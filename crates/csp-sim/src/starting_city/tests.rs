//! `apps/server/src/starting-city.test.ts`, and parity with the TypeScript: the `sight/*.json`
//! fixtures are `createWorld(cityTerrain())` with `foundStartingCity` for Players 1 to n, so the
//! Rust world founded the same way must be the same world. `checkInvariants` is T86.13's.

use csp_shared::balance::NPC_VILLAGE;
use csp_shared::balance::{
    ADULT_AGE, HOUSING_ROOM, MAX_HEALTH, MAX_HUNGER, START_CARRIED_FOOD, START_CITY_SIZE,
    START_COINS, START_FOOD, START_HORSES, START_RESIDENTS, START_SPEARS, START_STABLE_FOOD,
    STAT_BASE_MAX, STAT_BASE_MIN,
};
use csp_shared::terrain::{terrain_at, Terrain};
use csp_shared::world::{AlarmKind, BuildingKind, Good, ResidentOrder, Stock, WorldState};

use super::*;
use crate::alarms::raise_outsider;
use crate::invariants::check_all;
use crate::npc_cities::{find_npc_city_site, found_npc_city};
use crate::queries::city_area::{in_city_area, is_city_building};
use crate::queries::residents::{age_in_years, is_armed};
use crate::queues::tests::resident;
use crate::test_world::{city_terrain, world_with_city};
use crate::world::create_world;

fn fixture(name: &str) -> WorldState {
    let path = format!("{}/fixtures/sight/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(path).expect("the sight fixtures are in git");
    let mut value: serde_json::Value = serde_json::from_str(&text).expect("a fixture is JSON");
    serde_json::from_value(value["world"].take()).expect("a fixture holds a world")
}

fn founded_for(players: u64) -> WorldState {
    let terrain = city_terrain();
    let mut world = create_world(terrain, 1);
    for user in 1..=players {
        found_starting_city(&mut world, terrain, user, None);
    }
    world
}

/// The world as the TypeScript founded it: its starting cities held no Coins (T101.2 gave them
/// `START_COINS`, which `gives_a_player_a_realm_with_everything_a_starting_city_has` checks) and
/// its residents no Spear (T104.1, `starting_residents_each_carry_an_iron_spear_and_are_armed`), so
/// these are taken out to compare the rest with the frozen fixtures.
fn as_the_typescript_founded(mut world: WorldState) -> WorldState {
    for b in world.buildings.iter_mut().filter(|b| b.kind == BuildingKind::Storage) {
        if let Some(stock) = b.stock.as_mut() {
            assert_eq!(stock.shift_remove(&Good::Coins), Some(START_COINS));
        }
    }
    for r in &mut world.residents {
        assert_eq!(r.carried.shift_remove(&Good::Spear), Some(START_SPEARS));
    }
    world
}

/// The world as the TypeScript founded it: its stable hands (T104.3) worked the farm as everyone
/// else, so each is put back on it to compare the rest with the frozen fixtures;
/// `one_grown_resident_not_the_leader_starts_on_farm_and_feed` checks the queue.
fn without_stable_hands(mut world: WorldState) -> WorldState {
    for realm in world.realms.clone() {
        let leader = world.residents.iter().find(|r| r.id == realm.leader_id).unwrap().clone();
        let hand = world
            .residents
            .iter_mut()
            .find(|r| r.owner.as_ref() == Some(&realm.id) && r.queue.is_some())
            .unwrap();
        hand.queue = None;
        (hand.order, hand.script) = (leader.order, leader.script);
    }
    world
}

/// Both of the above.
fn as_the_typescript(world: WorldState) -> WorldState {
    without_stable_hands(as_the_typescript_founded(world))
}

#[test]
fn founds_the_typescripts_starting_city() {
    assert_eq!(as_the_typescript(founded_for(1)), fixture("city"));
}

#[test]
fn founds_the_typescripts_starting_cities_for_two_and_three_players() {
    assert_eq!(as_the_typescript(founded_for(2)), fixture("two-realms"));
    assert_eq!(as_the_typescript(founded_for(3)), fixture("three-realms"));
}

#[test]
fn one_grown_resident_not_the_leader_starts_on_farm_and_feed() {
    let world = founded_for(2);
    for realm in &world.realms {
        let hands: Vec<_> = world
            .residents
            .iter()
            .filter(|r| r.owner.as_ref() == Some(&realm.id) && r.queue.is_some())
            .collect();
        assert_eq!(hands.len(), 1);
        let hand = hands[0];
        assert_ne!(hand.id, realm.leader_id);
        assert!(age_in_years(hand.born_at, world.tick as f64) >= ADULT_AGE);
        let city = world.cities.iter().find(|c| c.realm_id.as_ref() == Some(&realm.id)).unwrap();
        let of_city = |k: BuildingKind| {
            world.buildings.iter().find(|b| b.kind == k && b.city_id == Some(city.id.clone()))
        };
        let (farm, stable) =
            (of_city(BuildingKind::Farm).unwrap(), of_city(BuildingKind::Stable).unwrap());
        let q = hand.queue.as_ref().unwrap();
        assert_eq!((q.name.as_deref(), q.r#loop), (Some(FARM_AND_FEED), true));
        assert_eq!(q.realm_id, realm.id);
        let written = serde_json::to_value(&q.items).unwrap();
        let mut expected = farm_and_feed(farm, stable);
        // Ids from 1, a block before its items.
        expected[0]["id"] = 1.into();
        for (n, id) in [2, 3, 4].into_iter().enumerate() {
            expected[0]["items"][n]["id"] = id.into();
        }
        expected[1]["id"] = 5.into();
        assert_eq!(written, expected);
        // The stable starts with plenty, so their first step is the farm, for a game hour.
        assert_eq!(q.current, 5);
        assert!(hand.order.is_none() && hand.script.is_none());
    }
}

#[test]
fn gives_a_player_a_realm_with_everything_a_starting_city_has() {
    let world = world_with_city();
    let terrain = city_terrain();
    let realm = &world.realms[realm_of(&world, 1).unwrap()];
    assert_eq!(world.realms.len(), 1);
    let city = &world.cities[0];
    assert_eq!(city.realm_id.as_deref(), Some(realm.id.as_str()));
    // A town hall, and a ring of wooden wall with one gate in the middle of a side.
    let hall = town_hall_of(&world, city).unwrap();
    assert_eq!(
        (hall.kind, hall.city_id.as_deref()),
        (BuildingKind::TownHall, Some(city.id.as_str()))
    );
    let walls: Vec<_> = world
        .buildings
        .iter()
        .filter(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate))
        .collect();
    assert_eq!(walls.len() as f64, 4.0 * (START_CITY_SIZE - 1.0));
    assert_eq!(walls.iter().filter(|b| b.kind == BuildingKind::Gate).count(), 1);
    for b in world.buildings.iter().filter(|b| is_city_building(b)) {
        assert_eq!(b.city_id.as_deref(), Some(city.id.as_str()));
    }
    let residents: Vec<_> =
        world.residents.iter().filter(|r| r.owner.as_deref() == Some(realm.id.as_str())).collect();
    assert_eq!(residents.len() as f64, START_RESIDENTS);
    assert!(residents.iter().any(|r| r.id == realm.leader_id));
    // Everyone starts on the farm, working it, with a little food on them; the stable hand on
    // their queue instead (`one_grown_resident_not_the_leader_starts_on_farm_and_feed`).
    let farm = world.buildings.iter().find(|b| b.kind == BuildingKind::Farm).unwrap();
    for r in &residents {
        assert_eq!(r.city_id.as_deref(), Some(city.id.as_str()));
        assert_eq!((r.x, r.y), (farm.x, farm.y));
        assert_eq!(r.carried.get(&Good::Food), Some(&START_CARRIED_FOOD));
        assert!(
            r.queue.is_some()
                || matches!(&r.order, Some(ResidentOrder::WorkAt(o))
            if o.building_id == farm.id && o.at.x == farm.x && o.at.y == farm.y && o.progress == 0.0 && o.makes.is_none())
        );
        assert_eq!((r.health, r.hunger), (MAX_HEALTH, MAX_HUNGER));
        assert!(age_in_years(r.born_at, world.tick as f64) >= ADULT_AGE);
        for s in [&r.stats.strength, &r.stats.endurance, &r.stats.agility, &r.stats.intellect] {
            assert!((STAT_BASE_MIN..=STAT_BASE_MAX).contains(&s.base));
        }
    }
    let count = |k: BuildingKind| world.buildings.iter().filter(|b| b.kind == k).count();
    assert!(
        count(BuildingKind::House) as f64 * HOUSING_ROOM.get("house").unwrap() > START_RESIDENTS
    );
    assert_eq!(count(BuildingKind::Storage), 1);
    assert_eq!(count(BuildingKind::Farm), 1);
    let storage = world.buildings.iter().find(|b| b.kind == BuildingKind::Storage).unwrap();
    let start = [(Good::Food, START_FOOD), (Good::Coins, START_COINS)];
    assert_eq!(storage.stock, Some(start.into_iter().collect()));
    // The farm lies just past the city's area, so working it is not being at home.
    assert!(!in_city_area(&world, &city.id, farm.x, farm.y, terrain.size));
    assert_eq!(terrain_at(terrain, farm.x as i32, farm.y as i32), Terrain::Plains as u8);
    // A stable on Plains next to the farm, with a little food and the realm's horses in it.
    let stable = world.buildings.iter().find(|b| b.kind == BuildingKind::Stable).unwrap();
    assert_eq!(count(BuildingKind::Stable), 1);
    assert_eq!(stable.city_id.as_deref(), Some(city.id.as_str()));
    assert_eq!(stable.stock, Some([(Good::Food, START_STABLE_FOOD)].into_iter().collect()));
    assert_eq!(terrain_at(terrain, stable.x as i32, stable.y as i32), Terrain::Plains as u8);
    assert!(!in_city_area(&world, &city.id, stable.x, stable.y, terrain.size));
    assert!((stable.x - farm.x).abs().max((stable.y - farm.y).abs()) < 4.0);
    assert_eq!(world.horses.len() as f64, START_HORSES);
    for h in &world.horses {
        assert_eq!(
            (h.realm_id.as_deref(), h.x, h.y),
            (Some(realm.id.as_str()), stable.x, stable.y)
        );
        assert_eq!((h.hunger, h.health), (MAX_HUNGER, MAX_HEALTH));
    }
    // The carriage stands at the stable with one of its horses hitched, ready to drive.
    assert_eq!(world.carriages.len(), 1);
    let k = &world.carriages[0];
    assert_eq!(
        (k.realm_id.as_deref(), k.load.is_empty(), k.x, k.y),
        (Some(realm.id.as_str()), true, stable.x, stable.y)
    );
    assert!(world.horses.iter().any(|h| Some(&h.id) == k.horse_id.as_ref()));
}

#[test]
fn founds_nothing_more_for_a_player_who_already_has_a_realm() {
    let mut world = world_with_city();
    let before = world.clone();
    assert_eq!(found_starting_city(&mut world, city_terrain(), 1, None), 0);
    assert_eq!(world, before);
}

#[test]
fn gives_the_same_world_and_player_the_same_city_and_ids_are_never_reused() {
    let a = world_with_city();
    assert_eq!(a, world_with_city());
    let ids: Vec<&String> = a
        .realms
        .iter()
        .map(|e| &e.id)
        .chain(a.cities.iter().map(|e| &e.id))
        .chain(a.residents.iter().map(|e| &e.id))
        .chain(a.buildings.iter().map(|e| &e.id))
        .chain(a.horses.iter().map(|e| &e.id))
        .chain(a.carriages.iter().map(|e| &e.id))
        .collect();
    assert_eq!(ids.iter().collect::<std::collections::HashSet<_>>().len(), ids.len());
}

#[test]
fn still_finds_room_on_a_crowded_map_closer_together() {
    let world = founded_for(6);
    assert_eq!(world.cities.len(), 6);
}

#[test]
#[ignore = "the full-size map takes long to generate: T86.14's slow simulations"]
fn places_cities_on_open_land_far_from_each_other_the_short_way_round() {}

#[test]
fn names_the_realm_and_the_leader_as_the_player_founds_it() {
    let terrain = city_terrain();
    let mut world = create_world(terrain, 1);
    let names = FoundingNames { realm_name: "  Northmarch ".into(), leader_name: " Mara ".into() };
    let r = found_starting_city(&mut world, terrain, 1, Some(&names));
    let realm = &world.realms[r];
    assert_eq!(realm.name.as_deref(), Some("Northmarch"));
    let leader = world.residents.iter().find(|x| x.id == realm.leader_id).unwrap();
    assert_eq!((leader.name.as_str(), leader.game_name), ("Mara", None));
    // Nobody else gets the Leader's name from the game.
    assert!(world.residents.iter().filter(|x| x.id != leader.id).all(|x| x.name != "Mara"));
}

#[test]
fn starting_residents_each_carry_an_iron_spear_and_are_armed() {
    let world = world_with_city();
    let realm = &world.realms[realm_of(&world, 1).unwrap()];
    let residents: Vec<_> =
        world.residents.iter().filter(|r| r.owner.as_deref() == Some(realm.id.as_str())).collect();
    assert_eq!(residents.len() as f64, START_RESIDENTS);
    for r in &residents {
        assert!(age_in_years(r.born_at, world.tick as f64) >= ADULT_AGE);
        let start = [(Good::Food, START_CARRIED_FOOD), (Good::Spear, START_SPEARS)];
        assert_eq!(r.carried, start.into_iter().collect::<Stock>());
        assert!(is_armed(&r.carried), "{} is armed", r.name);
    }
    assert!(residents.iter().any(|r| r.id == realm.leader_id));
    // No spare weapons in the storage.
    let storage = world.buildings.iter().find(|b| b.kind == BuildingKind::Storage).unwrap();
    assert_eq!(storage.stock.as_ref().unwrap().get(&Good::Spear), None);
    assert_eq!(check_all(&world, city_terrain()), []);
}

#[test]
fn a_starting_child_gets_no_spear() {
    let child = starting_carry(false);
    assert_eq!(child, [(Good::Food, START_CARRIED_FOOD)].into_iter().collect::<Stock>());
    assert!(!is_armed(&child));
}

#[test]
fn an_npc_villages_start_is_unchanged() {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let mut m = Mulberry32::new(5.0);
    let mut rand = || m.next();
    let (x, y) = find_npc_city_site(&world, terrain, &NPC_VILLAGE, &mut rand).expect("a site");
    let id = found_npc_city(&mut world, terrain, &NPC_VILLAGE, x, y, &mut rand, None);
    let villagers: Vec<_> =
        world.residents.iter().filter(|r| r.city_id.as_deref() == Some(id.as_str())).collect();
    assert!(!villagers.is_empty());
    for r in villagers {
        assert_eq!(r.carried, [(Good::Food, START_CARRIED_FOOD)].into_iter().collect::<Stock>());
    }
}

#[test]
fn an_outsider_alarm_sends_a_starting_citys_residents_to_the_alarm_default() {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let city = world.cities[0].clone();
    let realm_id = city.realm_id.clone().unwrap();
    // Home from the farm: on the town hall, in the city's area.
    let hall = town_hall_of(&world, &city).unwrap().clone();
    for r in world.residents.iter_mut().filter(|r| r.owner.as_deref() == Some(realm_id.as_str())) {
        (r.x, r.y) = (hall.x, hall.y);
        r.order = None;
    }
    let mut outsider = resident("x1", Some("r-outsider"), hall.x + 2.0, hall.y + 2.0);
    outsider.carried = [(Good::Sword, 1.0)].into_iter().collect();
    world.residents.push(outsider);
    raise_outsider(&mut world, &city.id, "x1", terrain.size);
    let ours: Vec<_> =
        world.residents.iter().filter(|r| r.owner.as_deref() == Some(realm_id.as_str())).collect();
    assert_eq!(ours.len() as f64, START_RESIDENTS);
    for r in ours {
        let s = r.script.as_ref().expect("a script runs");
        assert_eq!(
            (s.task, s.script_id),
            (Some(Task::Alarm), 0),
            "{} runs the Alarm default",
            r.name
        );
        assert_eq!(s.alarm.as_ref().unwrap().kind, AlarmKind::Outsider);
    }
}
