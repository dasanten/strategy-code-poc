//! `npc-cities.test.ts`.

use std::collections::HashSet;
use std::sync::OnceLock;

use csp_shared::balance::{
    NPC_CITY_MIN_DISTANCE, NPC_TOWN, NPC_TOWNS, NPC_VILLAGE, NPC_VILLAGES, SIGHT_RANGE,
};
use csp_shared::terrain::{terrain_at, wrap_distance, Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, City, ResourceKind, ResourceNode, WorldState};
use serde_json::{json, Value};

use super::{find_npc_city_site, found_npc_city, npc_city_count, npc_site_fits, taken_ground};
use crate::invariants::check_all;
use crate::queries::city::{city_price, in_city_area, is_city_building, town_hall_of};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::sight::entities_in_sight;
use crate::starting_city::found_starting_city;
use crate::terrain_gen::generate_terrain;
use crate::test_support::plains;
use crate::test_world::{city_terrain, world_with_city};
use crate::world::{create_world, generate_world};
use crate::world_index::WorldIndex;

/// The tiles an NPC city's buildings and residents stand on, with their ids (`tilesOf`).
fn tiles_of(world: &WorldState, c: &City) -> Vec<(String, f64, f64)> {
    let own = |id: &Option<String>| id.as_deref() == Some(c.id.as_str());
    world
        .buildings
        .iter()
        .filter(|b| own(&b.city_id))
        .map(|b| (b.id.clone(), b.x, b.y))
        .chain(world.residents.iter().filter(|r| own(&r.city_id)).map(|r| (r.id.clone(), r.x, r.y)))
        .collect()
}

fn hall_of(world: &WorldState, c: &City) -> (i32, i32) {
    let h = town_hall_of(world, c).expect("a town hall");
    (h.x as i32, h.y as i32)
}

/// The world `generateWorld` makes on the seed-1 map of 2880 tiles, made once (`beforeAll`).
fn generated() -> &'static (TerrainMap, WorldState) {
    static WORLD: OnceLock<(TerrainMap, WorldState)> = OnceLock::new();
    WORLD.get_or_init(|| {
        let terrain = generate_terrain(1, 2880);
        let world = generate_world(&terrain, 1);
        (terrain, world)
    })
}

/// The NPC cities, without the Trade Org HQ the world generator places first.
fn npc(world: &WorldState) -> Vec<&City> {
    world.cities.iter().filter(|c| c.trade_org.is_none()).collect()
}

// placeNpcCities (through generateWorld)

#[test]
fn places_towns_and_villages_by_the_map_area_run_by_the_game() {
    let (terrain, world) = generated();
    assert_eq!(npc_city_count(NPC_TOWNS, 5760), NPC_TOWNS as usize);
    assert_eq!(npc_city_count(NPC_VILLAGES, 5760), NPC_VILLAGES as usize);
    let towns = npc_city_count(NPC_TOWNS, 2880);
    let villages = npc_city_count(NPC_VILLAGES, 2880);
    assert!(towns > 0);
    let npc = npc(world);
    assert_eq!(npc.len(), towns + villages);
    let sizes: Vec<usize> = npc
        .iter()
        .map(|c| world.residents.iter().filter(|r| r.city_id.as_deref() == Some(&c.id)).count())
        .collect();
    let want: Vec<usize> = std::iter::repeat_n(NPC_TOWN.residents as usize, towns)
        .chain(std::iter::repeat_n(NPC_VILLAGE.residents as usize, villages))
        .collect();
    assert_eq!(sizes, want);
    assert!(world.cities.iter().all(|c| c.realm_id.is_none()));
    assert!(world.residents.iter().all(|r| r.owner.is_none()));
    assert!(world.realms.is_empty());
    assert_eq!(check_all(world, terrain), []);
}

#[test]
fn lays_each_one_out_with_a_town_hall_a_storage_houses_a_wall_with_a_gate_and_farms() {
    let (terrain, world) = generated();
    for c in npc(world) {
        let own: Vec<_> =
            world.buildings.iter().filter(|b| b.city_id.as_deref() == Some(&c.id)).collect();
        let count = |k: BuildingKind| own.iter().filter(|b| b.kind == k).count();
        let kind = if count(BuildingKind::Farm) == 1 { NPC_VILLAGE } else { NPC_TOWN };
        assert_eq!(count(BuildingKind::TownHall), 1);
        assert_eq!(count(BuildingKind::Storage), 1);
        assert_eq!(count(BuildingKind::House), kind.houses as usize);
        assert_eq!(count(BuildingKind::Gate), 1);
        assert_eq!(count(BuildingKind::Wall), 4 * (kind.size as usize - 1) - 1);
        assert_eq!(count(BuildingKind::Farm), kind.farms as usize);
        let storage = own.iter().find(|b| b.kind == BuildingKind::Storage).unwrap();
        assert_eq!(serde_json::to_value(&storage.stock).unwrap(), json!({ "food": kind.food }));
        // Every city building is part of the city; the farms lie outside its area.
        for b in &own {
            let inside = in_city_area(world, &c.id, b.x as i32, b.y as i32, terrain.size);
            assert_eq!(inside, is_city_building(b), "{}", b.id);
        }
        // Residents start on the farms, working them.
        for r in world.residents.iter().filter(|x| x.city_id.as_deref() == Some(&c.id)) {
            let kind = r.order.as_ref().map(|o| serde_json::to_value(o).unwrap()["kind"].clone());
            assert_eq!(kind, Some(json!("workAt")));
            assert!(own.iter().any(|b| b.kind == BuildingKind::Farm && b.x == r.x && b.y == r.y));
        }
    }
}

#[test]
fn puts_them_on_plains_far_from_each_other() {
    let (terrain, world) = generated();
    let npc = npc(world);
    for c in &npc {
        for (_, x, y) in tiles_of(world, c) {
            assert_eq!(terrain_at(terrain, x as i32, y as i32), Terrain::Plains as u8);
        }
        for o in &npc {
            if o.id == c.id {
                continue;
            }
            let d = wrap_distance(terrain.size, hall_of(world, c), hall_of(world, o));
            assert!(d >= NPC_CITY_MIN_DISTANCE - NPC_TOWN.size);
        }
    }
}

#[test]
fn names_every_city_apart_the_trade_org_hqs_too() {
    let (_, world) = generated();
    let names: HashSet<&str> = world.cities.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names.len(), world.cities.len());
}

#[test]
fn places_the_same_cities_for_the_same_world() {
    let (terrain, world) = generated();
    assert_eq!(&generate_world(terrain, 1), world);
}

#[test]
fn leaves_room_for_starting_cities_far_from_the_npc_cities() {
    let (terrain, world) = generated();
    let mut w = world.clone();
    found_starting_city(&mut w, terrain, 1, None);
    let mine = w.cities.iter().find(|c| c.realm_id.is_some()).unwrap();
    let hall = hall_of(&w, mine);
    for c in &world.cities {
        let d = wrap_distance(terrain.size, hall, hall_of(&w, c));
        assert!(d >= NPC_CITY_MIN_DISTANCE - NPC_TOWN.size);
    }
    assert_eq!(check_all(&w, terrain), []);
}

// findNpcCitySite

/// What Player 1's realm sees, as plain JSON.
fn seen(world: &WorldState, terrain: &TerrainMap, realm: &str) -> Vec<Value> {
    let index = WorldIndex::new(world, terrain.size);
    entities_in_sight(world, &index, Some(realm), None)
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .collect()
}

fn realm_one(world: &WorldState) -> String {
    world.realms.iter().find(|r| r.user_id == 1).expect("realm of Player 1").id.clone()
}

#[test]
fn keeps_away_from_starting_cities_and_out_of_every_players_sight() {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let realm = realm_one(&world);
    let start = world.cities[0].clone();
    let mut m = Mulberry32::new(5.0);
    let mut rand = || m.next();
    let (x, y) = find_npc_city_site(&world, terrain, &NPC_VILLAGE, &mut rand).expect("a site");
    let id = found_npc_city(&mut world, terrain, &NPC_VILLAGE, x, y, &mut rand, None);
    let c = world.cities.iter().find(|c| c.id == id).unwrap().clone();
    let d = wrap_distance(terrain.size, hall_of(&world, &start), hall_of(&world, &c));
    assert!(d >= NPC_CITY_MIN_DISTANCE - NPC_VILLAGE.size);
    let ids: HashSet<String> = tiles_of(&world, &c).into_iter().map(|t| t.0).collect();
    let seen = seen(&world, terrain, &realm);
    let theirs: Vec<&Value> = seen
        .iter()
        .filter(|e| e["id"].as_str().is_some_and(|i| ids.contains(i) || i == c.id))
        .collect();
    assert!(theirs.is_empty(), "{theirs:?}");
    assert_eq!(check_all(&world, terrain), []);
}

#[test]
fn shows_an_npc_city_to_a_player_once_one_of_their_residents_comes_in_sight_of_it() {
    let terrain = city_terrain();
    let mut world = world_with_city();
    let realm = realm_one(&world);
    let mut m = Mulberry32::new(5.0);
    let mut rand = || m.next();
    let (x, y) = find_npc_city_site(&world, terrain, &NPC_VILLAGE, &mut rand).expect("a site");
    let id = found_npc_city(&mut world, terrain, &NPC_VILLAGE, x, y, &mut rand, None);
    let scout = world.residents.iter_mut().find(|r| r.owner.as_deref() == Some(&realm)).unwrap();
    // Just south of its gate, where its farms are.
    scout.x = f64::from(x + 3);
    scout.y = f64::from(y) + NPC_VILLAGE.size + 3.0;
    scout.order = None;
    let seen = seen(&world, terrain, &realm);
    let c = world.cities.iter().find(|c| c.id == id).unwrap();
    // It names its price (`CONTEXT.md`: Buying a city) and what it would lend (`CONTEXT.md`:
    // Hiring from an NPC city).
    let city = seen.iter().find(|e| e["is"] == "city" && e["id"] == id).expect("the city seen");
    let own = serde_json::to_value(c).unwrap();
    for (k, v) in own.as_object().unwrap() {
        assert_eq!(&city[k], v, "{k}");
    }
    assert_eq!(city["price"], json!(city_price(&world, c, None)));
    assert!(!city["hire"].is_null());
    let hall = town_hall_of(&world, c).unwrap();
    let mut want = serde_json::to_value(hall).unwrap();
    want["is"] = json!("building");
    assert!(seen.iter().any(|e| e["is"] == "building" && e["id"] == hall.id));
    let seen_hall = seen.iter().find(|e| e["id"] == hall.id).unwrap();
    for (k, v) in want.as_object().unwrap() {
        if !v.is_null() {
            assert_eq!(&seen_hall[k], v, "{k}");
        }
    }
    assert!(seen.iter().any(|e| e["is"] == "resident" && e["cityId"] == id));
}

#[test]
fn finds_no_site_when_the_map_has_no_room_left() {
    let terrain = plains(150);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(1.0);
    let mut rand = || m.next();
    let (x, y) = find_npc_city_site(&world, &terrain, &NPC_VILLAGE, &mut rand).expect("a site");
    found_npc_city(&mut world, &terrain, &NPC_VILLAGE, x, y, &mut rand, None);
    assert_eq!(find_npc_city_site(&world, &terrain, &NPC_VILLAGE, &mut rand), None);
}

// npcSiteFits

fn fits(world: &WorldState, terrain: &TerrainMap) -> bool {
    npc_site_fits(world, terrain, &NPC_TOWN, 50, 50, &taken_ground(world, terrain), true)
}

#[test]
fn takes_open_plains_far_from_cities_and_players() {
    let terrain = plains(200);
    assert!(fits(&create_world(&terrain, 1), &terrain));
}

#[test]
fn avoids_taken_tiles() {
    let terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    world.nodes.push(ResourceNode { id: "n1".into(), kind: ResourceKind::Stone, x: 49.0, y: 55.0 });
    assert!(!fits(&world, &terrain));
}

#[test]
fn avoids_tiles_other_than_plains() {
    let mut t = plains(200);
    t.tiles[55 * 200 + 60] = Terrain::Forest as u8;
    assert!(!fits(&create_world(&t, 1), &t));
}

#[test]
fn avoids_tiles_a_players_resident_sees_but_not_where_nobody_of_a_realm_looks() {
    let terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    // Just within sight of the north-west corner of the city's ring of open land.
    let corner = (50.0 - 2.0, 50.0 - 2.0);
    let fields = NewResident {
        id: "r1",
        owner: Some("realm1"),
        city_id: None,
        x: corner.0 - SIGHT_RANGE + 1.0,
        y: corner.1,
        tick: 0.0,
    };
    let mut m = Mulberry32::new(1.0);
    let r = new_resident(&mut || m.next(), &fields, None);
    world.residents.push(r);
    assert!(!fits(&world, &terrain));
    world.residents[0].owner = None;
    assert!(fits(&world, &terrain));
}

#[test]
fn keeps_its_distance_from_every_city() {
    let terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(1.0);
    let x = 50 + NPC_CITY_MIN_DISTANCE as i32 - 20;
    found_npc_city(&mut world, &terrain, &NPC_VILLAGE, x, 50, &mut || m.next(), None);
    assert!(!fits(&world, &terrain));
}
