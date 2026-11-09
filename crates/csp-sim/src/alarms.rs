//! Alarms (`apps/server/src/alarms.ts`, `CONTEXT.md`: Alarm, Alarm script; ADR 0028). Something
//! happening in a City area starts the Alarm script of its realm's residents at home. It runs as
//! `script` like any other, holding the alarm for `me.alarm`, with what they were doing kept aside
//! in `interrupted` as for a defence script (ADR 0015). A blow still starts the defence script,
//! which keeps the Alarm script aside in turn and hands back to it. NPC villages, towns and
//! self-managed cities run the same for their armed residents, with the game's default only.
//!
//! [`GameAlarms`] is T86.7's [`Alarms`] trait for the conflict rules.

use csp_shared::balance::{DEFEND_CALM_TICKS, SIGHT_RANGE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Alarm, AlarmKind, AlarmScriptId, City, CityJobKind, Interrupted, Resident, ResidentOrder,
    RunningScript, Task, WorldState,
};
use serde_json::json;

use crate::crimes::{city_organization, organization_of};
use crate::defence::{end_hold_if_over, Alarms};
use crate::queries::alliance::commander_of;
use crate::queries::carriages::driven_carriage_id;
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{in_city_area, occupiers_of};
use crate::queries::names::placed;
use crate::queries::residents::{is_armed, is_down};
use crate::queries::standing::TRADE_ORG;
use crate::sight::InvariantViolation;

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

use crate::caravans::caravan_crew;
use crate::queries::trade_org::punishers;

/// The residents an NPC city's plan sends founding (`foundingParty`).
// TODO(T86.10): `npc_founding::founding_party`.
fn founding_party(world: &WorldState, city_id: &str) -> Vec<String> {
    world.city_plans.get(city_id).map_or_else(Vec::new, |plan| {
        plan.jobs
            .iter()
            .filter(|(_, j)| j.kind == CityJobKind::Found)
            .map(|(id, _)| id.clone())
            .collect()
    })
}

/// Whether `r` of an NPC city goes by something other than their city (`runApart`): a caravan, a
/// punishment or a founding, which would give them orders over their Alarm script's.
fn run_apart(world: &WorldState, city: &City, r: &Resident) -> bool {
    if city.realm_id.is_some() {
        return false;
    }
    founding_party(world, &city.id).contains(&r.id)
        || caravan_crew(world).contains(&r.id)
        || punishers(world).contains(&r.id)
}

/// Whether an alarm can reach `r`, of the city's Organization and in its area (`canBeAlarmed`):
/// army members, those hired out and those driving a carriage get none. Nor do those Down, or on
/// a wall they are climbing. A trading post's and the HQ's keep their own rules, and those an NPC
/// city doesn't run itself get none.
fn can_be_alarmed(world: &WorldState, city: &City, r: &Resident, size: i32) -> bool {
    city.trade_org.is_none()
        && organization_of(r) == Some(city_organization(city))
        && commander_of(world, &r.id, r.owner.as_deref()) == r.owner
        && in_city_area(world, &city.id, r.x, r.y, size)
        && driven_carriage_id(r).is_none()
        && !matches!(r.order, Some(ResidentOrder::Climb(_)))
        && !is_down(r.down_until)
        && !world.armies.iter().any(|a| a.member_ids.contains(&r.id))
        && !run_apart(world, city, r)
}

/// Whether `r` runs the Alarm default as their NPC city's (`runsNpcAlarm`): one of a city that
/// has no realm and isn't the Trade Organization's, so nobody else is to end it.
pub fn runs_npc_alarm(world: &WorldState, r: &Resident) -> bool {
    let alarm_default =
        r.script.as_ref().is_some_and(|s| s.task == Some(Task::Alarm) && s.script_id == 0);
    if r.owner.is_some() || !alarm_default {
        return false;
    }
    world
        .cities
        .iter()
        .find(|c| Some(&c.id) == r.city_id.as_ref())
        .is_some_and(|c| c.realm_id.is_none() && c.trade_org.is_none())
}

/// Whether `alarm` takes over from the alarm `t`'s Alarm script runs for (`takesOver`): an
/// occupation from any other, and a theft or an attack from an outsider, unless they are already
/// attacking someone.
fn takes_over(t: &Resident, running: &Alarm, alarm: &Alarm) -> bool {
    if alarm.kind == AlarmKind::Occupied {
        return running.kind != AlarmKind::Occupied;
    }
    if alarm.kind == AlarmKind::Outsider || running.kind != AlarmKind::Outsider {
        return false;
    }
    !matches!(t.order, Some(ResidentOrder::Attack(_)))
}

/// Starts the Alarm script of the resident at `i` for `alarm`, keeping what they were doing aside
/// (`startAlarm`, `CONTEXT.md`: Alarm script): the script their Player picked, else, for an armed
/// resident, the Alarm default of their realm (script id 0, which the runner resolves); for None
/// or unarmed with none picked, nothing. Not while a defence script runs, or over what the Player
/// gave them under attack, while that holds. Nor while an Alarm script runs, unless the new alarm
/// takes over from its alarm: the script goes on with its memory, for the new alarm.
pub fn start_alarm(world: &mut WorldState, i: usize, alarm: &Alarm) {
    let tick = world.tick;
    let t = &world.residents[i];
    let commanded = commander_of(world, &t.id, t.owner.as_deref()).is_some();
    let picked = if commanded { t.alarm_script_id.clone() } else { None };
    let picked = match picked {
        Some(AlarmScriptId::Off(_)) => return,
        Some(AlarmScriptId::Script(id)) => Some(id),
        None if !is_armed(&t.carried) => return,
        None => None,
    };
    let t = &mut world.residents[i];
    end_hold_if_over(tick, t);
    let running_alarm =
        t.script.as_ref().filter(|s| s.task == Some(Task::Alarm)).and_then(|s| s.alarm.clone());
    if let Some(running) = running_alarm {
        if takes_over(t, &running, alarm) {
            let s = t.script.as_mut().expect("an Alarm script runs");
            let under = if running.kind == AlarmKind::Outsider {
                Some(running)
            } else {
                s.alarm_under.clone()
            };
            if under.is_some() {
                s.alarm_under = under;
            }
            s.alarm = Some(alarm.clone());
            s.waiting_since = None;
            t.order = None;
            return;
        }
    }
    if t.interrupted.is_some() || t.given_under_attack.is_some() {
        return;
    }
    if let Some(s) = &mut t.script {
        s.waiting_since = None;
    }
    t.interrupted =
        Some(Interrupted { order: t.order.take(), script: t.script.take(), alarm: None });
    let script: RunningScript = serde_json::from_value(json!({
        "scriptId": picked.unwrap_or(0), "task": "alarm", "memory": {}, "alarm": alarm
    }))
    .expect("an Alarm script");
    t.script = Some(script);
}

/// The resident at `i`'s Alarm script called `end()` (`backToOutsiderAlarm`): if its alarm took
/// over from an outsider alarm, the script goes on for that one, with its memory, and those
/// holding the hall go back to it. False if there is none to go back to, and it really ends.
pub fn back_to_outsider_alarm(r: &mut Resident) -> bool {
    let Some(s) = r.script.as_mut() else { return false };
    let Some(under) = s.alarm_under.take() else { return false };
    s.alarm = Some(under);
    r.order = None;
    true
}

fn alarm(kind: AlarmKind, city: &City, about: &Resident, x: f64, y: f64, tick: u64) -> Alarm {
    Alarm {
        kind,
        city_id: city.id.clone(),
        about: about.id.clone(),
        realm_id: about.owner.clone(),
        x,
        y,
        tick: tick as f64,
    }
}

/// Starts `alarm` for everyone of `who` (indices) it reaches.
fn start_for(world: &mut WorldState, who: Vec<usize>, alarm: &Alarm) {
    for i in who {
        start_alarm(world, i, alarm);
    }
}

/// An occupation of `city`'s town hall by `occupier` just started (`raiseOccupied`): it reaches
/// all its residents in its area, whoever sees it or not.
pub fn raise_occupied(world: &mut WorldState, city_id: &str, occupier: &str, size: i32) {
    let Some(city) = world.cities.iter().find(|c| c.id == city_id).cloned() else { return };
    let Some(hall) = town_hall_of(world, &city).cloned() else { return };
    // Occupying takes someone armed there, so there is one to name; the Trade Org's are of no realm.
    let someone = world.residents.iter().find(|r| {
        is_armed(&r.carried)
            && is_at(tile(r.x, r.y), placed(&hall), size)
            && (r.owner.as_deref() == Some(occupier) || occupier == TRADE_ORG)
    });
    let Some(someone) = someone else { return };
    let a = Alarm {
        kind: AlarmKind::Occupied,
        city_id: city.id.clone(),
        about: someone.id.clone(),
        realm_id: Some(occupier.to_string()),
        x: hall.x,
        y: hall.y,
        tick: world.tick as f64,
    };
    let who = (0..world.residents.len())
        .filter(|&i| can_be_alarmed(world, &city, &world.residents[i], size))
        .collect();
    start_for(world, who, &a);
}

/// `who`, an outsider, just came into `city`'s area (`raiseOutsider`): it reaches its residents in
/// its area who see them, within sight range themselves, but for those already attacking someone.
pub fn raise_outsider(world: &mut WorldState, city_id: &str, who_id: &str, size: i32) {
    let Some(city) = world.cities.iter().find(|c| c.id == city_id).cloned() else { return };
    let Some(who) = world.residents.iter().find(|r| r.id == who_id).cloned() else { return };
    let org = city_organization(&city).to_string();
    let a = alarm(AlarmKind::Outsider, &city, &who, who.x, who.y, world.tick);
    let reached = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            organization_of(r) == Some(org.as_str())
                && wrap_distance(size, tile(r.x, r.y), tile(who.x, who.y)) <= SIGHT_RANGE
                && !matches!(r.order, Some(ResidentOrder::Attack(_)))
                && can_be_alarmed(world, &city, r, size)
        })
        .collect();
    start_for(world, reached, &a);
}

/// `a` just attacked something of the city at `at` (`raiseAttacked`): a wall or gate, or `struck`,
/// a resident of its Organization standing in its area. It reaches those at home who see it,
/// leaving alone those already fighting. Raised once per attacker while their blows keep coming.
fn raise_attacked(
    world: &mut WorldState,
    city_id: &str,
    a: &Resident,
    at: (f64, f64),
    struck: Option<&str>,
    size: i32,
) {
    let tick = world.tick as f64;
    let Some(ci) = world.cities.iter().position(|c| c.id == city_id) else { return };
    let raised = world.cities[ci].alarmed_attackers.as_ref().and_then(|m| m.get(&a.id)).copied();
    if raised.is_some_and(|r| tick - r < DEFEND_CALM_TICKS) {
        world.cities[ci].alarmed_attackers.as_mut().expect("raised").insert(a.id.clone(), tick);
        return;
    }
    let city = world.cities[ci].clone();
    let org = city_organization(&city).to_string();
    let witnesses: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            Some(r.id.as_str()) != struck
                && organization_of(r) == Some(org.as_str())
                && wrap_distance(size, tile(r.x, r.y), tile(at.0, at.1)) <= SIGHT_RANGE
                && can_be_alarmed(world, &city, r, size)
        })
        .collect();
    if witnesses.is_empty() {
        return;
    }
    let mut fresh: indexmap::IndexMap<String, f64> = city
        .alarmed_attackers
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, t)| tick - t < DEFEND_CALM_TICKS)
        .collect();
    fresh.insert(a.id.clone(), tick);
    world.cities[ci].alarmed_attackers = Some(fresh);
    let al = alarm(AlarmKind::Attacked, &city, a, at.0, at.1, world.tick);
    let reached = witnesses
        .into_iter()
        .filter(|&i| !matches!(world.residents[i].order, Some(ResidentOrder::Attack(_))))
        .collect();
    start_for(world, reached, &al);
}

/// Whether `a`'s blow is an attack on the Organization `org` (`attacksOrganization`): a blow
/// struck in fighting back is none, nor is one by someone of that Organization.
fn attacks_organization(a: &Resident, org: Option<&str>) -> bool {
    let Some(org) = org else { return false };
    if organization_of(a) == Some(org) {
        return false;
    }
    !matches!(&a.order, Some(ResidentOrder::Attack(o)) if o.defending == Some(true))
}

/// `a`'s blow at the wall or gate `wall_id` raises an `attacked` alarm in its city
/// (`raiseWallAttacked`).
pub fn raise_wall_attacked(world: &mut WorldState, attacker_id: &str, wall_id: &str, size: i32) {
    let Some(a) = world.residents.iter().find(|r| r.id == attacker_id).cloned() else { return };
    let Some(wall) = world.buildings.iter().find(|b| b.id == wall_id).cloned() else { return };
    let Some(city) = world.cities.iter().find(|c| Some(&c.id) == wall.city_id.as_ref()) else {
        return;
    };
    if attacks_organization(&a, Some(city_organization(city))) {
        let id = city.id.clone();
        raise_attacked(world, &id, &a, (wall.x, wall.y), None, size);
    }
}

/// `a`'s blow at the resident `t` raises an `attacked` alarm in each city of `t`'s Organization
/// whose area they stand in (`raiseResidentAttacked`).
pub fn raise_resident_attacked(
    world: &mut WorldState,
    attacker_id: &str,
    target_id: &str,
    size: i32,
) {
    let Some(a) = world.residents.iter().find(|r| r.id == attacker_id).cloned() else { return };
    let Some(t) = world.residents.iter().find(|r| r.id == target_id).cloned() else { return };
    let org = organization_of(&t).map(str::to_string);
    if !attacks_organization(&a, org.as_deref()) {
        return;
    }
    let cities: Vec<String> = world
        .cities
        .iter()
        .filter(|c| {
            Some(city_organization(c)) == org.as_deref()
                && in_city_area(world, &c.id, t.x, t.y, size)
        })
        .map(|c| c.id.clone())
        .collect();
    for city_id in cities {
        raise_attacked(world, &city_id, &a, (t.x, t.y), Some(&t.id), size);
    }
}

/// `thief` just stole from the Organization `victim_org` (`raiseTheft`): standing in the area of a
/// city of that Organization, it reaches its residents standing there who see it. Taking from your
/// own raises none.
pub fn raise_theft(world: &mut WorldState, thief_id: &str, victim_org: &str, size: i32) {
    let Some(thief) = world.residents.iter().find(|r| r.id == thief_id).cloned() else { return };
    if organization_of(&thief) == Some(victim_org) {
        return;
    }
    let cities: Vec<City> =
        world.cities.iter().filter(|c| city_organization(c) == victim_org).cloned().collect();
    for city in cities {
        if !in_city_area(world, &city.id, thief.x, thief.y, size) {
            continue;
        }
        let a = alarm(AlarmKind::Theft, &city, &thief, thief.x, thief.y, world.tick);
        let reached = (0..world.residents.len())
            .filter(|&i| {
                let r = &world.residents[i];
                wrap_distance(size, tile(r.x, r.y), tile(thief.x, thief.y)) <= SIGHT_RANGE
                    && can_be_alarmed(world, &city, r, size)
            })
            .collect();
        start_for(world, reached, &a);
    }
}

/// Whether `r` going after `target_id` answers the attack their Alarm script runs for
/// (`answersAttack`): they strike back, which is no crime.
pub fn answers_attack(r: &Resident, target_id: &str) -> bool {
    r.script
        .as_ref()
        .and_then(|s| s.alarm.as_ref())
        .is_some_and(|a| a.kind == AlarmKind::Attacked && a.about == target_id)
}

/// Whether `r`, of an NPC city, goes after `target_id` as one occupying their town hall for their
/// Alarm script (`goesAfterOccupier`): no crime, as for any of its soldiers.
pub fn goes_after_occupier(world: &WorldState, r: &Resident, target_id: &str, size: i32) -> bool {
    let occupied = r
        .script
        .as_ref()
        .and_then(|s| s.alarm.as_ref())
        .is_some_and(|a| a.kind == AlarmKind::Occupied);
    if r.owner.is_some() || !occupied {
        return false;
    }
    let Some(city) = world.cities.iter().find(|c| Some(&c.id) == r.city_id.as_ref()) else {
        return false;
    };
    occupiers_of(world, city, size).into_iter().any(|i| world.residents[i].id == target_id)
}

/// The game's alarms for the conflict rules (T86.7's [`Alarms`]).
#[derive(Debug, Default, Clone, Copy)]
pub struct GameAlarms;

impl Alarms for GameAlarms {
    fn raise_wall_attacked(
        &mut self,
        world: &mut WorldState,
        attacker_id: &str,
        wall_id: &str,
        size: i32,
    ) {
        raise_wall_attacked(world, attacker_id, wall_id, size);
    }
    fn raise_resident_attacked(
        &mut self,
        world: &mut WorldState,
        attacker_id: &str,
        target_id: &str,
        size: i32,
    ) {
        raise_resident_attacked(world, attacker_id, target_id, size);
    }
    fn raise_occupied(&mut self, world: &mut WorldState, city_id: &str, occupier: &str, size: i32) {
        raise_occupied(world, city_id, occupier, size);
    }
}

fn violation(invariant: &str, message: String, entity_ids: Vec<String>) -> InvariantViolation {
    InvariantViolation { invariant: invariant.into(), message, entity_ids }
}

/// Invariant (`alarmed-attackers-sound`): who raised an `attacked` alarm is kept with the tick of
/// a blow already struck.
pub fn alarmed_attackers_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for c in &world.cities {
        for (id, &tick) in c.alarmed_attackers.iter().flatten() {
            if tick.fract() != 0.0 || tick < 0.0 || tick > world.tick as f64 {
                out.push(violation(
                    "alarmed-attackers-sound",
                    format!(
                        "{} keeps {id} as an attacker at tick {}, at tick {}",
                        c.id,
                        csp_lang::js::number_to_string(tick),
                        world.tick
                    ),
                    vec![c.id.clone(), id.clone()],
                ));
            }
        }
    }
    out
}

/// Invariant (`alarms-sound`): nobody runs two Alarm scripts. One running holds its alarm and has
/// what it interrupted kept aside; kept aside itself, a defence script is what runs, and what it
/// interrupted is no Alarm or defence script.
pub fn alarms_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for r in &world.residents {
        let s = r.script.as_ref();
        let task = s.and_then(|s| s.task);
        let kept = r.interrupted.as_ref();
        let aside = kept.and_then(|k| k.alarm.as_ref());
        let under = s.and_then(|s| s.alarm_under.as_ref());
        let alarm = s.and_then(|s| s.alarm.as_ref());
        let kept_task = kept.and_then(|k| k.script.as_ref()).and_then(|s| s.task);
        let problems = [
            (task == Some(Task::Alarm) && alarm.is_none(), "runs an Alarm script with no alarm"),
            (alarm.is_some_and(|a| a.about == r.id), "runs an Alarm script about themselves"),
            (
                task == Some(Task::Alarm) && kept.is_none(),
                "runs an Alarm script with nothing kept aside",
            ),
            (task == Some(Task::Alarm) && aside.is_some(), "runs two Alarm scripts"),
            (under.is_some() && task != Some(Task::Alarm), "keeps an alarm under no Alarm script"),
            (
                under.is_some_and(|u| u.kind != AlarmKind::Outsider),
                "keeps an alarm to go back to that is no outsider alarm",
            ),
            (
                under.is_some_and(|u| u.kind == AlarmKind::Outsider)
                    && alarm.is_some_and(|a| a.kind == AlarmKind::Outsider),
                "keeps an outsider alarm under another",
            ),
            (
                aside.is_some() && task != Some(Task::Defend),
                "keeps an Alarm script aside but doesn’t defend",
            ),
            (
                aside.is_some_and(|a| a.script.task != Some(Task::Alarm)),
                "keeps a script aside as an Alarm script",
            ),
            (kept_task == Some(Task::Alarm), "came back to an Alarm script as what it interrupted"),
            (
                kept_task == Some(Task::Defend),
                "came back to a defence script as what it interrupted",
            ),
        ];
        for (broken, p) in problems {
            if broken {
                out.push(violation("alarms-sound", format!("{} {p}", r.id), vec![r.id.clone()]));
            }
        }
    }
    out
}

/// Invariant (`alarm-script-sound`): a resident's picked Alarm script is a script id, a whole
/// positive number, or None.
pub fn alarm_script_sound(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.alarm_script_id, Some(AlarmScriptId::Script(0))))
        .map(|r| {
            violation(
                "alarm-script-sound",
                format!("{} keeps Alarm script 0, which can't be one", r.id),
                vec![r.id.clone()],
            )
        })
        .collect()
}

#[cfg(test)]
mod tests;
