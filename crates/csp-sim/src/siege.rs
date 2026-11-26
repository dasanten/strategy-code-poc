//! Siege machines (`CONTEXT.md`: Siege machine, ADR 0037): a ram or a catapult is laid out and
//! built in the field as a construction site (`building.rs`); finished, it stands as a machine of
//! the finisher's realm. Residents of its realm join its **crew** by walking onto its tile (the
//! crew order), and with at least its crew size there one of them **pushes** it, slowly, along a
//! way a carriage could take, the crew walking with it (the push order; the steps are taken by
//! `walking.rs`). A ram **rams** the wall next to it; a catapult **throws** Stone at one in its
//! reach. It is broken by blows like a wall (`combat.rs`) and torn down by its realm
//! (`teardown.rs`).

use csp_shared::balance::{
    carriage_can_enter, BROKEN_MATERIALS_RETURNED, CARRIAGE_SPEED, CATAPULT_BLOW, CATAPULT_REACH,
    CATAPULT_SHOT_TICKS, MAP_SIZE, RAM_BLOW, RAM_STRIKE_TICKS, SIEGE_PUSH_SHARE,
    TEARDOWN_MATERIALS_RETURNED, TEARDOWN_WORK_SHARE, WALK_TICKS_PER_TILE,
};
use csp_shared::footprint::near_footprint;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, CrewOrder, CrimeKind, Good, OrderRequest, PushOrder, RamOrder, Resident,
    ResidentOrder, SiegeMachine, SiegeMachineKind, Stock, ThrowOrder, Tile, WorldState,
};

use crate::crimes::{building_organization, commit_crime, CrimeAgainst};
use crate::defence::Alarms;
use crate::goods_made::GoodsMade;
use crate::order_meta::OrderMeta;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::queries::building::{build_materials_of, build_work_for};
use crate::running::{
    in_place, no_ties, no_ties_mut, same_when_equal, Arrival, By, Going, GoingMut, RunningOrder,
    Ties, To,
};
use crate::script_actions::{arg, place, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;

use crate::queries::driving::carriage_can_go_to;
use crate::queries::names::{held, placed};
use crate::queries::residents::{can_work, is_down};
use crate::queries::walls::{broken_returns, foreign_wall, wall_strength, wall_strength_left};
use crate::survival::drop_goods;

/// The machine's name, as the Player reads it.
pub fn machine_name(kind: SiegeMachineKind) -> &'static str {
    kind.spec().name
}

/// The fewest crew on its tile for a machine to be pushed (`RAM_CREW`).
pub fn crew_needed(kind: SiegeMachineKind) -> usize {
    kind.spec().crew as usize
}

/// Damage a machine takes before it breaks (`RAM_STRENGTH`).
pub fn machine_strength(kind: SiegeMachineKind) -> f64 {
    kind.spec().strength
}

/// What a machine is built of: its site's materials.
pub fn machine_materials(kind: SiegeMachineKind) -> Stock {
    build_materials_of(kind.spec().built_as, None)
}

/// What a broken machine leaves on its tile (`BROKEN_MATERIALS_RETURNED` of its materials).
pub fn broken_machine_returns(kind: SiegeMachineKind) -> Stock {
    share_of(machine_materials(kind), BROKEN_MATERIALS_RETURNED)
}

/// What a machine torn down leaves on its tile (`TEARDOWN_MATERIALS_RETURNED` of its materials).
pub fn torn_down_machine_returns(kind: SiegeMachineKind) -> Stock {
    share_of(machine_materials(kind), TEARDOWN_MATERIALS_RETURNED)
}

/// Work it takes to tear a machine down, as a finished building of its site's kind takes.
pub fn machine_teardown_work(kind: SiegeMachineKind) -> f64 {
    build_work_for(kind.spec().built_as, None) * TEARDOWN_WORK_SHARE
}

fn share_of(materials: Stock, share: f64) -> Stock {
    materials
        .into_iter()
        .map(|(good, units)| (good, (units * share).floor()))
        .filter(|(_, units)| *units > 0.0)
        .collect()
}

/// Where in `world.siege_machines` the machine `id` is.
pub fn machine_index(world: &WorldState, id: &str) -> Option<usize> {
    world.siege_machines.iter().position(|m| m.id == id)
}

/// The machine `id`, if it is in the world.
pub fn machine_by_id<'w>(world: &'w WorldState, id: &str) -> Option<&'w SiegeMachine> {
    world.siege_machines.iter().find(|m| m.id == id)
}

/// Whether the resident stands on the machine's tile.
fn on_its_tile(r: &Resident, m: &SiegeMachine) -> bool {
    r.x as i32 == m.x as i32 && r.y as i32 == m.y as i32
}

/// Whether `r` is one of the machine's crew: named in it and on its tile.
pub fn is_crew(m: &SiegeMachine, r: &Resident) -> bool {
    m.crew_ids.contains(&r.id) && on_its_tile(r, m)
}

/// The machine's crew on its tile and not Down, where they are in `world.residents`, in the order
/// they joined: those who count for pushing it.
pub fn crew_of(world: &WorldState, m: &SiegeMachine) -> Vec<usize> {
    m.crew_ids
        .iter()
        .filter_map(|id| world.residents.iter().position(|r| r.id == *id))
        .filter(|&i| on_its_tile(&world.residents[i], m) && !is_down(world.residents[i].down_until))
        .collect()
}

/// How many more crew a machine needs on its tile before it can be pushed.
pub fn crew_short(world: &WorldState, m: &SiegeMachine) -> usize {
    crew_needed(m.kind).saturating_sub(crew_of(world, m).len())
}

/// The one of its crew pushing the machine now, if anyone is.
pub fn pusher_of<'w>(world: &'w WorldState, m: &SiegeMachine) -> Option<&'w Resident> {
    world
        .residents
        .iter()
        .find(|r| matches!(&r.order, Some(ResidentOrder::Push(o)) if o.machine_id == m.id))
}

/// How many tiles a tick a crewed machine is pushed onto ground `terrain` (`SIEGE_PUSH_SHARE` of a
/// carriage's pace there, whoever pushes): nothing where a carriage can't go.
pub fn push_speed(terrain: u8) -> f64 {
    CARRIAGE_SPEED.get(terrain).unwrap_or(0.0) * SIEGE_PUSH_SHARE / WALK_TICKS_PER_TILE
}

/// Why `r` can't push the machine now: they must be one of its crew, with at least its crew size
/// on its tile.
pub fn push_problem(world: &WorldState, r: &Resident, m: &SiegeMachine) -> Option<String> {
    if !is_crew(m, r) {
        return Some(format!("only one of its crew on its tile pushes a {}", machine_name(m.kind)));
    }
    match crew_short(world, m) {
        0 => None,
        n => Some(format!("the {} needs {n} more crew to be pushed", machine_name(m.kind))),
    }
}

/// The crew order (`crew`): one of the Player's residents walks onto a machine of their realm and
/// joins its crew (`CONTEXT.md`: Siege machine).
pub struct Crew;

impl Crew {
    fn check(
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
    ) -> Result<(usize, String), String> {
        let Some(i) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Err("not one of your residents".into());
        };
        let Some(m) = str_field(order, "machineId").and_then(|id| machine_by_id(world, id)) else {
            return Err("no such siege machine".into());
        };
        let r = &world.residents[i];
        if r.owner.is_none() || m.realm_id != r.owner {
            return Err(format!("not a {} of your realm", machine_name(m.kind)));
        }
        if !can_work(r.born_at, world.tick as f64) {
            return Err(format!("children don’t crew a {}", machine_name(m.kind)));
        }
        if is_crew(m, r) {
            return Err(format!("already one of the {}’s crew", machine_name(m.kind)));
        }
        Ok((i, m.id.clone()))
    }
}

impl OrderKind for Crew {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        Crew::check(world, sender, order).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Ok((i, machine_id)) = Crew::check(world, sender, order) else { return };
        world.residents[i].order =
            Some(ResidentOrder::Crew(CrewOrder { machine_id, path: None, progress: 0.0 }));
    }
}

pub(crate) static CREW_META: OrderMeta =
    OrderMeta::request("crew", &Crew).gets_off_first().adults_only().script(&[CREW_ACTION]);

const CREW_ACTION: ScriptAction = ScriptAction {
    name: "crew",
    group: ActionGroup::Movement,
    request: Request::Fields(&[place("machine", "machineId")]),
    cost: 10.0,
    description: "Join the crew of a siege machine of my realm, by it or its id: I walk onto its tile, following it if it is pushed on, and am one of its crew there until I leave its tile. My order is \"crew\" until I get there.",
    returns: ScriptType::String,
};

impl RunningOrder for CrewOrder {
    fn going(&self) -> Option<Going<'_>> {
        Some(Going {
            path: &self.path,
            progress: self.progress,
            now: true,
            by: By::Foot,
            to: To::Machine(&self.machine_id),
            near: false,
            after: None,
            // It walks, so the arrival estimate times it as a walk (Daniel, 2026-11-25, #1621).
            estimated: true,
        })
    }
    fn going_mut(&mut self) -> Option<GoingMut<'_>> {
        Some(GoingMut::new(&mut self.path, &mut self.progress))
    }
    fn arrive(&mut self) -> Arrival {
        Arrival::JoinsCrew
    }
    fn resume(&mut self, _: &WorldState, _: &Resident) -> bool {
        // The path found before the interruption is kept (#1619).
        true
    }
    same_when_equal!();
    no_ties!();
}

/// The push order (`push`): one of a machine's crew pushes it to (x, y), a tile a carriage could
/// go to, with at least its crew size on its tile (`CONTEXT.md`: Siege machine). Another of the
/// crew pushing it stops.
pub struct Push;

impl Push {
    fn check(
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Result<(usize, String, f64, f64), String> {
        let Some(i) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Err("not one of your residents".into());
        };
        let Some(m) = str_field(order, "machineId").and_then(|id| machine_by_id(world, id)) else {
            return Err("no such siege machine".into());
        };
        let r = &world.residents[i];
        if r.owner.is_none() || m.realm_id != r.owner {
            return Err(format!("not a {} of your realm", machine_name(m.kind)));
        }
        if let Some(p) = push_problem(world, r, m) {
            return Err(p);
        }
        let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else {
            return Err("the target must be a tile".into());
        };
        if terrain.is_some_and(|t| !carriage_can_go_to(world, t, x as i32, y as i32)) {
            return Err(format!("a {} can’t be pushed there", machine_name(m.kind)));
        }
        Ok((i, m.id.clone(), x, y))
    }
}

impl OrderKind for Push {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        Push::check(world, sender, order, terrain).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Ok((i, machine_id, x, y)) = Push::check(world, sender, order, terrain) else { return };
        for r in &mut world.residents {
            if matches!(&r.order, Some(ResidentOrder::Push(o)) if o.machine_id == machine_id) {
                r.order = None;
            }
        }
        world.residents[i].order = Some(ResidentOrder::Push(PushOrder {
            machine_id,
            target: Tile { x, y },
            path: None,
            progress: 0.0,
        }));
    }
}

pub(crate) static PUSH_META: OrderMeta =
    OrderMeta::request("push", &Push).adults_only().script(&[PUSH_ACTION]);

const PUSH_ACTION: ScriptAction = ScriptAction {
    name: "push",
    group: ActionGroup::Movement,
    request: Request::Fields(&[place("machine", "machineId"), arg("x"), arg("y")]),
    cost: 10.0,
    description: "Push a siege machine, by it or its id, to the tile x, y, where a carriage could go. I must be one of its crew on its tile, with at least as many crew as it needs there; they go along with it, slowly, a Step at a time. My order is \"push\" until it gets there.",
    returns: ScriptType::String,
};

impl RunningOrder for PushOrder {
    fn going(&self) -> Option<Going<'_>> {
        Some(Going {
            path: &self.path,
            progress: self.progress,
            now: true,
            by: By::Machine(&self.machine_id),
            to: To::tile(&self.target),
            near: false,
            after: None,
            // Pushed, not walked: no arrival estimate until pushing has a pace of its own
            // (Daniel, 2026-11-25, #1621).
            estimated: false,
        })
    }
    fn going_mut(&mut self) -> Option<GoingMut<'_>> {
        Some(GoingMut::new(&mut self.path, &mut self.progress))
    }
    fn arrive(&mut self) -> Arrival {
        Arrival::Done
    }
    fn resume(&mut self, _: &WorldState, _: &Resident) -> bool {
        // The path found before the interruption is kept (#1619).
        true
    }
    same_when_equal!();
    no_ties!();
}

/// A crew order got onto its machine's tile (`walking.rs`): the resident joins its crew, if the
/// machine still stands there and is still of their realm. The order is done either way.
pub fn join_crew(world: &mut WorldState, i: usize) {
    let r = &world.residents[i];
    let Some(ResidentOrder::Crew(o)) = &r.order else { return };
    let mi = machine_index(world, &o.machine_id);
    let joins = mi.is_some_and(|mi| {
        let m = &world.siege_machines[mi];
        on_its_tile(r, m) && r.owner.is_some() && m.realm_id == r.owner && !is_down(r.down_until)
    });
    let id = r.id.clone();
    world.residents[i].order = None;
    if let Some(mi) = mi.filter(|_| joins) {
        let crew = &mut world.siege_machines[mi].crew_ids;
        if !crew.contains(&id) {
            crew.push(id);
        }
    }
}

/// Keeps every machine's crew to who is with it (`CONTEXT.md`: Siege machine), once everyone moved
/// this tick: one who died, left its tile or is no longer of its realm is no longer of its crew. A
/// crew or push order on a machine that is gone ends, and so does a push by one no longer of its
/// crew or below its crew size.
pub fn step_siege_machines(world: &mut WorldState) {
    let WorldState { siege_machines, residents, .. } = world;
    for m in siege_machines.iter_mut() {
        let (x, y, realm) = (m.x as i32, m.y as i32, m.realm_id.clone());
        m.crew_ids.retain(|id| {
            residents.iter().any(|r| {
                r.id == *id
                    && (r.x as i32, r.y as i32) == (x, y)
                    && r.owner.is_some()
                    && r.owner == realm
            })
        });
    }
    for i in 0..world.residents.len() {
        let ends = match &world.residents[i].order {
            Some(ResidentOrder::Crew(o)) => machine_index(world, &o.machine_id).is_none(),
            Some(ResidentOrder::Push(o)) => match machine_by_id(world, &o.machine_id) {
                None => true,
                Some(m) => push_problem(world, &world.residents[i], m).is_some(),
            },
            Some(ResidentOrder::Ram(o)) => match machine_by_id(world, &o.machine_id) {
                None => true,
                Some(m) => ram_problem(world, &world.residents[i], m, &o.target_id).is_some(),
            },
            Some(ResidentOrder::Throw(o)) => match machine_by_id(world, &o.machine_id) {
                None => true,
                Some(m) => throw_problem(world, &world.residents[i], m, &o.target_id).is_some(),
            },
            _ => false,
        };
        if ends {
            world.residents[i].order = None;
        }
    }
}

/// Whether `r` is under a ram's roof (`CONTEXT.md`: Ram): one of a ram's crew on its tile. Nobody
/// up on a wall strikes them, and no shot reaches them.
pub fn under_roof(world: &WorldState, r: &Resident) -> bool {
    world.siege_machines.iter().any(|m| m.kind == SiegeMachineKind::Ram && is_crew(m, r))
}

/// Why `r` can't swing the ram `m` at the wall or gate `target_id` now (`CONTEXT.md`: Ram): they
/// must be one of its crew with its crew size there, and it a finished wall or gate of another
/// realm's city, or of none, in contact with the ram.
pub fn ram_problem(
    world: &WorldState,
    r: &Resident,
    m: &SiegeMachine,
    target_id: &str,
) -> Option<String> {
    if m.kind != SiegeMachineKind::Ram {
        return Some(format!("a {} doesn’t ram", machine_name(m.kind)));
    }
    if !is_crew(m, r) {
        return Some("only one of its crew on its tile swings a ram".into());
    }
    if let n @ 1.. = crew_short(world, m) {
        return Some(format!("the ram needs {n} more crew to strike"));
    }
    let wall = match foreign_wall(world, r.owner.as_deref(), target_id) {
        Ok(w) => w,
        Err(e) => return Some(e.into()),
    };
    if let Some(no) = crate::lent::refusal(world, r, &wall.id) {
        return Some(no.into());
    }
    let size = csp_shared::balance::MAP_SIZE;
    // Next to any tile of it: a tower is 2×2 (`CONTEXT.md`: Tower).
    if !near_footprint(placed(wall), (m.x as i32, m.y as i32), m.kind.spec().reach as i32, size) {
        return Some("push the ram next to it first".into());
    }
    None
}

/// The ram order (`ram`): one of a ram's crew swings it at the wall or gate `targetId` next to it,
/// with its whole crew (`CONTEXT.md`: Ram). Pushing it stops while it rams.
pub struct RamAt;

impl RamAt {
    fn check(
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
    ) -> Result<(usize, String, String), String> {
        let Some(i) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Err("not one of your residents".into());
        };
        let Some(m) = str_field(order, "machineId").and_then(|id| machine_by_id(world, id)) else {
            return Err("no such siege machine".into());
        };
        let r = &world.residents[i];
        if r.owner.is_none() || m.realm_id != r.owner {
            return Err(format!("not a {} of your realm", machine_name(m.kind)));
        }
        let target = str_field(order, "targetId").unwrap_or("");
        if let Some(p) = ram_problem(world, r, m, target) {
            return Err(p);
        }
        Ok((i, m.id.clone(), target.to_string()))
    }
}

impl OrderKind for RamAt {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        RamAt::check(world, sender, order).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Ok((i, machine_id, target_id)) = RamAt::check(world, sender, order) else { return };
        for r in &mut world.residents {
            let on_it = match &r.order {
                Some(ResidentOrder::Push(o)) => o.machine_id == machine_id,
                Some(ResidentOrder::Ram(o)) => o.machine_id == machine_id,
                _ => false,
            };
            if on_it {
                r.order = None;
            }
        }
        world.residents[i].order =
            Some(ResidentOrder::Ram(RamOrder { machine_id, target_id, progress: 0.0 }));
    }
}

pub(crate) static RAM_META: OrderMeta =
    OrderMeta::request("ram", &RamAt).adults_only().script(&[RAM_ACTION]);

const RAM_ACTION: ScriptAction = ScriptAction {
    name: "ram",
    group: ActionGroup::Movement,
    request: Request::Fields(&[place("machine", "machineId"), place("wall", "targetId")]),
    cost: 10.0,
    description: "Swing a ram, by it or its id, at the wall or gate next to it, by it or its id: one of another realm's city, or of nobody's. I must be one of its crew on its tile, with at least as many crew as it needs there. It strikes far harder than a blow until the wall falls, and nobody up on a wall reaches its crew under its roof. My order is \"ram\" until then.",
    returns: ScriptType::String,
};

impl RunningOrder for RamOrder {
    in_place!();
    fn ties(&self) -> Ties<'_> {
        // It strikes the wall's owner, as Attack and Climb do (`CONTEXT.md`: Walls in combat).
        Ties { strikes: Some(&self.target_id), falls_with: Some(&self.target_id), ..Ties::NONE }
    }
    no_ties_mut!();
}

/// Resolves this tick's ram strikes (`CONTEXT.md`: Ram, ADR 0002): each ram order that still holds
/// gets `1 / RAM_STRIKE_TICKS` closer to its next strike; a strike raises the alarm as a blow at
/// the wall does and does `RAM_BLOW` to it. A wall or gate that has taken its strength falls,
/// leaving `BROKEN_MATERIALS_RETURNED` of its materials, and breaking another Organization's is a
/// crime of tearing down by whoever swung the last strike. An order that no longer holds ends.
/// Returns the walls and gates that fell.
pub fn resolve_ram_strikes(
    world: &mut WorldState,
    size: i32,
    alarms: &mut dyn Alarms,
    made: &mut GoodsMade,
) -> Vec<Building> {
    let mut broken = Vec::new();
    for i in 0..world.residents.len() {
        let Some(ResidentOrder::Ram(o)) = &world.residents[i].order else { continue };
        let (machine_id, target_id) = (o.machine_id.clone(), o.target_id.clone());
        let holds = machine_by_id(world, &machine_id)
            .is_some_and(|m| ram_problem(world, &world.residents[i], m, &target_id).is_none());
        if !holds {
            world.residents[i].order = None;
            continue;
        }
        let Some(ResidentOrder::Ram(o)) = &mut world.residents[i].order else { continue };
        o.progress += 1.0 / RAM_STRIKE_TICKS;
        if o.progress < 1.0 - 1e-9 {
            continue;
        }
        o.progress = 0.0;
        let attacker_id = world.residents[i].id.clone();
        broken.extend(hit_wall(world, size, alarms, made, &attacker_id, &target_id, RAM_BLOW));
    }
    end_orders_on(world, &broken);
    broken
}

/// One hit of a machine at a wall, gate or tower (`CONTEXT.md`: Ram, Catapult): it raises the
/// alarm as a blow at the wall does and does `blow` to it. One that has taken its strength falls,
/// leaving `BROKEN_MATERIALS_RETURNED` of its materials, and breaking another Organization's is a
/// crime of tearing down by `attacker_id`. Returns it if it fell.
fn hit_wall(
    world: &mut WorldState,
    size: i32,
    alarms: &mut dyn Alarms,
    made: &mut GoodsMade,
    attacker_id: &str,
    target_id: &str,
    blow: f64,
) -> Option<Building> {
    alarms.raise_wall_attacked(world, attacker_id, target_id, size);
    let bi = world.buildings.iter().position(|b| b.id == target_id)?;
    let b = &mut world.buildings[bi];
    b.damage = Some(wall_strength(b).min(b.damage.unwrap_or(0.0) + blow));
    if wall_strength_left(b) > 0.0 {
        return None;
    }
    let against = CrimeAgainst {
        victim_org: building_organization(world, &world.buildings[bi]),
        building: Some(world.buildings[bi].kind),
        ..CrimeAgainst::default()
    };
    commit_crime(world, size, CrimeKind::TearDown, attacker_id, against);
    let b = world.buildings.remove(bi);
    let returned = broken_returns(&b);
    drop_goods(world, b.x, b.y, &returned, size);
    made.note(&returned);
    Some(b)
}

/// Orders at walls and gates that fell this tick end: ramming, throwing at or attacking them.
fn end_orders_on(world: &mut WorldState, broken: &[Building]) {
    let gone: Vec<&str> = broken.iter().map(|b| b.id.as_str()).collect();
    for r in &mut world.residents {
        let on_gone =
            r.order.as_ref().and_then(|o| o.ties().falls_with).is_some_and(|id| gone.contains(&id));
        if on_gone {
            r.order = None;
        }
    }
}

/// Stone a catapult has at hand to throw (`CONTEXT.md`: Catapult): what its crew on its tile carry
/// and what lies in the pile on its tile.
pub fn stone_at_hand(world: &WorldState, m: &SiegeMachine) -> f64 {
    let carried: f64 =
        crew_of(world, m).into_iter().map(|i| held(&world.residents[i].carried, Good::Stone)).sum();
    let piled: f64 = world
        .piles
        .iter()
        .filter(|p| p.x as i32 == m.x as i32 && p.y as i32 == m.y as i32)
        .map(|p| held(&p.goods, Good::Stone))
        .sum();
    carried + piled
}

/// Takes the one Stone a shot throws: from its crew first, in the order they joined, then from the
/// pile on its tile. False if there was none.
fn take_a_stone(world: &mut WorldState, mi: usize) -> bool {
    let m = world.siege_machines[mi].clone();
    for i in crew_of(world, &m) {
        let carried = &mut world.residents[i].carried;
        if held(carried, Good::Stone) >= 1.0 {
            *carried.entry(Good::Stone).or_insert(0.0) -= 1.0;
            carried.retain(|_, n| *n > 0.0);
            return true;
        }
    }
    let pile = world.piles.iter_mut().find(|p| {
        p.x as i32 == m.x as i32 && p.y as i32 == m.y as i32 && held(&p.goods, Good::Stone) >= 1.0
    });
    let Some(pile) = pile else { return false };
    *pile.goods.entry(Good::Stone).or_insert(0.0) -= 1.0;
    pile.goods.retain(|_, n| *n > 0.0);
    world.piles.retain(|p| p.goods.values().any(|n| *n > 0.0));
    true
}

/// Why `r` can't throw with the catapult `m` at the wall, gate or tower `target_id` now
/// (`CONTEXT.md`: Catapult): they must be one of its crew with its crew size there, it a finished
/// wall, gate or tower of another realm's city, or of none, within `CATAPULT_REACH` tiles of it,
/// and a Stone at hand.
pub fn throw_problem(
    world: &WorldState,
    r: &Resident,
    m: &SiegeMachine,
    target_id: &str,
) -> Option<String> {
    if m.kind != SiegeMachineKind::Catapult {
        return Some(format!("a {} doesn’t throw", machine_name(m.kind)));
    }
    if !is_crew(m, r) {
        return Some("only one of its crew on its tile aims a catapult".into());
    }
    if let n @ 1.. = crew_short(world, m) {
        return Some(format!("the catapult needs {n} more crew to shoot"));
    }
    let wall = match foreign_wall(world, r.owner.as_deref(), target_id) {
        Ok(w) => w,
        Err(e) => return Some(e.into()),
    };
    if let Some(no) = crate::lent::refusal(world, r, &wall.id) {
        return Some(no.into());
    }
    if !near_footprint(placed(wall), (m.x as i32, m.y as i32), CATAPULT_REACH as i32, MAP_SIZE) {
        return Some("that is beyond the catapult’s reach".into());
    }
    if stone_at_hand(world, m) < 1.0 {
        return Some("the catapult has no Stone to throw".into());
    }
    None
}

/// The throw order (`throw`): one of a catapult's crew aims it at the wall, gate or tower `targetId`
/// in its reach, with its whole crew (`CONTEXT.md`: Catapult). Pushing it stops while it shoots.
pub struct ThrowAt;

impl ThrowAt {
    fn check(
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
    ) -> Result<(usize, String, String), String> {
        let Some(i) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Err("not one of your residents".into());
        };
        let Some(m) = str_field(order, "machineId").and_then(|id| machine_by_id(world, id)) else {
            return Err("no such siege machine".into());
        };
        let r = &world.residents[i];
        if r.owner.is_none() || m.realm_id != r.owner {
            return Err(format!("not a {} of your realm", machine_name(m.kind)));
        }
        // Aimed at a building, or at a tile of one (`CONTEXT.md`: Catapult).
        let at_tile = match (int_field(order, "x"), int_field(order, "y")) {
            (Some(x), Some(y)) => {
                crate::queries::building::building_at(world, x as i32, y as i32, MAP_SIZE)
            }
            _ => None,
        };
        let target = str_field(order, "targetId").or(at_tile.map(|b| b.id.as_str())).unwrap_or("");
        if let Some(p) = throw_problem(world, r, m, target) {
            return Err(p);
        }
        Ok((i, m.id.clone(), target.to_string()))
    }
}

impl OrderKind for ThrowAt {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        ThrowAt::check(world, sender, order).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let Ok((i, machine_id, target_id)) = ThrowAt::check(world, sender, order) else { return };
        for r in &mut world.residents {
            let on_it = match &r.order {
                Some(ResidentOrder::Push(o)) => o.machine_id == machine_id,
                Some(ResidentOrder::Throw(o)) => o.machine_id == machine_id,
                _ => false,
            };
            if on_it {
                r.order = None;
            }
        }
        world.residents[i].order =
            Some(ResidentOrder::Throw(ThrowOrder { machine_id, target_id, progress: 0.0 }));
    }
}

pub(crate) static THROW_META: OrderMeta =
    OrderMeta::request("throw", &ThrowAt).adults_only().script(&[THROW_ACTION]);

const THROW_ACTION: ScriptAction = ScriptAction {
    name: "throw",
    group: ActionGroup::Movement,
    request: Request::ByHand(&["machine", "wallOrX", "y?"]),
    cost: 10.0,
    description: "Shoot a catapult, by it or its id, at a wall, gate or tower within its reach: by it or its id, or by the tile x, y of it. It must be one of another realm's city, or of nobody's. I must be one of its crew on its tile, with at least as many crew as it needs there. Each shot throws one Stone that its crew carry or that lies on its tile; out of Stone it stops. It hits only the building, never anyone. My order is \"throw\" until the wall falls.",
    returns: ScriptType::String,
};

impl RunningOrder for ThrowOrder {
    in_place!();
    fn ties(&self) -> Ties<'_> {
        // It strikes the wall's owner, as Attack and Climb do (`CONTEXT.md`: Walls in combat).
        Ties { strikes: Some(&self.target_id), falls_with: Some(&self.target_id), ..Ties::NONE }
    }
    no_ties_mut!();
}

/// Resolves this tick's catapult shots (`CONTEXT.md`: Catapult, ADR 0002): each throw order that
/// still holds gets `1 / CATAPULT_SHOT_TICKS` closer to its next shot; a shot takes one Stone and
/// hits the wall, gate or tower for `CATAPULT_BLOW`, as a ram's strike does (`hit_wall`). It hits
/// buildings only: nobody standing by takes anything. An order that no longer holds (out of Stone,
/// say) ends. Returns the walls and gates that fell.
pub fn resolve_catapult_shots(
    world: &mut WorldState,
    size: i32,
    alarms: &mut dyn Alarms,
    made: &mut GoodsMade,
) -> Vec<Building> {
    let mut broken = Vec::new();
    for i in 0..world.residents.len() {
        let Some(ResidentOrder::Throw(o)) = &world.residents[i].order else { continue };
        let (machine_id, target_id) = (o.machine_id.clone(), o.target_id.clone());
        let mi = machine_index(world, &machine_id).filter(|&mi| {
            throw_problem(world, &world.residents[i], &world.siege_machines[mi], &target_id)
                .is_none()
        });
        let Some(mi) = mi else {
            world.residents[i].order = None;
            continue;
        };
        let Some(ResidentOrder::Throw(o)) = &mut world.residents[i].order else { continue };
        o.progress += 1.0 / CATAPULT_SHOT_TICKS;
        if o.progress < 1.0 - 1e-9 {
            continue;
        }
        o.progress = 0.0;
        if !take_a_stone(world, mi) {
            world.residents[i].order = None;
            continue;
        }
        if stone_at_hand(world, &world.siege_machines[mi]) < 1.0 {
            world.residents[i].order = None;
        }
        let attacker_id = world.residents[i].id.clone();
        broken.extend(hit_wall(world, size, alarms, made, &attacker_id, &target_id, CATAPULT_BLOW));
    }
    end_orders_on(world, &broken);
    broken
}

/// Whether ground `terrain` takes a pushed machine (where a carriage could go).
pub fn machine_can_enter(terrain: u8) -> bool {
    carriage_can_enter(terrain)
}

/// A realm that ended leaves its machines to nobody: none of its residents crews them any more.
pub fn end_realm_machines(world: &mut WorldState, realm_id: &str) {
    for m in &mut world.siege_machines {
        if m.realm_id.as_deref() == Some(realm_id) {
            m.realm_id = None;
            m.crew_ids.clear();
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod strike_tests;

#[cfg(test)]
mod catapult_tests;

#[cfg(test)]
mod tower_tests;
