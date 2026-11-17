//! Siege machines (`CONTEXT.md`: Siege machine, ADR 0037): a ram is laid out and built in the field
//! as a construction site (`building.rs`); finished, it stands as a machine of the finisher's
//! realm. Residents of its realm join its **crew** by walking onto its tile (the crew order), and
//! with at least its crew size there one of them **pushes** it, slowly, along a way a carriage
//! could take, the crew walking with it (the push order; the steps are taken by `walking.rs`). It
//! is broken by blows like a wall (`combat.rs`) and torn down by its realm (`teardown.rs`).

use csp_shared::balance::{
    carriage_can_enter, BROKEN_MATERIALS_RETURNED, CARRIAGE_SPEED, RAM_BLOW, RAM_CREW,
    RAM_STRENGTH, RAM_STRIKE_TICKS, SIEGE_PUSH_SHARE, TEARDOWN_MATERIALS_RETURNED,
    TEARDOWN_WORK_SHARE, WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, CrewOrder, CrimeKind, OrderRequest, PushOrder, RamOrder, Resident,
    ResidentOrder, SiegeMachine, SiegeMachineKind, Stock, Tile, WorldState,
};

use crate::crimes::{building_organization, commit_crime, CrimeAgainst};
use crate::defence::Alarms;
use crate::goods_made::GoodsMade;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::queries::building::{build_materials_of, build_work_for};
use crate::queries::combat::in_contact;
use crate::queries::driving::carriage_can_go_to;
use crate::queries::residents::{can_work, is_down};
use crate::queries::walls::{broken_returns, foreign_wall, wall_strength, wall_strength_left};
use crate::survival::drop_goods;

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
            Some(ResidentOrder::Ram(o)) => match machine_by_id(world, &o.machine_id) {
                None => true,
                Some(m) => ram_problem(world, &world.residents[i], m, &o.target_id).is_some(),
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
    let size = csp_shared::balance::MAP_SIZE;
    if !in_contact(size, (m.x as i32, m.y as i32), (wall.x as i32, wall.y as i32)) {
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
        alarms.raise_wall_attacked(world, &attacker_id, &target_id, size);
        let Some(bi) = world.buildings.iter().position(|b| b.id == target_id) else { continue };
        let b = &mut world.buildings[bi];
        b.damage = Some(wall_strength(b).min(b.damage.unwrap_or(0.0) + RAM_BLOW));
        if wall_strength_left(b) > 0.0 {
            continue;
        }
        let against = CrimeAgainst {
            victim_org: building_organization(world, &world.buildings[bi]),
            building: Some(world.buildings[bi].kind),
            ..CrimeAgainst::default()
        };
        commit_crime(world, size, CrimeKind::TearDown, &attacker_id, against);
        let b = world.buildings.remove(bi);
        let returned = broken_returns(&b);
        drop_goods(world, b.x, b.y, &returned, size);
        made.note(&returned);
        broken.push(b);
    }
    let gone: Vec<&str> = broken.iter().map(|b| b.id.as_str()).collect();
    for r in &mut world.residents {
        let on_gone = match &r.order {
            Some(ResidentOrder::Ram(o)) => gone.contains(&o.target_id.as_str()),
            Some(ResidentOrder::Attack(o)) => gone.contains(&o.target_id.as_str()),
            _ => false,
        };
        if on_gone {
            r.order = None;
        }
    }
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
