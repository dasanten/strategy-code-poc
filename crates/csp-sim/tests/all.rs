//! Every integration test of this crate, in one test binary. Cargo would build one binary per file
//! in `tests/`, each compiling and linking its own copy of the code it uses: that was most of the
//! build time of `cargo nextest run`. Cargo's own discovery is off (`autotests = false` in
//! Cargo.toml), so a new test file runs only once it is listed here; `every_test_file_is_listed`
//! fails when one isn't.
//!
//! Each file still declares its own helper modules (`mod common;`) as it did as a binary of its
//! own, so a helper is compiled once per file that uses it.
#![allow(clippy::duplicate_mod)]

#[path = "army_scripts.rs"]
mod army_scripts;
#[path = "boat_building.rs"]
mod boat_building;
#[path = "build_haul_started_directly.rs"]
mod build_haul_started_directly;
#[path = "building.rs"]
mod building;
#[path = "buying.rs"]
mod buying;
#[path = "caravan_theft.rs"]
mod caravan_theft;
#[path = "carriage_building.rs"]
mod carriage_building;
#[path = "carried_offers.rs"]
mod carried_offers;
#[path = "carrying.rs"]
mod carrying;
#[path = "carrying_output.rs"]
mod carrying_output;
#[path = "city_layout.rs"]
mod city_layout;
#[path = "coin_sums.rs"]
mod coin_sums;
#[path = "crew_tile.rs"]
mod crew_tile;
#[path = "default_scripts.rs"]
mod default_scripts;
#[path = "default_scripts_log.rs"]
mod default_scripts_log;
#[path = "deliveries.rs"]
mod deliveries;
#[path = "deliveries_robbed.rs"]
mod deliveries_robbed;
#[path = "demand_goods.rs"]
mod demand_goods;
#[path = "differential.rs"]
mod differential;
#[path = "down.rs"]
mod down;
#[path = "exploring.rs"]
mod exploring;
#[path = "feeding_horse.rs"]
mod feeding_horse;
#[path = "feeding_stable.rs"]
mod feeding_stable;
#[path = "fetching_inputs.rs"]
mod fetching_inputs;
#[path = "fetching_materials.rs"]
mod fetching_materials;
#[path = "getting_food.rs"]
mod getting_food;
#[path = "hauling.rs"]
mod hauling;
#[path = "haven.rs"]
mod haven;
#[path = "hitching.rs"]
mod hitching;
#[path = "horse_grant.rs"]
mod horse_grant;
#[path = "horse_market_selling.rs"]
mod horse_market_selling;
#[path = "horses_down.rs"]
mod horses_down;
#[path = "horses_down_crews.rs"]
mod horses_down_crews;
#[path = "hq_fall.rs"]
mod hq_fall;
#[path = "invariants.rs"]
mod invariants;
#[path = "invariants_rules.rs"]
mod invariants_rules;
#[path = "known_workplace.rs"]
mod known_workplace;
#[path = "last_seen.rs"]
mod last_seen;
#[path = "lost_post.rs"]
mod lost_post;
#[path = "npc_chain.rs"]
mod npc_chain;
#[path = "npc_founded.rs"]
mod npc_founded;
#[path = "npc_patrols.rs"]
mod npc_patrols;
#[path = "npc_posts.rs"]
mod npc_posts;
#[path = "npc_standing_idle.rs"]
mod npc_standing_idle;
#[path = "npc_stepped.rs"]
mod npc_stepped;
#[path = "offers_pick_up.rs"]
mod offers_pick_up;
#[path = "outpost_storage.rs"]
mod outpost_storage;
#[path = "output_food_storages.rs"]
mod output_food_storages;
#[path = "post_debt.rs"]
mod post_debt;
#[path = "processing.rs"]
mod processing;
#[path = "queries.rs"]
mod queries;
#[path = "relocate_steps.rs"]
mod relocate_steps;
#[path = "residents_stepped.rs"]
mod residents_stepped;
#[path = "road_line.rs"]
mod road_line;
#[path = "roads.rs"]
mod roads;
#[path = "script_waiting.rs"]
mod script_waiting;
#[path = "ship_building.rs"]
mod ship_building;
#[path = "ship_crew.rs"]
mod ship_crew;
#[path = "ship_sailing.rs"]
mod ship_sailing;
#[path = "sight.rs"]
mod sight;
#[path = "sight_fixtures.rs"]
mod sight_fixtures;
#[path = "smithy.rs"]
mod smithy;
#[path = "smoke.rs"]
mod smoke;
#[path = "stealing.rs"]
mod stealing;
#[path = "stealing_horse.rs"]
mod stealing_horse;
#[path = "storing.rs"]
mod storing;
#[path = "supply_lines.rs"]
mod supply_lines;
#[path = "tasks_started_directly.rs"]
mod tasks_started_directly;
#[path = "teaching.rs"]
mod teaching;
#[path = "teardown.rs"]
mod teardown;
#[path = "trade_org_debt_demand.rs"]
mod trade_org_debt_demand;
#[path = "trade_org_layout.rs"]
mod trade_org_layout;
#[path = "trading.rs"]
mod trading;
#[path = "training.rs"]
mod training;
#[path = "training_ground.rs"]
mod training_ground;
#[path = "transfers.rs"]
mod transfers;
#[path = "transfers_caravans.rs"]
mod transfers_caravans;
#[path = "wall_map.rs"]
mod wall_map;
#[path = "work.rs"]
mod work;
#[path = "work_started_directly.rs"]
mod work_started_directly;
#[path = "workplace_amounts.rs"]
mod workplace_amounts;
#[path = "world_index.rs"]
mod world_index;

/// Cargo no longer finds test files on its own: one missing here would never run.
#[test]
fn every_test_file_is_listed() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let listed = include_str!("all.rs");
    let mut missing: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .filter(|name| name.ends_with(".rs") && name != "all.rs")
        .filter(|name| !listed.contains(&format!("#[path = \"{name}\"]")))
        .collect();
    missing.sort();
    assert!(
        missing.is_empty(),
        "tests/all.rs doesn't list {missing:?}; add `#[path = \"<file>.rs\"] mod <file>;` for each"
    );
}
