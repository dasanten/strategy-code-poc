//! The invariant blocks of the building, teardown, work, teaching, training, carriage-building and
//! road-line tests (`building invariants`, `tear-down invariants`, `teachers sound`, `trainees
//! sound`, `carriage site invariants`, and the single invariant tests), ported with the
//! invariants (T86.13) on the worlds those tests set up.

mod build_common;

use build_common::*;
use csp_shared::balance::{BUILD_WORK, TRAINING_GROUND_MAX_TRAINEES, WORKPLACE_MAX_WORKERS};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, ResidentOrder, ResourceKind, ResourceNode, Stock,
    WorldState,
};
use csp_sim::invariants::{invariant_named, InvariantViolation};
use csp_sim::queries::building::teardown_work;
use serde_json::json;

fn check(name: &str, world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    invariant_named(name).expect("an invariant of that name").check(world, terrain)
}

fn messages(v: &[InvariantViolation]) -> Vec<String> {
    v.iter().map(|v| v.message.clone()).collect()
}

fn ids(v: &[InvariantViolation]) -> Vec<Vec<String>> {
    v.iter().map(|v| v.entity_ids.clone()).collect()
}

fn order(o: serde_json::Value) -> Option<ResidentOrder> {
    Some(serde_json::from_value(o).unwrap())
}

/// `building.test.ts`' world: nodes at (3, 3), (6, 6) and (10, 10), realm r1 and w1 on the
/// forest node; its map has forest at (3, 3), (4, 4) and hills at (6, 6), (10, 10).
fn building_setup() -> (WorldState, TerrainMap) {
    let mut t = plains(16);
    t.tiles[3 * 16 + 3] = Terrain::Forest as u8;
    t.tiles[4 * 16 + 4] = Terrain::Forest as u8;
    t.tiles[6 * 16 + 6] = Terrain::Hills as u8;
    t.tiles[10 * 16 + 10] = Terrain::Hills as u8;
    let mut world = empty_world(&plains(16));
    world.nodes = [
        ("n1", ResourceKind::Forest, 3.0),
        ("n2", ResourceKind::Stone, 6.0),
        ("n3", ResourceKind::IronOre, 10.0),
    ]
    .into_iter()
    .map(|(id, kind, at)| ResourceNode { id: id.into(), kind, x: at, y: at })
    .collect();
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 3.0, 3.0);
    (world, t)
}

fn mine_site(delivered: Stock, work: f64) -> csp_shared::world::Building {
    let mut b = site("b1", BuildingKind::Mine, 10.0, 10.0);
    b.site = Some(ConstructionSite { delivered, work });
    b
}

#[test]
fn a_site_never_holds_more_or_other_materials_than_it_needs_nor_too_much_work() {
    let (mut world, t) = building_setup();
    world.buildings.push(mine_site(Stock::from([(Good::Wood, 41.0), (Good::Food, 1.0)]), 0.0));
    assert_eq!(check("sites-within-needs", &world, &t).len(), 2);
    world.buildings = vec![mine_site(Stock::new(), BUILD_WORK.get("mine").unwrap() + 1.0)];
    assert_eq!(check("sites-within-needs", &world, &t).len(), 1);
    let mut camp = site("b1", BuildingKind::LumberCamp, 3.0, 3.0);
    camp.site.as_mut().unwrap().work = BUILD_WORK.get("lumberCamp").unwrap();
    world.buildings = vec![camp];
    assert_eq!(check("sites-within-needs", &world, &t).len(), 1);
    world.buildings = vec![mine_site(Stock::new(), 0.0)];
    assert_eq!(check("sites-within-needs", &world, &t), []);
}

#[test]
fn workplaces_stand_on_a_node_of_their_kind_and_belong_to_no_city() {
    let (mut world, t) = building_setup();
    let mut b1 = mine_site(Stock::new(), 0.0);
    (b1.x, b1.y) = (6.0, 6.0);
    let mut b2 = mine_site(Stock::new(), 0.0);
    b2.id = "b2".into();
    b2.city_id = Some("c1".into());
    world.buildings.extend([b1, b2]);
    assert_eq!(
        messages(&check("buildings-in-place", &world, &t)),
        ["b1 is a mine off its node", "b2 is a mine of city c1", "b2 belongs to no city (c1)"]
    );
}

#[test]
fn a_builder_stands_on_their_site() {
    let (mut world, t) = building_setup();
    world.buildings.push(mine_site(Stock::new(), 0.0));
    world.residents[0].order = order(
        json!({ "kind": "build", "building": "mine", "at": { "x": 3, "y": 3 }, "siteId": "b1" }),
    );
    assert_eq!(check("build-orders-on-sites", &world, &t).len(), 1);
    (world.residents[0].x, world.residents[0].y) = (10.0, 10.0);
    assert_eq!(check("build-orders-on-sites", &world, &t), []);
}

/// `teardown.test.ts`' world: a finished mine on the iron ore at (7, 7), w1 on it.
fn teardown_setup() -> (WorldState, TerrainMap) {
    let mut t = plains(16);
    t.tiles[3 * 16 + 3] = Terrain::Forest as u8;
    t.tiles[7 * 16 + 7] = Terrain::Hills as u8;
    let mut world = empty_world(&plains(16));
    world.nodes = vec![
        ResourceNode { id: "n1".into(), kind: ResourceKind::Forest, x: 3.0, y: 3.0 },
        ResourceNode { id: "n3".into(), kind: ResourceKind::IronOre, x: 7.0, y: 7.0 },
    ];
    world.buildings.push(building("b1", BuildingKind::Mine, 7.0, 7.0));
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 7.0, 7.0);
    (world, t)
}

#[test]
fn tear_down_work_stays_below_what_is_needed_and_only_on_what_can_be_built() {
    let (mut world, t) = teardown_setup();
    world.buildings[0].teardown = Some(teardown_work(&world.buildings[0]));
    assert_eq!(check("teardowns-within-needs", &world, &t).len(), 1);
    world.buildings[0].teardown = Some(-1.0);
    assert_eq!(check("teardowns-within-needs", &world, &t).len(), 1);
    world.buildings[0].teardown = Some(1.0);
    assert_eq!(check("teardowns-within-needs", &world, &t), []);
    let mut h = building("h", BuildingKind::Warehouse, 1.0, 1.0);
    h.city_id = Some("c1".into());
    h.teardown = Some(0.0);
    world.buildings.push(h);
    assert!(messages(&check("teardowns-within-needs", &world, &t))
        .contains(&"h is a warehouse being torn down".into()));
}

#[test]
fn at_most_one_building_or_site_per_tile() {
    let (mut world, t) = teardown_setup();
    world.buildings.push(site("b2", BuildingKind::Mine, 7.0, 7.0));
    let found = messages(&check("buildings-in-place", &world, &t));
    assert!(
        found.iter().any(|m| m.starts_with("b2 overlaps ") && m.ends_with(" on tile (7,7)")),
        "{found:?}"
    );
}

#[test]
fn a_resident_tearing_down_stands_on_that_building() {
    let (mut world, t) = teardown_setup();
    world.residents[0].order =
        order(json!({ "kind": "tearDown", "buildingId": "b1", "at": { "x": 7, "y": 7 } }));
    assert_eq!(check("tear-down-orders-on-buildings", &world, &t), []);
    world.residents[0].x = 6.0;
    assert_eq!(check("tear-down-orders-on-buildings", &world, &t).len(), 1);
    world.residents[0].x = 7.0;
    world.buildings.clear();
    assert_eq!(check("tear-down-orders-on-buildings", &world, &t).len(), 1);
}

#[test]
fn catches_a_worker_who_is_not_on_their_farm_or_a_farm_with_too_many_workers() {
    let t = plains(16);
    let mut world = empty_world(&t);
    world.realms.push(realm("r1", 7, "w1"));
    world.buildings.push(building("farm", BuildingKind::Farm, 3.0, 3.0));
    resident(&mut world, "w1", 3.0, 3.0);
    let work = order(
        json!({ "kind": "workAt", "buildingId": "farm", "at": { "x": 3, "y": 3 }, "progress": 0 }),
    );
    world.residents[0].order = work.clone();
    world.residents[0].x = 3.0 + FOOTPRINT.get("farm").unwrap() as f64; // just off its footprint
    assert_eq!(
        ids(&check("work-orders-on-workplaces", &world, &t)),
        [vec!["w1".to_string(), "farm".into()]]
    );
    world.residents[0].x = 3.0;
    for i in 0..WORKPLACE_MAX_WORKERS.get("farm").unwrap() as usize {
        let r = resident(&mut world, &format!("x{i}"), 3.0, 3.0);
        world.residents[r].order = work.clone();
    }
    assert_eq!(ids(&check("work-orders-on-workplaces", &world, &t)), [vec!["farm".to_string()]]);
}

#[test]
fn catches_a_work_order_for_a_workplace_without_a_node_to_work() {
    let t = plains(16);
    let mut world = empty_world(&t);
    world.buildings.push(building("mine", BuildingKind::Mine, 7.0, 1.0));
    resident(&mut world, "w1", 7.0, 1.0);
    world.residents[0].order = order(
        json!({ "kind": "workAt", "buildingId": "mine", "at": { "x": 7, "y": 1 }, "progress": 0 }),
    );
    assert_eq!(
        ids(&check("work-orders-on-workplaces", &world, &t)),
        [vec!["w1".to_string(), "mine".into()]]
    );
}

/// `teaching.test.ts`' and `training.test.ts`' ground g1 on (3, 3) to (5, 5).
fn ground_world() -> (WorldState, TerrainMap) {
    let t = plains(16);
    let mut world = empty_world(&t);
    world.realms.push(realm("r1", 7, "a1"));
    world.buildings.push(building("g1", BuildingKind::TrainingGround, 3.0, 3.0));
    (world, t)
}

#[test]
fn flags_a_teacher_off_the_ground_at_no_ground_and_a_second_teacher() {
    let (mut world, t) = ground_world();
    resident(&mut world, "a1", 3.0, 3.0);
    resident(&mut world, "a2", 5.0, 5.0);
    world.residents[0].order =
        order(json!({ "kind": "teach", "buildingId": "g1", "subject": "strength" }));
    world.residents[1].order =
        order(json!({ "kind": "teach", "buildingId": "g1", "subject": "combat" }));
    assert_eq!(ids(&check("teachers-sound", &world, &t)), [vec!["a2".to_string(), "a1".into()]]);
    world.residents[1].order =
        order(json!({ "kind": "teach", "buildingId": "gone", "subject": "combat" }));
    world.residents[0].x = 9.0;
    assert_eq!(
        ids(&check("teachers-sound", &world, &t)),
        [vec!["a1".to_string()], vec!["a2".into()]]
    );
}

#[test]
fn flags_a_trainee_off_the_ground_at_no_ground_and_one_too_many() {
    let (mut world, t) = ground_world();
    for (id, x, y) in
        [("t1", 4.0, 4.0), ("a1", 3.0, 3.0), ("a2", 5.0, 5.0), ("a3", 3.0, 5.0), ("a4", 5.0, 3.0)]
    {
        resident(&mut world, id, x, y);
    }
    let mut ids_all: Vec<String> = ["a1", "a2", "a3", "a4"].map(String::from).to_vec();
    while ids_all.len() as f64 <= TRAINING_GROUND_MAX_TRAINEES {
        let id = format!("a{}", ids_all.len() + 1);
        resident(&mut world, &id, 4.0, 3.0);
        ids_all.push(id);
    }
    for r in world.residents.iter_mut().filter(|r| ids_all.contains(&r.id)) {
        r.order = order(json!({ "kind": "train", "buildingId": "g1", "learning": null }));
    }
    assert_eq!(ids(&check("trainees-sound", &world, &t)), [ids_all.clone()]);
    at(&mut world, "a4").order =
        order(json!({ "kind": "train", "buildingId": "gone", "learning": null }));
    at(&mut world, "a1").x = 9.0;
    assert_eq!(
        ids(&check("trainees-sound", &world, &t)),
        [vec!["a1".to_string()], vec!["a4".into()]]
    );
}

#[test]
fn flags_a_finished_carriage_site_and_one_on_a_building_other_than_a_stable() {
    let t = plains(32);
    let mut world = empty_world(&t);
    world.buildings.push(building("k1", BuildingKind::Carriage, 10.0, 4.0));
    let mut house = building("h", BuildingKind::House, 1.0, 1.0);
    house.city_id = Some("c1".into());
    world.buildings.push(house);
    world.buildings.push(site("k2", BuildingKind::Carriage, 1.0, 1.0));
    let found: Vec<String> = messages(&check("buildings-in-place", &world, &t))
        .into_iter()
        .filter(|m| m.starts_with('k'))
        .collect();
    assert_eq!(found, ["k1 is a finished carriage site", "k2 is a carriage site on a house"]);
}

#[test]
fn a_road_line_order_is_checked_by_an_invariant() {
    let t = plains(10);
    let mut world = empty_world(&t);
    resident(&mut world, "w1", 1.0, 1.0);
    world.residents[0].order = order(json!({
        "kind": "roadLine", "tiles": [[1, 1], [3, 1]], "phase": "building", "path": null,
        "progress": 0, "siteId": "nowhere"
    }));
    assert_eq!(
        messages(&check("line-orders-sound", &world, &t)),
        [
            "resident w1 has a road order whose tile 1 is not a step on from the one before",
            "resident w1 builds nowhere, which is not the road site on their tile and the order’s next",
        ]
    );
}

/// `events.test.ts`' "are watched by an invariant: in order, numbered below the next id, within
/// the cap", on a bare realm instead of a starting city (T86.8).
#[test]
fn realm_logs_are_watched_by_an_invariant() {
    use csp_shared::balance::REALM_LOG_LENGTH;
    use csp_sim::events::record_event;
    let t = plains(16);
    let mut world = empty_world(&t);
    world.realms.push(realm("r1", 7, "w1"));
    let spoiled =
        |n: f64| serde_json::from_value(json!({ "kind": "foodSpoiled", "units": n })).unwrap();
    record_event(&mut world, Some("r1"), spoiled(1.0));
    record_event(&mut world, Some("r1"), spoiled(2.0));
    world.events.reverse();
    let mut late = world.events[0].clone();
    (late.seq, late.tick) = (world.next_id + 1, world.tick + 1);
    world.events.push(late);
    for _ in 0..REALM_LOG_LENGTH as usize {
        world.events.push(world.events[0].clone());
    }
    let found = messages(&check("realm-logs-in-order", &world, &t));
    assert!(found.iter().any(|m| m.contains("logged after")));
    assert!(found.iter().any(|m| m.contains("past next id")));
    assert!(found.iter().any(|m| m.contains("after now")));
    assert!(found.iter().any(|m| m.ends_with(&format!("over {REALM_LOG_LENGTH}"))));
}
