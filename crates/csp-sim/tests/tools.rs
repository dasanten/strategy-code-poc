//! Tools (`CONTEXT.md`: Tools, T97.3): a good a smithy makes from Iron and Wood. A resident
//! carrying a set works `TOOLS_WORK_BONUS` faster at a workplace and at a construction site; a
//! second set adds nothing; without, the plain pace. Tools wear with each day's work and break.

mod build_common;

use build_common::*;
use csp_shared::balance::{
    GOOD_WEIGHT, HOME_FOOD_LOW, TOOLS_WORK_BONUS, TOOLS_WORK_DAYS, WAREHOUSE_BASE_PRICE,
    WAREHOUSE_FLOOR,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, Good, Resident, ResidentOrder, ResourceKind, ResourceNode, SkillName, Stock,
    Wear, WorldState,
};
use csp_sim::queries::balance::{batch_work, build_work, made_per_day, work_output};
use csp_sim::queries::building::{pile_tile, recipe_for};
use csp_sim::wear::{gear_condition, in_use, PieceCondition};
use csp_sim::world::create_world;
use serde_json::json;

/// A world on plains: realm r1 (Player 7), its city c1 with a farm at (3, 3) outside the wall,
/// and resident w1 standing on the farm.
fn setup() -> (WorldState, TerrainMap, Orders) {
    let t = plains(16);
    let mut world = create_world(&t, 1);
    world.realms.push(realm("r1", 7, "w1"));
    let mut farm = building("farm", BuildingKind::Farm, 3.0, 3.0);
    farm.city_id = Some("c1".into());
    world.buildings.push(farm);
    add_city(&mut world, "c1", Some("r1"), 8.0, 8.0);
    world.residents.push(new_resident("w1", Some("r1"), 3.0, 3.0));
    (world, t, Orders::default())
}

fn with_tools(sets: f64) -> Resident {
    let mut r = new_resident("w", Some("r1"), 0.0, 0.0);
    if sets > 0.0 {
        r.carried.insert(Good::Tools, sets);
    }
    r
}

fn piled(world: &WorldState, good: Good) -> f64 {
    let (px, py) = pile_tile(world, 3, 3, 5760);
    world
        .piles
        .iter()
        .find(|p| p.x as i32 == px && p.y as i32 == py)
        .and_then(|p| p.goods.get(&good).copied())
        .unwrap_or(0.0)
}

fn progress(r: &Resident) -> f64 {
    match &r.order {
        Some(ResidentOrder::WorkAt(o)) => o.progress,
        _ => 0.0,
    }
}

/// Food the farm's worker made in just short of a game day, carrying `tools` sets.
fn farmed_in_a_day(tools: f64) -> f64 {
    let (mut world, t, mut orders) = setup();
    let w = at(&mut world, "w1");
    w.carried = Stock::from([(Good::Food, HOME_FOOD_LOW)]);
    if tools > 0.0 {
        w.carried.insert(Good::Tools, tools);
    }
    order(&mut world, &mut orders, &player(7), json!({ "kind": "workAt", "residentId": "w1" }), &t)
        .unwrap();
    run(&mut world, &t, TICKS_PER_GAME_DAY as usize - 2);
    assert_sound(&world, &t);
    let r = at(&mut world, "w1").clone();
    progress(&r) + piled(&world, Good::Food)
}

#[test]
fn a_smithy_makes_tools_from_iron_and_wood_and_they_weigh_what_went_into_them() {
    let r = recipe_for(BuildingKind::Smithy, Some("tools")).expect("a Tools recipe");
    let mut inputs: Vec<&str> = r.input.0.iter().map(|(g, _)| *g).collect();
    inputs.sort_unstable();
    assert_eq!(inputs, ["iron", "wood"]);
    let weight: f64 = r.input.0.iter().map(|(g, n)| n * GOOD_WEIGHT.get(g).unwrap()).sum();
    assert_eq!(GOOD_WEIGHT.get("tools"), Some(weight));
    // Iron only: no steel Tools.
    assert!(recipe_for(BuildingKind::Smithy, Some("steelTools")).is_none());
    // Warehouses trade them like any other good.
    assert!(WAREHOUSE_FLOOR.get("tools").unwrap() > 0.0);
    assert!(WAREHOUSE_BASE_PRICE.get("tools").unwrap() > 0.0);
}

#[test]
fn a_worker_carrying_tools_works_faster_everywhere_and_a_second_set_adds_nothing() {
    let (none, one, two) = (with_tools(0.0), with_tools(1.0), with_tools(2.0));
    let faster = 1.0 + TOOLS_WORK_BONUS;
    let pairs = [
        (
            work_output(&none, Good::Food, SkillName::Farming, 0.0),
            work_output(&one, Good::Food, SkillName::Farming, 0.0),
            work_output(&two, Good::Food, SkillName::Farming, 0.0),
        ),
        (
            batch_work(&none, BuildingKind::Smithy, 0.0),
            batch_work(&one, BuildingKind::Smithy, 0.0),
            batch_work(&two, BuildingKind::Smithy, 0.0),
        ),
        (build_work(&none, 0.0), build_work(&one, 0.0), build_work(&two, 0.0)),
        (
            made_per_day(&none, BuildingKind::Smelter, Good::Iron, 0.0),
            made_per_day(&one, BuildingKind::Smelter, Good::Iron, 0.0),
            made_per_day(&two, BuildingKind::Smelter, Good::Iron, 0.0),
        ),
    ];
    for (plain, with, with_two) in pairs {
        assert!(plain > 0.0);
        assert!((with - plain * faster).abs() < 1e-9, "{with} vs {plain}");
        assert_eq!(with_two, with);
    }
    // Part of a set is no set.
    assert_eq!(build_work(&with_tools(0.5), 0.0), build_work(&none, 0.0));
}

#[test]
fn a_farmer_carrying_tools_makes_more_in_a_day_and_one_without_the_same_as_before() {
    let plain = farmed_in_a_day(0.0);
    assert!((plain - 2.0).abs() < 0.5, "{plain}");
    let with = farmed_in_a_day(1.0);
    assert!((with - plain * (1.0 + TOOLS_WORK_BONUS)).abs() < 0.1, "{with} vs {plain}");
}

/// The farm's worker w1, carrying Food and `tools` sets, set to work; the work order's first tick
/// has run.
fn farming(tools: f64) -> (WorldState, TerrainMap) {
    let (mut world, t, mut orders) = setup();
    let w = at(&mut world, "w1");
    w.carried = Stock::from([(Good::Food, HOME_FOOD_LOW), (Good::Tools, tools)]);
    order(&mut world, &mut orders, &player(7), json!({ "kind": "workAt", "residentId": "w1" }), &t)
        .unwrap();
    (world, t)
}

/// A tick of work's share of a set of Tools' life.
fn per_tick() -> f64 {
    1.0 / (TICKS_PER_GAME_DAY * TOOLS_WORK_DAYS)
}

fn tools_of(world: &mut WorldState) -> f64 {
    at(world, "w1").carried.get(&Good::Tools).copied().unwrap_or(0.0)
}

#[test]
fn tools_wear_with_each_tick_of_work_and_read_worn_on_their_own_realms_card() {
    let (mut world, t) = farming(1.0);
    let worn = in_use(&world, "w1", Good::Tools);
    assert!(worn > 0.0 && worn <= 2.0 * per_tick(), "{worn}");
    run(&mut world, &t, 100);
    let worn = in_use(&world, "w1", Good::Tools);
    assert!((worn - 101.0 * per_tick()).abs() < 2.0 * per_tick(), "{worn}");
    let r = at(&mut world, "w1").clone();
    assert_eq!(gear_condition(&world, &r).tools, Some(PieceCondition::Good));
    world.wear.insert("w1".into(), Wear::from([(Good::Tools, vec![0.6])]));
    assert_eq!(gear_condition(&world, &r).tools, Some(PieceCondition::Worn));
    assert_sound(&world, &t);
}

#[test]
fn worn_out_tools_break_and_the_worker_goes_on_at_the_plain_pace() {
    let (mut world, t) = farming(1.0);
    // Ten ticks of work left in the set.
    world.wear.insert("w1".into(), Wear::from([(Good::Tools, vec![1.0 - 10.0 * per_tick()])]));
    run(&mut world, &t, 20);
    assert_eq!(tools_of(&mut world), 0.0);
    assert!(world.wear.get("w1").is_none());
    let r = at(&mut world, "w1").clone();
    assert!(matches!(r.order, Some(ResidentOrder::WorkAt(_))), "they work on");
    assert_eq!(gear_condition(&world, &r).tools, None);
    let plain = work_output(&r, Good::Food, SkillName::Farming, 0.0);
    let mut new_set = r.clone();
    new_set.carried.insert(Good::Tools, 1.0);
    let fast = work_output(&new_set, Good::Food, SkillName::Farming, 0.0);
    assert!((fast - plain * (1.0 + TOOLS_WORK_BONUS)).abs() < 1e-9);
    assert_sound(&world, &t);
}

#[test]
fn only_the_set_in_use_wears_and_a_spare_takes_over_when_it_breaks() {
    let (mut world, t) = farming(2.0);
    world.wear.insert("w1".into(), Wear::from([(Good::Tools, vec![1.0 - 10.0 * per_tick()])]));
    run(&mut world, &t, 20);
    assert_eq!(tools_of(&mut world), 1.0);
    let worn = in_use(&world, "w1", Good::Tools);
    assert!(worn > 0.0 && worn < 12.0 * per_tick(), "the spare wears from new: {worn}");
    let r = at(&mut world, "w1").clone();
    let mut without = r.clone();
    without.carried.shift_remove(&Good::Tools);
    let plain = work_output(&without, Good::Food, SkillName::Farming, 0.0);
    let now = work_output(&r, Good::Food, SkillName::Farming, 0.0);
    assert!((now - plain * (1.0 + TOOLS_WORK_BONUS)).abs() < 1e-9, "still faster");
    assert_sound(&world, &t);
}

#[test]
fn tools_carried_but_not_worked_with_dont_wear() {
    let (mut world, t, _) = setup();
    at(&mut world, "w1").carried = Stock::from([(Good::Tools, 1.0)]);
    run(&mut world, &t, 100);
    assert_eq!(in_use(&world, "w1", Good::Tools), 0.0);
    assert_eq!(tools_of(&mut world), 1.0);
}

#[test]
fn a_builder_carrying_tools_builds_faster_and_wears_them() {
    let mut t = plains(16);
    t.tiles[3 * 16 + 3] = csp_shared::terrain::Terrain::Forest as u8;
    let mut world = empty_world(&t);
    world.nodes = vec![ResourceNode {
        id: "n1".into(),
        kind: ResourceKind::Forest,
        x: 3.0,
        y: 3.0,
        richness: Default::default(),
        stock: None,
    }];
    world.realms.push(realm("r1", 7, "w1"));
    resident(&mut world, "w1", 3.0, 3.0);
    at(&mut world, "w1").carried = Stock::from([(Good::Tools, 1.0)]);
    let mut orders = Orders::default();
    let o = json!({ "kind": "build", "residentId": "w1", "building": "lumberCamp" });
    order(&mut world, &mut orders, &player(7), o, &t).unwrap();
    let r = at(&mut world, "w1").clone();
    let per = build_work(&r, world.tick as f64);
    close(per, 1.0 + TOOLS_WORK_BONUS);
    let before = site_of(&world).and_then(|b| b.site.as_ref()).map(|s| s.work).unwrap();
    run(&mut world, &t, 10);
    let after = site_of(&world).and_then(|b| b.site.as_ref()).map(|s| s.work).unwrap();
    close(after - before, 10.0 * per);
    let worn = in_use(&world, "w1", Good::Tools);
    assert!((worn - 11.0 * per_tick()).abs() < 1.5 * per_tick(), "{worn}");
    assert_sound(&world, &t);
}
