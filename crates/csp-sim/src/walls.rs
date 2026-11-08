//! Walls and gates as the path searches see them (`CONTEXT.md`: Walls in combat): the `WallMap`
//! and its step rules, ported from `packages/shared/src/walls.ts` (`WallTile`, `WallMap`,
//! `strandedOnWall`, `mayStep`). Building a `WallMap` from the world (`wallMap`) needs the cities,
//! alliances and standings and comes with the rules (Epic 1003).

use std::collections::{HashMap, HashSet};

use csp_shared::terrain::wrap;
use serde::Deserialize;

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
