//! The client's constants that are neither balance numbers nor specs (T122.3): the lists, limits,
//! names, paths and refusal texts the rules in the crates hold, written by `pnpm types:rust` into
//! `packages/shared-types/src/generated/constants.ts` beside the types, so the client reads them
//! from here instead of typing them again. The staleness test of `client_types` covers the file.

use serde_json::{json, Value};

use csp_shared::world::{
    BuildingKind, LineOrder, LinePhase, ResidentOrder, ResourceKind, SkillName, CONDITION_KINDS,
};

/// One exported constant: its name, what it is, its TypeScript type (none to infer it, `as
/// const` for a list whose members are a type of their own) and its value.
struct Constant {
    name: &'static str,
    doc: &'static str,
    ty: Ty,
    value: Value,
}

enum Ty {
    Inferred,
    AsConst,
    Is(&'static str),
}

fn c(name: &'static str, doc: &'static str, ty: Ty, value: impl serde::Serialize) -> Constant {
    let value = serde_json::to_value(value).expect("serialisable");
    Constant { name, doc, ty, value }
}

fn line_order() -> LineOrder {
    LineOrder {
        tiles: Default::default(),
        phase: LinePhase::Walking,
        path: None,
        progress: 0.0,
        site_id: None,
        material: None,
    }
}

/// Every constant, in the order the file lists them.
fn constants() -> Vec<Constant> {
    use crate::{auth, first_day, realtime};
    use csp_shared::chunks;
    use csp_sim::queries::{
        alliance_rules, army, building, city, contract, npc_trade, player_land, standing,
        trade_org, warehouse,
    };
    use csp_sim::{admin_map, conditions, default_scripts, directive, gathering, residents};
    use csp_sim::{reviving, script_api};
    use Ty::*;

    let resources = |of: fn(ResourceKind) -> Value| -> Value {
        ResourceKind::ALL.iter().map(|k| (k.name().to_string(), of(*k))).collect()
    };
    let (dx, dy) = warehouse::HQ_COIN_WAREHOUSE;
    let lines = [
        ("roadLine", ResidentOrder::RoadLine(line_order())),
        ("wallLine", ResidentOrder::WallLine(line_order())),
    ];
    vec![
        // Paths and limits of the server's API.
        c("WS_PATH", "Where the client opens its WebSocket.", Inferred, realtime::WS_PATH),
        c("WS_CLOSE_TOO_MANY_REQUESTS", "The close code the server ends a socket with that sent more messages than it may; the client shows it as \"too many requests\" and waits before connecting again.",
            Inferred,
            realtime::WS_CLOSE_TOO_MANY_REQUESTS,
        ),
        c("WS_CLOSE_LOGGED_OUT", "The close code a socket gets when its session ended (logout, a password reset, or expiry): the client shows the login screen instead of reconnecting.",
            Inferred,
            realtime::WS_CLOSE_LOGGED_OUT,
        ),
        c("WS_CLOSE_UPDATED", "The close code a socket gets when the tab speaks an older protocol than the server serves: the game was updated since the tab loaded, and the client shows a Reload button (ADR 0034).",
            Inferred,
            realtime::WS_CLOSE_UPDATED,
        ),
        c("WS_CLOSE_RELOAD", "The close code every socket gets when a creative server restores a checkpoint (`CONTEXT.md`: Creative mode): the world was swapped whole, so the client loads the page again at once.",
            Inferred,
            realtime::WS_CLOSE_RELOAD,
        ),
        c("PROTOCOL_VERSION", "The protocol version this client speaks, named when it connects (`/ws?v=…`, ADR 0034).",
            Inferred,
            realtime::PROTOCOL_VERSION,
        ),
        c(
            "MIN_PASSWORD_LENGTH",
            "The fewest characters a password may have.",
            Inferred,
            auth::MIN_PASSWORD_LENGTH,
        ),
        c("FIRST_DAY_PATH", "Where the client reports a line done (POST `{ line }`).",
            Inferred,
            first_day::FIRST_DAY_PATH,
        ),
        c("FIRST_DAY_DISMISS_PATH", "Where the client dismisses the first day card (POST).",
            Inferred,
            first_day::FIRST_DAY_DISMISS_PATH,
        ),
        c("FIRST_DAY_LINES", "The first day card's lines, in its order.",
            AsConst,
            first_day::FIRST_DAY_LINES.map(|l| l.name()),
        ),
        c("CLIENT_FIRST_DAY_LINES", "The lines the client reports (`FIRST_DAY_PATH`); the server sees the others itself, as the orders come in, and ignores a report of them.",
            AsConst,
            first_day::CLIENT_FIRST_DAY_LINES.map(|l| l.name()),
        ),
        c(
            "ADMIN_MAP_INFO_PATH",
            "Where an admin loads the map they draw: its seed and size (`MapInfo`).",
            Inferred,
            admin_map::ADMIN_MAP_INFO_PATH,
        ),
        c(
            "ADMIN_WORLD_PATH",
            "Where an admin loads every entity in a rectangle of tiles (`adminWorldPath`).",
            Inferred,
            admin_map::ADMIN_WORLD_PATH,
        ),
        c(
            "ADMIN_PLACES_PATH",
            "Where an admin loads the jump list's places, for the whole world (`AdminPlaces`).",
            Inferred,
            admin_map::ADMIN_PLACES_PATH,
        ),
        c(
            "ADMIN_TERRITORY_PATH",
            "Where an admin loads the territory of the whole map, as a `RegionMap` of all of it.",
            Inferred,
            admin_map::ADMIN_TERRITORY_PATH,
        ),
        c(
            "ADMIN_LAND_PATH",
            "Where an admin loads the land: its regions, passes and land bridges (`AdminLand`).",
            Inferred,
            admin_map::ADMIN_LAND_PATH,
        ),
        c(
            "ADMIN_INSPECT_PATH",
            "Where an admin loads one thing on the map for the inspector (`adminInspectPath`).",
            Inferred,
            admin_map::ADMIN_INSPECT_PATH,
        ),
        c(
            "ADMIN_VIEW_MAX_SIDE",
            "The widest and tallest rectangle `ADMIN_WORLD_PATH` gives every entity in, in tiles; \
             the far zoom asks for cities only, which may span the whole map.",
            Inferred,
            admin_map::ADMIN_VIEW_MAX_SIDE,
        ),
        c(
            "ADMIN_INSPECT_KINDS",
            "What the admin map's inspector can show (`CONTEXT.md`: admin map).",
            AsConst,
            admin_map::ADMIN_INSPECT_KINDS,
        ),
        c("ADMIN_TERRAIN_OVERVIEW_PATH", "Where an admin loads the whole map's terrain for the far zoom: `overviewAcross(size)`² bytes, row-major, each the most common terrain of its `OVERVIEW_SCALE`² tiles.",
            Inferred,
            chunks::ADMIN_TERRAIN_OVERVIEW_PATH,
        ),
        c("TERRAIN_BATCH_PATH", "Where the client loads many chunks of explored terrain in one request: a `POST` whose JSON body is `{ chunks: number[] }`, chunk indices as in `chunksAcross`, at most `TERRAIN_BATCH_MAX` of them. The answer is `encodeChunkBatch`: the explored ones among them, unexplored ones left out.",
            Inferred,
            chunks::TERRAIN_BATCH_PATH,
        ),
        c("TERRAIN_BATCH_MAX", "The most chunks one `TERRAIN_BATCH_PATH` request may ask for.",
            Inferred,
            chunks::TERRAIN_BATCH_MAX,
        ),
        c("LAND_PATH", "Where the client loads the land the Player knows (`PlayerLand`): a `POST` whose JSON body is `{ chunks?: number[] }`, the chunks to send, or every chunk they explored part of without it.",
            Inferred,
            player_land::LAND_PATH,
        ),
        // Terrain chunks.
        c("CHUNK_SIZE", "Terrain is served to clients in square chunks of this many tiles a side (ADR 0006).", Inferred, chunks::CHUNK_SIZE),
        c("UNEXPLORED", "The byte for a tile in a served chunk that the Player hasn't explored.",
            Inferred,
            chunks::UNEXPLORED,
        ),
        c("TERRAIN_LEVEL_MAX", "The coarsest level explored terrain is served at (ADR 0034). At level `k` one byte stands for a square of `2^k × 2^k` tiles, the most common terrain the Player explored in it, and a chunk is `CHUNK_SIZE × CHUNK_SIZE` squares; level 0 is one byte a tile. A `TERRAIN_BATCH_PATH` request names its level as `level`, 0 if none.",
            Inferred,
            chunks::TERRAIN_LEVEL_MAX,
        ),
        c("OVERVIEW_SCALE", "Tiles a side that one byte of the admin terrain overview stands for.",
            Inferred,
            chunks::OVERVIEW_SCALE,
        ),
        c("NODE_KINDS", "Resource node kinds by the byte that stands for them in a served chunk. Only add to the end.",
            Is("readonly ResourceKind[]"),
            chunks::NODE_KINDS,
        ),
        c("RICHNESSES", "The richnesses by their index in a served chunk's node byte (the upper four bits): normal 0.",
            Is("readonly Richness[]"),
            chunks::RICHNESSES,
        ),
        // Names and limits the rules check.
        c(
            "ALLIANCE_NAME_MAX_LENGTH",
            "The longest an alliance's name may be.",
            Inferred,
            alliance_rules::ALLIANCE_NAME_MAX_LENGTH,
        ),
        c(
            "ARMY_NAME_MAX_LENGTH",
            "The longest an army's name may be.",
            Inferred,
            army::ARMY_NAME_MAX_LENGTH,
        ),
        c("MAX_DIRECTIVE_REASON", "The longest reason an admin can give, in characters.",
            Inferred,
            directive::MAX_DIRECTIVE_REASON,
        ),
        c("MAX_DIRECTIVE_GOALS", "The most goals one directive can have.",
            Inferred,
            directive::MAX_DIRECTIVE_GOALS,
        ),
        c("MAX_DIRECTIVE_SOLDIERS", "The most soldiers a `soldiers` goal can ask to be killed.",
            Inferred,
            directive::MAX_DIRECTIVE_SOLDIERS,
        ),
        c(
            "LAST_HOUR",
            "The highest hour a condition names: a day's hours run 0 to 23.",
            Inferred,
            conditions::LAST_HOUR,
        ),
        c("GAME_DAYS_PER_WEEK", "Game days in a game week, the period a mercenary contract is paid for (`CONTEXT.md`).",
            Inferred,
            contract::GAME_DAYS_PER_WEEK,
        ),
        c("TICKS_PER_GAME_WEEK", "Ticks in one game week.",
            Inferred,
            contract::TICKS_PER_GAME_WEEK,
        ),
        c("TRADE_ORG", "The Trade Organization where a realm's id would go (`CONTEXT.md`: Trade Org army): in mercenary contracts it is a side like a realm, lending its army or hiring mercenaries.",
            Inferred,
            standing::TRADE_ORG,
        ),
        c("TRADE_ORG_NAME", "What Players call the Trade Organization where they would see a realm's name.",
            Inferred,
            standing::TRADE_ORG_NAME,
        ),
        c("HQ_COIN_WAREHOUSE", "Where the Trade Org HQ's coin warehouse stands from its town hall, north-west tile from north-west tile (`CONTEXT.md`: Warehouse): the HQ keeps its coins there and its other goods in its other warehouse.",
            Inferred,
            json!({ "dx": dx, "dy": dy }),
        ),
        c("NPC_SMITHY_WEAPON", "What an NPC city's smithy makes for its soldiers: the cheapest weapon (`RECIPES`).",
            Is("Weapon"),
            npc_trade::NPC_SMITHY_WEAPON,
        ),
        // Why something is refused.
        c(
            "CARRYING_A_CHILD",
            "Why a resident carrying a child is turned down for work, building, tearing down or \
             hauling.",
            Inferred,
            building::CARRYING_A_CHILD,
        ),
        c("NO_CHILD_FEEDS", "Why a child can't Feed anyone (`CONTEXT.md`: Reviving: any grown resident).",
            Inferred,
            reviving::NO_CHILD_FEEDS,
        ),
        c("NO_FOOD_TO_FEED", "Why a resident without Food in their hands can't Feed anyone.",
            Inferred,
            reviving::NO_FOOD_TO_FEED,
        ),
        c("HORSE_FULL", "Why a horse can't be Fed (`CONTEXT.md`: Feeding a horse: any horse that isn't full).", Inferred, reviving::HORSE_FULL),
        c("NO_CARAVANS", "Why no caravan will carry anything: the HQ has fallen (`CONTEXT.md`: Fall of the HQ).",
            Inferred,
            trade_org::NO_CARAVANS,
        ),
        // Lists and tables of kinds.
        c(
            "STAT_NAMES",
            "A resident's stats (`CONTEXT.md`: Stats).",
            AsConst,
            residents::STAT_NAMES,
        ),
        c(
            "HORSE_STAT_NAMES",
            "A horse's stats (`CONTEXT.md`: Horse stats).",
            AsConst,
            json_keys(serde_json::to_value(csp_shared::balance::AVERAGE_HORSE_STATS).unwrap()),
        ),
        c(
            "SKILL_NAMES",
            "Every skill, in the order they are declared.",
            Is("readonly SkillName[]"),
            SkillName::ALL,
        ),
        c(
            "CONDITION_KINDS",
            "Every kind of condition, in the order the condition editor offers them.",
            Is("readonly Condition['kind'][]"),
            CONDITION_KINDS,
        ),
        c("SCRIPT_PARAM_TYPES", "What a script's `param` line can hold (`CONTEXT.md`: Script parameter): `param name: type` at the top of a script, read as `params.name`, picked per resident on their card. The same types as `PARAM_TYPES` in `@csp/lang`.",
            AsConst,
            script_api::SCRIPT_PARAM_TYPES.map(script_api::param_type_name),
        ),
        c("CITY_BUILDINGS", "Kinds of city building (`CONTEXT.md`: City building): what a city is made of. Farms, workplaces and stables are not. A Trade Org warehouse is a storage of its kind.",
            Is("readonly BuildingKind[]"),
            city::CITY_BUILDINGS,
        ),
        c(
            "GATHERED_GOODS",
            "The goods gathered by hand, in the order the game offers them.",
            AsConst,
            gathering::GATHERED_GOODS,
        ),
        c(
            "NODE_GOOD",
            "The good each kind of node yields once worked (`CONTEXT.md`: Resource node).",
            Is("Record<ResourceKind, Good>"),
            resources(|k| json!(building::node_good(k))),
        ),
        c(
            "NODE_WORKPLACE",
            "The workplace built on each kind of node (`CONTEXT.md`: Workplace, Where buildings go).",
            Is("Record<ResourceKind, BuildingKind>"),
            resources(|k| json!(building::node_workplace(k))),
        ),
        c(
            "LINE_BUILDING",
            "What a line order builds on each of its tiles (`CONTEXT.md`: Road, Wall / Gate).",
            Is("Record<'roadLine' | 'wallLine', 'road' | 'wall'>"),
            lines
                .iter()
                .map(|(kind, o)| {
                    let b: BuildingKind = building::line_building(o).expect("a line order");
                    (kind.to_string(), json!(b))
                })
                .collect::<serde_json::Map<_, _>>(),
        ),
        c(
            "TARGET_PARAMS",
            "The param each task's default script takes its target in (`CONTEXT.md`: Default \
             script, Started directly).",
            Is("Partial<Readonly<Record<Task, string>>>"),
            default_scripts::TASKS
                .iter()
                .filter_map(|t| {
                    let p = default_scripts::target_param_of(*t)?;
                    Some((serde_json::to_value(t).unwrap().as_str()?.to_string(), json!(p)))
                })
                .collect::<serde_json::Map<_, _>>(),
        ),
        c(
            "WORKPLACE_PARAM",
            "The param a work script is given its workplace in: the Work default's target param.",
            Inferred,
            default_scripts::WORKPLACE_PARAM,
        ),
    ]
}

/// The keys of a JSON object, in order.
fn json_keys(v: Value) -> Vec<String> {
    v.as_object().expect("an object").keys().cloned().collect()
}

/// `value` with every whole number written without a fraction, as TypeScript writes it.
fn whole(value: Value) -> Value {
    match value {
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 9e15 => json!(f as i64),
            _ => Value::Number(n),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(whole).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, whole(v))).collect()),
        other => other,
    }
}

/// `constants.ts`.
pub fn constants_text() -> String {
    let mut out = String::from(
        "// This file was generated by `pnpm types:rust` from the Rust crates. Do not edit it.\n",
    );
    for k in constants() {
        out.push_str(&format!("\n/** {} */\n", k.doc));
        let value = serde_json::to_string(&whole(k.value)).expect("serialisable");
        match k.ty {
            Ty::Inferred => out.push_str(&format!("export const {} = {value};\n", k.name)),
            Ty::AsConst => out.push_str(&format!("export const {} = {value} as const;\n", k.name)),
            Ty::Is(ty) => out.push_str(&format!("export const {}: {ty} = {value};\n", k.name)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use csp_shared::world::{Condition, Good, CONDITION_KINDS};
    use csp_sim::gathering::{gathered_on, GATHERED_GOODS};

    #[test]
    fn the_gathered_goods_are_those_gathered_on_some_terrain() {
        let mut listed = GATHERED_GOODS.to_vec();
        listed.sort();
        let mut gathered: Vec<Good> =
            Good::ALL.iter().copied().filter(|g| gathered_on(*g).is_some()).collect();
        gathered.sort();
        assert_eq!(listed, gathered);
    }

    #[test]
    fn the_condition_kinds_are_every_kind_once() {
        let samples = [
            r#"{"kind":"carries","good":"food","compare":"atLeast","amount":1}"#,
            r#"{"kind":"load","load":"full"}"#,
            r#"{"kind":"stock","placeId":"b1","good":"food","compare":"atLeast","amount":1}"#,
            r#"{"kind":"need","need":"hunger","side":"above","share":0.5}"#,
            r#"{"kind":"mounted","is":true}"#,
            r#"{"kind":"aboard","is":true}"#,
            r#"{"kind":"hour","side":"before","hour":3}"#,
        ];
        let kinds: Vec<&str> =
            samples.iter().map(|s| serde_json::from_str::<Condition>(s).expect(s).kind()).collect();
        assert_eq!(kinds, CONDITION_KINDS);
        // A new kind of condition fails to compile here until it is in `CONDITION_KINDS`.
        let _every_kind = |c: &Condition| match c {
            Condition::Carries { .. }
            | Condition::Load { .. }
            | Condition::Stock { .. }
            | Condition::Need { .. }
            | Condition::Mounted { .. }
            | Condition::Aboard { .. }
            | Condition::Hour { .. } => (),
        };
    }
}
