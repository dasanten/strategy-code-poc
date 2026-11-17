//! Repairing from the UI (`CONTEXT.md`: Repairing; T97.5): the Repair task runs the Player's
//! Repair default, which fetches what the repair lacks from a storage of their realm, comes back
//! and puts the worn building back to good.

mod build_common;
mod scripts_common;

use build_common::*;
use csp_shared::world::{BuildingKind, Good, Task, WorldState};
use scripts_common::{acked, default_script_id, order_json, rejected, Game};
use serde_json::json;

const SIZE: i32 = 24;
const MARA: u64 = 7;

/// Realm r1 of Mara with a worn house of its city at (3, 3), w1 standing on it, and a storage
/// with Wood at (14, 14).
fn worn_house_world(wood: f64) -> WorldState {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", MARA, "w1"));
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    let mut house = building("h1", BuildingKind::House, 3.0, 3.0);
    house.city_id = Some("c1".into());
    house.decay = Some(0.5);
    world.buildings.push(house);
    let mut storage = building("s1", BuildingKind::Storage, 14.0, 14.0);
    storage.city_id = Some("c1".into());
    storage.stock = Some([(Good::Wood, wood), (Good::Food, 50.0)].into_iter().collect());
    world.buildings.push(storage);
    world.residents.push(new_resident("w1", Some("r1"), 3.0, 3.0));
    world
}

fn game(wood: f64) -> Game {
    Game::new(worn_house_world(wood), plains(SIZE), player(MARA))
}

fn house(g: &Game) -> &csp_shared::world::Building {
    g.world.buildings.iter().find(|b| b.id == "h1").unwrap()
}

#[test]
fn a_repair_from_the_card_fetches_the_wood_and_puts_the_house_back_to_good() {
    let mut g = game(30.0);
    let reply = g.give_to("w1", json!({ "kind": "task", "task": "repair", "buildingId": "h1" }));
    assert!(acked(&reply), "{reply:?}");
    g.tick();
    let script = g.r("w1").script.as_ref().expect("running the Repair default");
    assert_eq!(script.script_id, default_script_id(MARA, Task::Repair));
    // Nothing on them: off to the storage for what the repair lacks, a quarter of a house's Wood.
    assert_eq!(order_json(g.r("w1"))["kind"], json!("fetch"));
    g.until(3_000, |g| house(g).decay.is_none());
    assert_eq!(house(&g).repair, None);
    let stock = g.world.buildings.iter().find(|b| b.id == "s1").unwrap().stock.clone().unwrap();
    assert_eq!(stock.get(&Good::Wood), Some(&25.0), "5 Wood went into the repair");
    // Done, the script ends.
    g.until(5, |g| g.r("w1").script.is_none());
    assert!(g.r("w1").carried.get(&Good::Wood).is_none());
}

#[test]
fn with_no_wood_in_any_storage_the_repair_ends_and_the_house_stays_worn() {
    let mut g = game(0.0);
    let reply = g.give_to("w1", json!({ "kind": "task", "task": "repair", "buildingId": "h1" }));
    assert!(acked(&reply), "{reply:?}");
    g.until(5, |g| g.r("w1").script.is_none());
    assert_eq!(house(&g).decay, Some(0.5));
}

#[test]
fn a_house_in_good_condition_is_not_repaired() {
    let mut g = game(30.0);
    g.world.buildings.iter_mut().find(|b| b.id == "h1").unwrap().decay = None;
    let reply = g.give_to("w1", json!({ "kind": "task", "task": "repair", "buildingId": "h1" }));
    assert_eq!(rejected(&reply), Some("the house is in good condition"));
}

/// The Build default with nothing to build (`CONTEXT.md`: Repairing; T97.7): w1 of city c1
/// stands on an empty tile of its area, a house of the city is worn and another nearly a ruin.
fn idle_builder(g: &mut Game) {
    g.world.residents.iter_mut().find(|r| r.id == "w1").unwrap().city_id = Some("c1".into());
    g.world.residents.iter_mut().find(|r| r.id == "w1").unwrap().x = 8.0;
    let mut worse = building("h2", BuildingKind::House, 6.0, 12.0);
    worse.city_id = Some("c1".into());
    worse.decay = Some(0.8);
    g.world.buildings.push(worse);
}

#[test]
fn an_idle_build_default_builder_repairs_the_worn_buildings_of_their_city_worst_first() {
    let mut g = game(30.0);
    idle_builder(&mut g);
    let build = default_script_id(MARA, Task::Build);
    let reply = g.give_to("w1", json!({ "kind": "runScript", "scriptId": build }));
    assert!(acked(&reply), "{reply:?}");
    g.tick();
    let memory = &g.r("w1").script.as_ref().expect("still running").memory;
    assert_eq!(memory["repairId"], json!("h2"), "the one nearly a ruin first");
    let h2 = |g: &Game| g.world.buildings.iter().find(|b| b.id == "h2").unwrap().decay;
    g.until(3_000, |g| h2(g).is_none());
    assert_eq!(h2(&g), None);
    // Then the worn one, on their own.
    g.until(3_000, |g| house(g).decay.is_none());
    assert_eq!(house(&g).decay, None);
    // Nothing left: the script ends.
    g.until(5, |g| g.r("w1").script.is_none());
    assert!(g.r("w1").script.is_none());
    let stock = g.world.buildings.iter().find(|b| b.id == "s1").unwrap().stock.clone().unwrap();
    assert_eq!(stock.get(&Good::Wood), Some(&20.0), "5 Wood for each house");
}

#[test]
fn a_worn_building_outside_their_city_area_is_left_alone() {
    let mut g = game(30.0);
    idle_builder(&mut g);
    g.world.buildings.retain(|b| b.id != "h2");
    // Far from the town hall the house is in no city's area of theirs.
    let h1 = g.world.buildings.iter_mut().find(|b| b.id == "h1").unwrap();
    h1.city_id = None;
    let build = default_script_id(MARA, Task::Build);
    let reply = g.give_to("w1", json!({ "kind": "runScript", "scriptId": build }));
    assert!(acked(&reply), "{reply:?}");
    g.until(5, |g| g.r("w1").script.is_none());
    assert!(g.r("w1").script.is_none());
    assert_eq!(house(&g).decay, Some(0.5));
}
