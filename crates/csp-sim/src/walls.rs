//! Walls and gates as the path searches see them (`CONTEXT.md`: Walls in combat): the `WallMap`
//! and its step rules, ported from `packages/shared/src/walls.ts` (`WallTile`, `WallMap`,
//! `strandedOnWall`, `mayStep`), and with the rules (T86.6) the rest of it: building the `WallMap`
//! from the world (`wallMap`, `wallsKey`) and the world queries about walls and gates.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{BROKEN_MATERIALS_RETURNED, WALL_ENCLOSES_MAX, WALL_STRENGTH};
use csp_shared::terrain::{is_passable_terrain, tile_index, wrap, wrap_delta, TerrainMap};
use csp_shared::world::{Building, BuildingKind, Resident, Stock, WorldState};
use serde::Deserialize;

use crate::queries::alliance::allied_realms;
use crate::queries::building::build_materials;
use crate::queries::city::npc_city_refuses;
use crate::queries::standing::TRADE_ORG;

/// Whether a wall tile is a wall or a gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WallKind {
    Wall,
    Gate,
}

/// A finished wall or gate on a tile, and whose it is.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallTile {
    pub kind: WallKind,
    /// The realm of the wall's city; `None` for nobody's.
    pub realm_id: Option<String>,
    /// The sides (`wallSide`) that may stand on it and pass its gate while closed: its city's
    /// realm and that realm's allies, or for an NPC city the city itself and its allies. Empty
    /// for nobody's.
    pub realms: Vec<String>,
    /// A gate that is closed.
    pub closed: bool,
    /// The sides an NPC city keeps its gate shut to even while open (`npcCityRefuses`). Empty for
    /// a wall.
    pub shut_to: Vec<String>,
}

impl WallTile {
    /// A wall of nobody's.
    pub fn wall() -> WallTile {
        WallTile {
            kind: WallKind::Wall,
            realm_id: None,
            realms: Vec::new(),
            closed: false,
            shut_to: Vec::new(),
        }
    }

    /// A gate of nobody's, closed or open.
    pub fn gate(closed: bool) -> WallTile {
        WallTile { kind: WallKind::Gate, closed, ..WallTile::wall() }
    }

    fn of_side(&self, realm_id: Option<&str>) -> bool {
        realm_id.is_some_and(|r| self.realms.iter().any(|s| s == r))
    }
}

/// The finished walls and gates on the map, by tile index, and the tiles they enclose. Nothing
/// that uses it depends on the order of `tiles` or `inside`: only on what they hold.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WallMap {
    pub size: i32,
    pub tiles: HashMap<usize, WallTile>,
    /// Tiles shut in by walls and gates (and impassable land): a wall ring's inside.
    pub inside: HashSet<usize>,
}

/// The four tiles next to tile index `t`, across the map's joins too, in `walls.ts`' order.
pub(crate) fn neighbours(size: i32, t: usize) -> [usize; 4] {
    let t = t as i32;
    let x = t % size;
    let y = (t - x) / size;
    [
        (y * size + wrap(x + 1, size)) as usize,
        (y * size + wrap(x - 1, size)) as usize,
        (wrap(y + 1, size) * size + x) as usize,
        (wrap(y - 1, size) * size + x) as usize,
    ]
}

/// Whether a realm may stand on the wall on tile index `t`: its own city's, or an ally's.
fn own_wall(walls: &WallMap, realm_id: Option<&str>, t: usize) -> bool {
    walls.tiles.get(&t).is_some_and(|w| w.kind == WallKind::Wall && w.of_side(realm_id))
}

/// Whether tile index `t` is a wall or gate of the realm's own cities or its allies'.
fn own_wall_or_gate(walls: &WallMap, realm_id: Option<&str>, t: usize) -> bool {
    walls.tiles.get(&t).is_some_and(|w| w.of_side(realm_id))
}

fn is_wall(walls: &WallMap, t: usize) -> bool {
    walls.tiles.get(&t).is_some_and(|w| w.kind == WallKind::Wall)
}

/// Whether someone of `realm_id` on tile index `t` is stuck on a wall: a wall they may not stand
/// on (a foreign wall finished under them), or a stretch of their own wall with no gate and no way
/// down inside. Such a one may climb down anywhere next to it.
pub fn stranded_on_wall(walls: &WallMap, realm_id: Option<&str>, t: usize) -> bool {
    if !is_wall(walls, t) {
        return false;
    }
    if !own_wall(walls, realm_id, t) {
        return true;
    }
    let mut seen = HashSet::from([t]);
    let mut todo = vec![t];
    while let Some(c) = todo.pop() {
        if walls.tiles[&c].kind == WallKind::Gate {
            return false;
        }
        for n in neighbours(walls.size, c) {
            if walls.inside.contains(&n) {
                return false;
            }
            if !seen.contains(&n) && own_wall_or_gate(walls, realm_id, n) {
                seen.insert(n);
                todo.push(n);
            }
        }
    }
    true
}

/// Whether someone of `realm_id` may step from tile index `from` to the next tile `to`
/// (`CONTEXT.md`: Walls in combat), walls and gates aside from the land itself. Nobody walks
/// through a wall: only the city's own realm and its allies go onto its walls, from inside or from
/// the wall itself, and down only inside, and only `on_walls` (on foot, not driving). A gate lets
/// them through always, everyone else only while open, and an NPC city's gate never those it
/// refuses (`WallTile::shut_to`). `stranded` (`stranded_on_wall`) frees the way down from a wall.
pub fn may_step(
    walls: &WallMap,
    realm_id: Option<&str>,
    from: usize,
    to: usize,
    on_walls: bool,
    stranded: bool,
) -> bool {
    let w = walls.tiles.get(&to);
    if let Some(w) = w {
        match w.kind {
            WallKind::Gate => {
                if !own_wall_or_gate(walls, realm_id, to)
                    && (w.closed || realm_id.is_some_and(|r| w.shut_to.iter().any(|s| s == r)))
                {
                    return false;
                }
            }
            WallKind::Wall => {
                if !on_walls || !own_wall(walls, realm_id, to) {
                    return false;
                }
                return walls.inside.contains(&from) || own_wall_or_gate(walls, realm_id, from);
            }
        }
    }
    if is_wall(walls, from) && !stranded {
        return walls.inside.contains(&to) || own_wall_or_gate(walls, realm_id, to);
    }
    true
}

// The rest of `packages/shared/src/walls.ts` (T86.6): building the `WallMap` from the world, and
// the world queries about walls and gates.

/// Whose side a resident is on at walls and gates (`wallSide`): their realm, or their NPC city.
pub fn wall_side(r: &Resident) -> Option<&str> {
    r.owner.as_deref().or(r.city_id.as_deref())
}

/// Whether a building is a finished wall or gate (`isWallOrGate`).
pub fn is_wall_or_gate(b: &Building) -> bool {
    matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate) && b.site.is_none()
}

/// Whether a gate is closed (`isClosed`); a gate is open until its city's realm closes it.
pub fn is_closed(b: &Building) -> bool {
    b.kind == BuildingKind::Gate && b.closed == Some(true)
}

/// The sides each NPC city refuses, by city id, in the order of the standings (`shutOut`).
pub fn shut_out(world: &WorldState) -> Vec<(String, Vec<String>)> {
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
            Some((_, have)) => {
                have.extend(sides);
                have.sort();
            }
            None => {
                let mut sides = sides;
                sides.sort();
                out.push((city.id.clone(), sides));
            }
        }
    }
    out
}

/// A key that changes whenever what a `WallMap` is built from changes (`wallsKey`).
pub fn walls_key(world: &WorldState) -> String {
    let mut parts: Vec<String> = Vec::new();
    for b in world.buildings.iter().filter(|b| is_wall_or_gate(b)) {
        let closed = if is_closed(b) { "!" } else { "" };
        parts.push(format!(
            "{}@{},{}:{}{closed}",
            b.id,
            b.x,
            b.y,
            b.city_id.as_deref().unwrap_or("")
        ));
    }
    for c in &world.cities {
        parts.push(format!("{}={}", c.id, c.realm_id.as_deref().unwrap_or("")));
    }
    for a in &world.alliances {
        let members: Vec<&str> = a.members.iter().map(|m| m.realm_id.as_str()).collect();
        parts.push(format!("{}+{}", a.id, members.join(",")));
    }
    for (city_id, sides) in shut_out(world) {
        parts.push(format!("{city_id}-{}", sides.join(",")));
    }
    parts.join(";")
}

/// Builds the `WallMap` for the world on `terrain` (`wallMap`). A tile is inside when it can't
/// reach far out (`WALL_ENCLOSES_MAX` tiles) on foot without crossing a wall or gate. The fills
/// start beside each wall in the world's order, as the TypeScript's `Map` iterates them.
pub fn wall_map(world: &WorldState, terrain: &TerrainMap) -> WallMap {
    let size = terrain.size;
    let shut = shut_out(world);
    let mut sides: HashMap<String, Vec<String>> = HashMap::new();
    let mut side = |realm_id: Option<&str>| -> Vec<String> {
        let Some(realm_id) = realm_id else { return Vec::new() };
        sides.entry(realm_id.to_string()).or_insert_with(|| allied_realms(world, realm_id)).clone()
    };
    let mut tiles: HashMap<usize, WallTile> = HashMap::new();
    let mut order: Vec<usize> = Vec::new();
    for b in world.buildings.iter().filter(|b| is_wall_or_gate(b)) {
        // `(b.cityId && realms.get(b.cityId)) ?? null`: the city's realm, if the city has one.
        let realm_id = b
            .city_id
            .as_deref()
            .and_then(|id| world.cities.iter().find(|c| c.id == id))
            .and_then(|c| c.realm_id.clone());
        let realms = side(realm_id.as_deref().or(b.city_id.as_deref()));
        let shut_to = match (&b.kind, &b.city_id) {
            (BuildingKind::Gate, Some(city_id)) => shut
                .iter()
                .find(|(id, _)| id == city_id)
                .map(|(_, s)| s.clone())
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        let t = tile_index(size, b.x as i32, b.y as i32);
        if !tiles.contains_key(&t) {
            order.push(t);
        }
        let kind = if b.kind == BuildingKind::Gate { WallKind::Gate } else { WallKind::Wall };
        tiles.insert(t, WallTile { kind, realm_id, realms, closed: is_closed(b), shut_to });
    }
    let passable = |t: usize| is_passable_terrain(terrain.tiles[t]);
    let mut inside: HashSet<usize> = HashSet::new();
    let mut outside: HashSet<usize> = HashSet::new();
    for &w in &order {
        for start in neighbours(size, w) {
            let open = !tiles.contains_key(&start)
                && passable(start)
                && !inside.contains(&start)
                && !outside.contains(&start);
            if !open {
                continue;
            }
            // Fill from beside the wall; a fill that grows too large, or runs into the outside, is out.
            let mut seen: HashSet<usize> = HashSet::from([start]);
            let mut todo = vec![start];
            let mut out = false;
            while !out {
                let Some(t) = todo.pop() else { break };
                for n in neighbours(size, t) {
                    if seen.contains(&n) || tiles.contains_key(&n) || !passable(n) {
                        continue;
                    }
                    if outside.contains(&n) || seen.len() as f64 >= WALL_ENCLOSES_MAX {
                        out = true;
                        break;
                    }
                    seen.insert(n);
                    todo.push(n);
                }
            }
            if out {
                outside.extend(seen);
            } else {
                inside.extend(seen);
            }
        }
    }
    WallMap { size, tiles, inside }
}

/// Whether a resident stands on a wall of their own side or an ally's (`onOwnWall`).
pub fn on_own_wall(world: &WorldState, r: &Resident) -> bool {
    let wall = world
        .buildings
        .iter()
        .find(|b| b.x == r.x && b.y == r.y && b.kind == BuildingKind::Wall && b.site.is_none());
    let city = wall.and_then(|w| world.cities.iter().find(|c| Some(&c.id) == w.city_id.as_ref()));
    let (Some(city), Some(side)) = (city, wall_side(r)) else { return false };
    // An NPC city's walls are its own residents' and its allies' (`wallSide`).
    let of = city.realm_id.as_deref().unwrap_or(&city.id);
    of == side || allied_realms(world, of).iter().any(|m| m == side)
}

/// Damage a finished wall or gate takes before it falls (`wallStrength`).
pub fn wall_strength(b: &Building) -> f64 {
    if b.kind == BuildingKind::Gate {
        WALL_STRENGTH.gate
    } else {
        WALL_STRENGTH.wall
    }
}

/// Damage a wall or gate can still take before it falls (`wallStrengthLeft`).
pub fn wall_strength_left(b: &Building) -> f64 {
    0f64.max(wall_strength(b) - b.damage.unwrap_or(0.0))
}

/// Goods left on the tile of a broken wall or gate (`brokenReturns`).
pub fn broken_returns(b: &Building) -> Stock {
    let mut out = Stock::new();
    for (good, units) in build_materials(b.kind) {
        let back = (units * BROKEN_MATERIALS_RETURNED).floor();
        if back > 0.0 {
            out.insert(good, back);
        }
    }
    out
}

/// The finished wall or gate `wall_id` a resident of `realm_id` may break or climb, or why not
/// (`foreignWall`).
pub fn foreign_wall<'w>(
    world: &'w WorldState,
    realm_id: Option<&str>,
    wall_id: Option<&str>,
) -> Result<&'w Building, String> {
    let b = world.buildings.iter().find(|x| Some(x.id.as_str()) == wall_id);
    let Some(b) = b.filter(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)) else {
        return Err("no such wall or gate".into());
    };
    if b.site.is_some() {
        return Err("that wall is not finished yet".into());
    }
    let city = world.cities.iter().find(|c| Some(&c.id) == b.city_id.as_ref());
    if let Some(own) = city.and_then(|c| c.realm_id.as_deref()) {
        if Some(own) == realm_id {
            return Err("that is one of your own walls".into());
        }
    }
    Ok(b)
}

/// Where a climber at `from` comes down after climbing over the wall or gate at `wall`
/// (`climbLanding`).
pub fn climb_landing(
    world: &WorldState,
    terrain: &TerrainMap,
    from: (i32, i32),
    wall: (i32, i32),
) -> (i32, i32) {
    let size = terrain.size;
    let x = wrap(wall.0 + wrap_delta(from.0, wall.0, size), size);
    let y = wrap(wall.1 + wrap_delta(from.1, wall.1, size), size);
    let t = tile_index(size, x, y);
    // Walls and gates are 1×1 (`CONTEXT.md`: Footprint): their tile is their footprint.
    let walled =
        world.buildings.iter().any(|b| b.x as i32 == x && b.y as i32 == y && is_wall_or_gate(b));
    if walled || !is_passable_terrain(terrain.tiles[t]) {
        return wall;
    }
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A row of three tiles on a 9-wide map: inside (0), own wall (1), outside (2).
    fn ring() -> WallMap {
        let mut tiles = HashMap::new();
        tiles.insert(
            1,
            WallTile { realm_id: Some("r1".into()), realms: vec!["r1".into()], ..WallTile::wall() },
        );
        WallMap { size: 9, tiles, inside: HashSet::from([0]) }
    }

    #[test]
    fn only_the_realm_goes_onto_its_walls_and_down_only_inside() {
        let walls = ring();
        let r1 = Some("r1");
        assert!(may_step(&walls, r1, 0, 1, true, false));
        assert!(!may_step(&walls, r1, 0, 1, false, false));
        assert!(!may_step(&walls, Some("r2"), 0, 1, true, false));
        assert!(!may_step(&walls, r1, 2, 1, true, false));
        assert!(may_step(&walls, r1, 1, 0, true, false));
        assert!(!may_step(&walls, r1, 1, 2, true, false));
        assert!(may_step(&walls, r1, 1, 2, true, true));
    }

    #[test]
    fn a_closed_gate_lets_only_its_side_through() {
        let mut walls = WallMap { size: 9, ..WallMap::default() };
        walls.tiles.insert(
            1,
            WallTile {
                realms: vec!["r1".into()],
                shut_to: vec!["r3".into()],
                ..WallTile::gate(true)
            },
        );
        assert!(may_step(&walls, Some("r1"), 0, 1, false, false));
        assert!(!may_step(&walls, Some("r2"), 0, 1, false, false));
        assert!(!may_step(&walls, None, 0, 1, false, false));
        walls.tiles.get_mut(&1).unwrap().closed = false;
        assert!(may_step(&walls, Some("r2"), 0, 1, false, false));
        assert!(!may_step(&walls, Some("r3"), 0, 1, false, false));
    }

    #[test]
    fn stranded_on_a_foreign_wall_or_one_with_no_way_down() {
        let walls = ring();
        assert!(stranded_on_wall(&walls, Some("r2"), 1));
        assert!(!stranded_on_wall(&walls, Some("r1"), 1));
        assert!(!stranded_on_wall(&walls, Some("r2"), 2));
        let mut cut_off = ring();
        cut_off.inside.clear();
        assert!(stranded_on_wall(&cut_off, Some("r1"), 1));
    }
}
