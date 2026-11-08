//! Orders along a line (`apps/server/src/road-line.ts`, `CONTEXT.md`: Road, Wall / Gate): one of
//! the Player's adult residents builds road or wall on each tile of the straight or diagonal line
//! between two tiles, one after another, walking from tile to tile. Walking, laying out and
//! working happen in later ticks (`building.rs`). The puts of materials (`requestRoadMaterials`)
//! are carrying's (T86.5).

use csp_shared::balance::{MAP_SIZE, ROAD_LINE_MAX_TILES};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, LineOrder, LinePhase, OrderRequest, ResidentOrder, WorldState,
};

use crate::order_sender::{commands, realm_of, OrderSender};
use crate::queries::building::{
    build_problem, building_at, road_at, road_line, TerrainLookup, CARRYING_A_CHILD,
};
use crate::queries::names::kind_name;
use crate::queries::residents::can_work;
use crate::queue::field_str as str_field;

/// Which line order: a road line or a wall line (`LineOrder['kind']`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    RoadLine,
    WallLine,
}

impl LineKind {
    /// What the line builds on each of its tiles (`LINE_BUILDING`).
    pub fn building(self) -> BuildingKind {
        match self {
            LineKind::RoadLine => BuildingKind::Road,
            LineKind::WallLine => BuildingKind::Wall,
        }
    }
}

/// A tile of an order's input (`isTile`): `{ x, y }` with whole numbers.
fn tile_field(order: &OrderRequest, key: &str) -> Option<(i32, i32)> {
    let t = order.fields.get(key)?.as_object()?;
    let whole = |v: Option<&serde_json::Value>| {
        v.and_then(serde_json::Value::as_f64).filter(|n| n.fract() == 0.0).map(|n| n as i32)
    };
    Some((whole(t.get("x"))?, whole(t.get("y"))?))
}

/// Whether a line order passes over (x, y) without building there (`alreadyBuilt`): it has a road
/// already, for a road line, or a wall or gate, finished or not, for a wall line.
fn already_built(world: &WorldState, kind: LineKind, x: i32, y: i32) -> bool {
    match kind {
        LineKind::RoadLine => road_at(world, x, y).is_some(),
        LineKind::WallLine => building_at(world, x, y, MAP_SIZE)
            .is_some_and(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)),
    }
}

/// Checks an order along a line (`lineOrder(kind).validate`): every tile must take one or have
/// one already; tiles that have one are skipped.
pub fn validate_line(
    kind: LineKind,
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let building = kind.building();
    let id = str_field(order, "residentId");
    let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id);
    let realm = realm_of(world, sender.user_id);
    let (Some(realm), Some(r)) = (realm, r) else {
        return Some("not one of your residents".into());
    };
    if !commands(world, &realm.id, Some(r)) {
        return Some("not one of your residents".into());
    }
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t build".into());
    }
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    let (Some(from), Some(to)) = (tile_field(order, "from"), tile_field(order, "to")) else {
        return Some("the line must run between two tiles".into());
    };
    let tiles = road_line(from, to, terrain.map_or(MAP_SIZE, |t| t.size));
    if tiles.len() as f64 > ROAD_LINE_MAX_TILES {
        return Some(format!(
            "a {} order covers at most {ROAD_LINE_MAX_TILES} tiles",
            kind_name(building)
        ));
    }
    let lookup = terrain.map(|t| t as &dyn TerrainLookup);
    for (x, y) in tiles {
        if already_built(world, kind, x, y) {
            continue;
        }
        if let Some(problem) = build_problem(world, x, y, building, lookup) {
            return Some(format!("({x}, {y}): {problem}"));
        }
    }
    None
}

/// Gives the resident the order along the line (`lineOrder(kind).apply`).
pub fn apply_line(
    kind: LineKind,
    world: &mut WorldState,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) {
    let (Some(from), Some(to)) = (tile_field(order, "from"), tile_field(order, "to")) else {
        return;
    };
    let id = str_field(order, "residentId");
    let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else { return };
    let tiles = road_line(from, to, terrain.map_or(MAP_SIZE, |t| t.size));
    let line = LineOrder {
        tiles: tiles.into_iter().map(|(x, y)| (x as f64, y as f64)).collect(),
        phase: LinePhase::Walking,
        path: None,
        progress: 0.0,
        site_id: None,
    };
    r.order = Some(match kind {
        LineKind::RoadLine => ResidentOrder::RoadLine(line),
        LineKind::WallLine => ResidentOrder::WallLine(line),
    });
}
