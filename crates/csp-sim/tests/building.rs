//! `apps/server/src/building.test.ts`, ported (T86.6). The invariant checks it makes after each
//! step (`checkInvariants`) and its `building invariants` block come with the invariants
//! (T86.13); the two tests that deliver or take materials with the drop and pick-up orders put
//! them in directly until those orders land (T86.5).

mod build_common;

use build_common::*;
use csp_shared::balance::{BUILD_WORK, CONSTRUCTION_SKILL_EFFECT};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ResidentOrder, ResourceKind, ResourceNode, SkillName, WorldState,
};
use csp_sim::building::BuildingPart;
use csp_sim::order_sender::OrderSender;
use csp_sim::queries::balance::{build_work, construction_learned};
use csp_sim::queries::building::{build_materials, work_pace, working_on};
use serde_json::{json, Value};

/// Plains, with forest at (3, 3) and (4, 4) and hills at (6, 6) and (10, 10).
fn map() -> TerrainMap {
    let mut t = plains(16);
    t.tiles[3 * 16 + 3] = Terrain::Forest as u8;
    t.tiles[4 * 16 + 4] = Terrain::Forest as u8;
    t.tiles[6 * 16 + 6] = Terrain::Hills as u8;
    t.tiles[10 * 16 + 10] = Terrain::Hills as u8;
    t
}

fn me() -> OrderSender {
    player(7)
}

fn stranger() -> OrderSender {
    player(8)
}

fn node(id: &str, kind: ResourceKind, x: f64, y: f64) -> ResourceNode {
    ResourceNode { id: id.into(), kind, x, y }
}

/// A world on a small map: a forest node at (3, 3), a stone node at (6, 6) and an iron ore node at
/// (10, 10); realm r1 (Player 7) with resident w1 standing on the forest node, Strength 10.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let mut world = empty_world(&plains(16));
    world.nodes = vec![
        node("n1", ResourceKind::Forest, 3.0, 3.0),
        node("n2", ResourceKind::Stone, 6.0, 6.0),
        node("n3", ResourceKind::IronOre, 10.0, 10.0),
    ];
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 3.0, 3.0);
    (world, map(), Orders::default())
}

fn build_order(building: &str, resident_id: &str) -> Value {
    json!({ "kind": "build", "residentId": resident_id, "building": building })
}

fn site_index(world: &WorldState) -> usize {
    world.buildings.iter().position(|b| b.site.is_some()).unwrap()
}

fn work_of(world: &WorldState, i: usize) -> f64 {
    world.buildings[i].site.as_ref().map(|s| s.work).unwrap()
}

fn site_id_of(world: &mut WorldState, id: &str) -> Option<String> {
    match &at(world, id).order {
        Some(ResidentOrder::Build(o)) => o.site_id.clone(),
        _ => None,
    }
}

#[test]
fn lays_out_a_construction_site_on_the_node_in_the_next_tick_of_no_city() {
    let (mut world, terrain, mut orders) = setup();
    assert_eq!(orders.receive(&world, &me(), build_order("lumberCamp", "w1"), &terrain), Ok(()));
    assert!(world.buildings.is_empty());
    orders.apply_all(&mut world, &terrain);
    assert_eq!(
        serde_json::to_value(&at(&mut world, "w1").order).unwrap(),
        json!({ "kind": "build", "building": "lumberCamp", "at": { "x": 3.0, "y": 3.0 }, "siteId": null })
    );
    run(&mut world, &terrain, 1);
    let site = site_of(&world).unwrap().clone();
    assert_eq!(
        (site.kind, site.city_id.clone(), site.x, site.y),
        (BuildingKind::LumberCamp, None, 3.0, 3.0)
    );
    let s = site.site.as_ref().unwrap();
    assert!(s.delivered.is_empty());
    assert_eq!(s.work, 0.0);
    assert_eq!(site_id_of(&mut world, "w1"), Some(site.id));
}

#[test]
fn then_works_on_the_site_strength_and_construction_add_work_and_construction_grows() {
    let (mut world, terrain, mut orders) = setup();
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    let r = at(&mut world, "w1").clone();
    let per = build_work(&r, world.tick as f64);
    close(per, 1.0);
    run(&mut world, &terrain, 10);
    close(work_of(&world, site_index(&world)), 10.0 * per);
    let r = at(&mut world, "w1").clone();
    close(r.skills[&SkillName::Construction], 10.0 * construction_learned(&r, world.tick as f64));
    // A skilled, stronger resident works faster.
    let mut strong = r.clone();
    strong.stats.strength.base = 15.0;
    strong.skills.insert(SkillName::Construction, 10.0);
    close(build_work(&strong, world.tick as f64), 1.5 * (1.0 + 10.0 * CONSTRUCTION_SKILL_EFFECT));
}

#[test]
fn puts_in_what_work_pace_says_for_the_residents_working_on_it_so_estimates_match() {
    let (mut world, terrain, mut orders) = setup();
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    let h = resident(&mut world, "w2", 3.0, 3.0);
    world.residents[h].stats.strength.base = 15.0;
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w2"), &terrain).unwrap();
    let si = site_index(&world);
    let site = world.buildings[si].clone();
    let on = working_on(&site, &world.residents, false, 16);
    let mut ids: Vec<&str> = on.iter().map(|x| x.id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, ["w1", "w2"]);
    let pace = work_pace(&site, &on, world.tick as f64, None);
    let before = work_of(&world, si);
    run(&mut world, &terrain, 1);
    close(work_of(&world, si) - before, pace);
}

#[test]
fn finishes_a_lumber_camp_once_enough_work_is_in_and_the_order_is_done() {
    let (mut world, terrain, mut orders) = setup();
    assert!(build_materials(BuildingKind::LumberCamp).is_empty());
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    let si = site_index(&world);
    world.buildings[si].site.as_mut().unwrap().work = BUILD_WORK.get("lumberCamp").unwrap() - 2.5;
    run(&mut world, &terrain, 2);
    assert!(world.buildings[si].site.is_some());
    run(&mut world, &terrain, 1);
    assert!(world.buildings[si].site.is_none());
    assert_eq!(
        serde_json::to_value(&world.buildings).unwrap(),
        json!([{ "id": world.buildings[si].id, "kind": "lumberCamp", "cityId": null, "x": 3.0, "y": 3.0 }])
    );
    assert!(at(&mut world, "w1").order.is_none());
}

#[test]
fn needs_its_materials_too_only_what_it_still_needs() {
    let (mut world, terrain, mut orders) = setup();
    at(&mut world, "w1").x = 6.0;
    at(&mut world, "w1").y = 6.0;
    order(&mut world, &mut orders, &me(), build_order("quarry", "w1"), &terrain).unwrap();
    let si = site_index(&world);
    world.buildings[si].site.as_mut().unwrap().work = BUILD_WORK.get("quarry").unwrap();
    run(&mut world, &terrain, 3);
    assert!(world.buildings[si].site.is_some()); // all work in, but no wood yet
    let id = world.buildings[si].id.clone();
    assert_eq!(site_id_of(&mut world, "w1"), Some(id));
    // TODO(T86.5): delivered with the drop order (and its rejection of goods the site needs none
    // of); put in directly here.
    let need = build_materials(BuildingKind::Quarry)[&csp_shared::world::Good::Wood];
    world.buildings[si]
        .site
        .as_mut()
        .unwrap()
        .delivered
        .insert(csp_shared::world::Good::Wood, need);
    run(&mut world, &terrain, 1);
    assert!(world.buildings[si].site.is_none()); // the builder's work finished it in the tick
    assert!(at(&mut world, "w1").order.is_none());
}

#[test]
fn lets_another_resident_join_the_site_and_two_finish_sooner_than_one() {
    let (mut world, terrain, mut orders) = setup();
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    let si = site_index(&world);
    let id = world.buildings[si].id.clone();
    resident(&mut world, "w2", 3.0, 3.0);
    assert_eq!(orders.receive(&world, &me(), build_order("lumberCamp", "w2"), &terrain), Ok(()));
    orders.apply_all(&mut world, &terrain);
    run(&mut world, &terrain, 1); // w2 joins
    assert_eq!(site_id_of(&mut world, "w2"), Some(id));
    let before = work_of(&world, si);
    run(&mut world, &terrain, 4);
    close(work_of(&world, si) - before, 8.0);
    assert_eq!(world.buildings.len(), 1);
}

#[test]
fn lays_out_the_footprint_from_its_north_west_tile_others_join_from_any_tile_of_it() {
    let (mut world, terrain, mut orders) = setup();
    // The forest node at (3, 3) is the south-east tile of a camp laid out from (2, 2).
    at(&mut world, "w1").x = 2.0;
    at(&mut world, "w1").y = 2.0;
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    let site = site_of(&world).unwrap().clone();
    assert_eq!((site.kind, site.x, site.y), (BuildingKind::LumberCamp, 2.0, 2.0));
    resident(&mut world, "w2", 3.0, 2.0);
    assert_eq!(
        order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w2"), &terrain),
        Ok(())
    );
    assert_eq!(site_id_of(&mut world, "w2"), Some(site.id));
    assert_eq!(world.buildings.len(), 1);
    // A tile next to the footprint is not at the site: there, a camp would be a new one.
    resident(&mut world, "w3", 4.0, 2.0);
    assert_eq!(
        orders.receive(&world, &me(), build_order("lumberCamp", "w3"), &terrain),
        Err("a lumberCamp goes with one tile on a fitting resource node".into())
    );
}

#[test]
fn gathers_goods_lying_on_the_footprint_into_the_sites_one_pile_when_it_is_laid_out() {
    let (mut world, terrain, mut orders) = setup();
    at(&mut world, "w1").x = 2.0;
    at(&mut world, "w1").y = 2.0;
    world.piles = serde_json::from_value(json!([
        { "id": "p1", "x": 3, "y": 3, "goods": { "wood": 2 } },
        { "id": "p2", "x": 2, "y": 3, "goods": { "wood": 1, "stone": 4 } },
        { "id": "p3", "x": 4, "y": 3, "goods": { "food": 5 } },
    ]))
    .unwrap();
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    let site = site_of(&world).unwrap();
    assert_eq!((site.x, site.y), (2.0, 2.0));
    let piles: Vec<Value> = world
        .piles
        .iter()
        .map(|p| json!([p.x, p.y, serde_json::to_value(&p.goods).unwrap()]))
        .collect();
    assert_eq!(
        piles,
        [json!([4.0, 3.0, { "food": 5.0 }]), json!([2.0, 2.0, { "wood": 3.0, "stone": 4.0 }])]
    );
}

#[test]
fn stops_when_the_resident_leaves_the_tile_an_unattended_site_stays_for_anyone() {
    let (mut world, terrain, mut orders) = setup();
    order(&mut world, &mut orders, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    at(&mut world, "w1").x = 2.0;
    run(&mut world, &terrain, 1);
    assert!(at(&mut world, "w1").order.is_none());
    assert!(site_of(&world).is_some());
}

#[test]
fn rejects_what_cannot_be_built() {
    let (mut world, terrain, mut orders) = setup();
    let reject = |world: &WorldState, orders: &mut Orders, o: Value, sender: &OrderSender| {
        orders.receive(world, sender, o, &terrain).err().unwrap_or_else(|| "ack".into())
    };
    let camp = || build_order("lumberCamp", "w1");
    assert_eq!(reject(&world, &mut orders, camp(), &stranger()), "not one of your residents");
    assert_eq!(
        reject(&world, &mut orders, build_order("warehouse", "w1"), &me()),
        "that can’t be built"
    );
    assert_eq!(
        reject(&world, &mut orders, build_order("quarry", "w1"), &me()),
        "a quarry goes with one tile on a fitting resource node"
    );
    at(&mut world, "w1").x = 1.0;
    assert_eq!(
        reject(&world, &mut orders, camp(), &me()),
        "a lumberCamp goes with one tile on a fitting resource node"
    );
    at(&mut world, "w1").x = 3.0;
    let tick = world.tick as f64;
    at(&mut world, "w1").born_at = tick - csp_shared::balance::ticks_for_age(5.0);
    assert_eq!(reject(&world, &mut orders, camp(), &me()), "children can’t build");
    at(&mut world, "w1").born_at = tick - csp_shared::balance::ticks_for_age(30.0);
    world.buildings.push(building("b9", BuildingKind::LumberCamp, 3.0, 3.0));
    assert_eq!(reject(&world, &mut orders, camp(), &me()), "there is already a building there");
    world.buildings = vec![building("b9", BuildingKind::Wall, 3.0, 3.0)];
    assert_eq!(reject(&world, &mut orders, camp(), &me()), "there is already a building there");
    // A wall on another tile of the camp's footprint is in the way too.
    world.buildings = vec![building("b9", BuildingKind::Wall, 4.0, 4.0)];
    assert_eq!(reject(&world, &mut orders, camp(), &me()), "there is already a building there");
    assert_eq!(orders.len(), 0);
}

#[test]
fn ends_the_order_if_the_tile_was_taken_before_the_site_is_laid_out() {
    let (mut world, terrain, mut orders) = setup();
    orders.receive(&world, &me(), build_order("lumberCamp", "w1"), &terrain).unwrap();
    orders.apply_all(&mut world, &terrain);
    world.buildings.push(building("b9", BuildingKind::LumberCamp, 3.0, 3.0));
    run(&mut world, &terrain, 1);
    assert!(at(&mut world, "w1").order.is_none());
    assert_eq!(world.buildings.len(), 1);
}

#[test]
fn building_part_names_what_a_line_order_builds_on_its_next_tile() {
    // Not in the TypeScript tests: `buildingPart` of a wall line building its first tile.
    let line = serde_json::from_value(json!({
        "kind": "wallLine", "tiles": [[4, 5], [5, 5]], "phase": "building", "path": null,
        "progress": 0, "siteId": "b3"
    }))
    .unwrap();
    assert_eq!(
        csp_sim::building::building_part(Some(&line)),
        Some(BuildingPart { building: BuildingKind::Wall, at: (4, 5), site_id: Some("b3".into()) })
    );
}
