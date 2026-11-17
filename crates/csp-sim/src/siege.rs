//! Siege machines (`CONTEXT.md`: Siege machine, ADR 0037): a ram is laid out and built in the field
//! as a construction site (`building.rs`); finished, it stands as a machine of the finisher's
//! realm. Residents of its realm join its **crew** by walking onto its tile (the crew order), and
//! with at least its crew size there one of them **pushes** it, slowly, along a way a carriage
//! could take, the crew walking with it (the push order; the steps are taken by `walking.rs`). It
//! is broken by blows like a wall (`combat.rs`) and torn down by its realm (`teardown.rs`).

use csp_shared::balance::{
    carriage_can_enter, BROKEN_MATERIALS_RETURNED, CARRIAGE_SPEED, RAM_CREW, RAM_STRENGTH,
    SIEGE_PUSH_SHARE, TEARDOWN_MATERIALS_RETURNED, TEARDOWN_WORK_SHARE, WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, CrewOrder, OrderRequest, PushOrder, Resident, ResidentOrder, SiegeMachine,
    SiegeMachineKind, Stock, Tile, WorldState,
};

use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::queries::building::{build_materials_of, build_work_for};
use crate::queries::driving::carriage_can_go_to;
use crate::queries::residents::{can_work, is_down};

/// The site kind a machine of `kind` is built from.
pub fn site_kind(kind: SiegeMachineKind) -> BuildingKind {
    match kind {
        SiegeMachineKind::Ram => BuildingKind::Ram,
    }
}

/// The machine a finished site of `kind` becomes, if it is a siege machine's.
pub fn machine_kind(kind: BuildingKind) -> Option<SiegeMachineKind> {
    match kind {
        BuildingKind::Ram => Some(SiegeMachineKind::Ram),
        _ => None,
    }
}

/// The machine's name, as the Player reads it.
pub fn machine_name(kind: SiegeMachineKind) -> &'static str {
    match kind {
        SiegeMachineKind::Ram => "ram",
    }
}

/// The fewest crew on its tile for a machine to be pushed (`RAM_CREW`).
pub fn crew_needed(kind: SiegeMachineKind) -> usize {
    match kind {
        SiegeMachineKind::Ram => RAM_CREW as usize,
    }
}

/// Damage a machine takes before it breaks (`RAM_STRENGTH`).
pub fn machine_strength(kind: SiegeMachineKind) -> f64 {
    match kind {
        SiegeMachineKind::Ram => RAM_STRENGTH,
    }
}

/// What a machine is built of: its site's materials.
pub fn machine_materials(kind: SiegeMachineKind) -> Stock {
    build_materials_of(site_kind(kind), None)
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
    build_work_for(site_kind(kind), None) * TEARDOWN_WORK_SHARE
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
            _ => false,
        };
        if ends {
            world.residents[i].order = None;
        }
    }
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
