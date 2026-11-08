//! `apps/server/src/carriage-building.test.ts`, ported (T86.6). The drop orders that deliver
//! materials (T86.5) are put in directly; "is built by the Build default" needs the default
//! scripts and walking (T86.12, T86.4); `carriage site invariants` and the invariant checks come
//! with the invariants (T86.13).

mod build_common;

use build_common::*;
use csp_shared::balance::{BUILD_WORK, OWN_FOOD};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, ResidentOrder, ResourceKind, ResourceNode, Stock,
    WorldState,
};
use csp_sim::order_sender::OrderSender;
use csp_sim::queries::building::{build_materials, build_problem, carriage_site_at, TerrainLookup};
use csp_sim::world::create_world;
use serde_json::json;

const SIZE: i32 = 32;

/// Plains, with Mountain at (12, 4), right by the stable's east side.
fn map() -> TerrainMap {
    let mut t = plains(SIZE);
    t.tiles[(4 * SIZE + 12) as usize] = Terrain::Mountain as u8;
    t
}

fn me() -> OrderSender {
    player(7)
}

fn them() -> OrderSender {
    player(8)
}

fn materials() -> Stock {
    build_materials(BuildingKind::Carriage)
}

fn work() -> f64 {
    BUILD_WORK.get("carriage").unwrap()
}

fn person(world: &mut WorldState, id: &str, owner: &str, x: f64, y: f64) {
    let mut r = new_resident(id, Some(owner), x, y);
    r.city_id = (owner == "r1").then(|| "c1".into());
    r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
    world.residents.push(r);
}

/// Realm r1 (Player 7) with city c1 and a finished stable covering (9, 4)–(11, 6). Resident w1 of
/// r1 stands on the stable's middle tile.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let t = map();
    let mut world = create_world(&t, 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "w1"));
    add_city(&mut world, "c1", Some("r1"), 4.0, 4.0);
    let mut stable = building("st", BuildingKind::Stable, 9.0, 4.0);
    stable.city_id = Some("c1".into());
    stable.stock = Some(Stock::new());
    world.buildings.push(stable);
    person(&mut world, "w1", "r1", 10.0, 5.0);
    (world, t, Orders::default())
}

fn send(
    world: &mut WorldState,
    t: &TerrainMap,
    orders: &mut Orders,
    o: serde_json::Value,
    s: &OrderSender,
) -> String {
    order(world, orders, s, o, t).err().unwrap_or_else(|| "ack".into())
}

fn build(resident_id: &str) -> serde_json::Value {
    json!({ "kind": "build", "residentId": resident_id, "building": "carriage" })
}

fn site_index(world: &WorldState) -> Option<usize> {
    world.buildings.iter().position(|b| b.kind == BuildingKind::Carriage)
}

/// Delivers goods to the site, as the drop order would. TODO(T86.5): the drop order.
fn deliver(world: &mut WorldState, from: &str, goods: &Stock) {
    let si = site_index(world).unwrap();
    for (g, n) in goods {
        let r = at(world, from);
        *r.carried.entry(*g).or_insert(0.0) -= n;
        r.carried.retain(|_, v| *v > 0.0);
        let s = world.buildings[si].site.as_mut().unwrap();
        *s.delivered.entry(*g).or_insert(0.0) += n;
    }
}

#[test]
fn lays_out_a_carriage_site_on_the_residents_tile_of_a_finished_stable_of_no_city() {
    let (mut world, t, mut orders) = setup();
    assert_eq!(send(&mut world, &t, &mut orders, build("w1"), &me()), "ack");
    let s = &world.buildings[site_index(&world).unwrap()];
    assert_eq!((s.city_id.clone(), s.x, s.y), (None, 10.0, 5.0));
    assert!(s.site.as_ref().unwrap().delivered.is_empty());
    // The stable stands on: the site shares its tile.
    assert!(world.buildings.iter().any(|b| b.id == "st"));
}

#[test]
fn also_lays_one_out_right_next_to_the_stable_but_not_further_off() {
    let (mut world, t, mut orders) = setup();
    at(&mut world, "w1").x = 8.0;
    at(&mut world, "w1").y = 3.0;
    assert_eq!(send(&mut world, &t, &mut orders, build("w1"), &me()), "ack");
    assert!(carriage_site_at(&world, 8, 3).is_some());
    at(&mut world, "w1").order = None;
    at(&mut world, "w1").x = 7.0;
    assert_eq!(
        send(&mut world, &t, &mut orders, build("w1"), &me()),
        "a carriage is built at a finished stable"
    );
}

#[test]
fn is_turned_down_at_an_unfinished_stable_on_another_building_or_where_no_carriage_can_go() {
    let (mut world, t, mut orders) = setup();
    let st = world.buildings.iter().position(|b| b.id == "st").unwrap();
    world.buildings[st].site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    assert_eq!(
        send(&mut world, &t, &mut orders, build("w1"), &me()),
        "a carriage is built at a finished stable"
    );
    world.buildings[st].site = None;
    let mut house = building("h", BuildingKind::House, 7.0, 7.0);
    house.city_id = Some("c1".into());
    world.buildings.push(house);
    at(&mut world, "w1").x = 8.0;
    at(&mut world, "w1").y = 7.0;
    assert_eq!(
        send(&mut world, &t, &mut orders, build("w1"), &me()),
        "there is already a building there"
    );
    // The order checks terrain with the server's map; here the rule itself.
    let lookup = Some(&t as &dyn TerrainLookup);
    assert_eq!(
        build_problem(&world, 12, 4, BuildingKind::Carriage, lookup).as_deref(),
        Some("a carriage can’t stand on this land")
    );
    world.nodes.push(ResourceNode { id: "n1".into(), kind: ResourceKind::Stone, x: 12.0, y: 5.0 });
    assert_eq!(
        build_problem(&world, 12, 5, BuildingKind::Carriage, lookup).as_deref(),
        Some("a carriage goes off any resource node")
    );
}

#[test]
fn joins_the_carriage_site_already_on_the_tile_rather_than_laying_out_a_second() {
    let (mut world, t, mut orders) = setup();
    send(&mut world, &t, &mut orders, build("w1"), &me());
    person(&mut world, "w2", "r1", 10.0, 5.0);
    assert_eq!(send(&mut world, &t, &mut orders, build("w2"), &me()), "ack");
    assert_eq!(world.buildings.iter().filter(|b| b.kind == BuildingKind::Carriage).count(), 1);
    let id = world.buildings[site_index(&world).unwrap()].id.clone();
    for r in &world.residents {
        assert!(
            matches!(&r.order, Some(ResidentOrder::Build(o)) if o.site_id.as_ref() == Some(&id))
        );
    }
}

#[test]
fn takes_its_materials_and_work_and_becomes_an_empty_unhitched_carriage_of_the_finishers_realm() {
    let (mut world, t, mut orders) = setup();
    // The stable's horses stand there; the new carriage isn't hitched until it is driven.
    world.horses.push(
        serde_json::from_value(json!({
            "id": "h1", "realmId": "r1", "cityId": null, "x": 10, "y": 5, "hunger": 100,
            "health": 100, "name": "Rowan",
            "stats": { "speed": 10, "strength": 10, "endurance": 10 }, "bornAt": world.tick
        }))
        .unwrap(),
    );
    send(&mut world, &t, &mut orders, build("w1"), &me());
    // Laid out by r1, finished unattended by a resident of r2 (`CONTEXT.md`: Construction site).
    at(&mut world, "w1").order = None;
    world.realms.push(realm("r2", 8, "t1"));
    person(&mut world, "t1", "r2", 10.0, 5.0);
    for (g, n) in materials() {
        at(&mut world, "t1").carried.insert(g, n);
    }
    deliver(&mut world, "t1", &materials());
    run(&mut world, &t, 1);
    assert_eq!(
        world.buildings[site_index(&world).unwrap()].site.as_ref().unwrap().delivered,
        materials()
    );
    assert_eq!(send(&mut world, &t, &mut orders, build("t1"), &them()), "ack");
    run(&mut world, &t, work().ceil() as usize);
    assert!(site_index(&world).is_none());
    assert_eq!(world.carriages.len(), 1);
    let k = serde_json::to_value(&world.carriages[0]).unwrap();
    assert_eq!(
        k,
        json!({ "id": k["id"], "realmId": "r2", "cityId": null, "x": 10.0, "y": 5.0, "horseId": null, "load": {} })
    );
    assert!(at(&mut world, "t1").order.is_none());
}

#[test]
fn leaves_all_its_delivered_materials_when_torn_down() {
    let (mut world, t, mut orders) = setup();
    send(&mut world, &t, &mut orders, build("w1"), &me());
    let id = world.buildings[site_index(&world).unwrap()].id.clone();
    at(&mut world, "w1").carried.insert(Good::Wood, 10.0);
    deliver(&mut world, "w1", &Stock::from([(Good::Wood, 10.0)]));
    run(&mut world, &t, 1);
    let tear = json!({ "kind": "tearDown", "residentId": "w1", "buildingId": id });
    assert_eq!(send(&mut world, &t, &mut orders, tear, &me()), "ack");
    run(&mut world, &t, work().ceil() as usize);
    assert!(site_index(&world).is_none());
    assert!(world.carriages.is_empty());
    // Goods on the stable's footprint are its one pile (`CONTEXT.md`: A building's pile).
    assert_eq!(world.piles.len(), 1);
    assert_eq!((world.piles[0].x, world.piles[0].y), (9.0, 4.0));
    assert_eq!(world.piles[0].goods, Stock::from([(Good::Wood, 10.0)]));
    assert!(world.buildings.iter().any(|b| b.id == "st"));
}
