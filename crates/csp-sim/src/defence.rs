//! Defence scripts (`CONTEXT.md`: Defence script, A Player's order under attack, On a carriage
//! under attack; ADR 0015), ported from `apps/server/src/defence.ts`. A blow that leaves a Player's
//! resident alive starts their defence script, the Defend default, which runs as `script` like any
//! other; what they were doing is kept aside in `interrupted`, and when the defence script ends
//! they go on with it.
//!
//! Alarms (`alarms.ts`, ADR 0028) are raised through the [`Alarms`] trait, which the script
//! ticket (T86.12) implements; [`NoAlarms`] raises none.

use csp_shared::balance::DEFEND_CALM_TICKS;
use csp_shared::world::{
    GivenUnderAttack, HaulPhase, Interrupted, InterruptedAlarm, Resident, ResidentOrder,
    RunningScript, Task, WorldState,
};

use crate::queries::alliance::commander_of;
use crate::queries::carriages::{driven_carriage_id, horse_for};
use crate::queries::residents::is_down;
use crate::sight::InvariantViolation;

/// The alarm entry points the conflict rules call (`raiseWallAttacked`, `raiseResidentAttacked`,
/// `raiseOccupied` of `alarms.ts`). Each changes the world as the TypeScript does; the default
/// methods raise nothing.
pub trait Alarms {
    /// `a`'s blow at the wall or gate `wall_id` raises an `attacked` alarm in its city.
    fn raise_wall_attacked(
        &mut self,
        _world: &mut WorldState,
        _attacker_id: &str,
        _wall_id: &str,
        _size: i32,
    ) {
    }
    /// `a`'s blow at `target_id` raises an `attacked` alarm in each city of the target's
    /// Organization whose area they stand in.
    fn raise_resident_attacked(
        &mut self,
        _world: &mut WorldState,
        _attacker_id: &str,
        _target_id: &str,
        _size: i32,
    ) {
    }
    /// An occupation of `city_id`'s town hall by `occupier` just started.
    fn raise_occupied(
        &mut self,
        _world: &mut WorldState,
        _city_id: &str,
        _occupier: &str,
        _size: i32,
    ) {
    }
}

/// Raises no alarm: for worlds and tests without the alarm rules.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoAlarms;

impl Alarms for NoAlarms {}

/// Whether a struck resident reacts by their defence script (`defendsByScript`): one a realm
/// commands, outside an army.
pub fn defends_by_script(world: &WorldState, t: &Resident) -> bool {
    commander_of(world, &t.id, t.owner.as_deref()).is_some()
        && !world.armies.iter().any(|a| a.member_ids.contains(&t.id))
}

/// Starts the defence script of the resident at `i`, keeping what they were doing aside
/// (`startDefence`); not again while one runs, nor over what the Player gave them under attack
/// while that holds. An Alarm script running is kept aside in turn.
pub fn start_defence(world: &mut WorldState, i: usize) {
    let picked = {
        let t = &world.residents[i];
        let commander = commander_of(world, &t.id, t.owner.as_deref());
        if commander.is_some() && commander == t.owner {
            t.defence_script_id
        } else {
            None
        }
    };
    let t = &mut world.residents[i];
    let alarm = t.script.as_ref().filter(|s| s.task == Some(Task::Alarm)).cloned();
    if (t.interrupted.is_some() && alarm.is_none()) || t.given_under_attack.is_some() {
        return;
    }
    // Being struck ends a wait: back, it runs again.
    if let Some(s) = &mut t.script {
        s.waiting_since = None;
    }
    let alarm = t.script.as_ref().filter(|s| s.task == Some(Task::Alarm)).cloned();
    t.interrupted = Some(match (alarm, t.interrupted.take()) {
        (Some(alarm), Some(mut under)) => {
            under.alarm = Some(InterruptedAlarm { order: t.order.clone(), script: alarm });
            under
        }
        (_, _) => Interrupted { order: t.order.clone(), script: t.script.clone(), alarm: None },
    });
    // A driver goes on driving until their defence script says otherwise.
    if driven_carriage_id(t).is_none() {
        t.order = None;
    }
    t.script = Some(RunningScript {
        script_id: picked.unwrap_or(0),
        task: Some(Task::Defend),
        memory: Default::default(),
        settings_from: None,
        error_logged_at: None,
        budget_logged_at: None,
        last_error: None,
        last_run: None,
        waiting_since: None,
        alarm: None,
        alarm_under: None,
    });
}

/// Whether `now` is the order `kept` was, as the TypeScript's `r.order !== kept.order` tells by
/// identity. A drive or haul route a defence script never took them off goes on in place, so it
/// is the same order however far it has come since; any other order is the same when equal.
fn same_order(now: Option<&ResidentOrder>, kept: Option<&ResidentOrder>) -> bool {
    match (now, kept) {
        (Some(ResidentOrder::Drive(a)), Some(ResidentOrder::Drive(b))) => {
            a.carriage_id == b.carriage_id
                && a.target == b.target
                && a.army == b.army
                && a.near == b.near
        }
        (Some(ResidentOrder::Haul(a)), Some(ResidentOrder::Haul(b))) => {
            a.carriage_id == b.carriage_id
                && a.from == b.from
                && a.to == b.to
                && a.to_army == b.to_army
                && a.goods == b.goods
                && a.return_goods == b.return_goods
                && a.keep_food == b.keep_food
        }
        (Some(ResidentOrder::HaulByWater(a)), Some(ResidentOrder::HaulByWater(b))) => {
            a.vessel_id == b.vessel_id
                && a.from == b.from
                && a.to == b.to
                && a.goods == b.goods
                && a.return_goods == b.return_goods
                && a.keep_food == b.keep_food
        }
        _ => now == kept,
    }
}

/// The order kept aside, to go on from where the resident at `i` stands now (`orderGoingOn`): on
/// its way, it finds its way again. A drive or haul route ends if its driver isn't with the
/// carriage any more, someone else drives it now, or its horse is Down or gone.
fn order_going_on(world: &WorldState, i: usize, o: Option<ResidentOrder>) -> Option<ResidentOrder> {
    let mut o = o?;
    clear_path(&mut o);
    let r = &world.residents[i];
    let id = match &o {
        ResidentOrder::Drive(d) => d.carriage_id.clone(),
        ResidentOrder::Haul(h) => h.carriage_id.clone(),
        // A haul route by water rowing on needs its rower still at the oars (`CONTEXT.md`:
        // Rowing); at a stop it goes on from where they stand, or ends there.
        ResidentOrder::HaulByWater(h) => {
            let at_oars = world.vessels.iter().any(|v| {
                v.id == h.vessel_id
                    && v.rower_id.as_deref() == Some(r.id.as_str())
                    && r.aboard.as_deref() == Some(v.id.as_str())
            });
            return (h.phase == HaulPhase::Loading || at_oars).then_some(o);
        }
        _ => return Some(o),
    };
    let carriage = world.carriages.iter().find(|k| k.id == id)?;
    if carriage.x != r.x || carriage.y != r.y {
        return None;
    }
    if world
        .residents
        .iter()
        .enumerate()
        .any(|(j, x)| j != i && driven_carriage_id(x) == Some(id.as_str()))
    {
        return None;
    }
    let horse = horse_for(world, carriage)?;
    if is_down(horse.down_until) {
        None
    } else {
        Some(o)
    }
}

/// `if ('path' in o && o.path) Object.assign(o, { path: null, progress: 0 })`.
fn clear_path(o: &mut ResidentOrder) {
    macro_rules! clear {
        ($x:expr) => {
            if $x.path.is_some() {
                $x.path = None;
                $x.progress = 0.0;
            }
        };
    }
    match o {
        ResidentOrder::WalkTo(x) => clear!(x),
        ResidentOrder::Drive(x) => clear!(x),
        ResidentOrder::Haul(x) => clear!(x),
        ResidentOrder::HaulByWater(x) => clear!(x),
        ResidentOrder::Store(x) => clear!(x),
        ResidentOrder::Fetch(x) => clear!(x),
        ResidentOrder::Attack(x) => clear!(x),
        ResidentOrder::RoadLine(x) | ResidentOrder::WallLine(x) => clear!(x),
        ResidentOrder::Relocate(x) => clear!(x),
        _ => {}
    }
}

/// The defence script ended (`resumeInterrupted`): what it interrupted goes on, the script with
/// its memory, the order where it was. An Alarm script it kept aside goes on first. The same for
/// an Alarm script that ended. False when neither ran.
pub fn resume_interrupted(world: &mut WorldState, i: usize) -> bool {
    let Some(mut kept) = world.residents[i].interrupted.take() else { return false };
    if let Some(alarm) = kept.alarm.take() {
        world.residents[i].interrupted = Some(kept);
        if !same_order(world.residents[i].order.as_ref(), alarm.order.as_ref()) {
            world.residents[i].order = order_going_on(world, i, alarm.order);
        }
        world.residents[i].script = Some(alarm.script);
        return true;
    }
    if !same_order(world.residents[i].order.as_ref(), kept.order.as_ref()) {
        world.residents[i].order = order_going_on(world, i, kept.order);
    }
    world.residents[i].script = kept.script;
    true
}

/// The order kinds that go on until stopped (`GOES_ON_UNTIL_STOPPED`).
fn goes_on_until_stopped(o: &ResidentOrder) -> bool {
    matches!(
        o,
        ResidentOrder::Haul(_)
            | ResidentOrder::HaulByWater(_)
            | ResidentOrder::WorkAt(_)
            | ResidentOrder::Teach(_)
            | ResidentOrder::Train(_)
    )
}

/// Whether `r` counts as under attack for an order given now (`underAttack`): their defence script
/// runs, or the last blow is within the calm time Defend waits for.
pub fn under_attack(world: &WorldState, r: &Resident) -> bool {
    if r.interrupted.is_some() && r.script.as_ref().and_then(|s| s.task) != Some(Task::Alarm) {
        return true;
    }
    r.struck.as_ref().is_some_and(|s| (world.tick as f64) - s.tick < DEFEND_CALM_TICKS)
}

/// A Player's order was just applied to the resident at `i`, who had `order_before` and was
/// `was_under_attack` (`noteGiven`): marks what it gave them, if it holds against further blows.
/// Only an order that replaced what they do counts (by identity in the TypeScript: here, an
/// order unequal to the one before).
pub fn note_given(
    world: &mut WorldState,
    i: usize,
    was_under_attack: bool,
    order_before: Option<&ResidentOrder>,
) {
    let r = &world.residents[i];
    if r.order.as_ref() == order_before && r.script.is_none() && r.queue.is_none() {
        return;
    }
    let defends = defends_by_script(world, r);
    let r = &mut world.residents[i];
    r.given_under_attack = None;
    if !was_under_attack || !defends {
        return;
    }
    if r.script.is_some()
        || r.queue.is_some()
        || r.order.as_ref().is_some_and(goes_on_until_stopped)
    {
        r.given_under_attack = Some(GivenUnderAttack::UntilCalm);
    } else if r.order.is_some() {
        r.given_under_attack = Some(GivenUnderAttack::UntilDone);
    }
}

/// A blow is coming at `r`, before it counts as their last (`endHoldIfOver`): what the Player gave
/// them under attack no longer holds if nothing of it goes on, or if it is to hold until calm and
/// no blow has landed for the calm time.
pub fn end_hold_if_over(tick: u64, r: &mut Resident) {
    let Some(given) = r.given_under_attack else { return };
    let goes_on = r.order.is_some() || r.script.is_some() || r.queue.is_some();
    let calm = given == GivenUnderAttack::UntilCalm
        && r.struck.as_ref().is_none_or(|s| (tick as f64) - s.tick >= DEFEND_CALM_TICKS);
    if !goes_on || calm {
        r.given_under_attack = None;
    }
}

fn violations(name: &str, ids: impl Iterator<Item = (String, String)>) -> Vec<InvariantViolation> {
    ids.map(|(id, message)| InvariantViolation {
        invariant: name.into(),
        message,
        entity_ids: vec![id],
    })
    .collect()
}

/// Invariant (`givenUnderAttackSound`): a resident whose order is marked as standing has no
/// defence script running and nothing kept in `interrupted`.
pub fn given_under_attack_sound(world: &WorldState) -> Vec<InvariantViolation> {
    violations(
        "given-under-attack-sound",
        world
            .residents
            .iter()
            .filter(|r| {
                r.given_under_attack.is_some()
                    && (r.interrupted.is_some()
                        || r.script.as_ref().and_then(|s| s.task) == Some(Task::Defend))
            })
            .map(|r| {
                (
                    r.id.clone(),
                    format!(
                        "{} has an order standing under attack but runs their defence script",
                        r.id
                    ),
                )
            }),
    )
}

/// Invariant (`interruptedSound`): a resident with something kept aside in `interrupted` is
/// running their defence or Alarm script.
pub fn interrupted_sound(world: &WorldState) -> Vec<InvariantViolation> {
    violations(
        "interrupted-runs-defence",
        world
            .residents
            .iter()
            .filter(|r| {
                let task = r.script.as_ref().and_then(|s| s.task);
                r.interrupted.is_some() && task != Some(Task::Defend) && task != Some(Task::Alarm)
            })
            .map(|r| {
                (
                    r.id.clone(),
                    format!(
                        "{} has something interrupted but runs no defence or Alarm script",
                        r.id
                    ),
                )
            }),
    )
}

/// Invariant (`struckDriverDrivesOn`): a driver struck this tick, whose Defend default hasn't run
/// yet, still drives: their drive or haul route is kept aside and goes on.
pub fn struck_driver_drives_on(world: &WorldState) -> Vec<InvariantViolation> {
    let kept_driven = |r: &Resident| match r.interrupted.as_ref().and_then(|k| k.order.as_ref()) {
        Some(ResidentOrder::Drive(o)) => Some(o.carriage_id.clone()),
        Some(ResidentOrder::Haul(o)) => Some(o.carriage_id.clone()),
        _ => None,
    };
    violations(
        "struck-driver-drives-on",
        world
            .residents
            .iter()
            .filter(|r| {
                r.script.as_ref().is_some_and(|s| s.task == Some(Task::Defend) && s.script_id == 0)
                    && r.struck.as_ref().is_some_and(|s| s.tick == world.tick as f64 - 1.0)
                    && kept_driven(r).is_some_and(|k| driven_carriage_id(r) != Some(k.as_str()))
            })
            .map(|r| {
                (
                    r.id.clone(),
                    format!(
                        "{} was struck driving and no longer drives before Defend decided",
                        r.id
                    ),
                )
            }),
    )
}

/// Invariant (`defenceScriptSound`): a resident's picked defence script is a whole positive
/// number. A `u64` is whole by its type, so only 0 can break it here.
pub fn defence_script_sound(world: &WorldState) -> Vec<InvariantViolation> {
    violations(
        "defence-script-sound",
        world.residents.iter().filter(|r| r.defence_script_id == Some(0)).map(|r| {
            (r.id.clone(), format!("{} keeps defence script 0, which can't be one", r.id))
        }),
    )
}

#[cfg(test)]
mod tests;
