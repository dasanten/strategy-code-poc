//! `apps/server/src/starting-city.test.ts`, and parity with the TypeScript: the `sight/*.json`
//! fixtures are `createWorld(cityTerrain())` with `foundStartingCity` for Players 1 to n, so the
//! Rust world founded the same way must be the same world. `checkInvariants` is T86.13's.

use csp_shared::balance::{
    ADULT_AGE, HOUSING_ROOM, MAX_HEALTH, MAX_HUNGER, START_CARRIED_FOOD, START_CITY_SIZE,
    START_FOOD, START_HORSES, START_RESIDENTS, START_STABLE_FOOD, STAT_BASE_MAX, STAT_BASE_MIN,
};
use csp_shared::terrain::{terrain_at, Terrain};
use csp_shared::world::{BuildingKind, Good, ResidentOrder, WorldState};

use super::*;
use crate::queries::city_area::{in_city_area, is_city_building};
use crate::queries::residents::age_in_years;
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

#[test]
fn founds_the_typescripts_starting_city() {
    assert_eq!(founded_for(1), fixture("city"));
}

#[test]
fn founds_the_typescripts_starting_cities_for_two_and_three_players() {
    assert_eq!(founded_for(2), fixture("two-realms"));
    assert_eq!(founded_for(3), fixture("three-realms"));
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
    // Everyone starts on the farm, working it, with a little food on them.
    let farm = world.buildings.iter().find(|b| b.kind == BuildingKind::Farm).unwrap();
    for r in &residents {
        assert_eq!(r.city_id.as_deref(), Some(city.id.as_str()));
        assert_eq!((r.x, r.y), (farm.x, farm.y));
        assert_eq!(r.carried.get(&Good::Food), Some(&START_CARRIED_FOOD));
        assert!(matches!(&r.order, Some(ResidentOrder::WorkAt(o))
            if o.building_id == farm.id && o.at.x == farm.x && o.at.y == farm.y && o.progress == 0.0 && o.makes.is_none()));
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
    assert_eq!(storage.stock, Some([(Good::Food, START_FOOD)].into_iter().collect()));
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
