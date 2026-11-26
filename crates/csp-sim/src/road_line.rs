//! Orders along a line (`apps/server/src/road-line.ts`, `CONTEXT.md`: Road, Wall / Gate): one of
//! the Player's adult residents builds road or wall on each tile of the straight or diagonal line
//! between two tiles, one after another, walking from tile to tile. Walking, laying out and
//! working happen in later ticks (`building.rs`); the puts of materials (`requestRoadMaterials`)
//! are requested here and resolved with carrying.

use csp_shared::balance::{MAP_SIZE, ROAD_LINE_MAX_TILES};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, GoodsSpot, LineOrder, LinePhase, OrderRequest, ResidentOrder, Stock,
    WallMaterial, WorldState,
};

use crate::building::{material_field, material_problem};
use crate::carrying::{CarryAction, CarryKind};
use crate::order_meta::{OrderMeta, StepGroup};
use crate::order_sender::{commands, realm_of, OrderSender};
use crate::queries::building::materials_needed;
use crate::queries::building::{
    build_problem_for, building_at, is_stone, line_kind_at, road_at, road_line, TerrainLookup,
    CARRYING_A_CHILD,
};
use crate::queries::names::{held, kind_name};
use crate::queries::residents::can_work;
use crate::queue::field_str as str_field;
use crate::running::{
    same_when_equal, Arrival, By, Going, GoingMut, RunningOrder, Ties, TiesMut, To,
};
use crate::script_actions::{ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;
use csp_shared::world::Resident;

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
/// already, for a road line, or a wall or gate, finished or not, for a wall line; a stone wall
/// line passes only those of stone, and upgrades a finished wooden one (`CONTEXT.md`: Wood or
/// stone).
fn already_built(
    world: &WorldState,
    kind: LineKind,
    material: Option<WallMaterial>,
    x: i32,
    y: i32,
) -> bool {
    match kind {
        LineKind::RoadLine => road_at(world, x, y).is_some(),
        LineKind::WallLine => {
            let wall = building_at(world, x, y, MAP_SIZE)
                .filter(|b| matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate));
            match wall {
                None => false,
                Some(b) => {
                    let line_kind = line_kind_at(world, BuildingKind::Wall, material, x, y);
                    let upgrades = is_stone(BuildingKind::Wall, material)
                        && b.site.is_none()
                        && !is_stone(b.kind, b.material)
                        && b.kind == line_kind;
                    !upgrades
                }
            }
        }
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
    if let Some(problem) = material_problem(order, Some(building)) {
        return Some(problem);
    }
    let material = material_field(order).filter(|m| *m == WallMaterial::Stone);
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
        if already_built(world, kind, material, x, y) {
            continue;
        }
        let here = line_kind_at(world, building, material, x, y);
        if let Some(problem) = build_problem_for(world, x, y, here, material, lookup) {
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
        material: match kind {
            LineKind::WallLine => material_field(order).filter(|m| *m == WallMaterial::Stone),
            LineKind::RoadLine => None,
        },
    };
    r.order = Some(match kind {
        LineKind::RoadLine => ResidentOrder::RoadLine(line),
        LineKind::WallLine => ResidentOrder::WallLine(line),
    });
}

pub(crate) static WALL_LINE_META: OrderMeta = OrderMeta::fns(
    "wallLine",
    |w, s, o, t| validate_line(LineKind::WallLine, w, s, o, t),
    |w, _, o, t| apply_line(LineKind::WallLine, w, o, t),
)
.queue_step(StepGroup::Work)
.gets_off_first()
.adults_only()
.blocked_carrying_child()
.script(&[WALL_LINE_ACTION]);

const WALL_LINE_ACTION: ScriptAction = ScriptAction {
    name: "wallLine",
    group: ActionGroup::Ruling,
    request: Request::ByHand(&["x", "y", "material?"]),
    cost: 10.0,
    description: "Build wall of \"wood\" (by default) or \"stone\" on each tile of the line from my tile to (x, y), straight or diagonal, one after another, with the materials I carry; tiles with a wall or gate already are skipped, but a stone line upgrades the wooden ones on its way, passing only those of stone.",
    returns: ScriptType::String,
};

pub(crate) static ROAD_LINE_META: OrderMeta = OrderMeta::fns(
    "roadLine",
    |w, s, o, t| validate_line(LineKind::RoadLine, w, s, o, t),
    |w, _, o, t| apply_line(LineKind::RoadLine, w, o, t),
)
.queue_step(StepGroup::Work)
.gets_off_first()
.adults_only()
.blocked_carrying_child()
.script(&[ROAD_LINE_ACTION]);

const ROAD_LINE_ACTION: ScriptAction = ScriptAction {
    name: "roadLine",
    group: ActionGroup::Ruling,
    request: Request::ByHand(&["x", "y"]),
    cost: 10.0,
    description: "Build road on each tile of the line from my tile to (x, y), straight or diagonal, one after another, with the stone I carry.",
    returns: ScriptType::String,
};

impl RunningOrder for LineOrder {
    fn going(&self) -> Option<Going<'_>> {
        Some(Going {
            path: &self.path,
            progress: self.progress,
            now: self.phase == LinePhase::Walking,
            by: By::Foot,
            to: self.tiles.first().map_or(To::Nowhere, |&t| To::At(t)),
            near: false,
            after: None,
            // It walks to the line's next tile, timed as a walk (Daniel, 2026-11-25, #1621).
            estimated: true,
        })
    }
    fn going_mut(&mut self) -> Option<GoingMut<'_>> {
        Some(GoingMut::new(&mut self.path, &mut self.progress))
    }
    fn arrive(&mut self) -> Arrival {
        self.phase = LinePhase::Building;
        GoingMut::new(&mut self.path, &mut self.progress).reset();
        Arrival::GoesOn
    }
    fn resume(&mut self, _: &WorldState, _: &Resident) -> bool {
        GoingMut::new(&mut self.path, &mut self.progress).reset_found();
        true
    }
    same_when_equal!();
    fn ties(&self) -> Ties<'_> {
        Ties::NONE
    }
    fn ties_mut(&mut self) -> TiesMut<'_> {
        TiesMut { place: self.site_id.as_mut(), ..TiesMut::none() }
    }
}

/// This tick's puts of materials from orders along a line (`requestRoadMaterials`): a resident
/// on the site of their tile puts in what they carry of what it still needs.
pub fn request_road_materials(world: &WorldState) -> Vec<CarryAction> {
    let mut actions = Vec::new();
    for r in &world.residents {
        let (Some(ResidentOrder::RoadLine(o)) | Some(ResidentOrder::WallLine(o))) = &r.order else {
            continue;
        };
        let Some(site_id) = o.site_id.as_deref().filter(|_| o.phase == LinePhase::Building) else {
            continue;
        };
        let Some(site) = world.buildings.iter().find(|b| b.id == site_id) else { continue };
        if site.site.is_none() || site.x != r.x || site.y != r.y {
            continue;
        }
        let mut goods = Stock::new();
        for (good, units) in materials_needed(site) {
            let held = units.min(held(&r.carried, good));
            if held > 0.0 {
                goods.insert(good, held);
            }
        }
        if goods.is_empty() {
            continue;
        }
        actions.push(CarryAction {
            kind: CarryKind::Put,
            resident_id: r.id.clone(),
            spot: GoodsSpot::Site { site_id: site.id.clone() },
            goods,
        });
    }
    actions
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_world::{building, empty_world, resident};
    use csp_shared::world::{ConstructionSite, Good};

    /// w1 building a road line, on the road site s1 of their tile, carrying `stone`.
    fn on_site(stone: f64, phase: LinePhase) -> WorldState {
        let mut world = empty_world();
        let w1 = resident(&mut world, "w1", Some("r1"), 5.0, 5.0);
        world.residents[w1].carried = Stock::from([(Good::Stone, stone), (Good::Wood, 3.0)]);
        world.residents[w1].order = Some(ResidentOrder::RoadLine(LineOrder {
            tiles: vec![(5.0, 5.0), (6.0, 5.0)],
            phase,
            path: None,
            progress: 0.0,
            site_id: Some("s1".into()),
            material: None,
        }));
        let s1 = building(&mut world, "s1", BuildingKind::Road, None, 5.0, 5.0);
        world.buildings[s1].site = Some(ConstructionSite { work: 0.0, delivered: Stock::new() });
        world
    }

    #[test]
    fn puts_in_what_the_site_still_needs_of_what_they_carry() {
        let world = on_site(4.0, LinePhase::Building);
        let actions = request_road_materials(&world);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].kind, CarryKind::Put);
        assert_eq!(actions[0].spot, GoodsSpot::Site { site_id: "s1".into() });
        assert_eq!(actions[0].goods, Stock::from([(Good::Stone, 1.0)]));
    }

    #[test]
    fn puts_nothing_while_walking_off_the_site_or_carrying_none_of_it() {
        assert!(request_road_materials(&on_site(4.0, LinePhase::Walking)).is_empty());
        assert!(request_road_materials(&on_site(0.0, LinePhase::Building)).is_empty());
        let mut away = on_site(4.0, LinePhase::Building);
        away.residents[0].x = 6.0;
        assert!(request_road_materials(&away).is_empty());
    }
}
