//! The rules that take only values, no world (T122.5): costs, recipes, prices, fees, capacities,
//! paces, names and checks of what a Player sends. One entry, [`rule`], called by name with its
//! arguments as a JSON array and answering JSON, so a rule is one line here and one in
//! `packages/lang-wasm/src/rules.ts`. Each line calls `csp-sim`'s (or `csp-shared`'s) own function;
//! where the client's shape differs, the line converts.

use csp_lang::ParamInfo;
use csp_shared::world::{
    BuildingKind, CarriedFeeBy, Directive, DirectiveGoal, Good, HorseStats, MercenaryContract,
    Realm, ResourceKind, SkillName, Stock, Task, TrainingSubject, WallMaterial, Waypoint,
};
use csp_shared::world::{Offer, OrderRequest, TradeSide};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use wasm_bindgen::prelude::wasm_bindgen;

use csp_sim::queries::{
    building, building_info, carriages, city_area, combat, demand, direct_offer, horse_market,
    npc_trade, people, residents, trader_trade, transfer, walls, warehouse, warehouse_trade,
};

/// A tile as a rule takes it: (x, y).
type Tile = (f64, f64);

/// The arguments of a call, read as the tuple the rule takes.
fn args<T: DeserializeOwned>(name: &str, json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|e| format!("{name}: {e}"))
}

/// A building the client passes: a `SeenBuilding` as it was sent (its `is` too) or a plain one,
/// read the way the world mirror reads one, so the module needs no other reader for it.
fn building_arg(mut v: Value) -> Result<csp_shared::world::Building, String> {
    if let Some(map) = v.as_object_mut() {
        // What a Player sees of it besides the building, which these rules don't read.
        for key in ["is", "prices", "offers"] {
            map.remove(key);
        }
    }
    serde_json::from_value::<csp_shared::protocol::SeenBuilding>(v)
        .map(|seen| seen.building)
        .map_err(|e| format!("a building: {e}"))
}

/// The building in a call's only argument.
fn one_building(name: &str, json: &str) -> Result<csp_shared::world::Building, String> {
    let (b,): (Value,) = args(name, json)?;
    building_arg(b)
}

/// A resident the client passes, as a Player sees them (`SeenResident`) or whole, read the way the
/// world mirror reads one (`csp_sim::mirror::resident`). What the rules here never read of a
/// whole resident (their script, its log, what interrupted it) is left out first.
fn resident_arg(mut v: Value) -> Result<csp_shared::world::Resident, String> {
    if let Some(map) = v.as_object_mut() {
        for key in ["is", "script", "scriptLog", "interrupted", "givenUnderAttack"] {
            map.remove(key);
        }
    }
    serde_json::from_value::<csp_shared::protocol::SeenResident>(v)
        .map(csp_sim::mirror::resident)
        .map_err(|e| format!("a resident: {e}"))
}

/// A horse the client passes, as a Player sees it or whole (`csp_sim::mirror::horse`).
fn horse_arg(mut v: Value) -> Result<csp_shared::world::Horse, String> {
    if let Some(map) = v.as_object_mut() {
        map.remove("is");
    }
    serde_json::from_value::<csp_shared::protocol::SeenHorse>(v)
        .map(csp_sim::mirror::horse)
        .map_err(|e| format!("a horse: {e}"))
}

/// A carriage the client passes, as a Player sees it or whole (`csp_sim::mirror::carriage`).
fn carriage_arg(mut v: Value) -> Result<csp_shared::world::Carriage, String> {
    if let Some(map) = v.as_object_mut() {
        map.remove("is");
    }
    serde_json::from_value::<csp_shared::protocol::SeenCarriage>(v)
        .map(csp_sim::mirror::carriage)
        .map_err(|e| format!("a carriage: {e}"))
}

/// A name a Player sends, as the client passes it: `{ "v": value }`, with no `v` for none, so
/// that nothing sent and `null` sent stay apart as `Given` keeps them.
#[derive(serde::Deserialize)]
struct Given {
    #[serde(default, deserialize_with = "present")]
    v: Option<Value>,
}

/// A field that is there, `null` or not, as `Some`.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    <Value as serde::Deserialize>::deserialize(d).map(Some)
}

impl Given {
    fn given(&self) -> people::Given<'_> {
        match &self.v {
            None => people::Given::Missing,
            Some(Value::String(s)) => people::Given::Text(s),
            Some(_) => people::Given::NotText,
        }
    }
}

/// A city the client passes, as a Player sees it (`SeenCity`) or whole: what the rules read of
/// it is the city's own fields.
fn city_arg(mut v: Value) -> Result<csp_shared::world::City, String> {
    if let Some(map) = v.as_object_mut() {
        // What a Player sees of it besides the city, which these rules don't read.
        for key in
            ["is", "price", "wontSell", "refuses", "hire", "trade", "retaliatingAgainst", "horses"]
        {
            map.remove(key);
        }
    }
    serde_json::from_value::<csp_shared::world::City>(v).map_err(|e| format!("a city: {e}"))
}

/// A trade holder as the client passes it: what it holds and the room it has left.
#[derive(serde::Deserialize)]
struct Holder {
    stock: Stock,
    room: f64,
}

impl Holder {
    fn as_holder(&self) -> warehouse_trade::TradeHolder<'_> {
        warehouse_trade::TradeHolder { stock: &self.stock, room: self.room }
    }
}

/// What stops a trade short, as the client names it.
fn limit_name(limit: warehouse_trade::TradeLimit) -> &'static str {
    use warehouse_trade::TradeLimit::*;
    match limit {
        Coins => "coins",
        Held => "held",
        Room => "room",
        Stock => "stock",
        TheirCoins => "theirCoins",
        TheirRoom => "theirRoom",
        Unwanted => "unwanted",
        Refused => "refused",
    }
}

/// A trade quote as the client has it: its limit only when something cut it short.
fn trade_quote(q: warehouse_trade::TradeQuote) -> Value {
    let mut out = json!({ "units": q.units, "coins": q.coins });
    if let Some(limit) = q.limit {
        out["limit"] = json!(limit_name(limit));
    }
    out
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
        // Rules on a few fields of one thing (T122.5b): the client passes the fields.
        // A resident seen without a birth (`SeenResident`) has no age: NaN, as the client had it.
        "ageInYears" => {
            let (born_at, tick): (Option<f64>, f64) = args(name, json)?;
            let born_at = born_at.unwrap_or(f64::NAN);
            json!(residents::age_in_years(born_at, tick))
        }
        "canWork" => {
            let (born_at, tick): (Option<f64>, f64) = args(name, json)?;
            let born_at = born_at.unwrap_or(f64::NAN);
            json!(residents::can_work(born_at, tick))
        }
        "canHandle" => {
            let (born_at, tick, goods): (Option<f64>, f64, Vec<Value>) = args(name, json)?;
            let born_at = born_at.unwrap_or(f64::NAN);
            // A word that is no good is no child's good either.
            let goods: Option<Vec<Good>> =
                goods.into_iter().map(|g| serde_json::from_value(g).ok()).collect();
            json!(match goods {
                Some(goods) => csp_sim::queries::goods::can_handle(born_at, tick, &goods),
                None => residents::can_work(born_at, tick),
            })
        }
        "riderSpareFood" => {
            let (carried,): (Stock,) = args(name, json)?;
            json!(csp_sim::queries::riding::rider_spare_food(&carried))
        }
        "traderStock" => {
            let (escorts, load): (usize, Stock) = args(name, json)?;
            json!(trader_trade::trader_stock(escorts, &load))
        }
        "transferTiles" => {
            let (size, warehouse, from, to): (i32, Tile, Option<Tile>, Tile) = args(name, json)?;
            json!(transfer::transfer_tiles(size, warehouse, from, to))
        }
        "quoteTransfer" => {
            let (held, good, wanted, tiles, unload_share): (Stock, Good, f64, f64, f64) =
                args(name, json)?;
            let (units, fee) = transfer::quote_transfer(&held, good, wanted, tiles, unload_share);
            json!({ "units": units, "fee": fee })
        }
        "addWaypointProblem" => {
            let (held, x, y, label, size): (
                Vec<Waypoint>,
                Option<Value>,
                Option<Value>,
                Option<Value>,
                i32,
            ) = args(name, json)?;
            json!(csp_sim::waypoints::add_waypoint_problem(
                &held,
                x.as_ref(),
                y.as_ref(),
                label.as_ref(),
                size
            ))
        }
        "renameWaypointProblem" => {
            let (held, id, label): (Vec<Waypoint>, Option<Value>, Option<Value>) =
                args(name, json)?;
            json!(csp_sim::waypoints::rename_waypoint_problem(&held, id.as_ref(), label.as_ref()))
        }
        "removeWaypointProblem" => {
            let (held, id): (Vec<Waypoint>, Option<Value>) = args(name, json)?;
            json!(csp_sim::waypoints::remove_waypoint_problem(&held, id.as_ref()))
        }
        "offerTermsProblem" => {
            let (terms,): (serde_json::Map<String, Value>,) = args(name, json)?;
            json!(csp_sim::queries::offers::offer_terms_problem(&terms))
        }
        "conditionProblem" => {
            let (c,): (Option<Value>,) = args(name, json)?;
            json!(csp_sim::conditions::condition_of(c.as_ref()).err())
        }
        "npcSwapRates" => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Line {
                good: Good,
                for_sale: f64,
                wanted: f64,
                buy: f64,
                sell: f64,
            }
            let (lines,): (Vec<Line>,) = args(name, json)?;
            let prices: Vec<npc_trade::NpcCityPrice> = lines
                .into_iter()
                .map(|l| npc_trade::NpcCityPrice {
                    good: l.good,
                    stock: 0.0,
                    for_sale: l.for_sale,
                    wanted: l.wanted,
                    buy: l.buy,
                    sell: l.sell,
                })
                .collect();
            let rates = csp_sim::queries::trade_quotes::npc_swap_rates(&prices);
            json!(rates
                .iter()
                .map(|r| json!({ "give": r.give, "gives": r.gives, "want": r.want, "units": r.units }))
                .collect::<Vec<_>>())
        }
        "targetParam" => {
            let (task,): (Option<Task>,) = args(name, json)?;
            json!(csp_sim::default_scripts::target_param(task))
        }
        "isWorkScript" => {
            let (params,): (Vec<ParamInfo>,) = args(name, json)?;
            json!(csp_sim::default_scripts::is_work_script(&params))
        }
        "paramNeedsValue" => {
            let (param,): (ParamInfo,) = args(name, json)?;
            json!(csp_sim::default_scripts::param_needs_value(&param))
        }
        "isParamChoice" => {
            let (param, value): (ParamInfo, Value) = args(name, json)?;
            json!(csp_sim::script_api::is_param_choice(&param, &value))
        }
        // Rules on one building (T122.5b): the client passes the building.
        "materialsNeeded" => json!(building::materials_needed(&one_building(name, json)?)),
        "workNeeded" => json!(building::work_needed(&one_building(name, json)?)),
        "teardownWork" => json!(building::teardown_work(&one_building(name, json)?)),
        "teardownLeft" => json!(building::teardown_left(&one_building(name, json)?)),
        "teardownReturns" => json!(building::teardown_returns(&one_building(name, json)?)),
        "conditionOf" => {
            let b = one_building(name, json)?;
            json!(csp_sim::repair::condition_of(&b).map(|c| c.name()))
        }
        "repairable" => json!(csp_sim::repair::repairable(&one_building(name, json)?)),
        "brokenReturns" => json!(walls::broken_returns(&one_building(name, json)?)),
        "wallStrength" => json!(walls::wall_strength(&one_building(name, json)?)),
        "wallStrengthLeft" => json!(walls::wall_strength_left(&one_building(name, json)?)),
        "inInnerRingAround" => {
            let (hall, at, size): (Value, Tile, i32) = args(name, json)?;
            json!(csp_sim::queries::trade_org::in_inner_ring_around(&building_arg(hall)?, at, size))
        }
        // Rules on one resident or horse (T122.5b): the client passes them.
        "ageFactor" => {
            let (r, tick): (Value, f64) = args(name, json)?;
            json!(residents::age_factor(&resident_arg(r)?, tick))
        }
        "constructionLearned" => {
            let (r, tick): (Value, f64) = args(name, json)?;
            json!(csp_sim::queries::balance::construction_learned(&resident_arg(r)?, tick))
        }
        "foodUse" => {
            let (r, terrain, tick): (Value, u8, f64) = args(name, json)?;
            json!(residents::food_use(&resident_arg(r)?, terrain, tick))
        }
        "madePerDay" => {
            let (r, kind, good, tick): (Value, BuildingKind, Good, f64) = args(name, json)?;
            json!(csp_sim::queries::balance::made_per_day(&resident_arg(r)?, kind, good, tick))
        }
        "workLearned" => {
            let (r, skill, tick): (Value, SkillName, f64) = args(name, json)?;
            json!(csp_sim::queries::balance::work_learned(&resident_arg(r)?, skill, tick))
        }
        "subjectValue" => {
            let (r, subject, tick): (Value, TrainingSubject, f64) = args(name, json)?;
            json!(csp_sim::queries::balance::subject_value(&resident_arg(r)?, subject, tick))
        }
        "trainingCeiling" => {
            let (trainee, teacher, subject, tick): (Value, Value, TrainingSubject, f64) =
                args(name, json)?;
            let (trainee, teacher) = (resident_arg(trainee)?, resident_arg(teacher)?);
            json!(csp_sim::queries::balance::training_ceiling(&trainee, &teacher, subject, tick))
        }
        "unitsThatFit" => {
            let (r, good, tick): (Value, Good, f64) = args(name, json)?;
            json!(csp_sim::queries::goods::units_that_fit(&resident_arg(r)?, good, tick))
        }
        "horseBuyerProblem" => {
            let (r, price, tick): (Value, f64, f64) = args(name, json)?;
            json!(csp_sim::queries::trade_quotes::horse_buyer_problem(
                &resident_arg(r)?,
                price,
                tick
            ))
        }
        "horseSellerProblem" => {
            let (r, price, tick): (Value, f64, f64) = args(name, json)?;
            json!(csp_sim::queries::trade_quotes::horse_seller_problem(
                &resident_arg(r)?,
                price,
                tick
            ))
        }
        "foodPerTick" => {
            let (r, terrain, tick, stats): (Value, u8, f64, Option<HorseStats>) = args(name, json)?;
            let r = resident_arg(r)?;
            json!(csp_sim::queries::estimates::food_per_tick(&r, terrain, tick, stats.as_ref()))
        }
        "rideSpeed" => {
            let (rider, horse, terrain): (Value, Value, u8) = args(name, json)?;
            let (rider, horse) = (resident_arg(rider)?, horse_arg(horse)?);
            json!(csp_sim::queries::pace::ride_speed(&rider, &horse, terrain))
        }
        "horseWorth" => {
            let (h, tick): (Value, f64) = args(name, json)?;
            json!(horse_market::horse_worth(&horse_arg(h)?, tick))
        }
        "horseAgeInYears" => {
            let (h, tick): (Value, f64) = args(name, json)?;
            json!(residents::horse_age_in_years(&horse_arg(h)?, tick))
        }
        "feedProblem" => {
            let (feeder, target, tick, size): (Value, Option<Value>, f64, i32) = args(name, json)?;
            let feeder = resident_arg(feeder)?;
            let target = target.map(resident_arg).transpose()?;
            json!(csp_sim::reviving::feed_problem(&feeder, target.as_ref(), tick, size))
        }
        // Rules on one contract, realm, directive or carriage (T122.5b): the client passes it.
        "workPace" => {
            let (b, workers, tick, under): (Value, Vec<Value>, f64, Option<u8>) = args(name, json)?;
            let b = building_arg(b)?;
            let workers =
                workers.into_iter().map(resident_arg).collect::<Result<Vec<_>, String>>()?;
            let refs: Vec<&csp_shared::world::Resident> = workers.iter().collect();
            json!(building::work_pace(&b, &refs, tick, under))
        }
        "contractWeeks" => {
            let (c,): (MercenaryContract,) = args(name, json)?;
            json!(csp_sim::queries::contract::contract_weeks(&c))
        }
        "contractEndsAt" => {
            let (c, started_at): (MercenaryContract, f64) = args(name, json)?;
            json!(csp_sim::queries::contract::contract_ends_at(&c, started_at))
        }
        "contractPayBy" => {
            let (c,): (MercenaryContract,) = args(name, json)?;
            json!(csp_sim::queries::contract::contract_pay_by(&c))
        }
        "demandsCounted" => {
            let (realm, tick): (Realm, f64) = args(name, json)?;
            json!(demand::demands_counted(&realm, tick))
        }
        "demandsLeft" => {
            let (realm, tick): (Realm, f64) = args(name, json)?;
            json!(demand::demands_left(&realm, tick))
        }
        "goalMet" => {
            let (d, goal): (Directive, DirectiveGoal) = args(name, json)?;
            json!(csp_sim::directive::goal_met(&d, &goal))
        }
        "goalsMet" => {
            let (d,): (Directive,) = args(name, json)?;
            json!(csp_sim::directive::goals_met(&d))
        }
        "renameProblem" => {
            let (realm, target, label, realm_name): (Realm, Option<Value>, Given, Given) =
                args(name, json)?;
            let target = target.map(resident_arg).transpose()?;
            json!(people::rename_problem(
                &realm,
                target.as_ref(),
                label.given(),
                realm_name.given()
            ))
        }
        "horseRenameProblem" => {
            let (realm, h, label): (Realm, Option<Value>, Given) = args(name, json)?;
            let h = h.map(horse_arg).transpose()?;
            json!(people::horse_rename_problem(&realm, h.as_ref(), label.given()))
        }
        "carriedFeesOver" => {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Way {
                sender_tiles: f64,
                other_tiles: f64,
            }
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Goods {
                gives: Good,
                gives_units: f64,
                wants: Good,
                wants_units: f64,
                times: f64,
            }
            let (way, fee_by, g): (Way, CarriedFeeBy, Goods) = args(name, json)?;
            let way = direct_offer::CarriedWay {
                sender_tiles: way.sender_tiles,
                other_tiles: way.other_tiles,
            };
            let goods = direct_offer::OfferGoods {
                gives: g.gives,
                gives_units: g.gives_units,
                wants: g.wants,
                wants_units: g.wants_units,
                times: g.times,
            };
            let (sender, other) = direct_offer::carried_fees_over(&way, fee_by, goods);
            json!({ "senderFee": sender, "otherFee": other })
        }
        "boarderProblem" => {
            let (r, k): (Value, Value) = args(name, json)?;
            let (r, k) = (resident_arg(r)?, carriage_arg(k)?);
            json!(csp_sim::queries::driving::boarder_problem(&r, &k))
        }
        "unhitchProblem" => {
            let (r, k, tick): (Value, Option<Value>, f64) = args(name, json)?;
            let r = resident_arg(r)?;
            let k = k.map(carriage_arg).transpose()?;
            json!(csp_sim::queries::driving::unhitch_problem(&r, k.as_ref(), tick))
        }
        // The last rules on one thing (T122.5b): who works on a site, trade holders and quotes,
        // a city's, and a queue step's.
        "workingOn" => {
            let (b, residents, tearing_down, size): (Value, Vec<Value>, bool, i32) =
                args(name, json)?;
            let b = building_arg(b)?;
            let residents =
                residents.into_iter().map(resident_arg).collect::<Result<Vec<_>, String>>()?;
            let on = building::working_on(&b, &residents, tearing_down, size);
            json!(on.iter().map(|r| r.id.as_str()).collect::<Vec<_>>())
        }
        "handsOf" => {
            let (r, tick): (Value, f64) = args(name, json)?;
            let r = resident_arg(r)?;
            let h = warehouse_trade::hands_of(&r, tick);
            json!({ "stock": h.stock, "room": h.room })
        }
        "loadOf" => {
            let (k, capacity): (Value, f64) = args(name, json)?;
            let k = carriage_arg(k)?;
            let h = warehouse_trade::load_of(&k, capacity);
            json!({ "stock": h.stock, "room": h.room })
        }
        "quoteAtPrices" => {
            let (stock, floor, coin_stock, holder, side, good, wanted, owed, their_room): (
                f64,
                f64,
                f64,
                Holder,
                TradeSide,
                Good,
                f64,
                f64,
                Option<f64>,
            ) = args(name, json)?;
            let q = warehouse_trade::quote_at_prices(
                stock,
                floor,
                coin_stock,
                holder.as_holder(),
                side,
                good,
                wanted,
                owed,
                their_room.unwrap_or(f64::INFINITY),
                &[],
            );
            trade_quote(q)
        }
        "quoteTraderTrade" => {
            let (escorts, load, capacity, holder, side, good, wanted): (
                usize,
                Stock,
                f64,
                Holder,
                TradeSide,
                Good,
                f64,
            ) = args(name, json)?;
            let q = csp_sim::queries::trade_quotes::quote_trader_trade(
                escorts,
                &load,
                capacity,
                holder.as_holder(),
                side,
                good,
                wanted,
                &[],
            );
            trade_quote(q)
        }
        "quoteOffer" => {
            let (offer, holder, wanted, available): (Offer, Holder, f64, Option<f64>) =
                args(name, json)?;
            let q = csp_sim::queries::offers::quote_offer(
                &offer,
                &holder.as_holder(),
                wanted,
                available.unwrap_or(f64::INFINITY),
            );
            let mut out = json!({ "times": q.times, "gives": q.gives, "wants": q.wants });
            if let Some(limit) = q.limit {
                out["limit"] = json!(limit_name(limit));
            }
            out
        }
        "cityRenameProblem" => {
            let (realm, city, label): (Realm, Option<Value>, Given) = args(name, json)?;
            let city = city.map(city_arg).transpose()?;
            json!(people::city_rename_problem(&realm, city.as_ref(), label.given()))
        }
        "formerPlayerStanding" => {
            let (city, tick): (Value, f64) = args(name, json)?;
            json!(csp_sim::queries::standing::former_player_standing(&city_arg(city)?, tick))
        }
        "neverEnds" => {
            let (order,): (OrderRequest,) = args(name, json)?;
            json!(csp_sim::queue::never_ends(&order))
        }
        "feedsOnce" => {
            let (order,): (OrderRequest,) = args(name, json)?;
            json!(csp_sim::queue::feeds_once(&order))
        }
        "stepLine" => {
            let (order,): (OrderRequest,) = args(name, json)?;
            json!(csp_sim::queue::step_line(&order))
        }
        _ => return Err(format!("no rule {name}")),
    };
    Ok(serde_json::to_string(&out).expect("serialisable"))
}
