//! The rules that take only values, no world (T122.5): costs, recipes, prices, fees, capacities,
//! paces, names and checks of what a Player sends. One entry, [`rule`], called by name with its
//! arguments as a JSON array and answering JSON, so a rule is one line here and one in
//! `packages/lang-wasm/src/rules.ts`. Each line calls `csp-sim`'s (or `csp-shared`'s) own function;
//! where the client's shape differs, the line converts.

use csp_shared::world::{BuildingKind, CarriedFeeBy, Good, ResourceKind, Stock, WallMaterial};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use wasm_bindgen::prelude::wasm_bindgen;

use csp_sim::queries::{
    building, building_info, carriages, city_area, combat, demand, direct_offer, horse_market,
    npc_trade, people, residents, trader_trade, transfer, warehouse, warehouse_trade,
};

/// The arguments of a call, read as the tuple the rule takes.
fn args<T: DeserializeOwned>(name: &str, json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|e| format!("{name}: {e}"))
}

/// A price as the client has it.
fn price(p: warehouse::Price) -> Value {
    json!({ "buy": p.buy, "sell": p.sell })
}

/// A recipe as the client has it: its input and output, keyed by good.
fn recipe(r: &csp_shared::balance::Recipe) -> Value {
    serde_json::to_value(r).expect("serialisable")
}

/// Calls the rule `name` with `args`, a JSON array of its arguments; answers its result as JSON,
/// or an error for a rule it doesn't know or arguments it can't read.
#[wasm_bindgen(js_name = rule)]
pub fn rule(name: &str, json: &str) -> Result<String, String> {
    let out: Value = match name {
        // Building, repairing, rebuilding (`CONTEXT.md`: Construction site, Repairing, Ruin).
        "buildingWork" => {
            let (kind, under, material): (BuildingKind, Option<u8>, Option<WallMaterial>) =
                args(name, json)?;
            json!(building::build_work_for(kind, material) * building::work_factor(kind, under))
        }
        "materialsOfKind" => {
            let (kind, material): (BuildingKind, Option<WallMaterial>) = args(name, json)?;
            json!(building::build_materials_of(kind, material))
        }
        "workOfKind" => {
            let (kind, material): (BuildingKind, Option<WallMaterial>) = args(name, json)?;
            json!(building::build_work_for(kind, material))
        }
        "workFactor" => {
            let (kind, under): (BuildingKind, Option<u8>) = args(name, json)?;
            json!(building::work_factor(kind, under))
        }
        "siteWorkOf" => {
            let (work, kind, under): (f64, BuildingKind, Option<u8>) = args(name, json)?;
            json!(building::site_work_of(work, kind, under))
        }
        "hasChoice" => {
            let (kind,): (BuildingKind,) = args(name, json)?;
            json!(building::has_choice(kind))
        }
        "recipeFor" => {
            let (kind, makes): (BuildingKind, Option<Good>) = args(name, json)?;
            building::recipe_for(kind, makes.map(Good::name)).map_or(Value::Null, recipe)
        }
        "buildMenu" => {
            let (node,): (Option<ResourceKind>,) = args(name, json)?;
            json!(building::build_menu(node))
        }
        "buildingInfo" => {
            let (kind, node): (BuildingKind, Option<ResourceKind>) = args(name, json)?;
            let i = building_info::building_info(kind, node);
            json!({
                "kind": i.kind,
                "purpose": i.purpose,
                "recipes": i.recipes.iter().map(recipe).collect::<Vec<_>>(),
                "yields": i.yields,
                "skill": i.skill,
                "maxWorkers": i.max_workers,
                "footprint": i.footprint,
                "materials": i.materials,
                "work": i.work,
            })
        }
        "repairMaterials" => {
            let (kind,): (BuildingKind,) = args(name, json)?;
            json!(csp_sim::repair::repair_materials(kind))
        }
        "repairWork" => {
            let (kind,): (BuildingKind,) = args(name, json)?;
            json!(csp_sim::repair::repair_work(kind))
        }
        "rebuildMaterials" => {
            let (kind,): (BuildingKind,) = args(name, json)?;
            json!(csp_sim::ruins::rebuild_materials(kind))
        }
        "rebuildWork" => {
            let (kind,): (BuildingKind,) = args(name, json)?;
            json!(csp_sim::ruins::rebuild_work(kind))
        }
        "cornersCovering" => {
            let (kind, x, y, size): (BuildingKind, i32, i32, i32) = args(name, json)?;
            json!(building::corners_covering(kind, x, y, size))
        }
        "roadLine" => {
            let (from, to, size): ((i32, i32), (i32, i32), i32) = args(name, json)?;
            json!(building::road_line(from, to, size))
        }
        // Carrying: weights, loads, food for the way (`CONTEXT.md`: Carriage, Caravan).
        "stockWeight" => {
            let (stock,): (Stock,) = args(name, json)?;
            json!(residents::stock_weight(&stock))
        }
        "loadLevel" => {
            let (load, capacity): (Stock, f64) = args(name, json)?;
            json!(carriages::load_level(&load, capacity))
        }
        "caravanFoodFor" => {
            let (escorts,): (f64,) = args(name, json)?;
            json!(carriages::caravan_food_for(escorts))
        }
        "foodForWay" => {
            let (escorts, tiles, stops): (f64, f64, f64) = args(name, json)?;
            json!(csp_sim::caravans::food_for_way(escorts, tiles, stops))
        }
        "putAwayUnits" => {
            let (good, carried, own_food): (Good, f64, Option<f64>) = args(name, json)?;
            let own_food = own_food.unwrap_or(csp_shared::balance::OWN_FOOD);
            json!(csp_shared::goods::put_away_units(good.name(), carried, own_food))
        }
        "carriageCanEnter" => {
            let (terrain,): (u8,) = args(name, json)?;
            json!(csp_shared::balance::carriage_can_enter(terrain))
        }
        // Prices and fees (`CONTEXT.md`: Warehouse, Transfer, Trader, NPC city prices).
        "priceFor" => {
            let (good, stock, floor): (Good, f64, f64) = args(name, json)?;
            price(warehouse::price_for(good, stock, floor))
        }
        "traderPriceFor" => {
            let (good, stock): (Good, f64) = args(name, json)?;
            price(trader_trade::trader_price_for(good, stock))
        }
        "npcPriceFor" => {
            let (good, stock, reserve, swing): (Good, f64, Stock, f64) = args(name, json)?;
            price(npc_trade::npc_price_for(good, stock, &reserve, swing))
        }
        "deliveryFee" => {
            let (kg, tiles): (f64, f64) = args(name, json)?;
            json!(warehouse_trade::delivery_fee(kg, tiles))
        }
        "transferFee" => {
            let (kg, tiles): (f64, f64) = args(name, json)?;
            json!(transfer::transfer_fee(kg, tiles))
        }
        "feeAtPickUp" => {
            let (fee, unload_share): (f64, f64) = args(name, json)?;
            json!(transfer::fee_at_pick_up(fee, unload_share))
        }
        "transferLoad" => {
            let (good,): (Good,) = args(name, json)?;
            json!(transfer::transfer_load(good))
        }
        "transferLoads" => {
            let (goods,): (Stock,) = args(name, json)?;
            let loads = demand::transfer_loads(&goods);
            json!(loads
                .iter()
                .map(|(good, units)| json!({ "good": good, "units": units }))
                .collect::<Vec<_>>())
        }
        "transferLoadsFee" => {
            let (goods, tiles): (Stock, f64) = args(name, json)?;
            json!(demand::transfer_loads_fee(&goods, tiles))
        }
        "goodsToHandOver" => {
            let (goods, free): (Stock, Stock) = args(name, json)?;
            json!(demand::goods_to_hand_over(&goods, &free))
        }
        "carriedUnloadShares" => {
            let (fee_by,): (CarriedFeeBy,) = args(name, json)?;
            let (sender, other) = direct_offer::carried_unload_shares(fee_by);
            json!({ "sender": sender, "other": other })
        }
        "horseStockFactor" => {
            let (has, wanted): (f64, f64) = args(name, json)?;
            json!(horse_market::horse_stock_factor(has, wanted))
        }
        // NPC cities (`CONTEXT.md`: NPC city).
        "npcSoldierTarget" => {
            let (adults,): (f64,) = args(name, json)?;
            json!(npc_trade::npc_soldier_target(adults))
        }
        "npcFullDays" => {
            let (residents,): (f64,) = args(name, json)?;
            json!(npc_trade::npc_full_days(residents))
        }
        "npcFoundingPartySize" => {
            let (residents,): (f64,) = args(name, json)?;
            json!(npc_trade::npc_founding_party_size(residents))
        }
        // Checks of what a Player sends.
        "nameProblem" => {
            let (name_value, max_length): (Value, f64) = args(name, json)?;
            json!(people::name_problem(name_value.as_str(), max_length))
        }
        "foundingProblem" => {
            let (realm, leader): (Value, Value) = args(name, json)?;
            json!(people::founding_problem(realm.as_str(), leader.as_str()))
        }
        "demandNoteProblem" => {
            let (note,): (Option<Value>,) = args(name, json)?;
            json!(demand::demand_note_problem(note.as_ref()))
        }
        "queueStepsProblem" => {
            let (items,): (Option<Value>,) = args(name, json)?;
            json!(csp_sim::queue::queue_steps_problem(items.as_ref()))
        }
        "isFirstDayLine" => {
            let (line,): (Value,) = args(name, json)?;
            json!(line.as_str().is_some_and(people::is_first_day_line))
        }
        "isClientFirstDayLine" => {
            let (line,): (Value,) = args(name, json)?;
            json!(line.as_str().is_some_and(people::is_client_first_day_line))
        }
        "isParamNumber" => {
            let (value,): (Value,) = args(name, json)?;
            json!(csp_sim::script_api::is_param_number(&value))
        }
        // Time and places.
        "gameTime" => {
            let (tick,): (f64,) = args(name, json)?;
            let t = csp_shared::time::game_time(tick);
            json!({ "year": t.year, "day": t.day, "hour": t.hour, "minute": t.minute })
        }
        "formatGameTime" => {
            let (tick,): (f64,) = args(name, json)?;
            json!(csp_shared::time::format_game_time(tick))
        }
        "idNumber" => {
            let (id,): (String,) = args(name, json)?;
            json!(city_area::id_number(&id))
        }
        "inContact" => {
            let (size, a, b): (i32, (i32, i32), (i32, i32)) = args(name, json)?;
            json!(combat::in_contact(size, a, b))
        }
        _ => return Err(format!("no rule {name}")),
    };
    Ok(serde_json::to_string(&out).expect("serialisable"))
}
