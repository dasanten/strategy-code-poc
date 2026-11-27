//! Ruins (`CONTEXT.md`: Ruin; T97.6): a ruin stands but does nothing. A ruined wall tile is a gap,
//! a workplace makes nothing, a storage takes nothing in, though anyone at it can take out what is
//! left in it, a theft from another organization. The Repair task rebuilds it.

mod build_common;
mod scripts_common;

use build_common::*;
use csp_shared::balance::OWN_FOOD;
use csp_shared::terrain::tile_index;
use csp_shared::world::{
    Building, BuildingKind, Good, GoodsSpot, ResidentOrder, Stock, Task, Tile, WorkOrder,
    WorldState,
};
use csp_sim::carrying::{resolve_carrying, CarryAction, CarryKind};
use csp_sim::ruins::{is_ruin, rebuild_materials};
use csp_sim::tick::Scratch;
use csp_sim::walls::{may_step, wall_map};
use csp_sim::work::{request_work, resolve_work};
use scripts_common::{acked, default_script_id, rejected, Game};
use serde_json::json;

const SIZE: i32 = 24;
const MARA: u64 = 7;

fn ruin(b: &mut Building) {
    b.decay = Some(1.0);
    b.ruined_at = Some(0.0);
}

fn b<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).expect("a building")
}

fn b_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Building {
    world.buildings.iter_mut().find(|b| b.id == id).expect("a building")
}

fn food(n: f64) -> Stock {
    [(Good::Food, n)].into_iter().collect()
}

#[test]
fn a_ruined_wall_or_gate_tile_lets_anyone_through() {
    csp_npc::install(); // T1719
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    add_city(&mut world, "c1", None, 10.0, 10.0);
    for (id, kind, x) in [("w1", BuildingKind::Wall, 3.0), ("g1", BuildingKind::Gate, 4.0)] {
        let mut w = building(id, kind, x, 3.0);
        w.city_id = Some("c1".into());
        w.closed = (kind == BuildingKind::Gate).then_some(true);
        world.buildings.push(w);
    }
    let wall = tile_index(SIZE, 3, 3);
    let gate = tile_index(SIZE, 4, 3);
    let walls = wall_map(&world, &terrain);
    assert!(!may_step(&walls, Some("r2"), wall));
    assert!(!may_step(&walls, Some("r2"), gate), "a closed gate");
    ruin(b_mut(&mut world, "w1"));
    ruin(b_mut(&mut world, "g1"));
    let walls = wall_map(&world, &terrain);
    assert!(may_step(&walls, Some("r2"), wall), "a gap");
    assert!(may_step(&walls, Some("r2"), gate), "a gap");
    assert_sound(&world, &terrain);
}

#[test]
fn a_ruined_workplace_makes_nothing() {
    csp_npc::install(); // T1719
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.buildings.push(building("f1", BuildingKind::Farm, 3.0, 3.0));
    world.residents.push(new_resident("w1", None, 3.0, 3.0));
    let work = ResidentOrder::WorkAt(WorkOrder {
        building_id: "f1".into(),
        at: Tile { x: 3.0, y: 3.0 },
        progress: 0.0,
        makes: None,
        mends: false,
    });
    world.residents[0].order = Some(work.clone());
    let mut scratch = Scratch::default();
    let actions = request_work(&world);
    resolve_work(&mut world, &actions, &mut scratch);
    assert!(world.residents[0].order.is_some(), "works at the farm");

    ruin(b_mut(&mut world, "f1"));
    world.residents[0].order = Some(work);
    let actions = request_work(&world);
    resolve_work(&mut world, &actions, &mut scratch);
    assert_eq!(world.residents[0].order, None, "nothing to work at");
}

/// Realm r1 (Mara) with city c1 and a ruined storage `s1` of it holding 9 Food at (3, 3); realm
/// r2's b1 stands on it, w1 of r1 next to it, armed.
fn at_ruined_storage() -> WorldState {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", MARA, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    let mut s = building("s1", BuildingKind::Storage, 3.0, 3.0);
    s.realm_id = Some("r1".into());
    s.stock = Some(food(9.0));
    ruin(&mut s);
    world.buildings.push(s);
    let mut b1 = new_resident("b1", Some("r2"), 3.0, 3.0);
    b1.carried = food(OWN_FOOD);
    world.residents.push(b1);
    let mut w1 = new_resident("w1", Some("r1"), 2.0, 3.0);
    w1.carried.insert(Good::Spear, 1.0);
    world.residents.push(w1);
    world
}

fn carry(kind: CarryKind, resident: &str, units: f64) -> CarryAction {
    CarryAction {
        kind,
        resident_id: resident.into(),
        spot: GoodsSpot::Storage { storage_id: "s1".into() },
        goods: food(units),
    }
}

fn stored(world: &WorldState) -> f64 {
    b(world, "s1").stock.as_ref().and_then(|s| s.get(&Good::Food)).copied().unwrap_or(0.0)
}

#[test]
fn anyone_takes_from_a_ruined_storage_unguarded_and_it_is_theft_from_another_organization() {
    csp_npc::install(); // T1719
    let mut world = at_ruined_storage();
    // An outpost storage, armed w1 of its realm beside it: a standing one would be guarded.
    resolve_carrying(&mut world, &[carry(CarryKind::Take, "b1", 3.0)], SIZE);
    assert_eq!(stored(&world), 6.0);
    assert_eq!(world.crimes.len(), 1);
    assert_eq!(world.crimes[0].victim_org, "r1");
    // Its own realm takes from it too, no theft.
    world.residents[1].x = 3.0;
    resolve_carrying(&mut world, &[carry(CarryKind::Take, "w1", 2.0)], SIZE);
    assert_eq!(stored(&world), 4.0);
    assert_eq!(world.crimes.len(), 1);
}

#[test]
fn a_ruined_storage_takes_nothing_in() {
    csp_npc::install(); // T1719
    let mut world = at_ruined_storage();
    resolve_carrying(&mut world, &[carry(CarryKind::Put, "b1", 2.0)], SIZE);
    assert_eq!(stored(&world), 9.0);
    assert_eq!(world.residents[0].carried.get(&Good::Food), Some(&OWN_FOOD));
}

/// Mara's realm r1 with a ruined house of its city at (3, 3), w1 on it, and a storage with Wood
/// at (14, 14).
fn ruined_house_game(wood: f64) -> Game {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", MARA, "w1"));
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    let mut house = building("h1", BuildingKind::House, 3.0, 3.0);
    house.city_id = Some("c1".into());
    ruin(&mut house);
    world.buildings.push(house);
    let mut storage = building("s1", BuildingKind::Storage, 14.0, 14.0);
    storage.city_id = Some("c1".into());
    storage.stock = Some([(Good::Wood, wood), (Good::Food, 50.0)].into_iter().collect());
    world.buildings.push(storage);
    world.residents.push(new_resident("w1", Some("r1"), 3.0, 3.0));
    Game::new(world, terrain, player(MARA))
}

#[test]
fn the_repair_task_rebuilds_a_ruin_with_the_rebuilds_wood() {
    csp_npc::install(); // T1719
    let mut g = ruined_house_game(30.0);
    let reply = g.give_to("w1", json!({ "kind": "task", "task": "repair", "buildingId": "h1" }));
    assert!(acked(&reply), "{reply:?}");
    g.tick();
    let script = g.r("w1").script.as_ref().expect("running the Repair default");
    assert_eq!(script.script_id, default_script_id(MARA, Task::Repair));
    g.until(6_000, |g| !is_ruin(b(&g.world, "h1")));
    let h = b(&g.world, "h1");
    assert_eq!((h.decay, h.repair.as_ref()), (None, None));
    let wood = rebuild_materials(BuildingKind::House).get(&Good::Wood).copied().unwrap();
    let stock = b(&g.world, "s1").stock.clone().unwrap();
    assert_eq!(stock.get(&Good::Wood), Some(&(30.0 - wood)));
}

#[test]
fn a_store_order_to_a_ruined_storage_is_refused() {
    csp_npc::install(); // T1719
    let mut g = ruined_house_game(30.0);
    let s = b_mut(&mut g.world, "s1");
    ruin(s);
    g.world.residents[0].carried = food(2.0);
    let reply = g.give_to("w1", json!({ "kind": "store", "goods": { "food": 2 }, "to": "s1" }));
    assert_eq!(rejected(&reply), Some("that is a ruin, it takes nothing in"));
}
