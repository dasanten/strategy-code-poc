//! `apps/server/src/horses.test.ts`, the parts on horses' hunger and riding. "stables in the world"
//! needs build orders, the order queue and starting cities (T86.2, T86.6, T86.8) and the invariant
//! cases need `horseStatsSound` and friends (T86.13): those come with T86.14.

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, DOWN_DAYS, HORSE_FOOD_PER_DAY, HORSE_HUNGRY_SHARE, HORSE_START_AGE_MAX,
    HORSE_START_AGE_MIN, HORSE_STAT_AVERAGE, HORSE_STAT_MAX, HORSE_STAT_MIN, HUNGER_DAYS,
    MAX_HEALTH, MAX_HUNGER, OWN_FOOD, STARVE_DAYS,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{
    BuildingKind, Good, Horse, HorseStats, Pile, RealmEventWhat, Stock, WorldState,
};

use super::*;
use crate::movement_test_world::{building, events_for, horse, resident, world_with_realm};
use crate::queries::names::held;
use crate::queries::residents::horse_age_in_years;
use crate::queries::riding::{horse_food, FoodPlace};
use crate::random::Mulberry32;

/// Plains, with forest at (3, 3).
fn map() -> TerrainMap {
    let mut tiles = vec![Terrain::Plains as u8; 16 * 16];
    tiles[3 * 16 + 3] = Terrain::Forest as u8;
    TerrainMap { size: 16, tiles }
}

fn stock(goods: &[(Good, f64)]) -> Stock {
    goods.iter().copied().collect()
}

/// A world with realm r1 (Player 7, Leader w1 at (0, 0) carrying 5 Food) and a finished stable
/// `s1` at (8, 8) holding `food`.
fn setup(food: f64) -> WorldState {
    let mut world = world_with_realm(&map());
    let mut w1 = resident("w1", Some("r1"), 0.0, 0.0);
    w1.carried = stock(&[(Good::Food, 5.0)]);
    world.residents.push(w1);
    let mut stable = building("s1", BuildingKind::Stable, 8.0, 8.0);
    stable.stock = Some(if food > 0.0 { stock(&[(Good::Food, food)]) } else { Stock::new() });
    world.buildings.push(stable);
    world
}

fn add_horse(world: &mut WorldState, id: &str, x: f64, y: f64) {
    world.horses.push(horse(id, Some("r1"), x, y));
}

fn h1(world: &WorldState) -> &Horse {
    world.horses.iter().find(|h| h.id == "h1").expect("h1")
}

fn h1_mut(world: &mut WorldState) -> &mut Horse {
    world.horses.iter_mut().find(|h| h.id == "h1").expect("h1")
}

fn stable_food(world: &WorldState, id: &str) -> f64 {
    let b = world.buildings.iter().find(|b| b.id == id).expect("the stable");
    held(b.stock.as_ref().expect("its storage"), Good::Food)
}

/// Runs the horses' part of `days` game days.
fn run(world: &mut WorldState, days: f64) -> Vec<Horse> {
    let terrain = map();
    let mut died = Vec::new();
    let mut t = 0.0;
    while t < days * TICKS_PER_GAME_DAY {
        died.extend(step_horses(world, &terrain));
        world.tick += 1;
        t += 1.0;
    }
    died
}

#[test]
fn feeds_a_horse_of_higher_endurance_less_of_lower_endurance_more() {
    let eaten = |endurance: f64| {
        let mut world = setup(0.0);
        add_horse(&mut world, "h1", 8.0, 8.0);
        h1_mut(&mut world).stats.endurance = endurance;
        world.buildings[0].stock = Some(stock(&[(Good::Food, 100.0)]));
        run(&mut world, 20.0);
        100.0 - stable_food(&world, "s1")
    };
    let average = eaten(HORSE_STAT_AVERAGE);
    let tough = eaten(HORSE_STAT_MAX);
    let weak = eaten(HORSE_STAT_MIN);
    assert!(tough < average);
    assert!(weak > average);
    let factor = crate::queries::pace::horse_food_factor(&HorseStats {
        speed: AVERAGE_HORSE_STATS.speed,
        strength: AVERAGE_HORSE_STATS.strength,
        endurance: HORSE_STAT_MAX,
    });
    assert!((tough - 20.0 * HORSE_FOOD_PER_DAY * factor).abs() <= 1.0);
}

#[test]
fn draws_a_new_horses_stats_and_age_in_their_ranges_and_a_name_from_the_pool() {
    assert!(HORSE_NAMES.len() >= 24);
    let tick = 3.0 * TICKS_PER_GAME_YEAR;
    for seed in 0..50 {
        let mut rand = Mulberry32::new(seed as f64);
        let mut next = || rand.next();
        let fields =
            NewHorse { id: "h".into(), realm_id: None, city_id: None, x: 0.0, y: 0.0, tick };
        let h = new_horse(&mut next, fields);
        for s in [h.stats.speed, h.stats.strength, h.stats.endurance] {
            assert_eq!(s.fract(), 0.0);
            assert!((HORSE_STAT_MIN..=HORSE_STAT_MAX).contains(&s));
        }
        let age = horse_age_in_years(&h, tick);
        assert!((HORSE_START_AGE_MIN..=HORSE_START_AGE_MAX).contains(&age));
        assert_eq!((h.hunger, h.health), (MAX_HUNGER, MAX_HEALTH));
        assert!(HORSE_NAMES.contains(&h.name.as_str()));
    }
}

#[test]
fn feeds_a_horse_in_a_stable_from_the_stables_storage_horse_food_per_day_a_game_day() {
    let mut world = setup(100.0);
    add_horse(&mut world, "h1", 8.0, 8.0);
    run(&mut world, 10.0);
    let eaten = 100.0 - stable_food(&world, "s1");
    assert!(eaten >= 10.0 * HORSE_FOOD_PER_DAY - 1.0);
    assert!(eaten <= 10.0 * HORSE_FOOD_PER_DAY + 1.0);
    assert!(h1(&world).hunger > 0.0);
    assert_eq!(h1(&world).health, MAX_HEALTH);
}

#[test]
fn starves_a_horse_with_nothing_in_reach_like_a_resident_down_and_then_dead_and_logs_both() {
    let mut world = setup(0.0);
    add_horse(&mut world, "h1", 2.0, 2.0);
    // A full meter lasts HUNGER_DAYS; then it loses health for STARVE_DAYS and goes Down.
    run(&mut world, HUNGER_DAYS - 0.01);
    assert!(h1(&world).hunger > 0.0);
    assert_eq!(h1(&world).health, MAX_HEALTH);
    assert!(run(&mut world, STARVE_DAYS + 0.02).is_empty());
    let until = h1(&world).down_until.expect("Down");
    let events: Vec<_> = events_for(&world, 7).into_iter().map(|e| e.what.clone()).collect();
    assert_eq!(
        events,
        vec![RealmEventWhat::HorseDown { horse_id: "h1".into(), name: "Rowan".into(), until }]
    );
    // Nobody puts Food by it before its time is up (`CONTEXT.md`: Down).
    let before = h1(&world).clone();
    let died = run(&mut world, DOWN_DAYS);
    assert_eq!(died, vec![before]);
    assert!(world.horses.is_empty());
    assert!(events_for(&world, 7).iter().any(|e| e.what
        == RealmEventWhat::HorseDied { horse_id: "h1".into(), name: Some("Rowan".into()) }));
}

#[test]
fn has_no_inventory_carried_food_and_food_in_another_stable_are_out_of_reach() {
    let mut world = setup(0.0);
    // The resident with plenty of food stands right on the horse's tile.
    add_horse(&mut world, "h1", 0.0, 0.0);
    let mut s2 = building("s2", BuildingKind::Stable, 1.0, 0.0);
    s2.stock = Some(stock(&[(Good::Food, 50.0)]));
    world.buildings.push(s2);
    run(&mut world, HUNGER_DAYS + STARVE_DAYS + DOWN_DAYS + 0.02);
    assert!(world.horses.is_empty());
    assert_eq!(held(&world.residents[0].carried, Good::Food), 5.0);
    assert_eq!(world.buildings[1].stock, Some(stock(&[(Good::Food, 50.0)])));
}

#[test]
fn eats_food_on_the_ground_on_its_tile_or_right_next_to_it_across_the_maps_join_too() {
    let terrain = map();
    let mut world = setup(0.0);
    add_horse(&mut world, "h1", 0.0, 5.0);
    let pile = |id: &str, x: f64, y: f64, goods: Stock| Pile { id: id.into(), x, y, goods };
    world.piles.push(pile("p1", 15.0, 6.0, stock(&[(Good::Food, 2.0), (Good::Wood, 3.0)])));
    world.piles.push(pile("p2", 2.0, 5.0, stock(&[(Good::Food, 50.0)])));
    h1_mut(&mut world).hunger = 0.0;
    step_horses(&mut world, &terrain);
    step_horses(&mut world, &terrain);
    let goods =
        |w: &WorldState, id: &str| w.piles.iter().find(|p| p.id == id).expect("pile").goods.clone();
    assert_eq!(goods(&world, "p1"), stock(&[(Good::Wood, 3.0)]));
    step_horses(&mut world, &terrain);
    // Two tiles away is out of reach.
    assert_eq!(goods(&world, "p2"), stock(&[(Good::Food, 50.0)]));
    assert!(h1(&world).hunger > 0.0);
}

#[test]
fn eats_from_its_stable_before_food_on_the_ground_and_an_emptied_pile_is_gone() {
    let terrain = map();
    let mut world = setup(1.0);
    // On the stable's south edge, with food just past it.
    add_horse(&mut world, "h1", 8.0, 10.0);
    world.piles.push(Pile { id: "p1".into(), x: 8.0, y: 11.0, goods: stock(&[(Good::Food, 1.0)]) });
    h1_mut(&mut world).hunger = 0.0;
    step_horses(&mut world, &terrain);
    assert_eq!(world.buildings[0].stock, Some(Stock::new()));
    assert_eq!(world.piles.len(), 1);
    step_horses(&mut world, &terrain);
    assert!(world.piles.is_empty());
}

#[test]
fn heals_a_fed_horse_that_went_hungry() {
    let mut world = setup(100.0);
    add_horse(&mut world, "h1", 8.0, 8.0);
    h1_mut(&mut world).health = MAX_HEALTH / 2.0;
    run(&mut world, 1.0);
    assert!(h1(&world).health > MAX_HEALTH / 2.0);
}

/// w1 riding h1 at (2, 2), out of the stable's reach, carrying `food`.
fn ridden(food: f64) -> WorldState {
    let mut world = setup(0.0);
    add_horse(&mut world, "h1", 2.0, 2.0);
    let w1 = &mut world.residents[0];
    (w1.x, w1.y) = (2.0, 2.0);
    w1.riding = Some("h1".into());
    w1.carried = stock(&[(Good::Food, food)]);
    world
}

fn horse_hungry(world: &WorldState) -> Vec<RealmEventWhat> {
    events_for(world, 7)
        .into_iter()
        .filter(|e| matches!(e.what, RealmEventWhat::HorseHungry { .. }))
        .map(|e| e.what.clone())
        .collect()
}

/// `horseFood` as the TypeScript calls it, with the rider looked up (`riderOf`).
fn food_of(world: &WorldState) -> Vec<FoodPlace> {
    let rider = world.residents.iter().position(|r| r.riding.as_deref() == Some("h1"));
    horse_food(world, h1(world), 16, rider)
}

#[test]
fn eats_its_riders_spare_food_and_leaves_their_own_food_alone() {
    let terrain = map();
    let mut world = ridden(OWN_FOOD + 3.0);
    assert_eq!(food_of(&world), vec![FoodPlace::Rider(0)]);
    // Kept starving, it eats a unit a tick until only the rider's own food is left.
    for _ in 0..5 {
        h1_mut(&mut world).hunger = 0.0;
        step_horses(&mut world, &terrain);
    }
    assert_eq!(held(&world.residents[0].carried, Good::Food), OWN_FOOD);
    assert!(food_of(&world).is_empty());
    // Off the horse, the resident's food is out of its reach again.
    world.residents[0].carried.insert(Good::Food, OWN_FOOD + 3.0);
    world.residents[0].riding = None;
    assert!(food_of(&world).is_empty());
}

#[test]
fn eats_food_on_the_ground_in_reach_before_its_riders() {
    let terrain = map();
    let mut world = ridden(OWN_FOOD + 3.0);
    world.piles.push(Pile { id: "p1".into(), x: 3.0, y: 3.0, goods: stock(&[(Good::Food, 1.0)]) });
    assert_eq!(food_of(&world), vec![FoodPlace::Pile(0), FoodPlace::Rider(0)]);
    h1_mut(&mut world).hunger = 0.0;
    step_horses(&mut world, &terrain);
    assert!(world.piles.is_empty());
    assert_eq!(held(&world.residents[0].carried, Good::Food), OWN_FOOD + 3.0);
    step_horses(&mut world, &terrain);
    assert_eq!(held(&world.residents[0].carried, Good::Food), OWN_FOOD + 2.0);
}

#[test]
fn logs_once_when_it_goes_hungry_and_its_rider_has_no_food_to_spare() {
    let mut world = ridden(OWN_FOOD);
    run(&mut world, HUNGER_DAYS);
    assert!(h1(&world).hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER);
    assert_eq!(
        horse_hungry(&world),
        vec![RealmEventWhat::HorseHungry {
            horse_id: "h1".into(),
            horse_name: Some("Rowan".into()),
            resident_id: "w1".into(),
            name: world.residents[0].name.clone(),
        }]
    );
}

#[test]
fn logs_nothing_while_its_riders_spare_food_keeps_it_fed() {
    let mut world = ridden(OWN_FOOD + 4.0 * HORSE_FOOD_PER_DAY);
    run(&mut world, 3.0);
    assert!(h1(&world).hunger > HORSE_HUNGRY_SHARE * MAX_HUNGER);
    assert!(held(&world.residents[0].carried, Good::Food) >= OWN_FOOD);
    assert!(horse_hungry(&world).is_empty());
}

#[test]
fn a_down_horse_ridden_or_with_its_carriage_driven_breaks_the_invariant() {
    let mut world = setup(0.0);
    add_horse(&mut world, "h1", 2.0, 2.0);
    assert!(horses_down_lie_still(&world).is_empty());
    let h = h1_mut(&mut world);
    (h.health, h.hunger, h.down_until) = (0.0, 0.0, Some(10.0));
    assert!(horses_down_lie_still(&world).is_empty());
    world.residents[0].riding = Some("h1".into());
    let found: Vec<String> = horses_down_lie_still(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(found, vec!["horse h1 is Down but is ridden".to_string()]);
}
