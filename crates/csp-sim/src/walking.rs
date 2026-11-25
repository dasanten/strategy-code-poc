//! Walking, driving and riding along paths (`apps/server/src/walking.ts`, `CONTEXT.md`: Step,
//! Road, Walls in combat, Carriage, Riding, Passenger): the walk-to order, and `Walking`, which
//! finds paths a little at a time and turns moving orders into steps, then resolves the steps.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;

use csp_shared::balance::{carriage_can_enter, TOWER_ROOM, WALL_WALK_TICKS};
use csp_shared::terrain::{
    beside_step, ground_at, is_passable_terrain, step_length, terrain_at, tile_index, wrap,
    TerrainMap,
};
use csp_shared::world::{
    GoodsPlace, OrderRequest, Resident, ResidentOrder, SkillName, Tile, TilePath, UpSide,
    VesselKind, WalkOrder, WorldState,
};

use crate::order_meta::{running_meta, OrderMeta, StepGroup};
use crate::passengers::get_off_vessel;
use crate::queries::vessels::{
    across_docked_ship, beside_vessel, between_vessels, crew_short, floats_on, row_target,
    vessel_aboard, vessel_crew,
};
use crate::running::{
    moving, same_when_equal, Arrival, By, Going, GoingMut, RunningOrder, Ties, TiesMut, To,
};
use crate::script_actions::{arg, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;
use crate::water_hauling::stop_tile;

use crate::armies::waiting_for_army;
use crate::caravans::waiting_for_escort;
use crate::combat::strikes_from_here;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::pathfinding::{
    PathFinder, PathOptions, PathResult, Point, TerrainCosts, CARRIAGE_COSTS, SEA_COSTS,
    WALKING_COSTS, WATER_COSTS,
};
use crate::queries::army::army_spot;
use crate::queries::carriages::{horse_for, passengers_of};
use crate::queries::driving::carriage_can_go_to;
use crate::queries::pace::{
    drive_speed, driving_learned, ride_speed, row_speed, sail_speed, seafaring_learned, walk_speed,
};
use crate::queries::residents::is_down;
use crate::queries::riding::horse_ridden;
use crate::storing::{end_order, place_tile};
use crate::tick::{Scratch, Walk};
use crate::trade_org_punishment::waiting_on_the_road;
use crate::walls::wall_side;
use crate::walls::{
    may_move, may_step, stranded_on_wall, up_after, wall_map, walls_fingerprint, WallMap,
};

/// Time the pathfinder may use per tick (`PATH_BUDGET_MS`, ADR 0004).
pub const PATH_BUDGET_MS: f64 = 50.0;

/// Whether two spots are in contact (`inContact`), on their whole tiles.
fn in_contact(size: i32, a: (f64, f64), b: (f64, f64)) -> bool {
    crate::queries::combat::in_contact(size, (a.0 as i32, a.1 as i32), (b.0 as i32, b.1 as i32))
}

/// Where an attack order's target stands (`attackTarget`): a resident, or a finished wall or gate.
fn attack_target(world: &WorldState, target_id: &str) -> Option<(f64, f64)> {
    match crate::combat::attack_target(world, target_id)? {
        crate::combat::Target::Resident(i) => Some((world.residents[i].x, world.residents[i].y)),
        crate::combat::Target::Building(i) => Some((world.buildings[i].x, world.buildings[i].y)),
        crate::combat::Target::Machine(i) => {
            Some((world.siege_machines[i].x, world.siege_machines[i].y))
        }
    }
}

/// An action a resident requests (`StepAction`): step onto the next tile, on foot, driving
/// `carriage_id` there, riding `horse_id` there, or rowing `vessel_id` there over water. The world
/// resolves it at the end of the tick.
#[derive(Debug, Clone, PartialEq)]
pub struct StepAction {
    pub resident_id: String,
    pub to: (f64, f64),
    pub carriage_id: Option<String>,
    pub horse_id: Option<String>,
    pub vessel_id: Option<String>,
    /// The siege machine pushed onto the tile, with its crew (`CONTEXT.md`: Siege machine).
    pub machine_id: Option<String>,
}

/// The walk-to order (`walkTo`): one of the Player's residents walks to a tile. It only sets the
/// order; the path is found and the steps are taken in later ticks.
pub struct WalkTo;

impl OrderKind for WalkTo {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId"))
            .map(|i| &world.residents[i])
        else {
            return Some("not one of your residents".into());
        };
        let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else {
            return Some("the target must be a tile".into());
        };
        // A rider goes where a carriage could (`CONTEXT.md`: Riding).
        if r.riding.is_some()
            && terrain.is_some_and(|t| !carriage_can_go_to(world, t, x as i32, y as i32))
        {
            return Some("a horse can’t go there".into());
        }
        None
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let id = str_field(order, "residentId");
        let (Some(x), Some(y)) = (num_field(order, "x"), num_field(order, "y")) else { return };
        if let Some(r) = world.residents.iter_mut().find(|r| Some(r.id.as_str()) == id) {
            r.order = Some(ResidentOrder::WalkTo(WalkOrder {
                target: Tile { x, y },
                path: None,
                progress: 0.0,
                army: None,
            }));
        }
    }
}

pub(crate) static WALK_TO_META: OrderMeta = OrderMeta::request("walkTo", &WalkTo)
    .queue_step(StepGroup::Move)
    .gets_off_first()
    .npc_city()
    .script(&[WALK_TO_ACTION]);

const WALK_TO_ACTION: ScriptAction = ScriptAction {
    name: "walkTo",
    group: ActionGroup::Movement,
    request: Request::Fields(&[arg("x"), arg("y")]),
    cost: 10.0,
    description: "Walk to a tile.",
    returns: ScriptType::String,
};

impl RunningOrder for WalkOrder {
    fn going(&self) -> Option<Going<'_>> {
        Some(Going {
            path: &self.path,
            progress: self.progress,
            now: true,
            by: By::Foot,
            to: To::tile(&self.target),
            near: false,
            after: None,
            estimated: true,
        })
    }
    fn going_mut(&mut self) -> Option<GoingMut<'_>> {
        Some(GoingMut::new(&mut self.path, &mut self.progress))
    }
    fn arrive(&mut self) -> Arrival {
        Arrival::Done
    }
    fn resume(&mut self, _: &WorldState, _: &Resident) -> bool {
        GoingMut::new(&mut self.path, &mut self.progress).reset_found();
        true
    }
    same_when_equal!();
    fn ties(&self) -> Ties<'_> {
        Ties { army: self.army.as_deref(), ..Ties::NONE }
    }
    fn ties_mut(&mut self) -> TiesMut<'_> {
        TiesMut { army: Some(&mut self.army), ..TiesMut::none() }
    }
}

/// A number field of an order as the TypeScript `apply` takes it, unchecked.
fn num_field(order: &OrderRequest, name: &str) -> Option<f64> {
    order.fields.get(name).and_then(|v| v.as_f64())
}

/// A moving order's path found again from scratch (`o.path = null; o.progress = 0`).
fn reset_path(world: &mut WorldState, i: usize) {
    if let Some(going) = moving_mut(world.residents[i].order.as_mut()) {
        going.reset();
    }
}

/// What walking changes on an order that goes along a path now.
fn moving_mut(o: Option<&mut ResidentOrder>) -> Option<GoingMut<'_>> {
    let o = o?;
    moving(Some(o))?;
    o.going_mut()
}

/// The path of a moving order (`moveOrder(r)?.path`).
fn move_path(o: Option<&ResidentOrder>) -> Option<&TilePath> {
    moving(o)?.path.as_ref()
}

/// Where a moving order goes (`targetOf`): its target, a haul route's next stop, the tile an
/// attack order's target stands on, a line's next tile, a store or fetch order's place; nowhere
/// when that target is gone.
fn target_of(world: &WorldState, to: To) -> Option<(f64, f64)> {
    match to {
        To::At(tile) => Some(tile),
        To::Foe(id) => attack_target(world, id),
        To::Place(place) => place_tile(world, place),
        To::Machine(id) => crate::siege::machine_by_id(world, id).map(|m| (m.x, m.y)),
        To::Nowhere => None,
    }
}

/// The search for a moving order's path, by kind, target and whether the resident rides
/// (`searchKey`).
fn search_key(world: &WorldState, riding: bool, o: &ResidentOrder, to: To) -> String {
    let kind = running_meta(o).kind;
    let how = if riding { format!("{kind}:riding") } else { kind.to_string() };
    match target_of(world, to) {
        Some((x, y)) => format!("{how}:{},{}", js(x), js(y)),
        None => format!("{how}:gone"),
    }
}

/// A coordinate as a template string prints it.
fn js(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

/// Whether a store or fetch order goes to a boat, which is loaded from beside it (`CONTEXT.md`:
/// Beside a vessel): its walk ends next to the boat's water tile. One to a ship walks onto the
/// haven it is docked at, as to a storage (`CONTEXT.md`: Docked).
fn goes_beside_vessel(world: &WorldState, to: To) -> bool {
    matches!(to, To::Place(GoodsPlace::Vessel { vessel_id })
        if world.vessels.iter().any(|v| &v.id == vessel_id && v.kind == VesselKind::Boat))
}

/// Whether the vessel of an id is a ship, which sails over Sea only (`CONTEXT.md`: Ship).
fn is_ship(world: &WorldState, vessel_id: &str) -> bool {
    world.vessels.iter().any(|v| v.id == vessel_id && v.kind == VesselKind::Ship)
}

/// Nobody walks off a vessel's water tile (`CONTEXT.md`: Water, No ferrying by itself): a
/// vessel's passenger whose order has them walk, however they got it, gets off onto the shore
/// beside it nearest where they go first (`get_off_vessel`); with no shore there the order ends
/// and they stay aboard. One aboard who fights someone beside the vessel stays aboard
/// (`CONTEXT.md`: Fighting at a vessel).
fn land_moving_passengers(world: &mut WorldState, terrain: &TerrainMap) {
    let size = terrain.size;
    for i in 0..world.residents.len() {
        let r = &world.residents[i];
        if r.aboard.is_none() {
            continue;
        }
        let Some(going) = moving(r.order.as_ref()) else { continue };
        if vessel_aboard(world, r).is_none() {
            continue;
        }
        // Rowing and sailing keep them aboard: the vessel moves, not they.
        match going.by {
            By::Oars(_) | By::Sails(_) => continue,
            By::Foot | By::Carriage { .. } | By::Machine(_) => {}
        }
        let target = target_of(world, going.to);
        if let To::Foe(id) = going.to {
            let foe = world.residents.iter().find(|t| t.id == id);
            // Not at someone aboard another vessel: there are no fights between vessels.
            let across = foe.is_some_and(|t| between_vessels(world, r, t));
            // From a docked ship, anyone on its haven is in reach (`CONTEXT.md`: Fighting at a
            // vessel).
            let haven = foe.is_some_and(|t| across_docked_ship(world, r, t));
            if !across && (haven || target.is_some_and(|t| in_contact(size, (r.x, r.y), t))) {
                continue;
            }
        }
        let toward = target.map(|(x, y)| (x as i32, y as i32));
        if get_off_vessel(world, i, terrain, toward) {
            reset_path_any(world, i);
        } else {
            world.residents[i].order = None;
        }
    }
}

/// Resolves a rower's step (`CONTEXT.md`: Rowing): the rower at the boat's oars, aboard it on its
/// tile, moves it one Step over water, onto a tile with no other vessel, a diagonal step only where
/// both straight tiles beside it are water too; everyone aboard goes along, so they see from its
/// new tile. Whether it moved. A boat whose rower lost the oars or the boat, or that was steered
/// at land, stops; one whose next tile holds another vessel waits, or stops beside it when that
/// tile was the last.
fn row_step(
    world: &mut WorldState,
    terrain: &TerrainMap,
    i: usize,
    vessel_id: &str,
    to: (f64, f64),
) -> bool {
    let size = terrain.size;
    let r = &world.residents[i];
    let Some(vi) = world.vessels.iter().position(|v| v.id == vessel_id) else {
        world.residents[i].order = None;
        return false;
    };
    let v = &world.vessels[vi];
    // A boat's rower is at its oars; a ship's captain is one of its crew, and it has enough of them
    // (`CONTEXT.md`: Sailing).
    let helm = match v.kind {
        VesselKind::Boat => v.rower_id.as_deref() == Some(r.id.as_str()),
        VesselKind::Ship => v.crew_ids.contains(&r.id) && crew_short(world, v) == 0,
    };
    let at_oars = helm && r.aboard.as_deref() == Some(vessel_id) && v.x == r.x && v.y == r.y;
    let (vx, vy) = (v.x as i32, v.y as i32);
    let (tx, ty) = (to.0 as i32, to.1 as i32);
    // A boat over any water, a ship over Sea only.
    let kind = v.kind;
    let water = |x: i32, y: i32| floats_on(kind, terrain_at(terrain, x, y));
    let corners =
        beside_step(size, vx, vy, tx, ty).into_iter().all(|t| floats_on(kind, terrain.tiles[t]));
    if !at_oars || step_length(size, vx, vy, tx, ty) == 0.0 || !water(tx, ty) || !corners {
        world.residents[i].order = None;
        return false;
    }
    let (wx, wy) = (f64::from(wrap(tx, size)), f64::from(wrap(ty, size)));
    if world.vessels.iter().any(|o| o.id != vessel_id && o.x == wx && o.y == wy) {
        let last = move_path(world.residents[i].order.as_ref()).is_some_and(|p| p.len() == 1);
        if last {
            if let Some(ResidentOrder::HaulByWater(_)) = &world.residents[i].order {
                water_stop_taken(world, terrain, i, vi);
            } else {
                world.residents[i].order = None;
            }
        }
        return false;
    }
    let length = step_length(size, vx, vy, tx, ty);
    world.vessels[vi].x = wx;
    world.vessels[vi].y = wy;
    for r in world.residents.iter_mut().filter(|r| r.aboard.as_deref() == Some(vessel_id)) {
        (r.x, r.y) = (wx, wy);
    }
    let Some(going) = moving_mut(world.residents[i].order.as_mut()) else {
        return true;
    };
    *going.progress -= length;
    let Some(p) = going.path.as_mut() else { return true };
    if !p.is_empty() {
        p.remove(0);
    }
    if p.is_empty() {
        arrive(world, i);
    }
    true
}

/// A haul route by water whose water tile beside the stop another vessel took just before it got
/// there: a boat already beside the stop has arrived; else it heads for another free water tile
/// beside the stop, or waits for one.
fn water_stop_taken(world: &mut WorldState, terrain: &TerrainMap, i: usize, vi: usize) {
    let Some(ResidentOrder::HaulByWater(o)) = &world.residents[i].order else { return };
    let stop = stop_tile(o, o.stop);
    let v = &world.vessels[vi];
    if beside_vessel(world, v, stop.x, stop.y) {
        arrive(world, i);
        return;
    }
    let to = row_target(world, terrain, v, stop.x as i32, stop.y as i32);
    let Some(ResidentOrder::HaulByWater(o)) = &mut world.residents[i].order else { return };
    if let Some((x, y)) = to.map(|(x, y)| (f64::from(x), f64::from(y))) {
        if o.water.is_some_and(|w| w.x != x || w.y != y) {
            o.water = Some(Tile { x, y });
            o.path = None;
            o.progress = 0.0;
        }
    }
}

/// A moving order got there (`arrive`): a walk or drive is done, a haul route starts on its stop,
/// an attack order waits, a line builds on its tile, a store or fetch order puts or takes, a
/// relocate order waits to move in, a supply wagon's drive lasts as long as its army. A crew order
/// joins its machine's crew on its tile, or goes after it if it was pushed on meanwhile.
fn arrive(world: &mut WorldState, i: usize) {
    let Some(o) = &mut world.residents[i].order else { return };
    match o.arrive() {
        Arrival::Done => world.residents[i].order = None,
        Arrival::GoesOn => {}
        Arrival::JoinsCrew => {
            let r = &world.residents[i];
            let machine = moving(r.order.as_ref()).and_then(|g| target_of(world, g.to));
            let there = machine.map(|(x, y)| (x as i32, y as i32) == (r.x as i32, r.y as i32));
            if there == Some(false) {
                reset_path_any(world, i);
            } else {
                crate::siege::join_crew(world, i);
            }
        }
    }
}

/// An attack order that need not walk this tick (`attackHolds`): its target is gone or in
/// contact, or an archer can shoot it from where they stand (`CONTEXT.md`: Ranged combat). One
/// whose path no longer ends in contact with its target finds a new one.
fn attack_holds(world: &mut WorldState, i: usize, size: i32) -> bool {
    let r = &world.residents[i];
    let Some(o) = &r.order else { return false };
    if let ResidentOrder::Attack(a) = o {
        let target = world.residents.iter().position(|t| t.id == a.target_id);
        if target.is_some_and(|t| t != i && strikes_from_here(world, size, i, t)) {
            if let Some(ResidentOrder::Attack(a)) = &mut world.residents[i].order {
                a.path = None;
                a.progress = 0.0;
            }
            return true;
        }
    }
    let r = &world.residents[i];
    let Some(going) = moving(r.order.as_ref()) else { return false };
    let target = target_of(world, going.to);
    let Some(target) = target.filter(|&t| !in_contact(size, (r.x, r.y), t)) else { return true };
    if let Some(ResidentOrder::Attack(o)) = &mut world.residents[i].order {
        if let Some(path) = &o.path {
            let ends = path.last().is_some_and(|&end| in_contact(size, end, target));
            if !ends {
                o.path = None;
            }
        }
    }
    false
}

/// A carriage going after an army that need not drive this tick (`followHolds`). With the army
/// gone the order ends. Where the order heads follows the army; in contact with it, a supply
/// wagon stands with it and a haul route starts on its stop.
fn follow_holds(world: &mut WorldState, i: usize, army_id: &str, size: i32) -> bool {
    let r = &world.residents[i];
    let Some(spot) = army_spot(world, army_id, (r.x, r.y), size) else {
        world.residents[i].order = None;
        return true;
    };
    // A path found is kept while it ends in contact with the army, so heading always for the spot
    // itself costs no search.
    let contact = in_contact(size, (r.x, r.y), spot);
    let Some(going) = world.residents[i].order.as_mut().and_then(|o| o.going_mut()) else {
        return false;
    };
    let Some(to) = going.after else { return false };
    (to.x, to.y) = spot;
    if !contact {
        let ends =
            going.path.as_ref().map(|p| p.last().is_some_and(|&e| in_contact(size, e, spot)));
        if ends == Some(false) {
            *going.path = None;
        }
        return false;
    }
    arrive(world, i);
    reset_path_any(world, i);
    true
}

/// `o.path = null; o.progress = 0` on the order, moving or not.
fn reset_path_any(world: &mut WorldState, i: usize) {
    if let Some(going) = world.residents[i].order.as_mut().and_then(|o| o.going_mut()) {
        going.reset();
    }
}

/// Turns residents' moving orders into step actions each tick, and resolves the steps
/// (`Walking`). The path for a new order is found a little at a time (`PathFinder`), with the
/// carriage's costs for a drive; the found path is kept in the order as plain data.
pub struct Walking {
    terrain: Arc<TerrainMap>,
    finder: PathFinder,
    searching: HashMap<String, String>,
    /// The order the searches were asked for in, as the TypeScript `Map` keeps it.
    searching_order: Vec<String>,
    /// The wall map and the `walls_fingerprint` it was built at.
    walls: Option<(u64, Arc<WallMap>)>,
    roads: Option<Rc<HashSet<usize>>>,
    /// A clock for the pathfinder's budget (milliseconds); the wall clock without one.
    clock: Option<Box<dyn FnMut() -> f64>>,
}

impl Walking {
    pub fn new(terrain: Arc<TerrainMap>) -> Walking {
        Walking {
            finder: PathFinder::new(terrain.clone()),
            terrain,
            searching: HashMap::new(),
            searching_order: Vec::new(),
            walls: None,
            roads: None,
            clock: None,
        }
    }

    /// With `clock` (milliseconds) for the pathfinder's budget instead of the wall clock.
    pub fn with_clock(terrain: Arc<TerrainMap>, clock: Box<dyn FnMut() -> f64>) -> Walking {
        Walking { clock: Some(clock), ..Walking::new(terrain) }
    }

    /// The walls and gates on the map, built again only when they change (`wallsOf`).
    fn walls_of(&mut self, world: &WorldState) -> Arc<WallMap> {
        let key = walls_fingerprint(world);
        if self.walls.as_ref().is_none_or(|(k, _)| *k != key) {
            self.walls = Some((key, Arc::new(wall_map(world, &self.terrain))));
        }
        self.walls.as_ref().expect("walls just built").1.clone()
    }

    /// Tells the pathfinder the finished roads and the walls, when they changed (`setGround`).
    /// Returns the walls it set.
    fn set_ground(&mut self, world: &WorldState, roads: Rc<HashSet<usize>>) -> Arc<WallMap> {
        // The same index as last time holds the same roads: no need to compare them tile by tile.
        if self.roads.as_ref().is_none_or(|r| !Rc::ptr_eq(r, &roads) && **r != *roads) {
            self.finder.set_roads(roads.iter().copied());
        }
        self.roads = Some(roads);
        let walls = self.walls_of(world);
        self.finder.set_walls(Some(walls.clone()));
        walls
    }

    fn advance(&mut self, budget_ms: f64) {
        match &mut self.clock {
            Some(clock) => self.finder.advance_with(budget_ms, clock),
            None => self.finder.advance(budget_ms),
        }
    }

    /// The way someone of `side` would walk between two tiles, through their own gates and not
    /// over walls (`way`); with `area`, only as far as the first of its tiles. Ask again until it
    /// is settled; a settled answer is handed out once.
    pub fn way(
        &mut self,
        key: &str,
        from: Point,
        to: Point,
        side: Option<&str>,
        area: Option<HashSet<usize>>,
    ) -> PathResult {
        let id = format!("way:{key}");
        if let Some(result) = self.finder.result(&id) {
            return result;
        }
        let options = PathOptions {
            realm_id: side.map(str::to_string),
            on_walls: false,
            near: false,
            area,
            up: None,
        };
        self.finder.request(&id, from, to, &WALKING_COSTS, options);
        PathResult::Searching
    }

    /// Requests this tick's steps for every walking resident, rider and driver (`requestSteps`).
    pub fn request_steps(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        budget_ms: f64,
    ) -> Vec<StepAction> {
        let size = self.terrain.size;
        land_moving_passengers(world, &self.terrain);
        let roads = scratch.index(world, size).roads(world);
        let walls = self.set_ground(world, roads.clone());
        let mut holding: HashSet<String> = HashSet::new();
        for i in 0..world.residents.len() {
            let r = &world.residents[i];
            let after = moving(r.order.as_ref()).and_then(|g| g.after);
            let Some(army) = after.map(str::to_string) else { continue };
            if follow_holds(world, i, &army, size) {
                holding.insert(world.residents[i].id.clone());
            }
        }
        self.plan(world, budget_ms, &holding);
        for i in 0..world.residents.len() {
            let r = &world.residents[i];
            let Some(going) = moving(r.order.as_ref()) else { continue };
            match going.to {
                To::Foe(_) => {
                    if attack_holds(world, i, size) {
                        holding.insert(world.residents[i].id.clone());
                    }
                }
                // A store or fetch order whose carriage moved on since its path was found finds a
                // new one, and so does a crew order whose machine was pushed on.
                To::Place(_) | To::Machine(_) => {
                    let end = going.path.as_ref().and_then(|p| p.last());
                    if let (Some(to), Some(end)) = (target_of(world, going.to), end) {
                        // To a vessel the way ends beside it (`CONTEXT.md`: Beside a vessel).
                        let ends_there = if goes_beside_vessel(world, going.to) {
                            in_contact(size, *end, to) && *end != to
                        } else {
                            end.0 == to.0 && end.1 == to.1
                        };
                        if !ends_there {
                            reset_path_only(world, i);
                        }
                    }
                }
                To::At(_) | To::Nowhere => {}
            }
        }
        let mut waiting = waiting_for_army(world, &holding);
        // And caravans with their escort (`CONTEXT.md`: Caravan).
        waiting.extend(waiting_for_escort(world, size));
        // And the Trade Org's soldiers on the road (`CONTEXT.md`: Punishment trip).
        waiting.extend(waiting_on_the_road(world, size));
        let mut steps = Vec::new();
        let tick = world.tick as f64;
        for i in 0..world.residents.len() {
            let r = &world.residents[i];
            if holding.contains(&r.id) {
                continue;
            }
            let Some(Going { path: Some(path), by, .. }) = moving(r.order.as_ref()) else {
                continue;
            };
            let Some(&next) = path.first() else {
                arrive(world, i);
                continue;
            };
            // Keeping together with their army (`CONTEXT.md`: Army).
            if waiting.contains(&r.id) {
                continue;
            }
            // The rower sets the pace over water, Lake or Sea alike, and learns Seafaring; a
            // ship's crew set its pace over Sea, and all of them learn Seafaring (`CONTEXT.md`:
            // Rowing, Sailing, Seafaring).
            let sailed = match by {
                By::Sails(id) => Some((id, true)),
                // A ship on a haul route by water is sailed as well (`CONTEXT.md`: Haul route by
                // water).
                By::Oars(id) => Some((id, is_ship(world, id))),
                By::Foot | By::Carriage { .. } | By::Machine(_) => None,
            };
            if let Some((vessel_id, sailing)) = sailed {
                let vessel_id = vessel_id.to_string();
                let (rx, ry) = (r.x as i32, r.y as i32);
                let gain = if sailing {
                    let Some(v) = world.vessels.iter().find(|v| v.id == vessel_id) else {
                        world.residents[i].order = None;
                        continue;
                    };
                    // Below the fewest crew it takes, the ship stops where it is.
                    if crew_short(world, v) > 0 {
                        world.residents[i].order = None;
                        continue;
                    }
                    let crew: Vec<usize> = vessel_crew(world, v)
                        .iter()
                        .filter_map(|c| world.residents.iter().position(|x| x.id == c.id))
                        .collect();
                    let gain =
                        sail_speed(&crew.iter().map(|&c| &world.residents[c]).collect::<Vec<_>>());
                    for c in crew {
                        let learned = seafaring_learned(&world.residents[c], tick);
                        let skills = &mut world.residents[c].skills;
                        let skill = skills.get(&SkillName::Seafaring).copied().unwrap_or(0.0);
                        skills.insert(SkillName::Seafaring, skill + learned);
                    }
                    gain
                } else {
                    let (gain, learned) = (row_speed(r, tick), seafaring_learned(r, tick));
                    let skills = &mut world.residents[i].skills;
                    let skill = skills.get(&SkillName::Seafaring).copied().unwrap_or(0.0);
                    skills.insert(SkillName::Seafaring, skill + learned);
                    gain
                };
                let r = &mut world.residents[i];
                let going = moving_mut(r.order.as_mut()).expect("a moving order");
                *going.progress += gain;
                let progress = *going.progress;
                let length = match step_length(size, rx, ry, next.0 as i32, next.1 as i32) {
                    0.0 => 1.0,
                    l => l,
                };
                if progress >= length {
                    steps.push(StepAction {
                        resident_id: r.id.clone(),
                        to: next,
                        carriage_id: None,
                        horse_id: None,
                        vessel_id: Some(vessel_id),
                        machine_id: None,
                    });
                }
                continue;
            }
            let ground = ground_at(&self.terrain, &roads, next.0 as i32, next.1 as i32);
            let foot = matches!(by, By::Foot);
            let riding = if foot { horse_ridden(world, r) } else { None };
            // The road over Mountain on the way is gone: a carriage or horse finds a new way.
            if (!foot || riding.is_some()) && !carriage_can_enter(ground) {
                reset_path(world, i);
                continue;
            }
            let gain;
            let mut learned = 0.0;
            let mut pushed = None;
            let mut driven = None;
            if let By::Machine(machine_id) = by {
                // A crewed machine goes at its own slow pace, whoever pushes it; below its crew
                // size it stands where it is (`CONTEXT.md`: Siege machine).
                let Some(m) = crate::siege::machine_by_id(world, machine_id) else {
                    world.residents[i].order = None;
                    continue;
                };
                if crate::siege::push_problem(world, r, m).is_some() {
                    world.residents[i].order = None;
                    continue;
                }
                gain = crate::siege::push_speed(ground);
                pushed = Some(machine_id.to_string());
            } else if let By::Carriage { id: carriage_id, .. } = by {
                // The horse sets the pace. Without one the step goes at once, so resolving it ends
                // the order, as it does when the horse is Down: the carriage stands where it is.
                let carriage = world.carriages.iter().find(|k| k.id == carriage_id);
                let horse = carriage.and_then(|k| horse_for(world, k));
                match horse {
                    Some(h) if !is_down(h.down_until) => {
                        gain = drive_speed(r, &h.stats, ground);
                        learned = driving_learned(r, tick);
                    }
                    _ => {
                        steps.push(StepAction {
                            resident_id: r.id.clone(),
                            to: next,
                            carriage_id: Some(carriage_id.to_string()),
                            horse_id: None,
                            vessel_id: None,
                            machine_id: None,
                        });
                        continue;
                    }
                }
                driven = Some(carriage_id.to_string());
            } else if let Some(h) = riding {
                // The horse sets the pace, and riding trains Driving too (`CONTEXT.md`: Riding).
                gain = ride_speed(r, h, ground);
                learned = driving_learned(r, tick);
            } else {
                gain = walk_speed(r, ground, tick);
            }
            // Getting up onto a wall walk or down from it takes its ticks, however fast they walk
            // (`CONTEXT.md`: Wall walk).
            let climbs = foot && riding.is_none() && gets_up_or_down(&walls, size, r, path);
            let gain = if climbs { 1.0 } else { gain };
            let horse_id = riding.map(|h| h.id.clone());
            let (rx, ry) = (r.x, r.y);
            let r = &mut world.residents[i];
            let going = moving_mut(r.order.as_mut()).expect("a moving order");
            *going.progress += gain;
            let progress = *going.progress;
            if driven.is_some() || horse_id.is_some() {
                let skill = r.skills.get(&SkillName::Driving).copied().unwrap_or(0.0);
                r.skills.insert(SkillName::Driving, skill + learned);
            }
            // A diagonal step is further, so it waits for that much more progress (`CONTEXT.md`: Step).
            let length = match step_length(size, rx as i32, ry as i32, next.0 as i32, next.1 as i32)
            {
                _ if climbs => WALL_WALK_TICKS,
                0.0 => 1.0,
                l => l,
            };
            if progress < length {
                continue;
            }
            steps.push(StepAction {
                resident_id: r.id.clone(),
                to: next,
                carriage_id: driven,
                horse_id,
                vessel_id: None,
                machine_id: pushed,
            });
        }
        steps
    }

    /// Finds paths for new moving orders; drops orders whose target can't be reached (`plan`).
    fn plan(&mut self, world: &mut WorldState, budget_ms: f64, holding: &HashSet<String>) {
        for r in &world.residents {
            let Some(going) = moving(r.order.as_ref()) else { continue };
            if going.path.is_some() || holding.contains(&r.id) {
                continue;
            }
            let o = r.order.as_ref().expect("a moving order");
            // One aboard a vessel still attacking here fights from aboard, in contact
            // (`land_moving_passengers`): there is no way to find from the water.
            if matches!(going.to, To::Foe(_)) && vessel_aboard(world, r).is_some() {
                continue;
            }
            let Some(target) = target_of(world, going.to) else { continue };
            // A new order for a resident replaces any search for their old one.
            let key = search_key(world, r.riding.is_some(), o, going.to);
            if self.searching.get(&r.id) != Some(&key) {
                // A rider keeps to where a carriage can go, and off the walls (`CONTEXT.md`: Riding).
                let walking = matches!(going.by, By::Foot) && r.riding.is_none();
                // A boat goes over water only, a ship over Sea only (`CONTEXT.md`: Rowing,
                // Sailing).
                let costs: &TerrainCosts = match going.by {
                    By::Oars(id) if !is_ship(world, id) => &WATER_COSTS,
                    By::Oars(_) | By::Sails(_) => &SEA_COSTS,
                    By::Foot if walking => &WALKING_COSTS,
                    By::Foot | By::Carriage { .. } | By::Machine(_) => &CARRIAGE_COSTS,
                };
                // An attacker only needs to come into contact; so does a carriage going after an
                // army, and one driven up to a wall or gate it may not pass.
                let near =
                    going.near || going.after.is_some() || goes_beside_vessel(world, going.to);
                let options = PathOptions {
                    realm_id: wall_side(r).map(str::to_string),
                    on_walls: walking,
                    near,
                    area: None,
                    // From up on a wall walk, if they are (`CONTEXT.md`: Wall walk).
                    up: r.up.filter(|_| walking),
                };
                let from = (r.x as i32, r.y as i32);
                let to = (target.0 as i32, target.1 as i32);
                self.finder.request(&r.id, from, to, costs, options);
                if self.searching.insert(r.id.clone(), key).is_none() {
                    self.searching_order.push(r.id.clone());
                }
            }
        }
        if self.finder.pending() > 0 {
            self.advance(budget_ms);
        }
        let ids: Vec<String> = self.searching_order.clone();
        for id in ids {
            let Some(key) = self.searching.get(&id).cloned() else { continue };
            let result = match self.finder.result(&id) {
                None | Some(PathResult::Searching) => continue,
                Some(r) => r,
            };
            self.searching.remove(&id);
            self.searching_order.retain(|x| *x != id);
            let Some(i) = world.residents.iter().position(|r| r.id == id) else { continue };
            let r = &world.residents[i];
            let Some(going) = moving(r.order.as_ref()).filter(|g| g.path.is_none()) else {
                continue;
            };
            let o = r.order.as_ref().expect("a moving order");
            if search_key(world, r.riding.is_some(), o, going.to) != key {
                continue;
            }
            match result {
                PathResult::Found { path, .. } => {
                    let going =
                        moving_mut(world.residents[i].order.as_mut()).expect("a moving order");
                    *going.path =
                        Some(path.into_iter().map(|(x, y)| (f64::from(x), f64::from(y))).collect());
                }
                _ => end_order(world, i, Some("no way".into())),
            }
        }
    }

    /// Resolves step actions (`resolve`, ADR 0002): a step happens only if the tile is one of the
    /// eight around them and can be entered, walls and gates letting them, and for a diagonal step
    /// both straight tiles beside it could be stepped onto too. A driver's step also needs their
    /// carriage on their tile with a horse to pull it; the carriage, its horse and its passengers
    /// go along. A rider's step needs their horse with them. Each step taken uses up its length in
    /// tiles of progress. Returns how many steps were taken.
    pub fn resolve(
        &mut self,
        world: &mut WorldState,
        scratch: &mut Scratch,
        steps: &[StepAction],
    ) -> usize {
        let mut taken = 0;
        let size = self.terrain.size;
        let roads = scratch.index(world, size).roads(world);
        let walls = self.walls_of(world);
        let terrain = self.terrain.clone();
        let residents: HashMap<String, usize> =
            world.residents.iter().enumerate().map(|(i, r)| (r.id.clone(), i)).collect();
        // Who is up on each tower now, kept up to date step by step (`CONTEXT.md`: Tower).
        let mut towers_up: HashMap<String, usize> = HashMap::new();
        for r in world.residents.iter().filter(|r| r.up.is_some()) {
            let t = tile_index(size, r.x as i32, r.y as i32);
            if let Some(tower) = walls.tiles.get(&t).and_then(|w| w.tower.clone()) {
                *towers_up.entry(tower).or_insert(0) += 1;
            }
        }
        for step in steps {
            let Some(&i) = residents.get(&step.resident_id) else { continue };
            if let Some(vid) = &step.vessel_id {
                if row_step(world, &terrain, i, vid, step.to) {
                    taken += 1;
                }
                continue;
            }
            let r = &world.residents[i];
            let (rx, ry) = (r.x as i32, r.y as i32);
            let (tx, ty) = (step.to.0 as i32, step.to.1 as i32);
            let length = step_length(size, rx, ry, tx, ty);
            let ground = ground_at(&terrain, &roads, tx, ty);
            if length == 0.0 || !is_passable_terrain(ground) {
                world.residents[i].order = None;
                continue;
            }
            let from = tile_index(size, rx, ry);
            let to = tile_index(size, tx, ty);
            let side = wall_side(r);
            let on_walls =
                step.carriage_id.is_none() && step.horse_id.is_none() && step.machine_id.is_none();
            // Up on a wall walk, or getting up or down: straight steps on foot only, along their
            // side's walk, down to the side they came up from (`CONTEXT.md`: Wall walk).
            let up = r.up.filter(|_| on_walls);
            let to_up = match move_path(r.order.as_ref()) {
                Some(p) if on_walls && p.first() == Some(&step.to) => up_next(&walls, size, r, p),
                _ if on_walls => up_after(&walls, from, up, std::iter::once(to)),
                _ => None,
            };
            let walked = if up.is_some() || to_up.is_some() {
                let stranded = up.is_some_and(|s| stranded_on_wall(&walls, side, from, s));
                length == 1.0 && may_move(&walls, side, from, up, to, to_up, stranded)
            } else {
                let enterable = |t: usize| {
                    let g = ground_at(&terrain, &roads, t as i32 % size, t as i32 / size);
                    if on_walls {
                        is_passable_terrain(g)
                    } else {
                        carriage_can_enter(g)
                    }
                };
                let corners = beside_step(size, rx, ry, tx, ty)
                    .into_iter()
                    .all(|t| enterable(t) && may_step(&walls, side, t));
                corners && may_step(&walls, side, to)
            };
            if !walked {
                reset_path(world, i);
                continue;
            }
            // A tower holds only so many up at once (`CONTEXT.md`: Tower): one getting onto a full
            // one waits where they are, their way kept, until there is room. Along its own top they
            // go as they like.
            let tower_of = |t: usize, up: Option<UpSide>| {
                up.and(walls.tiles.get(&t)).and_then(|w| w.tower.clone())
            };
            let (left, onto) = (tower_of(from, up), tower_of(to, to_up));
            if left != onto {
                if let Some(t) = &onto {
                    if towers_up.get(t).copied().unwrap_or(0) >= TOWER_ROOM as usize {
                        continue;
                    }
                    *towers_up.entry(t.clone()).or_insert(0) += 1;
                }
                if let Some(n) = left.as_ref().and_then(|t| towers_up.get_mut(t)) {
                    *n = n.saturating_sub(1);
                }
            }
            // Getting up or down uses up its ticks of progress (`request_steps`).
            let length = if up.is_some() != to_up.is_some() { WALL_WALK_TICKS } else { length };
            if let Some(mid) = &step.machine_id {
                // The pusher's step needs the machine on their tile, still crewed, onto ground a
                // carriage could take; the machine and its crew there go along (`CONTEXT.md`:
                // Siege machine).
                let mi = crate::siege::machine_index(world, mid);
                let r = &world.residents[i];
                let ok = mi.is_some_and(|mi| {
                    let m = &world.siege_machines[mi];
                    (m.x as i32, m.y as i32) == (rx, ry)
                        && crate::siege::push_problem(world, r, m).is_none()
                });
                if !ok {
                    world.residents[i].order = None;
                    continue;
                }
                if !crate::siege::machine_can_enter(ground) {
                    reset_path(world, i);
                    continue;
                }
                let mi = mi.expect("checked");
                let crew: Vec<usize> = world.siege_machines[mi]
                    .crew_ids
                    .iter()
                    .filter_map(|id| residents.get(id).copied())
                    .filter(|&c| {
                        c != i
                            && (world.residents[c].x as i32, world.residents[c].y as i32)
                                == (rx, ry)
                    })
                    .collect();
                (world.siege_machines[mi].x, world.siege_machines[mi].y) = step.to;
                for c in crew {
                    let p = &mut world.residents[c];
                    (p.x, p.y) = step.to;
                    // Whatever path they were on starts again from the new tile.
                    if let Some(going) = p.order.as_mut().and_then(|o| o.going_mut()) {
                        going.reset();
                    }
                }
            }
            if let Some(cid) = &step.carriage_id {
                let k = world.carriages.iter().position(|k| k.id == *cid);
                let horse = k.and_then(|k| horse_for(world, &world.carriages[k]));
                let r = &world.residents[i];
                let ok = match (k, horse) {
                    (Some(k), Some(h)) => {
                        let c = &world.carriages[k];
                        c.x == r.x
                            && c.y == r.y
                            && h.x == r.x
                            && h.y == r.y
                            && !is_down(h.down_until)
                    }
                    _ => false,
                };
                if !ok {
                    world.residents[i].order = None;
                    continue;
                }
                // A road torn down on Mountain under a path found earlier: find a new way.
                if !carriage_can_enter(ground) {
                    reset_path(world, i);
                    continue;
                }
                let (k, hid) = (k.expect("checked"), horse.expect("checked").id.clone());
                let h =
                    world.horses.iter().position(|x| x.id == hid).expect("a horse of the world");
                let (old_x, old_y) = (r.x, r.y);
                let carriage = &mut world.carriages[k];
                carriage.horse_id = Some(hid);
                (carriage.x, carriage.y) = step.to;
                (world.horses[h].x, world.horses[h].y) = step.to;
                // Its passengers ride along (`CONTEXT.md`: Passenger).
                let cid = world.carriages[k].id.clone();
                let riders: Vec<String> = passengers_of(world, &cid)
                    .into_iter()
                    .filter(|p| p.x == old_x && p.y == old_y)
                    .map(|p| p.id.clone())
                    .collect();
                for id in riders {
                    let p = &mut world.residents[residents[&id]];
                    (p.x, p.y) = step.to;
                }
            }
            if let Some(hid) = &step.horse_id {
                // A rider who got off, or a path found on foot that leads where a horse can't go,
                // finds a new way (`CONTEXT.md`: Riding).
                let r = &world.residents[i];
                let horse = if r.riding.as_deref() == Some(hid.as_str()) {
                    horse_ridden(world, r)
                } else {
                    None
                };
                let ok = horse.is_some_and(|h| {
                    !is_down(h.down_until) && h.x == r.x && h.y == r.y && carriage_can_enter(ground)
                });
                if !ok {
                    reset_path(world, i);
                    continue;
                }
                let h =
                    world.horses.iter().position(|x| x.id == *hid).expect("a horse of the world");
                (world.horses[h].x, world.horses[h].y) = step.to;
            }
            let r = &mut world.residents[i];
            (r.x, r.y) = step.to;
            r.up = to_up;
            taken += 1;
            let Some(going) = moving_mut(r.order.as_mut()) else { continue };
            let Some(p) = going.path else { continue };
            if !p.is_empty() {
                p.remove(0);
            }
            *going.progress -= length;
            if p.is_empty() {
                arrive(world, i);
            }
        }
        taken
    }
}

/// Where a walker is once they take the next step of `path`, on the ground or up on a wall walk
/// (`up_after`).
fn up_next(walls: &WallMap, size: i32, r: &Resident, path: &TilePath) -> Option<UpSide> {
    let tile = |(x, y): (f64, f64)| tile_index(size, x as i32, y as i32);
    up_after(walls, tile((r.x, r.y)), r.up, path.iter().map(|&p| tile(p)))
}

/// Whether a walker's next step of `path` gets them up onto a wall walk or down from it
/// (`CONTEXT.md`: Wall walk).
fn gets_up_or_down(walls: &WallMap, size: i32, r: &Resident, path: &TilePath) -> bool {
    up_next(walls, size, r, path).is_some() != r.up.is_some()
}

/// `o.path = null` alone, progress kept, on a moving order.
fn reset_path_only(world: &mut WorldState, i: usize) {
    if let Some(going) = moving_mut(world.residents[i].order.as_mut()) {
        *going.path = None;
    }
}

impl Walk for Walking {
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize {
        let steps = self.request_steps(world, scratch, PATH_BUDGET_MS);
        self.resolve(world, scratch, &steps);
        steps.len()
    }

    fn ways(&mut self) -> Option<&mut dyn crate::npc_roads::WayFinder> {
        Some(self)
    }
}

#[cfg(test)]
mod tests;
