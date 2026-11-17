//! Threat and danger places (T98.2, `CONTEXT.md`: Threat).

use csp_shared::balance::{
    DANGER_ESCORTS_MAX, DANGER_PLACE_FORGOTTEN, DANGER_PLACE_HALF_LIFE_DAYS, NPC_PLAN_TICKS,
    THREAT_FORGOTTEN, THREAT_HALF_LIFE_DAYS, THREAT_PER_KILLING, THREAT_PER_ROBBERY,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{CrimeKind, DangerPlace, Good, ResidentOrder, WorldState};

use super::*;
use crate::combat::attack_order;
use crate::crimes::{commit_crime, step_crimes, CrimeAgainst};
use crate::test_world::{add_city, empty_world, live, live_mut, realm, resident, step};

const SIZE: i32 = 256;

fn citizen(world: &mut WorldState, id: &str, owner: Option<&str>, at: (f64, f64), city: &str) {
    let i = resident(world, id, owner, at.0, at.1);
    world.residents[i].city_id = Some(city.to_string());
}

/// Realm r1 (Leader a1 at home in c1, far away) and the NPC city n1 at (100, 100), where n1a
/// lives, at home.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "a1");
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0, None);
    add_city(&mut world, "n1", None, 100.0, 100.0, None);
    citizen(&mut world, "a1", Some("r1"), (10.0, 10.0), "c1");
    citizen(&mut world, "n1a", None, (100.0, 100.0), "n1");
    world
}

fn n1(world: &WorldState) -> &City {
    world.cities.iter().find(|c| c.id == "n1").unwrap()
}

/// r1's soldier `id` at `at`, carrying `gear`.
fn soldier(world: &mut WorldState, id: &str, at: (f64, f64), gear: &[Good]) {
    citizen(world, id, Some("r1"), at, "c1");
    for g in gear {
        live_mut(world, id).carried.insert(*g, 1.0);
    }
}

/// On to n1's next planning pass and steps threat there.
fn plan_pass(world: &mut WorldState) {
    world.tick += 1;
    while !plan_due(world, "n1") {
        world.tick += 1;
    }
    step_threat(world, SIZE);
    assert!(threat_sound(world).is_empty(), "{:?}", threat_sound(world));
}

fn passes_in_days(days: f64) -> usize {
    (days * TICKS_PER_GAME_DAY / NPC_PLAN_TICKS).round() as usize
}

#[test]
fn armed_residents_near_a_city_raise_its_threat_more_with_better_gear() {
    let mut spear = setup();
    soldier(&mut spear, "s1", (110.0, 100.0), &[Good::Spear]);
    plan_pass(&mut spear);
    let by_spear = threat_of(&spear, n1(&spear), "r1");
    assert!(by_spear > 0.0);

    let mut armoured = setup();
    soldier(&mut armoured, "s1", (110.0, 100.0), &[Good::Sword, Good::Shield, Good::Armour]);
    plan_pass(&mut armoured);
    assert!(threat_of(&armoured, n1(&armoured), "r1") > by_spear);

    // Unarmed, or out of sight of the city and its people, they count for nothing.
    let mut far = setup();
    soldier(&mut far, "s1", (200.0, 200.0), &[Good::Sword]);
    citizen(&mut far, "u1", Some("r1"), (101.0, 100.0), "c1");
    plan_pass(&mut far);
    assert_eq!(far.cities.iter().find(|c| c.id == "n1").unwrap().threats, None);
}

#[test]
fn its_people_away_from_home_see_armed_residents_too() {
    let mut world = setup();
    // A trader of n1 out on the road, with r1's soldier beside them, far from n1.
    citizen(&mut world, "n1t", None, (200.0, 200.0), "n1");
    soldier(&mut world, "s1", (205.0, 200.0), &[Good::Sword]);
    plan_pass(&mut world);
    assert!(threat_of(&world, n1(&world), "r1") > 0.0);
}

#[test]
fn threat_builds_while_they_stay_and_fades_once_they_go() {
    let mut world = setup();
    soldier(&mut world, "s1", (110.0, 100.0), &[Good::Sword]);
    plan_pass(&mut world);
    let first = threat_of(&world, n1(&world), "r1");
    plan_pass(&mut world);
    let second = threat_of(&world, n1(&world), "r1");
    assert!(second > first, "{second} > {first}");
    // They go home: it fades to half in THREAT_HALF_LIFE_DAYS, and is forgotten in the end.
    live_mut(&mut world, "s1").x = 10.0;
    live_mut(&mut world, "s1").y = 10.0;
    world.cities[1].threats = Some([("r1".to_string(), 40.0)].into_iter().collect());
    for _ in 0..passes_in_days(THREAT_HALF_LIFE_DAYS) {
        plan_pass(&mut world);
    }
    let half = threat_of(&world, n1(&world), "r1");
    assert!((half - 20.0).abs() < 0.01, "{half}");
    for _ in 0..passes_in_days(THREAT_HALF_LIFE_DAYS * 10.0) {
        plan_pass(&mut world);
    }
    assert_eq!(n1(&world).threats, None);
}

#[test]
fn a_killed_trader_raises_threat_more_and_marks_a_danger_place() {
    let mut world = setup();
    // n1's trader on the road, 20 tiles out, with n1a at home in sight of it; r1's swordsman
    // passes by.
    citizen(&mut world, "n1t", None, (120.0, 100.0), "n1");
    live_mut(&mut world, "n1t").health = 1.0;
    soldier(&mut world, "s1", (120.0, 101.0), &[Good::Sword]);
    let mut seen = world.clone();
    plan_pass(&mut seen);
    let only_seen = threat_of(&seen, n1(&seen), "r1");

    live_mut(&mut world, "s1").order =
        Some(ResidentOrder::Attack(attack_order("n1t", false, false)));
    for _ in 0..20 {
        step(&mut world, SIZE);
        if live(&world, "n1t").is_none() {
            break;
        }
    }
    assert!(live(&world, "n1t").is_none(), "the trader was killed");
    // n1a saw it from home, so n1 knows at once.
    step(&mut world, SIZE);
    let threat = threat_of(&world, n1(&world), "r1");
    assert!(threat >= THREAT_PER_KILLING, "{threat}");
    assert!(threat > 10.0 * only_seen, "{threat} against {only_seen} for being seen");
    let places = n1(&world).danger_places.clone().unwrap();
    assert_eq!(places.len(), 1);
    assert!((places[0].x - 120.0).abs() <= 1.0 && (places[0].y - 100.0).abs() <= 1.0);
    assert_eq!(places[0].weight, 1.0);
    assert!(threat_sound(&world).is_empty());
}

#[test]
fn a_robbery_it_learns_of_raises_threat() {
    let mut world = setup();
    soldier(&mut world, "s1", (102.0, 100.0), &[]);
    let against = CrimeAgainst {
        victim_org: Some("n1".into()),
        victim: Some("n1a".into()),
        goods: Some([(Good::Food, 3.0)].into_iter().collect()),
        ..CrimeAgainst::default()
    };
    commit_crime(&mut world, SIZE, CrimeKind::Theft, "s1", against);
    step_crimes(&mut world, SIZE);
    assert_eq!(threat_of(&world, n1(&world), "r1"), THREAT_PER_ROBBERY);
}

#[test]
fn a_loss_to_bandits_marks_a_danger_place_and_more_losses_there_add_up() {
    let mut world = setup();
    for (id, at) in [("n1t", (150.0, 100.0)), ("n1u", (153.0, 102.0)), ("n1v", (180.0, 100.0))] {
        citizen(&mut world, id, None, at, "n1");
        live_mut(&mut world, id).health = 1.0;
    }
    // A bandit belongs to nobody: no crime, no threat, but the place is dangerous all the same.
    let b = resident(&mut world, "bandit", None, 150.0, 101.0);
    world.residents[b].carried.insert(Good::Sword, 1.0);
    let killed: Vec<_> = world
        .residents
        .iter()
        .filter(|r| r.id.starts_with("n1") && r.id != "n1a")
        .cloned()
        .collect();
    note_losses(&mut world, &killed, SIZE);
    let places = n1(&world).danger_places.clone().unwrap();
    assert_eq!(places.len(), 2);
    assert_eq!(places[0].weight, 2.0);
    assert_eq!(places[1].weight, 1.0);
    assert_eq!(n1(&world).threats, None);

    // One killed at home is no danger place.
    let mut home = setup();
    live_mut(&mut home, "n1a").health = 0.0;
    let killed = vec![live(&home, "n1a").unwrap().clone()];
    note_losses(&mut home, &killed, SIZE);
    assert_eq!(n1(&home).danger_places, None);
}

#[test]
fn danger_places_fade_away() {
    let mut world = setup();
    world.cities[1].danger_places = Some(vec![DangerPlace { x: 150.0, y: 100.0, weight: 1.0 }]);
    for _ in 0..passes_in_days(DANGER_PLACE_HALF_LIFE_DAYS) {
        plan_pass(&mut world);
    }
    let w = n1(&world).danger_places.as_ref().unwrap()[0].weight;
    assert!((w - 0.5).abs() < 0.01, "{w}");
    for _ in 0..passes_in_days(DANGER_PLACE_HALF_LIFE_DAYS * 2.0) {
        plan_pass(&mut world);
    }
    assert_eq!(n1(&world).danger_places, None);
}

#[test]
fn escorts_grow_on_a_way_past_a_danger_place() {
    let mut world = setup();
    let city = |w: &WorldState| n1(w).clone();
    assert_eq!(danger_escorts(&world, &city(&world), (200, 100), SIZE), 0);
    world.cities[1].danger_places = Some(vec![DangerPlace { x: 150.0, y: 105.0, weight: 1.0 }]);
    // On the way east it counts, on the way north it doesn't.
    assert_eq!(danger_escorts(&world, &city(&world), (200, 100), SIZE), 1);
    assert_eq!(danger_escorts(&world, &city(&world), (100, 20), SIZE), 0);
    // Short of the place, it isn't on the way either.
    assert_eq!(danger_escorts(&world, &city(&world), (120, 100), SIZE), 0);
    // A faded place still counts while remembered; many losses at most DANGER_ESCORTS_MAX more.
    world.cities[1].danger_places.as_mut().unwrap()[0].weight = DANGER_PLACE_FORGOTTEN;
    assert_eq!(danger_escorts(&world, &city(&world), (200, 100), SIZE), 1);
    world.cities[1].danger_places.as_mut().unwrap()[0].weight = 9.0;
    assert_eq!(
        danger_escorts(&world, &city(&world), (200, 100), SIZE),
        DANGER_ESCORTS_MAX as usize
    );
    // The way round the edge of the map is the short one: to (230, 100) it goes west.
    world.cities[1].danger_places = Some(vec![DangerPlace { x: 30.0, y: 100.0, weight: 1.0 }]);
    assert_eq!(danger_escorts(&world, &city(&world), (230, 100), SIZE), 1);
    world.cities[1].danger_places = Some(vec![DangerPlace { x: 160.0, y: 100.0, weight: 1.0 }]);
    assert_eq!(danger_escorts(&world, &city(&world), (230, 100), SIZE), 0);
}

#[test]
fn a_city_that_is_no_npc_city_any_more_forgets_it_all() {
    let mut world = setup();
    world.cities[1].threats = Some([("r1".to_string(), 40.0)].into_iter().collect());
    world.cities[1].danger_places = Some(vec![DangerPlace { x: 150.0, y: 100.0, weight: 1.0 }]);
    world.cities[1].realm_id = Some("r1".into());
    assert!(!threat_sound(&world).is_empty());
    step_threat(&mut world, SIZE);
    assert_eq!((&n1(&world).threats, &n1(&world).danger_places), (&None, &None));
    assert!(threat_sound(&world).is_empty());
}

#[test]
fn the_invariant_catches_a_negative_or_forgotten_threat_and_a_faded_place() {
    let mut world = setup();
    world.cities[1].threats = Some([("r1".to_string(), -1.0)].into_iter().collect());
    assert_eq!(threat_sound(&world).len(), 1);
    world.cities[1].threats =
        Some([("r1".to_string(), THREAT_FORGOTTEN / 2.0)].into_iter().collect());
    assert_eq!(threat_sound(&world).len(), 1);
    world.cities[1].threats = Some([("n1".to_string(), 5.0)].into_iter().collect());
    assert_eq!(threat_sound(&world).len(), 1);
    world.cities[1].threats = None;
    world.cities[1].danger_places = Some(vec![DangerPlace { x: 1.0, y: 1.0, weight: 0.0 }]);
    assert_eq!(threat_sound(&world).len(), 1);
}

#[test]
fn others_never_see_a_citys_threats() {
    let mut world = setup();
    world.cities[1].threats = Some([("r1".to_string(), 40.0)].into_iter().collect());
    world.cities[1].danger_places = Some(vec![DangerPlace { x: 150.0, y: 100.0, weight: 1.0 }]);
    citizen(&mut world, "u1", Some("r1"), (101.0, 100.0), "c1");
    let index = crate::world_index::WorldIndex::new(&world, SIZE);
    let mut cache = crate::sight::SightCache::open(SIZE);
    let seen = cache.side(&world, &index, "r1").entities(&world, &index);
    let json = serde_json::to_string(&*seen).unwrap();
    assert!(json.contains("\"n1\""), "r1 sees n1: {json}");
    assert!(!json.contains("threats") && !json.contains("dangerPlaces"), "{json}");
}

#[test]
fn a_city_saved_before_threat_loads_with_none_and_saves_without_them() {
    let world = setup();
    let mut json = serde_json::to_value(n1(&world)).unwrap();
    assert!(json.get("threats").is_none() && json.get("dangerPlaces").is_none());
    let old: City = serde_json::from_value(json.clone()).unwrap();
    assert_eq!((old.threats, old.danger_places), (None, None));
    json["threats"] = serde_json::json!({ "r1": 3.0 });
    json["dangerPlaces"] = serde_json::json!([{ "x": 1.0, "y": 2.0, "weight": 1.0 }]);
    let new: City = serde_json::from_value(json).unwrap();
    assert_eq!(new.threats.unwrap()["r1"], 3.0);
    assert_eq!(new.danger_places.unwrap()[0], DangerPlace { x: 1.0, y: 2.0, weight: 1.0 });
}
