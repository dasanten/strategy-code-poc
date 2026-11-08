//! `apps/server/src/teardown.test.ts`, ported (T86.6) for the bare tear-down order. The same tests
//! given as the Tear down task (`describe.each`'s second case) need the default scripts (T86.12);
//! the invariant checks and the `tear-down invariants` block come with the invariants (T86.13).

mod build_common;

use build_common::*;
use csp_shared::balance::{
    ticks_for_age, BUILD_WORK, TEARDOWN_MATERIALS_RETURNED, TEARDOWN_WORK_SHARE,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, ResourceKind, ResourceNode, Stock, WorldState,
};
use csp_sim::goods_made::tally_goods;
use csp_sim::queries::balance::build_work;
use csp_sim::queries::building::{build_materials, teardown_returns, teardown_work, BUILDABLE};
use csp_sim::stand_ins::OrderSender;
use serde_json::{json, Value};

/// Plains, with forest at (3, 3) and hills at (7, 7).
fn map() -> TerrainMap {
    let mut t = plains(16);
    t.tiles[3 * 16 + 3] = Terrain::Forest as u8;
    t.tiles[7 * 16 + 7] = Terrain::Hills as u8;
    t
}

fn me() -> OrderSender {
    player(7)
}

fn stranger() -> OrderSender {
    player(8)
}

/// A world with a forest node at (3, 3) and an iron ore node at (7, 7); a finished mine on the
/// iron ore; realm r1 (Player 7) with resident w1 on the mine, Strength 10.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let mut world = empty_world(&plains(16));
    world.nodes = vec![
        ResourceNode { id: "n1".into(), kind: ResourceKind::Forest, x: 3.0, y: 3.0 },
        ResourceNode { id: "n3".into(), kind: ResourceKind::IronOre, x: 7.0, y: 7.0 },
    ];
    world.buildings.push(building("b1", BuildingKind::Mine, 7.0, 7.0));
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 7.0, 7.0);
    (world, map(), Orders::default())
}

fn tear_down_order(building_id: &str, resident_id: &str) -> Value {
    json!({ "kind": "tearDown", "residentId": resident_id, "buildingId": building_id })
}

fn mine() -> Value {
    tear_down_order("b1", "w1")
}

/// All goods in the world: carried, in piles, stored and delivered to sites (`allGoods`).
fn all_goods(world: &WorldState) -> Stock {
    let mut out = tally_goods(world);
    out.sort_keys();
    out
}

#[test]
fn works_at_the_building_until_it_is_gone_leaving_part_of_its_materials_on_the_tile() {
    let (mut world, terrain, mut orders) = setup();
    assert_eq!(orders.receive(&world, &me(), mine(), &terrain), Ok(()));
    orders.apply_all(&mut world, &terrain);
    assert_eq!(
        serde_json::to_value(&at(&mut world, "w1").order).unwrap(),
        json!({ "kind": "tearDown", "buildingId": "b1", "at": { "x": 7.0, "y": 7.0 } })
    );
    let need = teardown_work(&world.buildings[0]);
    assert_eq!(need, BUILD_WORK.get("mine").unwrap() * TEARDOWN_WORK_SHARE);
    assert!(need < BUILD_WORK.get("mine").unwrap());
    run(&mut world, &terrain, 10);
    let r = at(&mut world, "w1").clone();
    close(world.buildings[0].teardown.unwrap(), 10.0 * build_work(&r, world.tick as f64));
    assert!(r.skills[&csp_shared::world::SkillName::Construction] > 0.0);

    world.buildings[0].teardown = Some(need - 0.5);
    run(&mut world, &terrain, 1);
    assert!(world.buildings.is_empty());
    let built = build_materials(BuildingKind::Mine);
    let back = |g: Good| (built[&g] * TEARDOWN_MATERIALS_RETURNED).floor();
    assert_eq!(world.piles.len(), 1);
    assert_eq!((world.piles[0].x, world.piles[0].y), (7.0, 7.0));
    assert_eq!(
        world.piles[0].goods,
        Stock::from([(Good::Wood, back(Good::Wood)), (Good::Stone, back(Good::Stone))])
    );
    assert!(at(&mut world, "w1").order.is_none());
}

#[test]
fn frees_the_tile_so_it_can_be_built_on_again() {
    let (mut world, terrain, mut orders) = setup();
    order(&mut world, &mut orders, &me(), mine(), &terrain).unwrap();
    world.buildings[0].teardown = Some(teardown_work(&world.buildings[0]) - 0.1);
    run(&mut world, &terrain, 1);
    assert!(world.buildings.is_empty());
    assert!(at(&mut world, "w1").order.is_none());
    let build = json!({ "kind": "build", "residentId": "w1", "building": "mine" });
    assert_eq!(order(&mut world, &mut orders, &me(), build, &terrain), Ok(()));
    assert_eq!(world.buildings.len(), 1);
    assert!(world.buildings[0].site.is_some());
}

#[test]
fn tears_down_an_unfinished_site_with_less_work_leaving_all_its_delivered_materials() {
    let (mut world, terrain, mut orders) = setup();
    let mut s = building("b1", BuildingKind::Mine, 7.0, 7.0);
    s.site = Some(ConstructionSite {
        delivered: Stock::from([(Good::Wood, 12.0), (Good::Stone, 3.0)]),
        work: 8.0,
    });
    world.buildings = vec![s];
    let b = resident(&mut world, "w2", 7.0, 7.0);
    world.residents[b].order = Some(
        serde_json::from_value(json!({
            "kind": "build", "building": "mine", "at": { "x": 7, "y": 7 }, "siteId": "b1"
        }))
        .unwrap(),
    );
    let before = all_goods(&world);
    assert_eq!(teardown_work(&world.buildings[0]), 8.0 * TEARDOWN_WORK_SHARE);
    // w2 keeps building, so the site needs a little more tear-down work each tick.
    order(&mut world, &mut orders, &me(), mine(), &terrain).unwrap();
    for _ in 0..20 {
        if world.buildings.is_empty() {
            break;
        }
        run(&mut world, &terrain, 1);
    }
    assert!(world.buildings.is_empty());
    assert_eq!(world.piles[0].goods, Stock::from([(Good::Wood, 12.0), (Good::Stone, 3.0)]));
    assert_eq!(all_goods(&world), before);
    assert!(at(&mut world, "w1").order.is_none());
    assert!(at(&mut world, "w2").order.is_none()); // the site they were building is gone
}

#[test]
fn takes_down_a_site_no_one_has_worked_on_yet_at_once() {
    let (mut world, terrain, mut orders) = setup();
    world.buildings = vec![site("b1", BuildingKind::Mine, 7.0, 7.0)];
    order(&mut world, &mut orders, &me(), mine(), &terrain).unwrap();
    assert!(world.buildings.is_empty());
    assert!(world.piles.is_empty());
}

#[test]
fn lets_two_residents_tear_down_together_faster_than_one() {
    let (mut world, terrain, mut orders) = setup();
    resident(&mut world, "w2", 7.0, 7.0);
    orders.receive(&world, &me(), tear_down_order("b1", "w1"), &terrain).unwrap();
    orders.receive(&world, &me(), tear_down_order("b1", "w2"), &terrain).unwrap();
    orders.apply_all(&mut world, &terrain);
    run(&mut world, &terrain, 5);
    close(world.buildings[0].teardown.unwrap(), 10.0);
}

#[test]
fn stops_when_the_resident_leaves_the_tile_the_work_done_stays_for_anyone_to_go_on() {
    let (mut world, terrain, mut orders) = setup();
    order(&mut world, &mut orders, &me(), mine(), &terrain).unwrap();
    let done = world.buildings[0].teardown.unwrap();
    at(&mut world, "w1").x = 6.0;
    run(&mut world, &terrain, 1);
    assert!(at(&mut world, "w1").order.is_none());
    assert_eq!(world.buildings[0].teardown, Some(done));
}

#[test]
fn tears_down_other_organizations_buildings_too() {
    let (mut world, terrain, mut orders) = setup();
    world.realms.push(realm("r2", 8, "w9"));
    let o = resident(&mut world, "w9", 7.0, 7.0);
    world.residents[o].owner = Some("r2".into());
    assert_eq!(orders.receive(&world, &stranger(), tear_down_order("b1", "w9"), &terrain), Ok(()));
}

#[test]
fn rejects_what_cannot_be_torn_down() {
    let (mut world, terrain, mut orders) = setup();
    let reject = |world: &WorldState, orders: &mut Orders, o: Value, sender: &OrderSender| {
        orders.receive(world, sender, o, &terrain).err().unwrap_or_else(|| "ack".into())
    };
    assert_eq!(reject(&world, &mut orders, mine(), &stranger()), "not one of your residents");
    let no_building = json!({ "kind": "tearDown", "residentId": "w1" });
    assert_eq!(reject(&world, &mut orders, no_building, &me()), "which building?");
    assert_eq!(
        reject(&world, &mut orders, tear_down_order("b9", "w1"), &me()),
        "the resident is not at that building"
    );
    at(&mut world, "w1").x = 6.0;
    assert_eq!(reject(&world, &mut orders, mine(), &me()), "the resident is not at that building");
    at(&mut world, "w1").x = 7.0;
    let tick = world.tick as f64;
    at(&mut world, "w1").born_at = tick - ticks_for_age(5.0);
    assert_eq!(reject(&world, &mut orders, mine(), &me()), "children can’t tear down buildings");
    at(&mut world, "w1").born_at = tick - ticks_for_age(30.0);
    let mut warehouse = building("b2", BuildingKind::Warehouse, 7.0, 7.0);
    warehouse.city_id = Some("c1".into());
    world.buildings.push(warehouse);
    assert_eq!(
        reject(&world, &mut orders, tear_down_order("b2", "w1"), &me()),
        "a warehouse can’t be torn down yet"
    );
    assert_eq!(orders.len(), 0);
}

#[test]
fn ends_the_order_if_the_building_is_gone_before_work_starts() {
    let (mut world, terrain, mut orders) = setup();
    orders.receive(&world, &me(), mine(), &terrain).unwrap();
    orders.apply_all(&mut world, &terrain);
    world.buildings.clear();
    run(&mut world, &terrain, 1);
    assert!(at(&mut world, "w1").order.is_none());
}

#[test]
fn tear_down_returns_never_leave_more_than_was_built_in() {
    for kind in BUILDABLE {
        let built = build_materials(kind);
        let back = teardown_returns(&building("b", kind, 0.0, 0.0));
        for (good, units) in &back {
            assert!(*units <= built.get(good).copied().unwrap_or(0.0));
        }
        let mut s = building("s", kind, 0.0, 0.0);
        s.site = Some(ConstructionSite { delivered: built.clone(), work: 1.0 });
        assert_eq!(teardown_returns(&s), built);
    }
}
