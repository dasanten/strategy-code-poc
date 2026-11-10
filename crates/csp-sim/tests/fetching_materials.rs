//! `apps/server/src/fetching-materials.test.ts`. Fetching materials (`CONTEXT.md`: Fetching
//! materials): the Build default builds a site, and while it lacks materials one of its builders,
//! picked at random, fetches a load of what is missing from the nearest storage of the realm that
//! holds it, one at a time.

mod build_common;
mod ts_match;

use std::sync::Arc;

use build_common::{add_city, building, new_resident, realm};
use csp_shared::balance::{BUILD_MATERIALS, MAX_HUNGER, OWN_FOOD};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, ConstructionSite, Good, Resident, Stat, Stock, Task, WorldState,
};
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::order_kinds;
use csp_sim::script_runner::{one_fetcher_at_a_time, ScriptHost, ScriptRunner};
use csp_sim::script_tables::DEFAULT_SCRIPTS;
use csp_sim::scripts::RunnableScript;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use ts_match::{assert_matches, json_of};

const SIZE: i32 = 32;
const BUILD: u64 = 1;
const AT: (f64, f64) = (6.0, 6.0);

fn wood_for_a_house() -> f64 {
    BUILD_MATERIALS.get("house").and_then(|m| m.get("wood")).expect("a house's Wood")
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

/// Mara's realm r1 with city c1 by (6, 6) and builders b1–b3 at (6, 6), given the Build task for
/// a house (`houseWorld`).
fn house_world() -> (WorldState, TerrainMap) {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 1, "b1"));
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    for id in ["b1", "b2", "b3"] {
        let mut r = new_resident(id, Some("r1"), AT.0, AT.1);
        r.city_id = Some("c1".into());
        r.stats.strength = Stat { base: 10.0, trained: 0.0 };
        r.carried = stock(&[(Good::Food, OWN_FOOD)]);
        r.script = Some(
            serde_json::from_value(json!({
                "scriptId": BUILD, "memory": { "building": "house", "at": { "x": AT.0, "y": AT.1 } }
            }))
            .unwrap(),
        );
        world.residents.push(r);
    }
    (world, terrain)
}

fn storage(world: &mut WorldState, id: &str, x: f64, y: f64, goods: Stock) {
    let mut b = building(id, BuildingKind::Storage, x, y);
    b.city_id = Some("c1".into());
    b.stock = Some(goods);
    world.buildings.push(b);
}

/// The Build default, unedited, as every script of Player 1.
struct Host;

impl ScriptHost for Host {
    fn script(&self, _: u64) -> Option<RunnableScript> {
        let (_, name, source) =
            DEFAULT_SCRIPTS.iter().find(|(t, _, _)| *t == Task::Build).expect("Build");
        Some(RunnableScript {
            user_id: 1,
            name: name.to_string(),
            version: 1,
            source: source.to_string(),
            follows_default: true,
            task: None,
        })
    }
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        Some(OrderSender::player(user_id, "Mara"))
    }
    fn explored(&self, _: u64, _: i32, _: i32) -> bool {
        true
    }
}

fn memory<'r>(r: &'r Resident, key: &str) -> Option<&'r Value> {
    r.script.as_ref().and_then(|s| s.memory.get(key)).filter(|v| !v.is_null())
}

fn fetchers(world: &WorldState) -> Vec<&Resident> {
    world.residents.iter().filter(|r| memory(r, "fetch").is_some()).collect()
}

fn site(world: &WorldState) -> Option<&Building> {
    world.buildings.iter().find(|b| b.kind == BuildingKind::House)
}

/// Runs scripts and steps the world until `done` or `ticks` run out, keeping everyone fed.
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    ticks: usize,
    mut each: impl FnMut(&WorldState),
    done: impl Fn(&WorldState) -> bool,
) {
    let map = Arc::new(terrain.clone());
    let mut runner = ScriptRunner::new(map.clone(), Arc::new(Host), order_kinds());
    let mut walking = Walking::new(map);
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        if done(world) {
            break;
        }
        for r in &mut world.residents {
            r.hunger = MAX_HUNGER;
        }
        let broken: Vec<String> =
            runner.run_all(world, &mut scratch, true).into_iter().map(|v| v.message).collect();
        assert_eq!(broken, Vec::<String>::new());
        each(world);
        step_world(world, terrain, &mut scratch, Some(&mut walking), None);
    }
}

fn elsewhere(world: &mut WorldState) {
    let c2: City = serde_json::from_value(json!({
        "id": "c2", "name": "Elsewhere", "realmId": "r2", "townHallId": "none", "occupation": null
    }))
    .unwrap();
    world.cities.push(c2);
}

#[test]
fn joins_the_site_then_one_builder_fetches_only_what_is_missing_from_the_nearest_storage_that_holds_it(
) {
    let (mut world, terrain) = house_world();
    // Nearest holds none of it; of those holding Wood, east is nearer than south.
    storage(&mut world, "stone", AT.0 + 3.0, AT.1, stock(&[(Good::Stone, 50.0)]));
    storage(&mut world, "east", AT.0 + 6.0, AT.1, stock(&[(Good::Wood, 100.0)]));
    storage(&mut world, "south", AT.0, AT.1 + 12.0, stock(&[(Good::Wood, 100.0)]));
    // Laid out already, with some Wood delivered.
    let mut laid = building("site", BuildingKind::House, AT.0, AT.1);
    laid.site = Some(ConstructionSite { delivered: stock(&[(Good::Wood, 5.0)]), work: 0.0 });
    world.buildings.push(laid);
    // They spread over the site's footprint as they join (`CONTEXT.md`: Spreading over the
    // footprint).
    let joined =
        |w: &WorldState| w.residents.iter().all(|r| memory(r, "siteId") == Some(&json!("site")));
    run(&mut world, &terrain, 60, |_| {}, |w| joined(w) && !fetchers(w).is_empty());
    let sites: Vec<Option<&Value>> = world.residents.iter().map(|r| memory(r, "siteId")).collect();
    assert_eq!(sites, [Some(&json!("site")); 3]);
    let found = fetchers(&world);
    assert_eq!(found.len(), 1);
    assert_matches(
        memory(found[0], "fetch").unwrap(),
        json!({ "storageId": "east", "goods": { "wood": wood_for_a_house() - 5.0 } }),
    );
}

#[test]
fn builds_the_site_with_materials_from_the_storage_one_fetcher_at_a_time() {
    let (mut world, terrain) = house_world();
    storage(&mut world, "s1", AT.0 + 6.0, AT.1, stock(&[(Good::Wood, 100.0)]));
    let mut fetched = false;
    run(
        &mut world,
        &terrain,
        3000,
        |w| {
            assert!(fetchers(w).len() <= 1);
            fetched |= !fetchers(w).is_empty();
        },
        |w| site(w).is_some_and(|b| b.site.is_none()),
    );
    assert!(fetched);
    assert!(site(&world).is_some_and(|b| b.site.is_none()));
    // Only what was missing left the storage; nobody kept any.
    let s1 = world.buildings.iter().find(|b| b.id == "s1").unwrap();
    assert_eq!(json_of(&s1.stock), json!({ "wood": 100.0 - wood_for_a_house() }));
    run(&mut world, &terrain, 2, |_| {}, |_| false);
    for r in &world.residents {
        assert_eq!(json_of(&r.carried), json!({ "food": OWN_FOOD }));
        // Built: Build ended itself.
        assert!(r.script.is_none());
    }
    let broken: Vec<String> = check_all(&world, &terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(broken, Vec::<String>::new());
}

#[test]
fn just_builds_with_no_storage_of_the_realm_holding_the_materials() {
    let (mut world, terrain) = house_world();
    storage(&mut world, "s1", AT.0 + 6.0, AT.1, stock(&[(Good::Stone, 50.0)]));
    elsewhere(&mut world);
    let mut theirs = building("theirs", BuildingKind::Storage, AT.0 + 3.0, AT.1);
    theirs.city_id = Some("c2".into());
    theirs.stock = Some(stock(&[(Good::Wood, 100.0)]));
    world.buildings.push(theirs);
    run(&mut world, &terrain, 40, |w| assert!(fetchers(w).is_empty()), |_| false);
    assert!(site(&world).and_then(|b| b.site.as_ref()).expect("a site").work > 0.0);
    for r in &world.residents {
        assert_matches(&r.order, json!({ "kind": "build" }));
    }
}

#[test]
fn delivers_materials_a_builder_carries_before_anyone_fetches() {
    let (mut world, terrain) = house_world();
    storage(&mut world, "s1", AT.0 + 6.0, AT.1, stock(&[(Good::Wood, 100.0)]));
    world.residents[1].carried.insert(Good::Wood, 8.0);
    run(&mut world, &terrain, 6, |_| {}, |_| false);
    let delivered = &site(&world).and_then(|b| b.site.as_ref()).expect("a site").delivered;
    assert_eq!(delivered.get(&Good::Wood).copied(), Some(8.0));
    assert_eq!(world.residents[1].carried.get(&Good::Wood), None);
}

#[test]
fn flags_two_residents_of_a_site_away_fetching_at_once_adr_0004() {
    let (mut world, _) = house_world();
    let fetch = json!({ "storageId": "s1", "step": "pickUp", "walked": true });
    for r in &mut world.residents[0..2] {
        r.script.as_mut().unwrap().memory.insert("siteId".into(), json!("site"));
    }
    world.residents[0].script.as_mut().unwrap().memory.insert("fetch".into(), fetch.clone());
    assert!(one_fetcher_at_a_time(&world, &|_| true).is_empty());
    world.residents[1].script.as_mut().unwrap().memory.insert("fetch".into(), fetch);
    let found = one_fetcher_at_a_time(&world, &|_| true);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].invariant, "one-fetcher-at-a-time");
    assert_eq!(found[0].entity_ids, ["site", "b1", "b2"]);
}
