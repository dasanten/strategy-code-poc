//! The admin map's world (`apps/server/src/admin-map.ts` with the shapes of shared
//! `admin-map.ts`, `CONTEXT.md`: Admin, admin map): everything in the world for admins, read
//! between ticks and never changing it. Script sources are never in it.
//!
//! The TypeScript builds these views by spreading entities into objects (`{ is, ...entity, org }`);
//! here they are JSON values built the same way, key for key, so the wire shape is the same.

use std::collections::{HashMap, HashSet};

use csp_shared::terrain::wrap;
use csp_shared::world::{BuildingKind, Caravan, City, RunningScript, Stock, Trader, WorldState};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::queries::alliance::alliance_of;
use crate::queries::carriages::crew_ids_of;
use crate::queries::city::town_hall_of;
use crate::queries::names::{held, kind_name, ALL_GOODS};
use crate::queries::npc_trade::locale_compare;
use crate::queries::region_map::{region_map_for, RegionMap};
use crate::queries::residents::is_armed;
use crate::queries::territory::{city_organization, Territory, TRADE_ORGANIZATION};
use crate::realm_pending::{realm_name, TRADE_ORG_NAME};

/// Where an admin loads the map they draw (`ADMIN_MAP_INFO_PATH`).
pub const ADMIN_MAP_INFO_PATH: &str = "/api/admin/map";
/// Where an admin loads every entity in a rectangle of tiles (`ADMIN_WORLD_PATH`).
pub const ADMIN_WORLD_PATH: &str = "/api/admin/world";
/// Where an admin loads the jump list's places (`ADMIN_PLACES_PATH`).
pub const ADMIN_PLACES_PATH: &str = "/api/admin/places";
/// Where an admin loads the territory of the whole map (`ADMIN_TERRITORY_PATH`).
pub const ADMIN_TERRITORY_PATH: &str = "/api/admin/territory";
/// Where an admin loads one thing for the inspector (`ADMIN_INSPECT_PATH`).
pub const ADMIN_INSPECT_PATH: &str = "/api/admin/inspect";
/// The widest and tallest rectangle `ADMIN_WORLD_PATH` gives every entity in
/// (`ADMIN_VIEW_MAX_SIDE`); cities only may span the whole map.
pub const ADMIN_VIEW_MAX_SIDE: i32 = 256;
/// What the inspector can show (`ADMIN_INSPECT_KINDS`).
pub const ADMIN_INSPECT_KINDS: [&str; 9] =
    ["resident", "city", "building", "horse", "carriage", "pile", "army", "caravan", "trader"];

/// Looks up what the world only knows by id (`AdminLookups`): a Player's account name, a
/// script's name.
pub trait AdminLookups {
    fn account_of(&self, user_id: u64) -> Option<String>;
    fn script_name(&self, script_id: u64) -> Option<String>;
}

/// The rectangle of tiles whose entities an admin loads (`AdminViewRequest`), wrapping around the
/// map's edges; with `cities_only`, just the cities whose town hall stands in it.
#[derive(Debug, Clone, PartialEq)]
pub struct AdminViewRequest {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub cities_only: bool,
}

/// The path of an admin world request (`adminWorldPath`).
pub fn admin_world_path(view: &AdminViewRequest) -> String {
    let cities = if view.cities_only { "&citiesOnly=1" } else { "" };
    format!("{ADMIN_WORLD_PATH}?x={}&y={}&w={}&h={}{cities}", view.x, view.y, view.w, view.h)
}

/// `Number(s)` for the query strings an admin sends: blank is 0, `0x`/`0o`/`0b` prefixes are read,
/// anything else not a number is NaN.
fn js_number(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    let radix = |p: &str, r: u32| {
        t.strip_prefix(p).map(|d| i64::from_str_radix(d, r).map_or(f64::NAN, |n| n as f64))
    };
    if let Some(n) = radix("0x", 16)
        .or_else(|| radix("0X", 16))
        .or_else(|| radix("0o", 8))
        .or_else(|| radix("0b", 2))
    {
        return n;
    }
    let plain = t.strip_prefix(['+', '-']).unwrap_or(t);
    if plain == "Infinity" {
        return if t.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    if !plain.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) {
        return f64::NAN;
    }
    t.parse().unwrap_or(f64::NAN)
}

/// Reads a rectangle from query parameters (`parseAdminView`), or says what is wrong with it.
pub fn parse_admin_view(
    query: &HashMap<String, String>,
    size: i32,
) -> Result<AdminViewRequest, String> {
    let n = |k: &str| query.get(k).map_or(f64::NAN, |v| js_number(v));
    let [x, y, w, h] = ["x", "y", "w", "h"].map(n);
    if ![x, y, w, h].iter().all(|v| v.is_finite() && v.fract() == 0.0) {
        return Err("x, y, w and h must be whole numbers.".into());
    }
    let cities_only = query.get("citiesOnly").map(String::as_str) == Some("1");
    let most = if cities_only { size } else { ADMIN_VIEW_MAX_SIDE };
    if w < 1.0 || h < 1.0 || w > f64::from(most) || h > f64::from(most) {
        return Err(format!("w and h must be from 1 to {most}."));
    }
    Ok(AdminViewRequest { x: x as i32, y: y as i32, w: w as i32, h: h as i32, cities_only })
}

/// Whether a tile lies in the rectangle, which wraps around the map's edges (`inView`).
fn in_view(view: &AdminViewRequest, size: i32, x: f64, y: f64) -> bool {
    wrap(x as i32 - view.x, size) < view.w && wrap(y as i32 - view.y, size) < view.h
}

/// A running script with its name and memory, its source left out (`adminScript`).
fn admin_script(script: &RunningScript, lookups: &dyn AdminLookups) -> Value {
    json!({ "scriptId": script.script_id, "name": lookups.script_name(script.script_id), "memory": script.memory })
}

/// An entity as a JSON object.
fn object(entity: &impl Serialize) -> Map<String, Value> {
    match serde_json::to_value(entity).expect("world data serialises") {
        Value::Object(m) => m,
        other => panic!("not an object: {other}"),
    }
}

/// `{ is, ...entity, ...more, org }` as the TypeScript spreads it: later keys overwrite in place.
fn tagged(is: &str, entity: Map<String, Value>, more: Vec<(&str, Value)>, org: Value) -> Value {
    let mut m = Map::new();
    m.insert("is".into(), Value::String(is.into()));
    m.extend(entity);
    for (k, v) in more {
        m.insert(k.into(), v);
    }
    m.insert("org".into(), org);
    Value::Object(m)
}

/// An entity with its `script` swapped for the admin's view of it (`{ script, ...rest }`).
fn without_source(
    entity: &impl Serialize,
    script: Option<&RunningScript>,
    lookups: &dyn AdminLookups,
) -> Map<String, Value> {
    let mut m = object(entity);
    m.shift_remove("script");
    if let Some(s) = script {
        m.insert("script".into(), admin_script(s, lookups));
    }
    m
}

/// The alliance a realm or city is in, as `{ id, name }`.
fn alliance_named(world: &WorldState, id: &str) -> Value {
    alliance_of(world, id).map_or(Value::Null, |a| json!({ "id": a.id, "name": a.name }))
}

/// An Organization by id as the admin map shows it (`adminOrganization`).
fn admin_organization(world: &WorldState, id: &str, lookups: &dyn AdminLookups) -> Value {
    let in_alliance = alliance_named(world, id);
    if id == TRADE_ORGANIZATION {
        return json!({ "id": id, "is": "tradeOrg", "name": TRADE_ORG_NAME, "alliance": null });
    }
    if let Some(realm) = world.realms.iter().find(|r| r.id == id) {
        let mut m = Map::new();
        m.insert("id".into(), json!(id));
        m.insert("is".into(), json!("realm"));
        m.insert("name".into(), json!(realm_name(world, id)));
        if let Some(account) = lookups.account_of(realm.user_id) {
            m.insert("account".into(), json!(account));
        }
        m.insert("alliance".into(), in_alliance);
        return Value::Object(m);
    }
    let name = world
        .cities
        .iter()
        .find(|c| c.id == id)
        .map_or("a lost city".to_string(), |c| c.name.clone());
    json!({ "id": id, "is": "city", "name": name, "alliance": in_alliance })
}

/// The Organization of the city `city_id` names, if it stands.
fn city_org_of(world: &WorldState, city_id: Option<&String>) -> Option<String> {
    let id = city_id?;
    world.cities.iter().find(|c| c.id == *id).map(|c| city_organization(c).to_string())
}

fn org_value(org: Option<String>) -> Value {
    org.map_or(Value::Null, Value::String)
}

/// Every entity in the rectangle, each with its Organization (`adminWorldView`): cities (where
/// their town hall stands, with their finished houses), residents, buildings, horses, carriages,
/// piles, armies with a member in it, caravans and wandering traders with their carriage or crew
/// in it. With `cities_only`, cities alone.
pub fn admin_world_view(
    world: &WorldState,
    size: i32,
    view: &AdminViewRequest,
    lookups: &dyn AdminLookups,
) -> Value {
    let here = |x: f64, y: f64| in_view(view, size, x, y);
    let mut houses: HashMap<&str, f64> = HashMap::new();
    for b in &world.buildings {
        if let (BuildingKind::House, None, Some(c)) = (b.kind, &b.site, b.city_id.as_deref()) {
            *houses.entry(c).or_insert(0.0) += 1.0;
        }
    }
    let mut out: Vec<Value> = Vec::new();
    let mut orgs: Vec<Option<String>> = Vec::new();
    let mut push =
        |is: &str, entity: Map<String, Value>, more: Vec<(&str, Value)>, org: Option<String>| {
            orgs.push(org.clone());
            out.push(tagged(is, entity, more, org_value(org)));
        };
    for c in &world.cities {
        let Some(hall) = town_hall_of(world, c) else { continue };
        if !here(hall.x, hall.y) {
            continue;
        }
        // What its scouts brought home is for the inspector, not for every map update.
        let mut shown = object(c);
        shown.shift_remove("scouted");
        let more = vec![
            ("x", json!(hall.x)),
            ("y", json!(hall.y)),
            ("houses", json!(houses.get(c.id.as_str()).copied().unwrap_or(0.0))),
        ];
        push("city", shown, more, Some(city_organization(c).to_string()));
    }
    if !view.cities_only {
        for r in world.residents.iter().filter(|r| here(r.x, r.y)) {
            let org = r.owner.clone().or_else(|| city_org_of(world, r.city_id.as_ref()));
            push("resident", without_source(r, r.script.as_ref(), lookups), Vec::new(), org);
        }
        for b in world.buildings.iter().filter(|b| here(b.x, b.y)) {
            push("building", object(b), Vec::new(), city_org_of(world, b.city_id.as_ref()));
        }
        for h in world.horses.iter().filter(|h| here(h.x, h.y)) {
            let org = h.realm_id.clone().or_else(|| city_org_of(world, h.city_id.as_ref()));
            push("horse", object(h), Vec::new(), org);
        }
        for k in world.carriages.iter().filter(|k| here(k.x, k.y)) {
            let org = k.realm_id.clone().or_else(|| city_org_of(world, k.city_id.as_ref()));
            push("carriage", object(k), Vec::new(), org);
        }
        for p in world.piles.iter().filter(|p| here(p.x, p.y)) {
            push("pile", object(p), Vec::new(), None);
        }
        let resident_here: HashSet<&str> =
            world.residents.iter().filter(|r| here(r.x, r.y)).map(|r| r.id.as_str()).collect();
        for a in &world.armies {
            if !a.member_ids.iter().any(|id| resident_here.contains(id.as_str())) {
                continue;
            }
            push(
                "army",
                without_source(a, a.script.as_ref(), lookups),
                Vec::new(),
                Some(a.realm_id.clone()),
            );
        }
        let carriage_here: HashSet<&str> =
            world.carriages.iter().filter(|k| here(k.x, k.y)).map(|k| k.id.as_str()).collect();
        let crew_here = |carriage_id: &str, driver: Option<&str>, escorts: &[String]| {
            carriage_here.contains(carriage_id)
                || crew_ids_of(driver, escorts).iter().any(|id| resident_here.contains(id.as_str()))
        };
        for c in &world.caravans {
            if crew_here(&c.carriage_id, c.driver_id.as_deref(), &c.escort_ids) {
                push("caravan", object(c), Vec::new(), Some(TRADE_ORGANIZATION.to_string()));
            }
        }
        for t in &world.traders {
            if crew_here(&t.carriage_id, t.driver_id.as_deref(), &t.escort_ids) {
                push("trader", object(t), Vec::new(), Some(TRADE_ORGANIZATION.to_string()));
            }
        }
    }
    let mut ids: Vec<String> =
        orgs.into_iter().flatten().collect::<HashSet<_>>().into_iter().collect();
    // `[...ids].sort()`: by UTF-16 code units, which for these ids is byte order.
    ids.sort();
    let orgs: Vec<Value> = ids.iter().map(|id| admin_organization(world, id, lookups)).collect();
    json!({ "tick": world.tick, "orgs": orgs, "entities": out })
}

/// What the admin map calls a wandering trader: by the stop it goes to next (`traderName`).
fn trader_name(world: &WorldState, t: &Trader) -> String {
    world
        .cities
        .iter()
        .find(|c| c.id == t.post_id)
        .map_or("a lost post".to_string(), |c| c.name.clone())
}

/// A spot on the jump list (`AdminPlace`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AdminPlace {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
}

fn by_name(a: &Value, b: &Value) -> std::cmp::Ordering {
    locale_compare(a["name"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or(""))
}

/// The jump list for the whole world (`adminPlaces`), each list by name.
pub fn admin_places(world: &WorldState, lookups: &dyn AdminLookups) -> Value {
    let residents: HashMap<&str, &csp_shared::world::Resident> =
        world.residents.iter().map(|r| (r.id.as_str(), r)).collect();
    let city_place = |c: &City| {
        town_hall_of(world, c).map(|h| json!({ "id": c.id, "name": c.name, "x": h.x, "y": h.y }))
    };
    let places_of = |cities: Vec<&City>| {
        let mut out: Vec<Value> = cities.into_iter().filter_map(city_place).collect();
        out.sort_by(by_name);
        out
    };
    let mut realms: Vec<Value> = world
        .realms
        .iter()
        .map(|realm| {
            let leader = residents.get(realm.leader_id.as_str());
            json!({
                "id": realm.id,
                "account": lookups.account_of(realm.user_id),
                "name": realm_name(world, &realm.id),
                "alliance": alliance_named(world, &realm.id),
                "leader": leader.map(|l| json!({ "id": l.id, "name": l.name, "x": l.x, "y": l.y })),
                "cities": places_of(world.cities.iter().filter(|c| c.realm_id.as_ref() == Some(&realm.id) && c.trade_org.is_none()).collect()),
            })
        })
        .collect();
    realms.sort_by(by_name);
    let mut npc_cities: Vec<Value> = world
        .cities
        .iter()
        .filter(|c| c.realm_id.is_none() && c.trade_org.is_none())
        .filter_map(|c| {
            let mut place = city_place(c)?;
            place["selfManaged"] = json!(c.former_player.is_some());
            place["alliance"] = alliance_named(world, &c.id);
            Some(place)
        })
        .collect();
    npc_cities.sort_by(by_name);
    use csp_shared::world::TradeOrgCity;
    let hq =
        world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq)).and_then(city_place);
    let posts = places_of(
        world.cities.iter().filter(|c| c.trade_org == Some(TradeOrgCity::Post)).collect(),
    );
    let carriages: HashMap<&str, (f64, f64)> =
        world.carriages.iter().map(|k| (k.id.as_str(), (k.x, k.y))).collect();
    let at = |carriage_id: &str, driver: Option<&String>| {
        carriages
            .get(carriage_id)
            .copied()
            .or_else(|| driver.and_then(|d| residents.get(d.as_str())).map(|r| (r.x, r.y)))
    };
    let mut caravans: Vec<Value> = world
        .caravans
        .iter()
        .filter_map(|c| {
            let (x, y) = at(&c.carriage_id, c.driver_id.as_ref())?;
            let name = world.cities.iter().find(|p| p.id == c.post_id).map_or("a lost post".to_string(), |p| p.name.clone());
            Some(json!({ "id": c.id, "name": name, "x": x, "y": y, "postId": c.post_id, "heading": c.heading }))
        })
        .collect();
    caravans.sort_by(by_name);
    let mut traders: Vec<Value> = world
        .traders
        .iter()
        .filter_map(|t| {
            let (x, y) = at(&t.carriage_id, t.driver_id.as_ref())?;
            Some(json!({ "id": t.id, "name": trader_name(world, t), "x": x, "y": y }))
        })
        .collect();
    traders.sort_by(by_name);
    let mut armies: Vec<Value> = world
        .armies
        .iter()
        .filter_map(|a| {
            let member = a.member_ids.iter().find_map(|id| residents.get(id.as_str()))?;
            let realm = realm_name(world, &a.realm_id);
            Some(json!({ "id": a.id, "name": a.name, "x": member.x, "y": member.y, "realmId": a.realm_id, "realm": realm }))
        })
        .collect();
    armies.sort_by(by_name);
    json!({
        "tick": world.tick,
        "realms": realms,
        "npcCities": npc_cities,
        "tradeOrg": { "hq": hq, "posts": posts, "caravans": caravans, "traders": traders },
        "armies": armies,
    })
}

/// The whole map's territory (`adminTerritory`): the Region map without the explored filter.
pub fn admin_territory(world: &WorldState, territory: &Territory, size: i32) -> RegionMap {
    region_map_for(world, territory, size, &|_, _| true, None)
}

/// One thing in the world as the admin map's inspector shows it (`adminInspection`), or None when
/// there is no such thing (any more). `kind` is one of `ADMIN_INSPECT_KINDS`.
pub fn admin_inspection(
    world: &WorldState,
    kind: &str,
    id: &str,
    lookups: &dyn AdminLookups,
) -> Option<Value> {
    let org = |o: Option<String>| o.map_or(Value::Null, |o| admin_organization(world, &o, lookups));
    let city_by_id =
        |cid: Option<&String>| cid.and_then(|cid| world.cities.iter().find(|c| c.id == *cid));
    let named = |x: Option<(&String, &String)>| {
        x.map_or(Value::Null, |(id, name)| json!({ "id": id, "name": name }))
    };
    let resident_named = |rid: &str| {
        world.residents.iter().find(|r| r.id == rid).map(|r| json!({ "id": r.id, "name": r.name }))
    };
    let post_name = |c: &Caravan| {
        world
            .cities
            .iter()
            .find(|p| p.id == c.post_id)
            .map_or("a lost post".to_string(), |p| p.name.clone())
    };
    let caravan_named = |c: Option<&Caravan>| {
        c.map_or(Value::Null, |c| json!({ "id": c.id, "name": post_name(c) }))
    };
    let tick = world.tick;
    let base = |o: Value, is: &str| {
        let mut m = Map::new();
        m.insert("tick".into(), json!(tick));
        m.insert("org".into(), o);
        m.insert("is".into(), json!(is));
        m
    };
    let m = match kind {
        "resident" => {
            let r = world.residents.iter().find(|x| x.id == id)?;
            let army = world.armies.iter().find(|a| a.member_ids.iter().any(|m| m == id));
            let caravan = world.caravans.iter().find(|c| {
                c.driver_id.as_deref() == Some(id) || c.escort_ids.iter().any(|e| e == id)
            });
            let trader = world.traders.iter().find(|t| {
                t.driver_id.as_deref() == Some(id) || t.escort_ids.iter().any(|e| e == id)
            });
            let mut m = base(
                org(r.owner.clone().or_else(|| city_org_of(world, r.city_id.as_ref()))),
                "resident",
            );
            m.insert(
                "resident".into(),
                Value::Object(without_source(r, r.script.as_ref(), lookups)),
            );
            m.insert(
                "city".into(),
                named(city_by_id(r.city_id.as_ref()).map(|c| (&c.id, &c.name))),
            );
            m.insert("army".into(), named(army.map(|a| (&a.id, &a.name))));
            m.insert("caravan".into(), caravan_named(caravan));
            if let Some(t) = trader {
                m.insert("trader".into(), json!({ "id": t.id, "name": trader_name(world, t) }));
            }
            m.insert(
                "leader".into(),
                json!(world.realms.iter().any(|realm| realm.leader_id == id)),
            );
            m
        }
        "city" => {
            let c = world.cities.iter().find(|c| c.id == id)?;
            let hall = town_hall_of(world, c)?;
            let residents: Vec<_> =
                world.residents.iter().filter(|r| r.city_id.as_deref() == Some(id)).collect();
            let finished: Vec<_> = world
                .buildings
                .iter()
                .filter(|b| b.city_id.as_deref() == Some(id) && b.site.is_none())
                .collect();
            let mut counts: Vec<(&str, f64)> = Vec::new();
            for b in &finished {
                let k = kind_name(b.kind);
                match counts.iter_mut().find(|(x, _)| *x == k) {
                    Some((_, n)) => *n += 1.0,
                    None => counts.push((k, 1.0)),
                }
            }
            counts.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| locale_compare(a.0, b.0)));
            let mut storage = Stock::new();
            for b in finished.iter().filter(|b| b.kind == BuildingKind::Storage) {
                for g in ALL_GOODS {
                    let n = b.stock.as_ref().map_or(0.0, |s| held(s, g));
                    if n > 0.0 {
                        let total = held(&storage, g) + n;
                        storage.insert(g, total);
                    }
                }
            }
            let gates: Vec<_> = finished.iter().filter(|b| b.kind == BuildingKind::Gate).collect();
            let shut = gates.iter().filter(|g| g.closed == Some(true)).count();
            let mut city = object(c);
            city.insert("x".into(), json!(hall.x));
            city.insert("y".into(), json!(hall.y));
            let mut m = base(org(Some(city_organization(c).to_string())), "city");
            m.insert("city".into(), Value::Object(city));
            m.insert(
                "residents".into(),
                json!(residents
                    .iter()
                    .map(|r| json!({ "id": r.id, "name": r.name }))
                    .collect::<Vec<_>>()),
            );
            m.insert(
                "buildings".into(),
                json!(counts.iter().map(|(k, n)| json!([k, n])).collect::<Vec<_>>()),
            );
            m.insert("storage".into(), json!(storage));
            m.insert("gates".into(), json!({ "open": gates.len() - shut, "shut": shut }));
            m.insert(
                "soldiers".into(),
                json!(residents.iter().filter(|r| is_armed(&r.carried)).count()),
            );
            m
        }
        "building" => {
            let b = world.buildings.iter().find(|x| x.id == id)?;
            let mut m = base(org(city_org_of(world, b.city_id.as_ref())), "building");
            m.insert("building".into(), json!(b));
            m.insert(
                "city".into(),
                named(city_by_id(b.city_id.as_ref()).map(|c| (&c.id, &c.name))),
            );
            m
        }
        "horse" => {
            let h = world.horses.iter().find(|x| x.id == id)?;
            let mut m = base(
                org(h.realm_id.clone().or_else(|| city_org_of(world, h.city_id.as_ref()))),
                "horse",
            );
            m.insert("horse".into(), json!(h));
            m
        }
        "carriage" => {
            let k = world.carriages.iter().find(|x| x.id == id)?;
            let caravan = world.caravans.iter().find(|c| c.carriage_id == id);
            let trader = world.traders.iter().find(|t| t.carriage_id == id);
            let crewed_driver = caravan.map(|c| &c.driver_id).or(trader.map(|t| &t.driver_id));
            let driver = world
                .residents
                .iter()
                .find(|r| crate::queries::carriages::driven_carriage_id(r) == Some(id))
                .map(|r| json!({ "id": r.id, "name": r.name }))
                .or_else(|| crewed_driver.and_then(|d| d.as_deref()).and_then(resident_named))
                .unwrap_or(Value::Null);
            let crewed = caravan.is_some() || trader.is_some();
            let o = if crewed {
                Some(TRADE_ORGANIZATION.to_string())
            } else {
                k.realm_id.clone().or_else(|| city_org_of(world, k.city_id.as_ref()))
            };
            let mut m = base(org(o), "carriage");
            m.insert("carriage".into(), json!(k));
            m.insert("driver".into(), driver);
            m.insert("caravan".into(), caravan_named(caravan));
            if let Some(t) = trader {
                m.insert("trader".into(), json!({ "id": t.id, "name": trader_name(world, t) }));
            }
            m
        }
        "pile" => {
            let p = world.piles.iter().find(|x| x.id == id)?;
            let mut m = base(Value::Null, "pile");
            m.insert("pile".into(), json!(p));
            m
        }
        "army" => {
            let a = world.armies.iter().find(|x| x.id == id)?;
            let members: Vec<Value> = a
                .member_ids
                .iter()
                .filter_map(|mid| world.residents.iter().find(|r| r.id == *mid))
                .map(|r| json!({ "id": r.id, "name": r.name, "x": r.x, "y": r.y }))
                .collect();
            let mut m = base(org(Some(a.realm_id.clone())), "army");
            m.insert("army".into(), Value::Object(without_source(a, a.script.as_ref(), lookups)));
            m.insert("members".into(), json!(members));
            m
        }
        "caravan" => {
            let c = world.caravans.iter().find(|x| x.id == id)?;
            let mut m = base(org(Some(TRADE_ORGANIZATION.to_string())), "caravan");
            m.insert("caravan".into(), json!(c));
            m.insert("post".into(), named(city_by_id(Some(&c.post_id)).map(|p| (&p.id, &p.name))));
            m.insert(
                "carriage".into(),
                json!(world.carriages.iter().find(|k| k.id == c.carriage_id)),
            );
            let crew: Vec<Value> = crew_ids_of(c.driver_id.as_deref(), &c.escort_ids)
                .iter()
                .filter_map(|m| resident_named(m))
                .collect();
            m.insert("crew".into(), json!(crew));
            m
        }
        "trader" => {
            let t = world.traders.iter().find(|x| x.id == id)?;
            let mut m = base(org(Some(TRADE_ORGANIZATION.to_string())), "trader");
            m.insert("trader".into(), json!(t));
            m.insert("post".into(), named(city_by_id(Some(&t.post_id)).map(|p| (&p.id, &p.name))));
            let loop_: Vec<Value> = t
                .r#loop
                .iter()
                .filter_map(|p| city_by_id(Some(p)))
                .map(|p| json!({ "id": p.id, "name": p.name }))
                .collect();
            m.insert("loop".into(), json!(loop_));
            m.insert(
                "carriage".into(),
                json!(world.carriages.iter().find(|k| k.id == t.carriage_id)),
            );
            let crew: Vec<Value> = crew_ids_of(t.driver_id.as_deref(), &t.escort_ids)
                .iter()
                .filter_map(|m| resident_named(m))
                .collect();
            m.insert("crew".into(), json!(crew));
            m
        }
        _ => return None,
    };
    Some(Value::Object(m))
}

#[cfg(test)]
mod tests;
