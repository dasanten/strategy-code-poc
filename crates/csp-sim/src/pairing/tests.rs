//! `apps/server/src/pairing.test.ts`, ported one to one where pairing itself runs it. Other order
//! kinds' "carrying a child" checks (work, build, tear down, haul, lines) are theirs to test
//! (T86.5, T86.6); the running-world test needs work and survival (T86.3, T86.6). `die` is the
//! `die_all` stand-in; `buildProblem` for a house is the `Ground` stand-in plus the city's area.

use csp_shared::balance::{CARRYING_TICKS, CHILD_STAT_SPREAD, HOUSING_ROOM, PAIRING_WAIT_TICKS};
use csp_shared::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};
use csp_shared::world::{
    BuildingKind, ConstructionSite, DeathCause, Good, RealmEventWhat, ResidentOrder, Stat,
    WorldState,
};

use super::*;
use crate::pending::die_all;
use crate::pending::ground::Ground;
use crate::queries::city::city_residents;
use crate::queries::city_area::{city_area_tiles, housing_room, surplus_food_line};
use crate::starting_city::found_starting_city;
use crate::test_world::{building, city_terrain, live, live_mut, resident, world_with_city};

const ME: Sender = Sender { user_id: 1, npc_city_id: None };
const STRANGER: Sender = Sender { user_id: 2, npc_city_id: None };
const WAIT_DAYS: usize = (PAIRING_WAIT_TICKS / TICKS_PER_GAME_DAY) as usize;
const CARRYING_DAYS: usize = (CARRYING_TICKS / TICKS_PER_GAME_DAY) as usize;
const DAYS_PER_YEAR: usize = (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY) as usize;

/// Player 1's starting city with plenty of food in storage; the ids of its residents.
fn setup(food: f64) -> (WorldState, Vec<String>) {
    let mut world = world_with_city();
    storage_of(&mut world).stock = Some([(Good::Food, food)].into_iter().collect());
    let ids = world.residents.iter().map(|r| r.id.clone()).collect();
    (world, ids)
}

fn storage_of(world: &mut WorldState) -> &mut csp_shared::world::Building {
    world.buildings.iter_mut().find(|b| b.kind == BuildingKind::Storage).unwrap()
}

fn city_id(world: &WorldState) -> String {
    world.cities[0].id.clone()
}

/// Sends a pairing order from `sender` and applies it; the reason it was turned down, if it was.
fn pair_up(world: &mut WorldState, a: &str, b: &str, sender: &Sender) -> Option<&'static str> {
    let o = PairRequest { resident_id: Some(a), partner_id: Some(b) };
    let reason = validate_pair(world, sender, &o);
    if reason.is_none() {
        apply_pair(world, &o);
    }
    reason
}

/// Runs only pairing for `n` game days, a day at a time; who was born, in order.
fn days(world: &mut WorldState, n: usize) -> Vec<String> {
    let mut born = Vec::new();
    for _ in 0..n {
        world.tick += TICKS_PER_GAME_DAY as u64;
        let actions = request_births(world);
        born.extend(resolve_births(world, &actions));
    }
    born
}

/// Whichever of the pair carries, if one does.
fn carrier_of(world: &WorldState, a: &str, b: &str) -> Option<String> {
    [a, b].into_iter().find(|id| live(world, id).unwrap().carrying.is_some()).map(str::to_string)
}

/// Adds a finished house to the city where one fits in its area.
fn add_house(world: &mut WorldState) {
    let terrain = city_terrain();
    let city = city_id(world);
    for (x, y) in city_area_tiles(world, &city, terrain.size) {
        if !Ground::new(world, terrain, &[]).fits(BuildingKind::House, x, y, &|_, _| true) {
            continue;
        }
        building(
            world,
            &format!("h{x},{y}"),
            BuildingKind::House,
            Some(&city),
            f64::from(x),
            f64::from(y),
        );
        return;
    }
    panic!("no free tile in the city");
}

fn die(world: &mut WorldState, id: &str) {
    die_all(world, &[id.to_string()], DeathCause::Killed, city_terrain().size, &[]);
}

#[test]
fn counts_houses_room_against_the_residents_and_only_finished_houses() {
    let (mut world, _) = setup(100_000.0);
    let city = city_id(&world);
    let houses = world.buildings.iter().filter(|b| b.kind == BuildingKind::House).count() as f64;
    let room = HOUSING_ROOM.get("house").unwrap();
    assert_eq!(housing_room(&world, &city), houses * room);
    assert_eq!(free_housing(&world, &city), houses * room - world.residents.len() as f64);
    let house = world.buildings.iter_mut().find(|b| b.kind == BuildingKind::House).unwrap();
    house.site = Some(
        serde_json::from_value::<ConstructionSite>(
            serde_json::json!({ "delivered": {}, "work": 0 }),
        )
        .unwrap(),
    );
    assert_eq!(housing_room(&world, &city), (houses - 1.0) * room);
}

#[test]
fn counts_residents_of_the_city_wherever_they_stand() {
    let (mut world, _) = setup(100_000.0);
    world.residents[0].x = 0.0;
    world.residents[0].y = 0.0;
    assert_eq!(city_residents(&world, &city_id(&world)).len(), world.residents.len());
}

#[test]
fn has_a_surplus_only_with_more_stored_food_than_its_residents_eat_in_the_surplus_days() {
    let (mut world, _) = setup(100_000.0);
    let line = surplus_food_line(&world, &world.cities[0]);
    storage_of(&mut world).stock = Some([(Good::Food, line.floor())].into_iter().collect());
    assert!(!has_food_surplus(&world, &world.cities[0]));
    // Food the residents carry doesn't count.
    for r in &mut world.residents {
        r.carried = [(Good::Food, 10.0)].into_iter().collect();
    }
    assert!(!has_food_surplus(&world, &world.cities[0]));
    storage_of(&mut world).stock = Some([(Good::Food, line.floor() + 1.0)].into_iter().collect());
    assert!(has_food_surplus(&world, &world.cities[0]));
}

#[test]
fn pairs_two_adults_of_the_same_city_leaving_what_both_of_them_do_alone() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (&ids[0], &ids[1]);
    let before = (
        live(&world, a).unwrap().order.clone(),
        live(&world, b).unwrap().order.clone(),
        live(&world, a).unwrap().script.clone(),
    );
    assert!(matches!(before.0, Some(ResidentOrder::WorkAt(_))));
    assert_eq!(pair_up(&mut world, a, b, &ME), None);
    let since = world.tick as f64;
    assert_eq!(live(&world, a).unwrap().pair, Some(Pair { partner_id: b.clone(), since }));
    assert_eq!(live(&world, b).unwrap().pair, Some(Pair { partner_id: a.clone(), since }));
    let after = (
        live(&world, a).unwrap().order.clone(),
        live(&world, b).unwrap().order.clone(),
        live(&world, a).unwrap().script.clone(),
    );
    assert_eq!(after, before);
}

#[test]
fn turns_down_children_a_resident_on_their_own_other_cities_and_other_players_residents() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (ids[0].clone(), ids[1].clone());
    let reason = |world: &WorldState, x: &str, y: &str, sender: &Sender| {
        validate_pair(world, sender, &PairRequest { resident_id: Some(x), partner_id: Some(y) })
    };
    assert!(reason(&world, &a, &a, &ME).unwrap().contains("themselves"));
    assert!(reason(&world, &a, &b, &STRANGER).unwrap().contains("not one of your residents"));
    assert!(reason(&world, &a, "nobody", &ME).unwrap().contains("not one"));
    let tick = world.tick as f64;
    live_mut(&mut world, &b).born_at = tick - csp_shared::balance::ticks_for_age(5.0);
    assert!(reason(&world, &a, &b, &ME).unwrap().contains("children"));
    live_mut(&mut world, &b).born_at = tick - csp_shared::balance::ticks_for_age(30.0);
    live_mut(&mut world, &b).city_id = None;
    assert!(reason(&world, &a, &b, &ME).unwrap().contains("same city"));
    // A resident of the same realm but another city.
    found_starting_city(&mut world, city_terrain(), 2, None);
    let other = world.cities[1].id.clone();
    live_mut(&mut world, &b).city_id = Some(other);
    assert!(reason(&world, &a, &b, &ME).unwrap().contains("same city"));
}

#[test]
fn ends_for_the_one_left_when_a_partner_dies_or_pairs_with_someone_else() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b, c, d) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    pair_up(&mut world, a, b, &ME);
    request_births(&mut world);
    assert_eq!(
        live(&world, b).unwrap().pair,
        Some(Pair { partner_id: a.clone(), since: world.tick as f64 })
    );
    pair_up(&mut world, c, d, &ME);
    die(&mut world, c);
    // `die` ends the pair of the one left at once.
    assert_eq!(live(&world, d).unwrap().pair, None);
}

#[test]
fn moves_a_resident_to_a_new_partner_ending_the_old_pair() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b, c) = (&ids[0], &ids[1], &ids[2]);
    pair_up(&mut world, a, b, &ME);
    pair_up(&mut world, a, c, &ME);
    request_births(&mut world);
    assert_eq!(live(&world, b).unwrap().pair, None);
    assert_eq!(
        live(&world, a).unwrap().pair.as_ref().map(|p| p.partner_id.as_str()),
        Some(c.as_str())
    );
    assert_eq!(
        live(&world, c).unwrap().pair.as_ref().map(|p| p.partner_id.as_str()),
        Some(a.as_str())
    );
}

#[test]
fn keeps_a_pairs_time_when_it_is_ordered_again_so_re_pairing_never_hurries_a_child() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (&ids[0], &ids[1]);
    pair_up(&mut world, a, b, &ME);
    let since = world.tick as f64;
    world.tick += TICKS_PER_GAME_DAY as u64;
    pair_up(&mut world, b, a, &ME);
    assert_eq!(live(&world, a).unwrap().pair.as_ref().unwrap().since, since);
    assert_eq!(live(&world, b).unwrap().pair.as_ref().unwrap().since, since);
}

#[test]
fn starts_pairing_wait_days_after_pairing_one_partner_carries_and_stops_the_other_works_on() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (&ids[0], &ids[1]);
    pair_up(&mut world, a, b, &ME);
    assert!(days(&mut world, WAIT_DAYS - 1).is_empty());
    assert_eq!(carrier_of(&world, a, b), None);
    days(&mut world, 1);
    let carrier = carrier_of(&world, a, b).unwrap();
    let other = if carrier == *a { b } else { a };
    let carrying = live(&world, &carrier).unwrap().carrying.clone().unwrap();
    assert_eq!((carrying.since, carrying.partner_id.as_str()), (world.tick as f64, other.as_str()));
    assert_eq!(carrying.partner_name, live(&world, other).unwrap().name);
    assert_eq!(live(&world, other).unwrap().carrying, None);
    // The carrier's work ends; the other partner's order is untouched.
    assert_eq!(live(&world, &carrier).unwrap().order, None);
    assert_eq!(live(&world, &carrier).unwrap().script, None);
    assert!(matches!(live(&world, other).unwrap().order, Some(ResidentOrder::WorkAt(_))));
}

#[test]
fn has_the_child_carrying_days_after_carrying_starts_and_ends_the_pair() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (&ids[0], &ids[1]);
    pair_up(&mut world, a, b, &ME);
    days(&mut world, WAIT_DAYS);
    let carrier = carrier_of(&world, a, b).unwrap();
    let start = world.tick as f64;
    assert!(days(&mut world, CARRYING_DAYS - 1).is_empty());
    let born = days(&mut world, 1);
    let child = live(&world, &born[0]).unwrap();
    assert_eq!(child.born_at - start, CARRYING_TICKS);
    assert_eq!(child.born_at - start, 10.0 * TICKS_PER_GAME_DAY);
    let c = live(&world, &carrier).unwrap();
    assert_eq!((child.x, child.y, child.city_id.clone()), (c.x, c.y, c.city_id.clone()));
    for id in [a, b] {
        let r = live(&world, id).unwrap();
        assert_eq!((r.pair.clone(), r.carrying.clone()), (None, None));
    }
    // Without pairing again, no other child comes.
    assert!(days(&mut world, 2 * DAYS_PER_YEAR).is_empty());
}

#[test]
fn picks_the_partner_who_carries_at_random() {
    let mut carriers = std::collections::HashSet::new();
    for seed in 1..=12 {
        let (mut world, ids) = setup(100_000.0);
        world.seed = seed;
        pair_up(&mut world, &ids[0], &ids[1], &ME);
        days(&mut world, WAIT_DAYS);
        carriers.insert(carrier_of(&world, &ids[0], &ids[1]) == Some(ids[0].clone()));
    }
    assert_eq!(carriers.len(), 2);
}

#[test]
fn waits_pairing_wait_days_again_between_children_however_soon_the_pair_is_paired_again() {
    let (mut world, ids) = setup(100_000.0);
    for _ in 0..3 {
        add_house(&mut world);
    }
    let (a, b) = (&ids[0], &ids[1]);
    pair_up(&mut world, a, b, &ME);
    let mut born = Vec::new();
    for _ in 0..5 * DAYS_PER_YEAR {
        let today = days(&mut world, 1);
        // Paired again the day the child is born.
        if !today.is_empty() {
            pair_up(&mut world, a, b, &ME);
        }
        born.extend(today);
    }
    assert!(born.len() >= 3, "{} born", born.len());
    let ticks: Vec<f64> = born.iter().map(|id| live(&world, id).unwrap().born_at).collect();
    for w in ticks.windows(2) {
        assert_eq!(w[1] - w[0], PAIRING_WAIT_TICKS + CARRYING_TICKS);
    }
}

/// The pairing part of the TypeScript test; the other kinds' checks are their tickets'.
#[test]
fn turns_down_pairing_for_a_resident_carrying() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b, c) = (&ids[0], &ids[1], &ids[2]);
    pair_up(&mut world, a, b, &ME);
    days(&mut world, WAIT_DAYS);
    let carrier = carrier_of(&world, a, b).unwrap();
    assert_eq!(pair_up(&mut world, &carrier, c, &ME), Some(CARRYING_A_CHILD));
    assert!(carrying_blocks(&ResidentOrder::Haul(serde_json::from_value(serde_json::json!({
        "carriageId": "k", "from": { "x": 0, "y": 0 }, "to": { "x": 0, "y": 0 }, "goods": [], "returnGoods": [],
        "keepFood": 0, "stop": "to", "phase": "driving", "path": null, "progress": 0, "moving": null
    })).unwrap())));
}

#[test]
fn stops_the_houses_filling_up_children_on_the_way_count_against_free_housing() {
    let (mut world, ids) = setup(100_000.0);
    let city = city_id(&world);
    let (a, b, c, d) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    let free = free_housing(&world, &city);
    assert!(free > 0.0);
    for _ in 0..free as usize + 1 {
        pair_up(&mut world, a, b, &ME);
        pair_up(&mut world, c, d, &ME);
        days(&mut world, WAIT_DAYS + CARRYING_DAYS);
        assert!(city_residents(&world, &city).len() as f64 <= housing_room(&world, &city));
    }
    assert_eq!((world.residents.len() - ids.len()) as f64, free);
    assert_eq!(free_housing(&world, &city), 0.0);
    add_house(&mut world);
    pair_up(&mut world, a, b, &ME);
    pair_up(&mut world, c, d, &ME);
    let born = days(&mut world, WAIT_DAYS + CARRYING_DAYS).len() as f64;
    assert_eq!(born, 2f64.min(HOUSING_ROOM.get("house").unwrap()));
}

#[test]
fn waits_for_a_food_surplus_in_storage_food_the_pair_carries_doesnt_help() {
    let (mut world, ids) = setup(0.0);
    let (a, b) = (&ids[0], &ids[1]);
    live_mut(&mut world, a).carried = [(Good::Food, 30.0)].into_iter().collect();
    live_mut(&mut world, b).carried = [(Good::Food, 30.0)].into_iter().collect();
    pair_up(&mut world, a, b, &ME);
    days(&mut world, 2 * DAYS_PER_YEAR);
    assert_eq!(carrier_of(&world, a, b), None);
    let line = surplus_food_line(&world, &world.cities[0]);
    storage_of(&mut world).stock = Some([(Good::Food, line.ceil() + 1.0)].into_iter().collect());
    days(&mut world, 1);
    assert!(carrier_of(&world, a, b).is_some());
}

#[test]
fn makes_a_child_of_the_carriers_city_and_realm_on_their_tile_inheriting_base_stats_only() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (&ids[0], &ids[1]);
    live_mut(&mut world, a).stats.strength = Stat { base: 14.0, trained: 7.0 };
    live_mut(&mut world, b).stats.strength = Stat { base: 6.0, trained: 3.0 };
    live_mut(&mut world, a).skills.insert(csp_shared::world::SkillName::Construction, 5.0);
    pair_up(&mut world, a, b, &ME);
    days(&mut world, WAIT_DAYS);
    let carrier = carrier_of(&world, a, b).unwrap();
    let born = days(&mut world, CARRYING_DAYS);
    let child = live(&world, &born[0]).unwrap();
    let (ra, rb, c) =
        (live(&world, a).unwrap(), live(&world, b).unwrap(), live(&world, &carrier).unwrap());
    assert_eq!(child.owner, ra.owner);
    assert_eq!(child.city_id.as_deref(), Some(world.cities[0].id.as_str()));
    assert_eq!((child.x, child.y, child.born_at), (c.x, c.y, world.tick as f64));
    assert!(child.skills.is_empty() && child.carried.is_empty() && child.order.is_none());
    let pairs = [
        (&child.stats.strength, ra.stats.strength.base, rb.stats.strength.base),
        (&child.stats.endurance, ra.stats.endurance.base, rb.stats.endurance.base),
        (&child.stats.agility, ra.stats.agility.base, rb.stats.agility.base),
        (&child.stats.intellect, ra.stats.intellect.base, rb.stats.intellect.base),
    ];
    for (s, x, y) in pairs {
        let average = crate::queries::js_round((x + y) / 2.0);
        assert!((s.base - average).abs() <= CHILD_STAT_SPREAD);
        assert_eq!(s.trained, 0.0);
    }
    assert!(!can_work(child.born_at, world.tick as f64));
    let last = world.events.last().unwrap();
    assert_eq!(last.user_id, 1);
    assert!(matches!(&last.what, RealmEventWhat::Born { resident_id, name, parents }
        if *resident_id == child.id && *name == child.name && parents.contains(&ra.name) && parents.contains(&rb.name)));
}

#[test]
fn still_has_the_child_when_the_other_parent_dies_while_it_is_carried() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (&ids[0], &ids[1]);
    pair_up(&mut world, a, b, &ME);
    days(&mut world, WAIT_DAYS);
    let carrier = carrier_of(&world, a, b).unwrap();
    let other = if carrier == *a { b.clone() } else { a.clone() };
    let names =
        (live(&world, &carrier).unwrap().name.clone(), live(&world, &other).unwrap().name.clone());
    die(&mut world, &other);
    let born = days(&mut world, CARRYING_DAYS);
    assert_eq!(born.len(), 1);
    assert!(
        matches!(&world.events.last().unwrap().what, RealmEventWhat::Born { parents, .. } if *parents == [names.0.clone(), names.1.clone()])
    );
}

#[test]
fn never_makes_a_base_stat_below_1() {
    let (mut world, ids) = setup(100_000.0);
    let (a, b) = (&ids[0], &ids[1]);
    for id in [a, b] {
        let r = live_mut(&mut world, id);
        for s in [
            &mut r.stats.strength,
            &mut r.stats.endurance,
            &mut r.stats.agility,
            &mut r.stats.intellect,
        ] {
            *s = Stat { base: 1.0, trained: 0.0 };
        }
    }
    pair_up(&mut world, a, b, &ME);
    for child in days(&mut world, WAIT_DAYS + CARRYING_DAYS) {
        let c = live(&world, &child).unwrap();
        for s in [&c.stats.strength, &c.stats.endurance, &c.stats.agility, &c.stats.intellect] {
            assert!(s.base >= 1.0);
        }
    }
}

#[test]
#[ignore = "needs the running world's work and survival (T86.3, T86.6)"]
fn happens_in_the_running_world_the_partner_keeps_farming_while_the_other_carries() {}

#[test]
fn a_resident_of_no_city_cant_pair() {
    let (mut world, ids) = setup(100_000.0);
    let owner = live(&world, &ids[0]).unwrap().owner.clone();
    resident(&mut world, "loner", owner.as_deref(), 0.0, 0.0);
    assert!(pair_up(&mut world, "loner", &ids[0], &ME).is_some());
}
