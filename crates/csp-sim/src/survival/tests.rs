//! `survival.test.ts`, ported one to one where its rules are here; each test the port leaves out
//! says why and which ticket brings it.

use super::*;
use csp_shared::balance::{
    ticks_for_age, ADULT_AGE, HUNGER_ENDURANCE_LIMIT, START_FOOD, TERRAIN_FOOD,
};
use csp_shared::terrain::{terrain_at, Terrain};
use csp_shared::world::{Pile, Stat};

use crate::aging::step_aging;
use crate::queries::residents::{carry_capacity, is_down};
use crate::test_support::world_with_city;
use crate::world::step_world;

/// Game days from a full hunger meter with no food to going Down, at average Endurance.
const DEATH_DAYS: f64 = HUNGER_DAYS + STARVE_DAYS;

/// Runs survival on to the tick the last of those Down is due to die; returns who died then
/// (`untilDue`).
fn until_due(world: &mut WorldState, terrain: &TerrainMap) -> Vec<Resident> {
    let due = world.residents.iter().filter_map(|r| r.down_until).fold(f64::MIN, f64::max);
    world.tick = due as u64;
    let died = step_survival(world, terrain, &mut Scratch::default()).died;
    world.tick += 1;
    died
}

/// Runs survival for some game days; returns everyone who died, in order (`live`).
fn live(world: &mut WorldState, terrain: &TerrainMap, days: f64) -> Vec<Resident> {
    let mut scratch = Scratch::default();
    let mut died = Vec::new();
    for _ in 0..(days * TICKS_PER_GAME_DAY).ceil() as u64 {
        died.extend(step_survival(world, terrain, &mut scratch).died);
        world.tick += 1;
    }
    died
}

/// Steps the world `ticks` times, nobody walking.
fn step(world: &mut WorldState, terrain: &TerrainMap, ticks: u64) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        step_world(world, terrain, &mut scratch, None, None);
    }
}

fn storage_index(world: &WorldState) -> usize {
    world.buildings.iter().position(|b| b.kind == BuildingKind::Storage).unwrap()
}

fn storage_food(world: &WorldState) -> Option<f64> {
    world.buildings[storage_index(world)].stock.as_ref().and_then(|s| s.get(&Good::Food).copied())
}

/// A tile a few steps east of a starting city, outside its area (`awayFrom`).
fn away_from(world: &WorldState) -> (f64, f64) {
    let hall = town_hall_of(world, &world.cities[0]).unwrap();
    (hall.x + 7.0, hall.y - 4.0)
}

/// Every resident gets the same Endurance, so food use is predictable (`averageEndurance`).
fn average_endurance(world: &mut WorldState) {
    for r in &mut world.residents {
        r.stats.endurance = Stat { base: 10.0, trained: 0.0 };
    }
}

fn food(r: &Resident) -> f64 {
    carried_food(r)
}

fn food_stock(n: f64) -> Stock {
    Stock::from([(Good::Food, n)])
}

#[test]
fn has_a_resident_of_average_endurance_eat_half_a_unit_a_game_day() {
    let (mut world, terrain) = world_with_city();
    average_endurance(&mut world);
    world.residents.truncate(1);
    world.residents[0].carried = food_stock(12.0);
    assert_eq!(live(&mut world, &terrain, 20.0), []);
    let r = &world.residents[0];
    // 20 game days at 0.5 a day; eaten in whole units, so within one.
    assert!((12.0 - food(r) - 10.0).abs() <= 1.0);
    // A fed resident's meter stays above a third: a unit fills two thirds of it.
    assert!(r.hunger > 0.0);
    assert_eq!(r.health, MAX_HEALTH);
}

#[test]
fn feeds_residents_from_what_they_carry_everyone_lives() {
    let (mut world, terrain) = world_with_city();
    average_endurance(&mut world);
    for r in &mut world.residents {
        r.stats.strength = Stat { base: 15.0, trained: 0.0 }; // room to carry the food
        r.carried = food_stock(15.0);
    }
    let carried = |w: &WorldState| w.residents.iter().map(food).sum::<f64>();
    let before = carried(&world);
    assert_eq!(live(&mut world, &terrain, 5.0), []);
    let eaten = before - carried(&world);
    let n = world.residents.len() as f64;
    assert!((eaten - n * FOOD_PER_DAY * 5.0).abs() <= n);
    for r in &world.residents {
        assert!(r.hunger > 0.0);
        assert_eq!(r.health, MAX_HEALTH);
    }
    assert_eq!(down_do_nothing(&world), []);
}

#[test]
fn never_eats_straight_from_storage_also_at_home() {
    let (mut world, terrain) = world_with_city();
    average_endurance(&mut world);
    let s = storage_index(&world);
    let (sx, sy) = (world.buildings[s].x, world.buildings[s].y);
    let before = world.buildings[s].stock.clone();
    let city = world.cities[0].id.clone();
    for r in &mut world.residents {
        (r.x, r.y, r.order, r.carried) = (sx, sy, None, Stock::new());
    }
    for r in &world.residents {
        assert!(in_city_area(&world, &city, r.x as i32, r.y as i32, terrain.size));
    }
    assert_eq!(live(&mut world, &terrain, DEATH_DAYS + 0.5), []);
    assert!(world.residents.iter().all(|r| is_down(r.down_until)));
    assert_eq!(world.buildings[s].stock, before);
}

#[test]
fn puts_a_city_without_food_down_in_about_5_game_days_and_they_die_down_days_later() {
    let (mut world, terrain) = world_with_city();
    average_endurance(&mut world);
    for r in &mut world.residents {
        r.carried = Stock::new();
    }
    assert_eq!(live(&mut world, &terrain, DEATH_DAYS - 0.5), []);
    assert!(!world.residents.iter().any(|r| is_down(r.down_until)));
    assert_eq!(live(&mut world, &terrain, 1.0), []);
    assert!(world.residents.iter().all(|r| is_down(r.down_until) && r.health == 0.0));
    let went_down = world.tick as f64 - TICKS_PER_GAME_DAY;
    for r in &world.residents {
        let lies = r.down_until.unwrap() - went_down;
        assert!(lies > DOWN_DAYS * TICKS_PER_GAME_DAY);
        assert!(lies <= (DOWN_DAYS + 1.0) * TICKS_PER_GAME_DAY);
    }
    assert_eq!(down_do_nothing(&world), []);
    assert_eq!(until_due(&mut world, &terrain).len(), 8);
    assert!(world.residents.is_empty());
}

#[test]
fn eats_what_a_resident_carries_a_unit_at_a_time() {
    let (mut world, terrain) = world_with_city();
    average_endurance(&mut world);
    world.residents[1].carried = food_stock(3.0);
    // Two meals: a unit lasts 1 / FOOD_PER_DAY game days, eaten when the meter has room for it.
    live(&mut world, &terrain, 2.0 / FOOD_PER_DAY + 0.1);
    assert_eq!(food(&world.residents[1]), 1.0);
}

#[test]
fn drops_what_a_dead_resident_carried_in_a_pile_on_their_tile() {
    let (mut world, terrain) = world_with_city();
    average_endurance(&mut world);
    let (ax, ay) = away_from(&world);
    let r = &mut world.residents[1];
    (r.x, r.y, r.carried) = (ax, ay, Stock::from([(Good::Stone, 4.0)]));
    let id = r.id.clone();
    let goods = Stock::from([(Good::Stone, 1.0), (Good::Wood, 2.0)]);
    world.piles.push(Pile { id: "p0".into(), x: ax, y: ay, goods });
    live(&mut world, &terrain, DEATH_DAYS + 0.5);
    // Down, they still hold it.
    assert_eq!(world.residents[1].carried, Stock::from([(Good::Stone, 4.0)]));
    let died = until_due(&mut world, &terrain);
    assert_eq!(died.iter().map(|r| r.id.clone()).collect::<Vec<_>>(), [id]);
    let goods = Stock::from([(Good::Stone, 5.0), (Good::Wood, 2.0)]);
    assert_eq!(world.piles, [Pile { id: "p0".into(), x: ax, y: ay, goods }]);
}

#[test]
fn ends_the_realm_when_the_leader_dies() {
    let (mut world, terrain) = world_with_city();
    average_endurance(&mut world);
    let realm = world.realms[0].clone();
    let (ax, ay) = away_from(&world);
    let leader = world.residents.iter_mut().find(|r| r.id == realm.leader_id).unwrap();
    (leader.x, leader.y, leader.order, leader.carried) = (ax, ay, None, Stock::new());
    let mut ended: Vec<String> = Vec::new();
    let mut scratch = Scratch::default();
    for _ in 0..((DEATH_DAYS + 0.5) * TICKS_PER_GAME_DAY) as u64 {
        let result = step_survival(&mut world, &terrain, &mut scratch);
        ended.extend(result.ended.into_iter().map(|x| x.id));
        world.tick += 1;
    }
    // Down is not a Leader death.
    let leader = world.residents.iter().find(|r| r.id == realm.leader_id).unwrap();
    assert!(is_down(leader.down_until));
    assert!(ended.is_empty());
    assert_eq!(world.realms, std::slice::from_ref(&realm));
    assert_eq!(down_do_nothing(&world), []);
    world.tick = leader.down_until.unwrap() as u64;
    let result = step_survival(&mut world, &terrain, &mut scratch);
    ended.extend(result.ended.into_iter().map(|x| x.id));
    world.tick += 1;
    assert_eq!(ended, std::slice::from_ref(&realm.id));
    assert!(world.realms.is_empty());
    assert!(world.residents.iter().all(|r| r.owner.is_none()));
    assert_eq!(world.cities[0].realm_id, None);
    assert_eq!(world.horses[0].realm_id, None);
    // The others still have food on them.
    assert_eq!(world.residents.len(), 7);
    // The rest of the TypeScript test founds the Player a fresh starting city
    // (`foundStartingCity`, T86.8).
}

#[test]
fn ends_the_realm_making_each_city_self_managed() {
    let (mut world, terrain) = world_with_city();
    let realm = world.realms[0].clone();
    let city = world.cities[0].id.clone();
    let (ax, ay) = away_from(&world);
    // One stands away from home: they are sent home.
    world.residents[1].x = ax + 30.0;
    world.residents[1].y = ay;
    world.residents[1].order = None;
    let leader = world.residents.iter().position(|r| r.id == realm.leader_id).unwrap();
    world.residents[leader].down_until = Some(world.tick as f64);
    world.residents[leader].health = 0.0;
    let SurvivalResult { died, ended } =
        step_survival(&mut world, &terrain, &mut Scratch::default());
    assert_eq!(died.len(), 1);
    assert_eq!(ended, std::slice::from_ref(&realm));
    let c = &world.cities[0];
    assert_eq!(c.realm_id, None);
    assert_eq!(c.layout, Some(pick_layout(world.seed, &city)));
    assert_eq!(c.former_player, Some(FormerPlayer { user_id: realm.user_id, tick: 0.0 }));
    assert!(matches!(world.residents[0].order, Some(ResidentOrder::WalkTo(_))));
    assert!(world.carriages.iter().all(|k| k.city_id.as_deref() == Some(city.as_str())));
    let became = world.events.iter().find_map(|e| match &e.what {
        RealmEventWhat::SelfManaged { cities } => Some(cities.clone()),
        _ => None,
    });
    let became = became.expect("a self-managed event");
    assert_eq!(became.len(), 1);
    assert_eq!((became[0].city_id.as_str(), became[0].residents), (city.as_str(), 7.0));
    assert!(world.events.iter().any(|e| matches!(
        &e.what,
        RealmEventWhat::Died { leader: true, cause: DeathCause::Starved, .. }
    )));
}

#[test]
fn slowly_heals_a_fed_resident() {
    let (mut world, terrain) = world_with_city();
    world.residents[1].health = MAX_HEALTH / 2.0;
    live(&mut world, &terrain, 1.0);
    let health = world.residents[1].health;
    assert!(health > MAX_HEALTH / 2.0 && health < MAX_HEALTH);
    live(&mut world, &terrain, 1.0);
    assert_eq!(world.residents[1].health, MAX_HEALTH);
}

#[test]
fn lets_high_endurance_get_by_on_less_food() {
    let stock = |endurance: f64| {
        let (mut world, terrain) = world_with_city();
        for r in &mut world.residents {
            let trained = if endurance > 10.0 { 7.0 } else { 0.0 };
            r.stats.endurance = Stat { base: endurance, trained };
            r.stats.strength = Stat { base: 15.0, trained: 0.0 }; // room to carry the food
            r.carried = food_stock(30.0);
        }
        live(&mut world, &terrain, 20.0);
        world.residents.iter().map(food).sum::<f64>()
    };
    assert!(stock(15.0) > stock(5.0) + 20.0);
}

/// The first tile of terrain `t` on the test map that also passes `fits` (`tileOf`).
fn tile_of_terrain(
    terrain: &TerrainMap,
    t: Terrain,
    fits: impl Fn(i32, i32) -> bool,
) -> (i32, i32) {
    for y in 0..terrain.size {
        for x in 0..terrain.size {
            if terrain_at(terrain, x, y) == t as u8 && fits(x, y) {
                return (x, y);
            }
        }
    }
    panic!("no tile of terrain {t:?}")
}

#[test]
fn burns_more_food_on_hard_terrain_as_terrain_food_says() {
    let eaten = |t: Terrain| {
        let (mut world, terrain) = world_with_city();
        average_endurance(&mut world);
        let city = world.cities[0].id.clone();
        let (x, y) =
            tile_of_terrain(&terrain, t, |x, y| !in_city_area(&world, &city, x, y, terrain.size));
        let r = &mut world.residents[1];
        r.stats.strength = Stat { base: 15.0, trained: 0.0 }; // room to carry the food
        (r.x, r.y, r.order, r.carried) = (f64::from(x), f64::from(y), None, food_stock(25.0));
        let id = r.id.clone();
        live(&mut world, &terrain, 5.0);
        let r = world.residents.iter().find(|r| r.id == id).expect("alive");
        25.0 - food(r)
    };
    // Meals come in whole units, so each count may be one meal off what the days need.
    let plains = eaten(Terrain::Plains);
    assert!((plains - FOOD_PER_DAY * 5.0).abs() <= 1.0);
    assert!((eaten(Terrain::Forest) - plains).abs() <= 1.0);
    let hills = TERRAIN_FOOD.get(Terrain::Hills as u8).unwrap();
    assert!((eaten(Terrain::Hills) - FOOD_PER_DAY * 5.0 * hills).abs() <= 1.0);
    let mountain = TERRAIN_FOOD.get(Terrain::Mountain as u8).unwrap();
    assert!((eaten(Terrain::Mountain) - FOOD_PER_DAY * 5.0 * mountain).abs() <= 1.0);
}

#[test]
fn lets_endurance_soften_the_extra_food_hard_terrain_costs_within_its_limit() {
    let (mut world, _) = world_with_city();
    let tick = world.tick as f64;
    let r = &mut world.residents[1];
    let mut extra = |endurance: f64, t: Terrain| {
        r.stats.endurance = Stat { base: endurance, trained: 0.0 };
        food_use(r, t as u8, tick) / food_use(r, Terrain::Plains as u8, tick)
    };
    assert!((extra(10.0, Terrain::Mountain) - 2.0).abs() < 0.005);
    assert!(extra(20.0, Terrain::Mountain) < 2.0);
    assert!(extra(0.0, Terrain::Mountain) > 2.0);
    // However tough or frail, hard terrain costs more than plains and Endurance moves the extra
    // by no more than `HUNGER_ENDURANCE_LIMIT` of it.
    for e in [0.0, 5.0, 10.0, 15.0, 22.0, 40.0, 100.0] {
        for t in [Terrain::Hills, Terrain::Mountain] {
            let more = TERRAIN_FOOD.get(t as u8).unwrap() - 1.0;
            assert!(extra(e, t) > 1.0);
            assert!(extra(e, t) >= 1.0 + more * (1.0 - HUNGER_ENDURANCE_LIMIT) - 1e-9);
            assert!(extra(e, t) <= 1.0 + more * (1.0 + HUNGER_ENDURANCE_LIMIT) + 1e-9);
        }
        assert!((extra(e, Terrain::Forest) - 1.0).abs() < 0.005);
    }
}

#[test]
fn wakes_a_down_resident_who_has_food_in_their_hands() {
    let (mut world, _) = world_with_city();
    go_down(&mut world, 1);
    assert_eq!(down_do_nothing(&world), []);
    world.residents[1].carried = Stock::new();
    assert!(!wake(&mut world, 1, "r9"));
    world.residents[1].carried = food_stock(2.0);
    assert!(wake(&mut world, 1, "r9"));
    let r = &world.residents[1];
    assert_eq!((r.health, r.down_until, food(r)), (WAKE_HEALTH, None, 1.0));
    assert!(r.hunger > 0.0);
    assert_eq!(awake_alive(&world), []);
    world.residents[1].health = 0.0;
    assert_eq!(awake_alive(&world).len(), 1);
}

#[test]
fn reports_down_residents_that_do_something() {
    let (mut world, _) = world_with_city();
    go_down(&mut world, 1);
    world.residents[1].riding = Some("horse1".into());
    world.residents[1].health = 3.0;
    let v = down_do_nothing(&world);
    let id = &world.residents[1].id;
    assert_eq!(
        v.iter().map(|v| v.message.clone()).collect::<Vec<_>>(),
        [
            format!("resident {id} is Down but rides a horse"),
            format!("resident {id} is Down but has health 3")
        ]
    );
    keep_down_still(&mut world);
}

// ---- stepRefill ----

/// A starting city with everyone idle on the storage's tile, inside the walls, carrying nothing
/// (`atHome`).
fn at_home() -> (WorldState, TerrainMap) {
    let (mut world, terrain) = world_with_city();
    let s = storage_index(&world);
    let (sx, sy) = (world.buildings[s].x, world.buildings[s].y);
    for r in &mut world.residents {
        (r.x, r.y, r.order, r.carried) = (sx, sy, None, Stock::new());
        r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    }
    (world, terrain)
}

#[test]
fn tops_up_a_resident_at_home_who_runs_low_with_meals_from_their_citys_storage() {
    let (mut world, terrain) = at_home();
    world.residents[0].carried = food_stock(HOME_FOOD_LOW - 1.0);
    step_refill(&mut world, terrain.size);
    for r in &world.residents {
        assert_eq!(food(r), HOME_FOOD_LOW);
    }
    let n = world.residents.len() as f64;
    assert_eq!(storage_food(&world), Some(START_FOOD - ((n - 1.0) * HOME_FOOD_LOW + 1.0)));
}

#[test]
fn leaves_a_resident_who_isnt_running_low_alone() {
    let (mut world, terrain) = at_home();
    for r in &mut world.residents {
        r.carried = food_stock(HOME_FOOD_LOW);
    }
    step_refill(&mut world, terrain.size);
    assert_eq!(storage_food(&world), Some(START_FOOD));
}

#[test]
fn gives_nothing_away_from_home_nor_in_someone_elses_city() {
    let (mut world, terrain) = at_home();
    let (ax, ay) = away_from(&world);
    (world.residents[0].x, world.residents[0].y) = (ax, ay);
    world.residents[1].owner = Some("someone else".into());
    step_refill(&mut world, terrain.size);
    assert_eq!(world.residents[0].carried, Stock::new());
    assert_eq!(world.residents[1].carried, Stock::new());
    let n = world.residents.len() as f64;
    assert_eq!(storage_food(&world), Some(START_FOOD - (n - 2.0) * HOME_FOOD_LOW));
}

#[test]
fn takes_only_what_the_storage_has_and_what_fits() {
    let (mut world, terrain) = at_home();
    let tick = world.tick as f64;
    let capacity = carry_capacity(&world.residents[0], tick);
    world.residents[0].carried = Stock::from([(Good::Stone, capacity)]);
    let s = storage_index(&world);
    world.buildings[s].stock = Some(food_stock(1.0));
    step_refill(&mut world, terrain.size);
    assert_eq!(world.residents[0].carried.get(&Good::Food), None);
    let rest: Vec<f64> = world.residents[1..].iter().map(food).collect();
    let mut want = vec![0.0; rest.len()];
    want[0] = 1.0;
    assert_eq!(rest, want);
    assert_eq!(world.buildings[s].stock, Some(Stock::new()));
}

#[test]
fn keeps_a_city_at_home_fed_from_its_storage() {
    let (mut world, terrain) = at_home();
    average_endurance(&mut world);
    step(&mut world, &terrain, 5 * TICKS_PER_GAME_DAY as u64);
    assert_eq!(world.residents.len(), 8);
    for r in &world.residents {
        assert_eq!(r.health, MAX_HEALTH);
    }
    let eaten = START_FOOD - storage_food(&world).unwrap() - 8.0 * HOME_FOOD_LOW;
    // Spoilage takes a little more than the meals.
    assert!(eaten >= 8.0 * FOOD_PER_DAY * 5.0 - 8.0);
}

// "is caught by the invariant when skipped" and "is caught by the invariant when a child at home
// has only a meal" test `refilledWhenLow` of `invariants.ts`, which comes with T86.13.

/// Makes a resident a child of five (`makeChild`).
fn make_child(world: &mut WorldState, i: usize) {
    world.residents[i].born_at = world.tick as f64 - ticks_for_age(5.0).ceil();
}

#[test]
fn tops_a_child_at_home_up_to_their_own_food_not_just_a_meal() {
    let (mut world, terrain) = at_home();
    make_child(&mut world, 1);
    world.residents[1].carried = food_stock(HOME_FOOD_LOW);
    step_refill(&mut world, terrain.size);
    let child = food(&world.residents[1]);
    assert!((OWN_FOOD..OWN_FOOD + MEAL_UNITS).contains(&child));
    assert_eq!(food(&world.residents[2]), HOME_FOOD_LOW);
    let n = world.residents.len() as f64;
    let want = START_FOOD - (n - 1.0) * HOME_FOOD_LOW - (child - 1.0);
    assert_eq!(storage_food(&world), Some(want));
}

#[test]
fn tops_a_child_up_only_from_their_citys_storage_and_nothing_when_it_has_no_food() {
    let (mut world, terrain) = at_home();
    make_child(&mut world, 1);
    make_child(&mut world, 2);
    let (ax, ay) = away_from(&world);
    (world.residents[1].x, world.residents[1].y) = (ax, ay);
    let s = storage_index(&world);
    world.buildings[s].stock = Some(Stock::new());
    step_refill(&mut world, terrain.size);
    assert_eq!(world.residents[1].carried, Stock::new());
    assert_eq!(world.residents[2].carried, Stock::new());
}

#[test]
fn sends_a_child_out_of_the_city_with_days_of_food() {
    let (mut world, terrain) = at_home();
    average_endurance(&mut world);
    make_child(&mut world, 1);
    step(&mut world, &terrain, 1);
    assert!(food(&world.residents[1]) >= OWN_FOOD);
    let (ax, ay) = away_from(&world);
    (world.residents[1].x, world.residents[1].y) = (ax, ay);
    let id = world.residents[1].id.clone();
    step(&mut world, &terrain, 2 * TICKS_PER_GAME_DAY as u64);
    let child = world.residents.iter().find(|r| r.id == id).expect("alive");
    assert_eq!(child.health, MAX_HEALTH);
    assert!(food(child) > 0.0);
}

#[test]
fn refills_at_a_workplace_from_its_pile_then_a_carriage_standing_at_it() {
    let (mut world, terrain) = world_with_city();
    let farm = world.buildings.iter().find(|b| b.kind == BuildingKind::Farm).unwrap().clone();
    let r = &mut world.residents[1];
    r.carried = Stock::new();
    assert!(matches!(&r.order, Some(ResidentOrder::WorkAt(o)) if o.building_id == farm.id));
    world.piles.push(Pile { id: "p".into(), x: farm.x, y: farm.y, goods: food_stock(1.0) });
    world.carriages[0].x = farm.x + 1.0;
    world.carriages[0].y = farm.y + 1.0;
    world.carriages[0].load = food_stock(5.0);
    for r in &mut world.residents {
        r.carried = Stock::new();
    }
    step_refill(&mut world, terrain.size);
    // The pile's one unit went first, and the pile with it; the carriage gave the rest.
    assert!(world.piles.is_empty());
    let fed = world.residents.iter().filter(|r| food(r) >= HOME_FOOD_LOW).count();
    assert_eq!(fed, 6);
    assert_eq!(world.carriages[0].load, Stock::new());
}

// ---- children.test.ts, where it is survival and aging ----

#[test]
fn children_grow_up_at_adult_age_through_aging_in_the_running_world() {
    let (mut world, terrain) = world_with_city();
    let born = world.tick as f64;
    world.residents[1].born_at = born;
    let id = world.residents[1].id.clone();
    world.tick = (born + ticks_for_age(ADULT_AGE)) as u64 - 1;
    assert!(step_aging(&mut world, terrain.size).grown.is_empty());
    let grown = |w: &WorldState| {
        w.events.iter().filter(|e| matches!(e.what, RealmEventWhat::GrownUp { .. })).count()
    };
    assert_eq!(grown(&world), 0);
    // The running world's tick ages them past ADULT_AGE.
    world.tick -= 1;
    let mut scratch = Scratch::default();
    step_world(&mut world, &terrain, &mut scratch, None, None);
    assert_eq!(world.tick as f64, born + ticks_for_age(ADULT_AGE) - 1.0);
    step_world(&mut world, &terrain, &mut scratch, None, None);
    let child = world.residents.iter().find(|r| r.id == id).unwrap();
    assert!(can_work(child.born_at, world.tick as f64));
    let events: Vec<_> = world
        .events
        .iter()
        .filter(|e| matches!(&e.what, RealmEventWhat::GrownUp { resident_id, .. } if *resident_id == id))
        .collect();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].user_id, 1);
    // Growing up is logged once.
    step_world(&mut world, &terrain, &mut scratch, None, None);
    assert_eq!(grown(&world), 1);
}
