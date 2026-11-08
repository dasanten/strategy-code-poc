//! Walking, driving and riding along paths (`apps/server/src/walking.ts`, `CONTEXT.md`: Step,
//! Road, Walls in combat, Carriage, Riding, Passenger): the walk-to order, and `Walking`, which
//! finds paths a little at a time and turns moving orders into steps, then resolves the steps.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;

use csp_shared::balance::carriage_can_enter;
use csp_shared::terrain::{
    beside_step, ground_at, is_passable_terrain, step_length, tile_index, TerrainMap,
};
use csp_shared::world::{
    FetchPhase, HaulPhase, HaulStop, LinePhase, OrderRequest, ResidentOrder, SkillName, StorePhase,
    Tile, TilePath, WalkOrder, WorldState,
};

use crate::movement_pending::{
    army_driven_to, army_spot, attack_target, end_order, in_contact, int_field, ordered_resident,
    place_tile, str_field, waiting_for_army, waiting_for_escort, waiting_on_the_road, wall_side,
    OrderKind, OrderSender,
};
use crate::pathfinding::{
    PathFinder, PathOptions, PathResult, Point, TerrainCosts, CARRIAGE_COSTS, WALKING_COSTS,
};
use crate::queries::carriages::{horse_for, passengers_of};
use crate::queries::driving::carriage_can_go_to;
use crate::queries::pace::{drive_speed, driving_learned, ride_speed, walk_speed};
use crate::queries::residents::is_down;
use crate::queries::riding::horse_ridden;
use crate::tick::{Scratch, Walk};
use crate::walls::{may_step, stranded_on_wall, wall_map, walls_fingerprint, WallMap};

/// Time the pathfinder may use per tick (`PATH_BUDGET_MS`, ADR 0004).
pub const PATH_BUDGET_MS: f64 = 50.0;

/// An action a resident requests (`StepAction`): step onto the next tile, on foot, driving
/// `carriage_id` there, or riding `horse_id` there. The world resolves it at the end of the tick.
#[derive(Debug, Clone, PartialEq)]
pub struct StepAction {
    pub resident_id: String,
    pub to: (f64, f64),
    pub carriage_id: Option<String>,
    pub horse_id: Option<String>,
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
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId")) else {
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

/// A number field of an order as the TypeScript `apply` takes it, unchecked.
fn num_field(order: &OrderRequest, name: &str) -> Option<f64> {
    order.fields.get(name).and_then(|v| v.as_f64())
}

/// The path and progress of an order that goes along a path, whatever its phase.
pub fn order_path_mut(o: &mut ResidentOrder) -> Option<(&mut Option<TilePath>, &mut f64)> {
    match o {
        ResidentOrder::WalkTo(o) => Some((&mut o.path, &mut o.progress)),
        ResidentOrder::Drive(o) => Some((&mut o.path, &mut o.progress)),
        ResidentOrder::Haul(o) => Some((&mut o.path, &mut o.progress)),
        ResidentOrder::Store(o) => Some((&mut o.path, &mut o.progress)),
        ResidentOrder::Fetch(o) => Some((&mut o.path, &mut o.progress)),
        ResidentOrder::Attack(o) => Some((&mut o.path, &mut o.progress)),
        ResidentOrder::RoadLine(o) | ResidentOrder::WallLine(o) => {
            Some((&mut o.path, &mut o.progress))
        }
        ResidentOrder::Relocate(o) => Some((&mut o.path, &mut o.progress)),
        _ => None,
    }
}

/// Whether an order goes along a path now (`moveOrder`): a walk-to, drive, attack or relocate
/// order, a haul route driving to its next stop, a road or wall order walking to its next tile, a
/// store or fetch order walking.
fn is_moving(o: Option<&ResidentOrder>) -> bool {
    match o {
        Some(ResidentOrder::Haul(o)) => o.phase == HaulPhase::Driving,
        Some(ResidentOrder::RoadLine(o) | ResidentOrder::WallLine(o)) => {
            o.phase == LinePhase::Walking
        }
        Some(ResidentOrder::Store(o)) => o.phase == StorePhase::Walking,
        Some(ResidentOrder::Fetch(o)) => o.phase == FetchPhase::Walking,
        Some(
            ResidentOrder::WalkTo(_)
            | ResidentOrder::Drive(_)
            | ResidentOrder::Attack(_)
            | ResidentOrder::Relocate(_),
        ) => true,
        _ => false,
    }
}

/// The path of a moving order (`moveOrder(r)?.path`).
fn move_path(o: Option<&ResidentOrder>) -> Option<&TilePath> {
    if !is_moving(o) {
        return None;
    }
    match o? {
        ResidentOrder::WalkTo(o) => o.path.as_ref(),
        ResidentOrder::Drive(o) => o.path.as_ref(),
        ResidentOrder::Haul(o) => o.path.as_ref(),
        ResidentOrder::Store(o) => o.path.as_ref(),
        ResidentOrder::Fetch(o) => o.path.as_ref(),
        ResidentOrder::Attack(o) => o.path.as_ref(),
        ResidentOrder::RoadLine(o) | ResidentOrder::WallLine(o) => o.path.as_ref(),
        ResidentOrder::Relocate(o) => o.path.as_ref(),
        _ => None,
    }
}

/// The path and progress of a moving order, to change.
fn move_path_mut(o: Option<&mut ResidentOrder>) -> Option<(&mut Option<TilePath>, &mut f64)> {
    let o = o?;
    if !is_moving(Some(o)) {
        return None;
    }
    order_path_mut(o)
}

/// A moving order's path found again from scratch (`o.path = null; o.progress = 0`).
fn reset_path(world: &mut WorldState, i: usize) {
    if let Some((path, progress)) = move_path_mut(world.residents[i].order.as_mut()) {
        *path = None;
        *progress = 0.0;
    }
}

/// The TypeScript `kind` of an order.
fn kind_name(o: &ResidentOrder) -> &'static str {
    match o {
        ResidentOrder::WalkTo(_) => "walkTo",
        ResidentOrder::Drive(_) => "drive",
        ResidentOrder::Haul(_) => "haul",
        ResidentOrder::Attack(_) => "attack",
        ResidentOrder::RoadLine(_) => "roadLine",
        ResidentOrder::WallLine(_) => "wallLine",
        ResidentOrder::Store(_) => "store",
        ResidentOrder::Fetch(_) => "fetch",
        ResidentOrder::Relocate(_) => "relocate",
        _ => "other",
    }
}

/// Where a moving order goes (`targetOf`): its target, a haul route's next stop, the tile an
/// attack order's target stands on, a line's next tile, a store or fetch order's place; nowhere
/// when that target is gone.
fn target_of(world: &WorldState, o: &ResidentOrder) -> Option<(f64, f64)> {
    match o {
        ResidentOrder::Haul(o) => {
            let stop = if o.stop == HaulStop::From { &o.from } else { &o.to };
            Some((stop.x, stop.y))
        }
        ResidentOrder::Attack(o) => attack_target(world, &o.target_id),
        ResidentOrder::RoadLine(o) | ResidentOrder::WallLine(o) => o.tiles.first().copied(),
        ResidentOrder::Store(o) => place_tile(world, &o.to),
        ResidentOrder::Fetch(o) => place_tile(world, &o.from),
        ResidentOrder::WalkTo(o) => Some((o.target.x, o.target.y)),
        ResidentOrder::Drive(o) => Some((o.target.x, o.target.y)),
        ResidentOrder::Relocate(o) => Some((o.target.x, o.target.y)),
        _ => None,
    }
}

/// The search for a moving order's path, by kind, target and whether the resident rides
/// (`searchKey`).
fn search_key(world: &WorldState, riding: bool, o: &ResidentOrder) -> String {
    let kind = kind_name(o);
    let how = if riding { format!("{kind}:riding") } else { kind.to_string() };
    match target_of(world, o) {
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

/// Not driving a carriage: walking, or riding a horse (`onFoot`).
fn on_foot(o: &ResidentOrder) -> bool {
    !matches!(o, ResidentOrder::Drive(_) | ResidentOrder::Haul(_))
}

/// A moving order got there (`arrive`): a walk or drive is done, a haul route starts on its stop,
/// an attack order waits, a line builds on its tile, a store or fetch order puts or takes, a
/// relocate order waits to move in, a supply wagon's drive lasts as long as its army.
fn arrive(world: &mut WorldState, i: usize) {
    let r = &mut world.residents[i];
    let Some(o) = r.order.as_mut() else { return };
    match o {
        ResidentOrder::Attack(o) => {
            o.path = None;
            o.progress = 0.0;
        }
        ResidentOrder::Relocate(o) => {
            o.path = None;
            o.progress = 0.0;
        }
        ResidentOrder::RoadLine(o) | ResidentOrder::WallLine(o) => {
            o.phase = LinePhase::Building;
            o.path = None;
            o.progress = 0.0;
        }
        ResidentOrder::Store(o) => {
            o.phase = StorePhase::Putting;
            o.path = None;
            o.progress = 0.0;
        }
        ResidentOrder::Fetch(o) => {
            o.phase = FetchPhase::Taking;
            o.path = None;
            o.progress = 0.0;
        }
        ResidentOrder::Drive(o) if o.army.is_some() => {
            o.path = None;
            o.progress = 0.0;
        }
        ResidentOrder::Haul(o) => {
            o.phase = HaulPhase::Loading;
            o.path = None;
            o.progress = 0.0;
        }
        _ => r.order = None,
    }
}

/// An attack order that need not walk this tick (`attackHolds`): its target is gone or in
/// contact. One whose path no longer ends in contact with its target finds a new one.
fn attack_holds(world: &mut WorldState, i: usize, size: i32) -> bool {
    let r = &world.residents[i];
    let Some(o) = &r.order else { return false };
    let target = target_of(world, o);
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
    let Some(o) = world.residents[i].order.as_mut() else { return false };
    let is_haul = matches!(o, ResidentOrder::Haul(_));
    let to = match o {
        ResidentOrder::Drive(o) => &mut o.target,
        ResidentOrder::Haul(o) => &mut o.to,
        _ => return false,
    };
    (to.x, to.y) = spot;
    if !contact {
        if let Some((path, _)) = order_path_mut(o) {
            let ends =
                path.as_ref().map(|p| p.last().is_some_and(|&end| in_contact(size, end, spot)));
            if ends == Some(false) {
                *path = None;
            }
        }
        return false;
    }
    if is_haul {
        arrive(world, i);
    }
    reset_path_any(world, i);
    true
}

/// `o.path = null; o.progress = 0` on the order, moving or not.
fn reset_path_any(world: &mut WorldState, i: usize) {
    if let Some((path, progress)) = world.residents[i].order.as_mut().and_then(order_path_mut) {
        *path = None;
        *progress = 0.0;
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
    fn set_ground(&mut self, world: &WorldState, roads: Rc<HashSet<usize>>) {
        if self.roads.as_ref().is_none_or(|r| **r != *roads) {
            self.finder.set_roads(roads.iter().copied());
        }
        self.roads = Some(roads);
        let walls = self.walls_of(world);
        self.finder.set_walls(Some(walls));
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
        let options =
            PathOptions { realm_id: side.map(str::to_string), on_walls: false, near: false, area };
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
        let roads = scratch.index(world, size).roads(world);
        self.set_ground(world, roads.clone());
        let mut holding: HashSet<String> = HashSet::new();
        for i in 0..world.residents.len() {
            let r = &world.residents[i];
            let drives = is_moving(r.order.as_ref())
                && matches!(r.order, Some(ResidentOrder::Drive(_) | ResidentOrder::Haul(_)));
            let Some(army) = army_driven_to(r).map(str::to_string).filter(|_| drives) else {
                continue;
            };
            if follow_holds(world, i, &army, size) {
                holding.insert(world.residents[i].id.clone());
            }
        }
        self.plan(world, budget_ms, &holding);
        for i in 0..world.residents.len() {
            let r = &world.residents[i];
            if !is_moving(r.order.as_ref()) {
                continue;
            }
            if matches!(r.order, Some(ResidentOrder::Attack(_))) && attack_holds(world, i, size) {
                holding.insert(world.residents[i].id.clone());
            }
            // A store or fetch order whose carriage moved on since its path was found finds a new one.
            let r = &world.residents[i];
            if let Some(o @ (ResidentOrder::Store(_) | ResidentOrder::Fetch(_))) = &r.order {
                if let (Some(to), Some(end)) =
                    (target_of(world, o), move_path(Some(o)).and_then(|p| p.last()))
                {
                    if end.0 != to.0 || end.1 != to.1 {
                        reset_path_only(world, i);
                    }
                }
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
            let Some(path) = move_path(r.order.as_ref()) else { continue };
            let Some(&next) = path.first() else {
                arrive(world, i);
                continue;
            };
            // Keeping together with their army (`CONTEXT.md`: Army).
            if waiting.contains(&r.id) {
                continue;
            }
            let o = r.order.as_ref().expect("a moving order");
            let ground = ground_at(&self.terrain, &roads, next.0 as i32, next.1 as i32);
            let foot = on_foot(o);
            let riding = if foot { horse_ridden(world, r) } else { None };
            // The road over Mountain on the way is gone: a carriage or horse finds a new way.
            if (!foot || riding.is_some()) && !carriage_can_enter(ground) {
                reset_path(world, i);
                continue;
            }
            let gain;
            let mut learned = 0.0;
            if !foot {
                // The horse sets the pace. Without one the step goes at once, so resolving it ends
                // the order, as it does when the horse is Down: the carriage stands where it is.
                let carriage_id = match o {
                    ResidentOrder::Drive(o) => &o.carriage_id,
                    ResidentOrder::Haul(o) => &o.carriage_id,
                    _ => unreachable!("a driving order"),
                };
                let carriage = world.carriages.iter().find(|k| k.id == *carriage_id);
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
                            carriage_id: Some(carriage_id.clone()),
                            horse_id: None,
                        });
                        continue;
                    }
                }
            } else if let Some(h) = riding {
                // The horse sets the pace, and riding trains Driving too (`CONTEXT.md`: Riding).
                gain = ride_speed(r, h, ground);
                learned = driving_learned(r, tick);
            } else {
                gain = walk_speed(r, ground, tick);
            }
            let horse_id = riding.map(|h| h.id.clone());
            let carriage_id = match o {
                ResidentOrder::Drive(o) => Some(o.carriage_id.clone()),
                ResidentOrder::Haul(o) => Some(o.carriage_id.clone()),
                _ => None,
            };
            let (rx, ry) = (r.x, r.y);
            let r = &mut world.residents[i];
            let (_, progress) = move_path_mut(r.order.as_mut()).expect("a moving order");
            *progress += gain;
            let progress = *progress;
            if !foot || horse_id.is_some() {
                let skill = r.skills.get(&SkillName::Driving).copied().unwrap_or(0.0);
                r.skills.insert(SkillName::Driving, skill + learned);
            }
            // A diagonal step is further, so it waits for that much more progress (`CONTEXT.md`: Step).
            let length = match step_length(size, rx as i32, ry as i32, next.0 as i32, next.1 as i32)
            {
                0.0 => 1.0,
                l => l,
            };
            if progress < length {
                continue;
            }
            steps.push(StepAction {
                resident_id: r.id.clone(),
                to: next,
                carriage_id: if foot { None } else { carriage_id },
                horse_id,
            });
        }
        steps
    }

    /// Finds paths for new moving orders; drops orders whose target can't be reached (`plan`).
    fn plan(&mut self, world: &mut WorldState, budget_ms: f64, holding: &HashSet<String>) {
        for r in &world.residents {
            let o = r.order.as_ref();
            if !is_moving(o) || move_path(o).is_some() || holding.contains(&r.id) {
                continue;
            }
            let o = o.expect("a moving order");
            let Some(target) = target_of(world, o) else { continue };
            // A new order for a resident replaces any search for their old one.
            let key = search_key(world, r.riding.is_some(), o);
            if self.searching.get(&r.id) != Some(&key) {
                // A rider keeps to where a carriage can go, and off the walls (`CONTEXT.md`: Riding).
                let walking = on_foot(o) && r.riding.is_none();
                let costs: &TerrainCosts = if walking { &WALKING_COSTS } else { &CARRIAGE_COSTS };
                // An attacker only needs to come into contact; so does a carriage going after an
                // army, and one driven up to a wall or gate it may not pass.
                let near = matches!(o, ResidentOrder::Attack(_))
                    || army_driven_to(r).is_some()
                    || matches!(o, ResidentOrder::Drive(d) if d.near == Some(true));
                let options = PathOptions {
                    realm_id: wall_side(r).map(str::to_string),
                    on_walls: walking,
                    near,
                    area: None,
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
            let o = r.order.as_ref();
            if !is_moving(o) || move_path(o).is_some() {
                continue;
            }
            if search_key(world, r.riding.is_some(), o.expect("a moving order")) != key {
                continue;
            }
            match result {
                PathResult::Found { path, .. } => {
                    let (p, _) =
                        move_path_mut(world.residents[i].order.as_mut()).expect("a moving order");
                    *p =
                        Some(path.into_iter().map(|(x, y)| (f64::from(x), f64::from(y))).collect());
                }
                _ => end_order(world, i, Some("no way")),
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
        for step in steps {
            let Some(&i) = residents.get(&step.resident_id) else { continue };
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
            let on_walls = step.carriage_id.is_none() && step.horse_id.is_none();
            let stranded = stranded_on_wall(&walls, side, from);
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
                .all(|t| enterable(t) && may_step(&walls, side, from, t, on_walls, stranded));
            if !corners || !may_step(&walls, side, from, to, on_walls, stranded) {
                reset_path(world, i);
                continue;
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
            taken += 1;
            let Some((path, progress)) = move_path_mut(r.order.as_mut()) else { continue };
            let Some(p) = path else { continue };
            if !p.is_empty() {
                p.remove(0);
            }
            *progress -= length;
            if p.is_empty() {
                arrive(world, i);
            }
        }
        taken
    }
}

/// `o.path = null` alone, progress kept, on a moving order.
fn reset_path_only(world: &mut WorldState, i: usize) {
    if let Some((path, _)) = move_path_mut(world.residents[i].order.as_mut()) {
        *path = None;
    }
}

impl Walk for Walking {
    fn walk(&mut self, world: &mut WorldState, scratch: &mut Scratch) -> usize {
        let steps = self.request_steps(world, scratch, PATH_BUDGET_MS);
        self.resolve(world, scratch, &steps);
        steps.len()
    }
}

#[cfg(test)]
mod tests;
