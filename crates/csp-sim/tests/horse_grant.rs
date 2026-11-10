//! `apps/server/src/horse-grant.test.ts`: the Horse grant (`CONTEXT.md`: Horse grant). The
//! TypeScript runs it as world migration 47 → 48; the Rust server reads only saves from after the
//! freeze (`csp-server`'s `world_format`), so these call `grant_horses` as that step does.

mod ts_match;

use csp_shared::balance::{
    HORSE_GRANT_FOOD, HORSE_GRANT_HORSES, HORSE_START_AGE_MAX, HORSE_START_AGE_MIN, HORSE_STAT_MAX,
    HORSE_STAT_MIN,
};
use csp_shared::footprint::{is_at, near_footprint};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, Good, Horse, WorldState};
use csp_sim::horse_grant::grant_horses;
use csp_sim::horses::HORSE_NAMES;
use csp_sim::invariants::check_all;
use csp_sim::queries::goods::pile_at;
use csp_sim::queries::names::placed;
use csp_sim::queries::residents::horse_age_in_years;
use csp_sim::starting_city::found_starting_city;
use csp_sim::world::generate_world;
use serde_json::json;
use ts_match::{assert_matches, json_of};

/// `worldWithPost()`: the seed-1 world of 1536 tiles where Player 1 has founded their city.
fn world_with_post() -> (WorldState, TerrainMap) {
    let terrain = csp_sim::terrain_gen::generate_terrain(1, 1536);
    let mut world = generate_world(&terrain, 1);
    found_starting_city(&mut world, &terrain, 1, None);
    (world, terrain)
}

/// A world where Player 1's realm has lost every horse: none stabled, hitched or ridden.
fn without_horses() -> (WorldState, TerrainMap, String) {
    let (mut world, terrain) = world_with_post();
    let realm = world.realms[0].id.clone();
    world.horses.retain(|h| h.realm_id.as_deref() != Some(realm.as_str()));
    for c in &mut world.carriages {
        if c.realm_id.as_deref() == Some(realm.as_str()) {
            c.horse_id = None;
        }
    }
    (world, terrain, realm)
}

fn realm_horses<'w>(world: &'w WorldState, realm: &str) -> Vec<&'w Horse> {
    world.horses.iter().filter(|h| h.realm_id.as_deref() == Some(realm)).collect()
}

fn at(h: &Horse) -> (i32, i32) {
    (h.x as i32, h.y as i32)
}

fn last_event(world: &WorldState) -> serde_json::Value {
    json_of(world.events.last().expect("an event"))
}

#[track_caller]
fn assert_sound(world: &WorldState, terrain: &TerrainMap) {
    let broken: Vec<String> = check_all(world, terrain)
        .into_iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert_eq!(broken, Vec::<String>::new());
}

#[test]
fn puts_two_new_horses_in_a_realms_stable_and_says_so_in_the_realm_log() {
    let (world, terrain, realm) = without_horses();
    let stable = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Stable && b.city_id.is_some())
        .expect("a stable")
        .clone();
    let mut migrated = world.clone();
    grant_horses(&mut migrated, &terrain);

    let horses = realm_horses(&migrated, &realm);
    assert_eq!(horses.len(), HORSE_GRANT_HORSES as usize);
    for h in &horses {
        assert!(is_at(at(h), placed(&stable), terrain.size));
        for s in [h.stats.speed, h.stats.strength, h.stats.endurance] {
            assert!((HORSE_STAT_MIN..=HORSE_STAT_MAX).contains(&s), "{s}");
        }
        let age = horse_age_in_years(h, migrated.tick as f64);
        assert!((HORSE_START_AGE_MIN..=HORSE_START_AGE_MAX).contains(&age), "{age}");
        assert!(HORSE_NAMES.contains(&h.name.as_str()));
    }
    let ids: Vec<&str> = horses.iter().map(|h| h.id.as_str()).collect();
    let city = migrated.cities.iter().find(|c| Some(&c.id) == stable.city_id.as_ref()).unwrap();
    assert_matches(
        &last_event(&migrated),
        json!({
            "kind": "horsesGranted", "userId": migrated.realms[0].user_id, "horseIds": ids,
            "where": "stable", "city": city.name, "x": stable.x, "y": stable.y
        }),
    );
    assert_sound(&migrated, &terrain);
}

#[test]
fn puts_them_next_to_the_storage_with_food_on_the_ground_by_each_when_the_realm_has_no_stable() {
    let (mut world, terrain, realm) = without_horses();
    let stable = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Stable && b.city_id.is_some())
        .expect("a stable")
        .clone();
    world.buildings.retain(|b| b.id != stable.id);
    world.piles.retain(|p| !is_at((p.x as i32, p.y as i32), placed(&stable), terrain.size));
    let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.as_str())).unwrap();
    let city_name = city.name.clone();
    let storage = world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Storage && b.city_id.as_deref() == Some(city.id.as_str()))
        .expect("a storage")
        .clone();
    let mut migrated = world.clone();
    grant_horses(&mut migrated, &terrain);

    let horses = realm_horses(&migrated, &realm);
    assert_eq!(horses.len(), HORSE_GRANT_HORSES as usize);
    let spots: std::collections::HashSet<(i32, i32)> = horses.iter().map(|h| at(h)).collect();
    assert_eq!(spots.len(), horses.len());
    for h in &horses {
        assert!(near_footprint(placed(&storage), at(h), 1, terrain.size));
        assert!(!is_at(at(h), placed(&storage), terrain.size));
        let pile = pile_at(&migrated, h.x, h.y).expect("a pile");
        assert_eq!(json_of(&pile.goods), json!({ "food": HORSE_GRANT_FOOD }));
    }
    assert_matches(
        &last_event(&migrated),
        json!({ "kind": "horsesGranted", "where": "storage", "city": city_name }),
    );
    assert_sound(&migrated, &terrain);
}

#[test]
fn puts_them_next_to_the_leader_when_the_realm_has_no_city() {
    let (mut world, terrain, realm) = without_horses();
    // The realm's city went to nobody, as if lost; its Leader is still alive.
    for c in &mut world.cities {
        if c.realm_id.as_deref() == Some(realm.as_str()) {
            c.realm_id = None;
        }
    }
    let leader_id = world.realms[0].leader_id.clone();
    let leader = world.residents.iter().find(|r| r.id == leader_id).unwrap().clone();
    let mut migrated = world.clone();
    grant_horses(&mut migrated, &terrain);

    let horses = realm_horses(&migrated, &realm);
    assert_eq!(horses.len(), HORSE_GRANT_HORSES as usize);
    for h in &horses {
        assert!((h.x - leader.x).abs().max((h.y - leader.y).abs()) <= 2.0);
        let food = pile_at(&migrated, h.x, h.y).and_then(|p| p.goods.get(&Good::Food)).copied();
        assert_eq!(food, Some(HORSE_GRANT_FOOD));
    }
    assert_matches(&last_event(&migrated), json!({ "kind": "horsesGranted", "where": "leader" }));
}

#[test]
fn gives_nothing_to_a_realm_with_a_horse_npc_cities_or_the_trade_organization() {
    let (world, terrain) = world_with_post();
    let before = world.clone();
    assert!(world.horses.iter().any(|h| h.realm_id.is_some()));
    assert!(world.cities.iter().any(|c| c.realm_id.is_none()));
    let mut migrated = world.clone();
    grant_horses(&mut migrated, &terrain);
    assert_eq!(json_of(&migrated), json_of(&before));
}

#[test]
fn gives_nothing_a_second_time() {
    let (mut once, terrain, _) = without_horses();
    grant_horses(&mut once, &terrain);
    let mut twice = once.clone();
    grant_horses(&mut twice, &terrain);
    assert_eq!(json_of(&twice), json_of(&once));
}

#[test]
fn gives_nothing_to_a_realm_whose_leader_is_dead() {
    let (mut world, terrain, realm) = without_horses();
    let leader = world.realms[0].leader_id.clone();
    world.residents.retain(|r| r.id != leader);
    grant_horses(&mut world, &terrain);
    assert!(realm_horses(&world, &realm).is_empty());
}
