//! Stand-ins for helpers other Epic 86 tickets own, which movement (T86.4) needs before they
//! land. Each is a port of its TypeScript (or the part movement needs), marked `TODO(T86.x)` with
//! the ticket that owns it; whichever merges second swaps these for the real ones and deletes
//! this file's entry.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{REALM_LOG_LENGTH, WALL_ENCLOSES_MAX};
use csp_shared::terrain::{
    is_passable_terrain, tile_index, wrap, wrap_delta, wrap_distance, TerrainMap,
};
use csp_shared::world::{
    Building, BuildingKind, GoodsPlace, HaulStop, OrderEnded, OrderEndedKind, OrderRequest,
    RealmEvent, RealmEventWhat, Resident, ResidentOrder, WorldState,
};

use crate::queries::alliance::{allied_realms, commander_of, contract_of};
use crate::queries::city::npc_city_refuses;
use crate::queries::standing::TRADE_ORG;
use crate::walls::{neighbours, WallKind, WallMap, WallTile};

// ---- T86.2 (`orders.ts`, `order-sender.ts`) ------------------------------------------------------

/// Who sent an order (`OrderSender`): a Player's account, or an NPC city's game default.
// TODO(T86.2): the real `OrderSender` once orders land.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct OrderSender {
    pub user_id: u64,
    pub npc_city_id: Option<String>,
}

/// An order kind (`OrderKind`): checks an order when it comes, and applies it at the start of the
/// next tick.
// TODO(T86.2): the real `OrderKind` and its registry.
pub trait OrderKind {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String>;
    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    );
}

/// A string field of an order, if it is one.
pub fn str_field<'o>(order: &'o OrderRequest, name: &str) -> Option<&'o str> {
    order.fields.get(name).and_then(|v| v.as_str())
}

/// A whole-number field of an order (`Number.isInteger`), if it is one.
pub fn int_field(order: &OrderRequest, name: &str) -> Option<f64> {
    let v = order.fields.get(name)?.as_f64()?;
    (v.is_finite() && v.fract() == 0.0).then_some(v)
}

/// A boolean field of an order, if it is one.
pub fn bool_field(order: &OrderRequest, name: &str) -> Option<bool> {
    order.fields.get(name).and_then(|v| v.as_bool())
}

/// The resident `resident_id` if the sender may order them (`orderedResident`).
// TODO(T86.2): `order_sender::ordered_resident`.
pub fn ordered_resident<'w>(
    world: &'w WorldState,
    sender: &OrderSender,
    resident_id: Option<&str>,
) -> Option<&'w Resident> {
    let r = world.residents.iter().find(|x| Some(x.id.as_str()) == resident_id);
    if let Some(city) = sender.npc_city_id.as_deref() {
        let r = r?;
        let runs = r.owner.is_none()
            && r.city_id.as_deref() == Some(city)
            && contract_of(world, &r.id).is_none();
        return runs.then_some(r);
    }
    let realm = realm_of(world, sender.user_id)?;
    commands(world, &realm.id, r).then_some(r?)
}

/// The Player's realm (`realmOf`).
// TODO(T86.8): `starting_city::realm_of`.
pub fn realm_of(world: &WorldState, user_id: u64) -> Option<&csp_shared::world::Realm> {
    world.realms.iter().find(|r| r.user_id == user_id)
}

/// Whether the realm's Player may give the resident orders (`commands`).
// TODO(T86.5/T86.7): `queries::alliance::commands`.
pub fn commands(world: &WorldState, realm_id: &str, r: Option<&Resident>) -> bool {
    r.is_some_and(|r| commander_of(world, &r.id, r.owner.as_deref()).as_deref() == Some(realm_id))
}

// ---- T86.13 (`events.ts`) ------------------------------------------------------------------------

/// Notes an event in the realm's log (`recordEvent`), keeping the newest `REALM_LOG_LENGTH`.
// TODO(T86.13): `events::record_event`.
pub fn record_event(world: &mut WorldState, realm_id: Option<&str>, what: RealmEventWhat) {
    let Some(user_id) =
        realm_id.and_then(|id| world.realms.iter().find(|r| r.id == id)).map(|r| r.user_id)
    else {
        return;
    };
    let seq = world.next_id;
    world.next_id += 1;
    world.events.push(RealmEvent { seq, tick: world.tick, user_id, what });
    let mine = world.events.iter().filter(|e| e.user_id == user_id).count();
    let keep = REALM_LOG_LENGTH as usize;
    if mine > keep {
        let mut drop = mine - keep;
        world.events.retain(|e| {
            if drop > 0 && e.user_id == user_id {
                drop -= 1;
                return false;
            }
            true
        });
    }
}

// ---- T86.6 (`walls.ts`, `building.ts`) -------------------------------------------------------------

/// Whose side a resident is on at walls and gates (`wallSide`).
// TODO(T86.6/T86.7): `queries::walls::wall_side`.
pub fn wall_side(r: &Resident) -> Option<&str> {
    r.owner.as_deref().or(r.city_id.as_deref())
}

/// Whether a building is a finished wall or gate (`isWallOrGate`).
// TODO(T86.6/T86.7): `queries::walls::is_wall_or_gate`.
pub fn is_wall_or_gate(b: &Building) -> bool {
    matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate) && b.site.is_none()
}

/// Whether a building is a closed gate (`isClosed`).
fn is_closed(b: &Building) -> bool {
    b.kind == BuildingKind::Gate && b.closed == Some(true)
}

/// The sides each NPC city keeps its gates shut to (`shutOut`), sorted, in the standings' order.
fn shut_out(world: &WorldState) -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for s in &world.standings {
        let Some(city) = world.cities.iter().find(|c| c.id == s.of) else { continue };
        if !npc_city_refuses(world, city, &s.toward) {
            continue;
        }
        let sides: Vec<String> = if s.toward == TRADE_ORG {
            world.cities.iter().filter(|c| c.trade_org.is_some()).map(|c| c.id.clone()).collect()
        } else {
            vec![s.toward.clone()]
        };
        match out.iter_mut().find(|(id, _)| *id == city.id) {
            Some((_, v)) => {
                v.extend(sides);
                v.sort();
            }
            None => {
                let mut v = sides;
                v.sort();
                out.push((city.id.clone(), v));
            }
        }
    }
    out
}

/// What the wall map is built from, as a key that changes when it does (`wallsKey`).
// TODO(T86.6): `walls::walls_key`.
pub fn walls_key(world: &WorldState) -> String {
    let mut parts: Vec<String> = Vec::new();
    for b in &world.buildings {
        if !is_wall_or_gate(b) {
            continue;
        }
        let city = b.city_id.as_deref().unwrap_or("");
        let closed = if is_closed(b) { "!" } else { "" };
        parts.push(format!("{}@{},{}:{city}{closed}", b.id, b.x, b.y));
    }
    for c in &world.cities {
        parts.push(format!("{}={}", c.id, c.realm_id.as_deref().unwrap_or("")));
    }
    for a in &world.alliances {
        let members: Vec<&str> = a.members.iter().map(|m| m.realm_id.as_str()).collect();
        parts.push(format!("{}+{}", a.id, members.join(",")));
    }
    for (city, sides) in shut_out(world) {
        parts.push(format!("{city}-{}", sides.join(",")));
    }
    parts.join(";")
}

/// The finished walls and gates on the map and the tiles they enclose (`wallMap`). The fills run
/// in the TypeScript `Map`'s order: the walls' first appearance in `world.buildings`.
// TODO(T86.6): `walls::wall_map`.
pub fn wall_map(world: &WorldState, terrain: &TerrainMap) -> WallMap {
    let size = terrain.size;
    let shut = shut_out(world);
    let mut sides: HashMap<String, Vec<String>> = HashMap::new();
    let mut tiles: HashMap<usize, WallTile> = HashMap::new();
    let mut order: Vec<usize> = Vec::new();
    for b in &world.buildings {
        if !is_wall_or_gate(b) {
            continue;
        }
        let city = b.city_id.as_deref().and_then(|id| world.cities.iter().find(|c| c.id == id));
        let realm_id = city.and_then(|c| c.realm_id.clone());
        let side_of = realm_id.clone().or_else(|| b.city_id.clone());
        let realms = match side_of {
            None => Vec::new(),
            Some(s) => sides.entry(s.clone()).or_insert_with(|| allied_realms(world, &s)).clone(),
        };
        let shut_to = match (b.kind, b.city_id.as_deref()) {
            (BuildingKind::Gate, Some(c)) => {
                shut.iter().find(|(id, _)| id == c).map(|(_, v)| v.clone()).unwrap_or_default()
            }
            _ => Vec::new(),
        };
        let kind = if b.kind == BuildingKind::Wall { WallKind::Wall } else { WallKind::Gate };
        let t = tile_index(size, b.x as i32, b.y as i32);
        if !tiles.contains_key(&t) {
            order.push(t);
        }
        tiles.insert(t, WallTile { kind, realm_id, realms, closed: is_closed(b), shut_to });
    }
    let mut inside: HashSet<usize> = HashSet::new();
    let mut outside: HashSet<usize> = HashSet::new();
    let passable = |t: usize| is_passable_terrain(terrain.tiles[t]);
    for &w in &order {
        for start in neighbours(size, w) {
            if tiles.contains_key(&start)
                || !passable(start)
                || inside.contains(&start)
                || outside.contains(&start)
            {
                continue;
            }
            let mut seen: Vec<usize> = vec![start];
            let mut seen_set: HashSet<usize> = HashSet::from([start]);
            let mut todo = vec![start];
            let mut out = false;
            while !out {
                let Some(t) = todo.pop() else { break };
                for n in neighbours(size, t) {
                    if seen_set.contains(&n) || tiles.contains_key(&n) || !passable(n) {
                        continue;
                    }
                    if outside.contains(&n) || seen_set.len() as f64 >= WALL_ENCLOSES_MAX {
                        out = true;
                        break;
                    }
                    seen_set.insert(n);
                    seen.push(n);
                    todo.push(n);
                }
            }
            let into = if out { &mut outside } else { &mut inside };
            into.extend(seen);
        }
    }
    WallMap { size, tiles, inside }
}

/// The finished wall or gate `wall_id` a resident of `realm_id` may climb (`foreignWall`).
// TODO(T86.6/T86.7): `queries::walls::foreign_wall`.
pub fn foreign_wall<'w>(
    world: &'w WorldState,
    realm_id: Option<&str>,
    wall_id: Option<&str>,
) -> Result<&'w Building, &'static str> {
    let b = world
        .buildings
        .iter()
        .find(|x| Some(x.id.as_str()) == wall_id)
        .filter(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate))
        .ok_or("no such wall or gate")?;
    if b.site.is_some() {
        return Err("that wall is not finished yet");
    }
    let city = world.cities.iter().find(|c| Some(&c.id) == b.city_id.as_ref());
    if let Some(own) = city.and_then(|c| c.realm_id.as_deref()) {
        if Some(own) == realm_id {
            return Err("that is one of your own walls");
        }
    }
    Ok(b)
}

/// Where a climber from `from` comes down over `wall` (`climbLanding`): straight across, or back
/// onto the wall's tile when that side is walled or impassable.
// TODO(T86.6): `walls::climb_landing`.
pub fn climb_landing(
    world: &WorldState,
    terrain: &TerrainMap,
    from: (f64, f64),
    wall: (f64, f64),
) -> (f64, f64) {
    let size = terrain.size;
    let (fx, fy, wx, wy) = (from.0 as i32, from.1 as i32, wall.0 as i32, wall.1 as i32);
    let x = wrap(wx + wrap_delta(fx, wx, size), size);
    let y = wrap(wy + wrap_delta(fy, wy, size), size);
    let t = tile_index(size, x, y);
    let walled =
        world.buildings.iter().any(|b| b.x as i32 == x && b.y as i32 == y && is_wall_or_gate(b));
    if walled || !is_passable_terrain(terrain.tiles[t]) {
        return wall;
    }
    (x as f64, y as f64)
}

// ---- T86.7 (`army.ts`, `combat.ts`, `armies.ts`, `stealing.ts`) --------------------------------

/// Whether two spots are in contact (`inContact`): the same tile or one of the eight around it.
// TODO(T86.7): `queries::combat::in_contact`.
pub fn in_contact(size: i32, a: (f64, f64), b: (f64, f64)) -> bool {
    wrap_delta(a.0 as i32, b.0 as i32, size).abs() <= 1
        && wrap_delta(a.1 as i32, b.1 as i32, size).abs() <= 1
}

/// The army a driver's carriage goes after now (`armyDrivenTo`).
// TODO(T86.7): `queries::army::army_driven_to`.
pub fn army_driven_to(driver: &Resident) -> Option<&str> {
    match &driver.order {
        Some(ResidentOrder::Drive(o)) => o.army.as_deref(),
        Some(ResidentOrder::Haul(o)) if o.stop == HaulStop::To => o.to_army.as_deref(),
        _ => None,
    }
}

/// Where an army is for a carriage at `from` that goes after it (`armySpot`): the tile of its
/// member nearest `from`.
// TODO(T86.7): `queries::army::army_spot`.
pub fn army_spot(
    world: &WorldState,
    army_id: &str,
    from: (f64, f64),
    size: i32,
) -> Option<(f64, f64)> {
    let members: Vec<&str> = match world.armies.iter().find(|a| a.id == army_id) {
        Some(a) => a.member_ids.iter().map(String::as_str).collect(),
        None => world
            .punishments
            .iter()
            .find(|p| p.id == army_id)?
            .members
            .iter()
            .map(|m| m.resident_id.as_str())
            .collect(),
    };
    let mut best: Option<((f64, f64), f64)> = None;
    for r in &world.residents {
        if !members.contains(&r.id.as_str()) {
            continue;
        }
        let d = wrap_distance(size, (from.0 as i32, from.1 as i32), (r.x as i32, r.y as i32));
        if best.is_none_or(|(_, bd)| d < bd) {
            best = Some(((r.x, r.y), d));
        }
    }
    best.map(|b| b.0)
}

/// Where an attack order's target stands (`attackTarget`): a resident, or a finished wall or gate.
// TODO(T86.7): `combat::attack_target`.
pub fn attack_target(world: &WorldState, target_id: &str) -> Option<(f64, f64)> {
    if let Some(r) = world.residents.iter().find(|x| x.id == target_id) {
        return Some((r.x, r.y));
    }
    let b = world.buildings.iter().find(|x| x.id == target_id)?;
    is_wall_or_gate(b).then_some((b.x, b.y))
}

/// The residents keeping together with their army this tick (`waitingForArmy`).
// TODO(T86.7): `armies::waiting_for_army`. Nobody waits until armies land.
pub fn waiting_for_army(_world: &WorldState, _holding: &HashSet<String>) -> HashSet<String> {
    HashSet::new()
}

/// What stealing takes over (`Taken`).
pub struct Taken {
    pub carriage: Option<usize>,
    pub horse: Option<usize>,
}

/// The realm `realm_id` takes over a carriage or horse (`takeOver`): it becomes the realm's and
/// leaves any alliance army.
// TODO(T86.7): `stealing::take_over` (the crime, its events and the caravan, trader and supply
// wagon follow-ups are T86.7's and T86.9's).
pub fn take_over(world: &mut WorldState, _thief: &str, realm_id: &str, taken: Taken, _size: i32) {
    let mut ids = Vec::new();
    if let Some(i) = taken.carriage {
        let k = &mut world.carriages[i];
        k.realm_id = Some(realm_id.to_string());
        k.city_id = None;
        ids.push(k.id.clone());
    }
    if let Some(i) = taken.horse {
        let h = &mut world.horses[i];
        h.realm_id = Some(realm_id.to_string());
        h.city_id = None;
        ids.push(h.id.clone());
    }
    for a in &mut world.alliances {
        a.army.retain(|p| !ids.contains(&p.id));
    }
}

// ---- T86.9 (`caravans.ts`, `trade-org-punishment.ts`) -------------------------------------------

/// Caravan crews waiting for their escort (`waitingForEscort`).
// TODO(T86.9): `caravans::waiting_for_escort`. Nobody waits until caravans land.
pub fn waiting_for_escort(_world: &WorldState, _size: i32) -> HashSet<String> {
    HashSet::new()
}

/// The Trade Org's soldiers waiting on the road (`waitingOnTheRoad`).
// TODO(T86.9): `trade_org_punishment::waiting_on_the_road`. Nobody waits until it lands.
pub fn waiting_on_the_road(_world: &WorldState, _size: i32) -> HashSet<String> {
    HashSet::new()
}

// ---- T86.5 (`storing.ts`) --------------------------------------------------------------------------

/// The tile of a store or fetch order's place (`placeTile`): its carriage, or its finished storage.
// TODO(T86.5): `storing::place_tile`.
pub fn place_tile(world: &WorldState, place: &GoodsPlace) -> Option<(f64, f64)> {
    match place {
        GoodsPlace::Carriage { carriage_id } => {
            world.carriages.iter().find(|k| k.id == *carriage_id).map(|k| (k.x, k.y))
        }
        GoodsPlace::Storage { storage_id } => world
            .buildings
            .iter()
            .find(|b| b.id == *storage_id && b.site.is_none())
            .map(|b| (b.x, b.y)),
    }
}

/// Ends a resident's order, noting why for a store or fetch order (`endOrder`).
// TODO(T86.5): `storing::end_order`.
pub fn end_order(world: &mut WorldState, i: usize, reason: Option<&str>) {
    let tick = world.tick as f64;
    let r = &mut world.residents[i];
    let kind = match r.order {
        Some(ResidentOrder::Store(_)) => Some(OrderEndedKind::Store),
        Some(ResidentOrder::Fetch(_)) => Some(OrderEndedKind::Fetch),
        _ => None,
    };
    if let Some(kind) = kind {
        r.order_ended = Some(OrderEnded { kind, tick, reason: reason.map(str::to_string) });
    }
    r.order = None;
}
