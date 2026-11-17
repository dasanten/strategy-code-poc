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
use csp_shared::world::{BuildingKind, Good, Resident, ResidentOrder, SkillName, Stock, WorldState};
use csp_sim::queries::balance::{batch_work, build_work, made_per_day, work_output};
use csp_sim::queries::building::{pile_tile, recipe_for};
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
    assert!(TOOLS_WORK_BONUS > 0.0 && TOOLS_WORK_DAYS > 0.0);
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
