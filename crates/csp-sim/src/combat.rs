//! Combat (`CONTEXT.md`: Combat, Walls in combat, Crime, Loot, Down, Under attack, On a carriage
//! under attack), ported from `apps/server/src/combat.ts`: the attack order, the blows it
//! requests (ADR 0002) and their resolution one after another at the end of the tick.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{MAP_SIZE, SIGHT_RANGE, STRIKE_TICKS, WALL_DEFENCE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    AttackOrder, Building, CrimeKind, DeathCause, Realm, RealmEventWhat, Resident, ResidentOrder, Struck, Task,
    Tile, WalkOrder, WorldState,
};

use crate::cities::update_city_membership;
use crate::crimes::{
    building_organization, city_organization, commit_crime, known_thieves, organization_of, CrimeAgainst,
};
use crate::defence::{defends_by_script, end_hold_if_over, start_defence, Alarms};
use crate::pending::{die_all, drop_goods, note_made, ordered_resident, record_event, Sender};
use crate::queries::alliance::{commands, contract_of};
use crate::queries::carriages::{driven_carriage_id, stands_still};
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{in_city_area, occupiers_of, stands_occupying};
use crate::queries::combat::{attack_power, blow_damage, combat_learned, dodge_chance, in_contact};
use crate::queries::names::placed;
use crate::queries::residents::{is_armed, is_down};
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::{in_inner_ring, of_trade_org_hq, trade_org_hq};
use crate::queries::walls::{broken_returns, foreign_wall, is_wall_or_gate, on_own_wall, wall_strength, wall_strength_left};
use crate::random::{hash_str, Mulberry32};

/// A blow a resident with an attack order requests once in contact with their target and ready
/// (`StrikeAction`). The world checks and resolves it at the end of the tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrikeAction {
    pub attacker_id: String,
    pub target_id: String,
}

/// What an attack order goes after (`attackTarget`): a resident, or else a finished wall or gate,
/// by index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Resident(usize),
    Building(usize),
}

/// The target `target_id` names (`attackTarget`): the resident of that id, or else the finished
/// wall or gate; None once it is gone.
pub fn attack_target(world: &WorldState, target_id: &str) -> Option<Target> {
    if let Some(i) = world.residents.iter().position(|x| x.id == target_id) {
        return Some(Target::Resident(i));
    }
    let i = world.buildings.iter().position(|x| x.id == target_id)?;
    is_wall_or_gate(&world.buildings[i]).then_some(Target::Building(i))
}

fn spot_of(world: &WorldState, t: Target) -> (f64, f64) {
    match t {
        Target::Resident(i) => (world.residents[i].x, world.residents[i].y),
        Target::Building(i) => (world.buildings[i].x, world.buildings[i].y),
    }
}

fn tile(p: (f64, f64)) -> (i32, i32) {
    (p.0 as i32, p.1 as i32)
}

/// A fresh attack order on `target_id` (`attackOrder`); `started` when the fight is already in
/// the realm logs, `defending` when it is fighting back at someone who hit the resident.
pub fn attack_order(target_id: &str, started: bool, defending: bool) -> AttackOrder {
    AttackOrder {
        target_id: target_id.to_string(),
        path: None,
        progress: 0.0,
        strike: 0.0,
        started,
        defending: defending.then_some(true),
        army: None,
    }
}

/// Whether `t` stands in the City area of a city of `org` as someone force is allowed against
/// (`wantedAtHome`): occupying its town hall, or a thief of it that it knows of.
fn wanted_at_home(world: &WorldState, org: &str, t: &Resident, size: i32) -> bool {
    let home: Vec<_> = world
        .cities
        .iter()
        .filter(|c| city_organization(c) == org && in_city_area(world, &c.id, t.x, t.y, size))
        .collect();
    if home.is_empty() {
        return false;
    }
    home.iter().any(|c| stands_occupying(world, c, t, size)) || known_thieves(world, org).contains(&t.id)
}

/// Whether `a` striking `t` is a crime (`isAggression`): not when `a` fights back at someone who
/// hit them, nor when `t` attacks someone of `a`'s Organization on their own account, or breaks or
/// climbs one of its walls or gates. The Trade Org HQ's soldiers keep its inner ring clear, a
/// trading post goes after a thief it knows of, and an Organization strikes those wanted in its
/// own City area, none of it a crime. For `t` running their defence script, what it interrupted is
/// what they are doing.
fn is_aggression(world: &WorldState, a: &Resident, t: &Resident, size: i32) -> bool {
    if matches!(&a.order, Some(ResidentOrder::Attack(o)) if o.defending == Some(true)) {
        return false;
    }
    let hq = trade_org_hq(world);
    if hq.is_some() && of_trade_org_hq(world, a) && !of_trade_org_hq(world, t) && in_inner_ring(world, (t.x, t.y), size) {
        return false;
    }
    if a.owner.is_none() {
        let post = world.cities.iter().find(|c| {
            a.city_id.as_ref() == Some(&c.id) && c.trade_org == Some(csp_shared::world::TradeOrgCity::Post)
        });
        if post.is_some_and(|p| known_thieves(world, &p.id).contains(&t.id)) {
            return false;
        }
    }
    let org = organization_of(a);
    if org.is_some_and(|org| wanted_at_home(world, org, t, size)) {
        return false;
    }
    let mut sides: HashSet<Option<String>> = HashSet::from([org.map(str::to_string)]);
    if let Some(hq) = hq {
        if contract_of(world, &a.id).is_some_and(|c| c.hirer_id == TRADE_ORG) {
            sides.insert(Some(hq.id.clone()));
        }
    }
    // Defending themselves, what they were doing before counts.
    let kept = t.interrupted.as_ref().filter(|_| t.script.as_ref().and_then(|s| s.task) != Some(Task::Alarm));
    let o = match kept {
        Some(k) => match &k.alarm {
            Some(alarm) => alarm.order.as_ref(),
            None => k.order.as_ref(),
        },
        None => t.order.as_ref(),
    };
    let ours = |building_id: &str| {
        world
            .buildings
            .iter()
            .find(|x| x.id == building_id)
            .is_some_and(|b| sides.contains(&building_organization(world, b)))
    };
    let o = match o {
        Some(ResidentOrder::Climb(c)) => return !ours(&c.wall_id),
        Some(ResidentOrder::Attack(o)) if o.defending != Some(true) => o,
        _ => return true,
    };
    match world.residents.iter().find(|x| x.id == o.target_id) {
        None => !ours(&o.target_id),
        Some(their_target) => !sides.contains(&organization_of(their_target).map(str::to_string)),
    }
}

/// The input of an attack order (`AttackRequest`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AttackRequest {
    pub resident_id: Option<String>,
    pub target_id: Option<String>,
}

/// `attack.validate` (`CONTEXT.md`: Combat): one of the Player's residents goes after a resident
/// of another realm, or of none, that the Player sees; or a wall or gate of another realm's city,
/// or of none. An NPC city's Alarm default gives it too. `size` is the map's, when known.
pub fn validate_attack(world: &WorldState, sender: &Sender, order: &AttackRequest, size: Option<i32>) -> Option<&'static str> {
    let npc = sender.npc_city_id.as_deref();
    let realm = if npc.is_none() { world.realms.iter().find(|r| r.user_id == sender.user_id) } else { None };
    let side = npc.or(realm.map(|r| r.id.as_str()));
    let Some(side) = side else { return Some("not one of your residents") };
    if ordered_resident(world, sender, order.resident_id.as_deref()).is_none() {
        return Some("not one of your residents");
    }
    let target_id = order.target_id.as_deref();
    let resident = world.residents.iter().find(|x| Some(x.id.as_str()) == target_id);
    if resident.is_some_and(|r| organization_of(r) == Some(side)) {
        return Some("that is one of your own residents");
    }
    let target = match resident {
        Some(r) => (r.x, r.y),
        None => {
            if npc.is_some() {
                return Some("no such resident");
            }
            match foreign_wall(world, Some(side), target_id.unwrap_or("")) {
                Ok(b) => (b.x, b.y),
                Err(reason) => {
                    let exists = world.buildings.iter().any(|b| Some(b.id.as_str()) == target_id);
                    return Some(if exists { reason } else { "no such resident" });
                }
            }
        }
    };
    let size = size?;
    let ours = |x: &Resident| match realm {
        Some(realm) => commands(world, &realm.id, Some(x)),
        None => x.owner.is_none() && x.city_id.as_deref() == npc && contract_of(world, &x.id).is_none(),
    };
    let seen = world
        .residents
        .iter()
        .any(|x| ours(x) && wrap_distance(size, tile((x.x, x.y)), tile(target)) <= SIGHT_RANGE);
    if seen {
        None
    } else if resident.is_some() {
        Some("that resident is out of sight")
    } else {
        Some("that wall is out of sight")
    }
}

/// `answersAttack` (TODO(T86.12): `alarms.ts`): whether `r` going after `target_id` answers the
/// attack their Alarm script runs for.
fn answers_attack(r: &Resident, target_id: &str) -> bool {
    r.script
        .as_ref()
        .and_then(|s| s.alarm.as_ref())
        .is_some_and(|a| a.kind == csp_shared::world::AlarmKind::Attacked && a.about == target_id)
}

/// `goesAfterOccupier` (TODO(T86.12): `alarms.ts`): whether `r`, of an NPC city, goes after
/// `target_id` as one occupying their town hall for their Alarm script.
fn goes_after_occupier(world: &WorldState, r: &Resident, target_id: &str, size: i32) -> bool {
    let occupied = r.script.as_ref().and_then(|s| s.alarm.as_ref()).map(|a| a.kind)
        == Some(csp_shared::world::AlarmKind::Occupied);
    if r.owner.is_some() || !occupied {
        return false;
    }
    let Some(city) = world.cities.iter().find(|c| r.city_id.as_ref() == Some(&c.id)) else { return false };
    occupiers_of(world, city, size).into_iter().any(|o| world.residents[o].id == target_id)
}

/// `attack.apply`: a defence script going after who struck them fights back, in a fight already
/// logged; an Alarm script answering an attack, or going after an occupier, strikes back too.
pub fn apply_attack(world: &mut WorldState, order: &AttackRequest, size: Option<i32>) {
    let (Some(resident_id), Some(target_id)) = (order.resident_id.as_deref(), order.target_id.as_deref()) else {
        return;
    };
    let Some(i) = world.residents.iter().position(|x| x.id == resident_id) else { return };
    let r = &world.residents[i];
    let defending = r.interrupted.is_some()
        && r.script.as_ref().and_then(|s| s.task) != Some(Task::Alarm)
        && r.struck.as_ref().is_some_and(|s| s.by == target_id);
    let no_crime = answers_attack(r, target_id) || size.is_some_and(|size| goes_after_occupier(world, r, target_id, size));
    world.residents[i].order = Some(ResidentOrder::Attack(attack_order(target_id, defending, defending || no_crime)));
}

/// Requests this tick's blows from residents' attack orders (`requestStrikes`), on a map of
/// `size` tiles. An order whose target is gone or out of the attacker's sight ends. An attacker in
/// contact stops walking and gets `1 / STRIKE_TICKS` closer to their next blow; once there, they
/// strike.
pub fn request_strikes(world: &mut WorldState, size: i32) -> Vec<StrikeAction> {
    let by_id: HashMap<String, usize> = world.residents.iter().enumerate().map(|(i, r)| (r.id.clone(), i)).collect();
    let mut strikes = Vec::new();
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::Attack(o)) = &world.residents[ri].order else { continue };
        let target = by_id.get(&o.target_id).map(|&i| Target::Resident(i)).or_else(|| attack_target(world, &o.target_id));
        let me = (world.residents[ri].x, world.residents[ri].y);
        let gone = match target {
            None => true,
            Some(Target::Resident(t)) if t == ri => true,
            Some(t) => wrap_distance(size, tile(me), tile(spot_of(world, t))) > SIGHT_RANGE,
        };
        if gone {
            world.residents[ri].order = None;
            continue;
        }
        let target = target.expect("not gone");
        if !in_contact(size, me, spot_of(world, target)) {
            continue;
        }
        let target_id = match target {
            Target::Resident(t) => world.residents[t].id.clone(),
            Target::Building(b) => world.buildings[b].id.clone(),
        };
        let r = &mut world.residents[ri];
        let Some(ResidentOrder::Attack(o)) = &mut r.order else { continue };
        o.path = None;
        o.progress = 0.0;
        o.strike += 1.0 / STRIKE_TICKS;
        if o.strike < 1.0 - 1e-9 {
            continue;
        }
        o.strike = 0.0;
        strikes.push(StrikeAction { attacker_id: r.id.clone(), target_id });
    }
    strikes
}

/// What combat did this tick (`CombatResult`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CombatResult {
    /// Blows struck, landed or dodged.
    pub blows: usize,
    /// Ids of the residents killed this tick, in the order they fell (one Down resident struck
    /// twice in a tick is in it twice, as in the TypeScript).
    pub died: Vec<String>,
    /// Walls and gates broken this tick.
    pub broken: Vec<Building>,
    /// Realms that ended because their Leader was killed.
    pub ended: Vec<Realm>,
}

/// Resolves blows (`resolveStrikes`, ADR 0002), one after another, on a map of `size` tiles. A
/// blow is struck only by a living attacker still attacking a living or Down target in contact.
/// The first blow of a fight goes in both realms' logs. The target keeps who struck them; both
/// learn Combat; the target dodges by Agility, or it lands and takes its `blowDamage`, only
/// `WALL_DEFENCE` of it on their own city's wall. A target left with no health is killed and drops
/// what they carried; otherwise they defend themselves (`react`). A climber can't defend
/// themselves, nor can someone Down. A blow at a wall or gate always lands (`break_wall`).
pub fn resolve_strikes(world: &mut WorldState, strikes: &[StrikeAction], size: i32, alarms: &mut dyn Alarms) -> CombatResult {
    let mut killers: Vec<(String, String)> = Vec::new();
    let mut died: Vec<String> = Vec::new();
    let mut broken: Vec<Building> = Vec::new();
    let mut blows = 0;
    for StrikeAction { attacker_id, target_id } in strikes {
        let Some(ai) = world.residents.iter().position(|x| x.id == *attacker_id) else { continue };
        let Some(target) = attack_target(world, target_id) else { continue };
        if world.residents[ai].health <= 0.0 {
            continue;
        }
        let a = &world.residents[ai];
        let Some(ResidentOrder::Attack(o)) = &a.order else { continue };
        let spot = spot_of(world, target);
        let real_id = match target {
            Target::Resident(t) => &world.residents[t].id,
            Target::Building(b) => &world.buildings[b].id,
        };
        if o.target_id != *real_id || !in_contact(size, (a.x, a.y), spot) {
            continue;
        }
        let started = o.started;
        let ti = match target {
            Target::Building(bi) => {
                blows += 1;
                let wall_id = world.buildings[bi].id.clone();
                alarms.raise_wall_attacked(world, attacker_id, &wall_id, size);
                if let Some(b) = break_wall(world, ai, &wall_id, size) {
                    broken.push(b);
                }
                continue;
            }
            Target::Resident(ti) => ti,
        };
        // Someone Down has no health left but is there to be killed.
        let down = is_down(world.residents[ti].down_until);
        if world.residents[ti].health <= 0.0 && !down {
            continue;
        }
        blows += 1;
        if !started {
            if let Some(ResidentOrder::Attack(o)) = &mut world.residents[ai].order {
                o.started = true;
            }
            let (a, t) = (&world.residents[ai], &world.residents[ti]);
            let to_a = RealmEventWhat::Fight {
                resident_id: a.id.clone(),
                name: a.name.clone(),
                other_id: t.id.clone(),
                other: t.name.clone(),
                attacker: true,
            };
            let to_t = RealmEventWhat::Fight {
                resident_id: t.id.clone(),
                name: t.name.clone(),
                other_id: a.id.clone(),
                other: a.name.clone(),
                attacker: false,
            };
            let (a_owner, t_owner) = (a.owner.clone(), t.owner.clone());
            record_event(world, a_owner.as_deref(), to_a);
            record_event(world, t_owner.as_deref(), to_t);
            let (a, t) = (&world.residents[ai], &world.residents[ti]);
            if is_aggression(world, a, t, size) {
                let against = crime_against(t);
                commit_crime(world, size, CrimeKind::Attack, attacker_id, against);
            }
        }
        let tick = world.tick;
        end_hold_if_over(tick, &mut world.residents[ti]);
        world.residents[ti].struck = Some(Struck { by: attacker_id.clone(), tick: tick as f64 });
        let t_id = world.residents[ti].id.clone();
        alarms.raise_resident_attacked(world, attacker_id, &t_id, size);
        // An alarm changes orders and scripts, never who is in the world: the indices hold.
        let tf = tick as f64;
        let learned_a = combat_learned(&world.residents[ai], tf);
        *world.residents[ai].skills.entry(csp_shared::world::SkillName::Combat).or_insert(0.0) += learned_a;
        let learned_t = combat_learned(&world.residents[ti], tf);
        *world.residents[ti].skills.entry(csp_shared::world::SkillName::Combat).or_insert(0.0) += learned_t;
        let roll = Mulberry32::new(f64::from(hash_str(&format!("{}:{}:{}:strike", world.seed, tick, attacker_id)))).next();
        let t = &world.residents[ti];
        let climbing = matches!(t.order, Some(ResidentOrder::Climb(_)));
        if !down && !climbing && roll < dodge_chance(t, tf) {
            continue;
        }
        let cover = if on_own_wall(world, t) { WALL_DEFENCE } else { 1.0 };
        let damage = blow_damage(&world.residents[ai], t, tf) * cover;
        let t = &mut world.residents[ti];
        t.health = 0f64.max(t.health - damage);
        if t.health <= 0.0 {
            died.push(t.id.clone());
            let name = world.residents[ai].name.clone();
            match killers.iter_mut().find(|(k, _)| *k == t_id) {
                Some(k) => k.1 = name,
                None => killers.push((t_id.clone(), name)),
            }
            let (a, t) = (&world.residents[ai], &world.residents[ti]);
            if is_aggression(world, a, t, size) {
                let against = crime_against(t);
                commit_crime(world, size, CrimeKind::Killing, attacker_id, against);
            }
            continue;
        }
        react(world, ti, ai);
    }
    let ended = die_all(world, &died, DeathCause::Killed, size, &killers);
    if !broken.is_empty() {
        update_city_membership(world, size);
    }
    let gone: HashSet<&str> = died.iter().map(String::as_str).chain(broken.iter().map(|b| b.id.as_str())).collect();
    for r in &mut world.residents {
        if matches!(&r.order, Some(ResidentOrder::Attack(o)) if gone.contains(o.target_id.as_str())) {
            r.order = None;
        }
    }
    CombatResult { blows, died, broken, ended }
}

fn crime_against(t: &Resident) -> CrimeAgainst {
    CrimeAgainst {
        victim_org: organization_of(t).map(str::to_string),
        victim: Some(t.id.clone()),
        ..CrimeAgainst::default()
    }
}

/// A blow from the resident at `ai` at the wall or gate `wall_id` (`breakWall`): it always lands,
/// its attacker's `attackPower` going onto the wall's damage, and teaches Combat. Once it has
/// taken its `wallStrength` it falls: it is gone and `brokenReturns` of its materials lie on its
/// tile. Breaking another Organization's wall is a crime of tearing down by whoever strikes the
/// last blow. Returns the wall when it fell.
fn break_wall(world: &mut WorldState, ai: usize, wall_id: &str, size: i32) -> Option<Building> {
    let tick = world.tick as f64;
    let learned = combat_learned(&world.residents[ai], tick);
    *world.residents[ai].skills.entry(csp_shared::world::SkillName::Combat).or_insert(0.0) += learned;
    let power = attack_power(&world.residents[ai], tick);
    let bi = world.buildings.iter().position(|b| b.id == wall_id)?;
    let b = &mut world.buildings[bi];
    b.damage = Some(wall_strength(b).min(b.damage.unwrap_or(0.0) + power));
    if wall_strength_left(b) > 0.0 {
        return None;
    }
    let victim_org = building_organization(world, &world.buildings[bi]);
    let against = CrimeAgainst { victim_org, building: Some(world.buildings[bi].kind), ..CrimeAgainst::default() };
    let attacker_id = world.residents[ai].id.clone();
    commit_crime(world, size, CrimeKind::TearDown, &attacker_id, against);
    let b = world.buildings.remove(bi);
    let returned = broken_returns(&b);
    drop_goods(world, b.x, b.y, &returned);
    note_made(world, &returned);
    Some(b)
}

/// Whether `t` drives a caravan, wandering trader or supply wagon and stands with its carriage
/// (`withCaravanCarriage`).
fn with_caravan_carriage(world: &WorldState, t: &Resident) -> bool {
    let me = Some(t.id.as_str());
    let carriage_id = world
        .caravans
        .iter()
        .find(|c| c.driver_id.as_deref() == me)
        .map(|c| &c.carriage_id)
        .or_else(|| world.traders.iter().find(|c| c.driver_id.as_deref() == me).map(|c| &c.carriage_id))
        .or_else(|| world.supply_wagons.iter().find(|w| w.driver_id.as_deref() == me).map(|w| &w.carriage_id));
    let carriage = carriage_id.and_then(|id| world.carriages.iter().find(|k| k.id == *id));
    carriage.is_some_and(|k| k.x == t.x && k.y == t.y)
}

/// The resident at `ti`, hit by the one at `ai` and still alive, reacts (`react`): a Player's
/// resident runs their defence script; others, armed, fight back unless already attacking
/// someone, off any carriage they are aboard; unarmed, they flee home to their city's town hall,
/// but a driver drives on and a passenger stays aboard a carriage being driven.
fn react(world: &mut WorldState, ti: usize, ai: usize) {
    let t = &world.residents[ti];
    if matches!(t.order, Some(ResidentOrder::Climb(_))) {
        return;
    }
    if defends_by_script(world, t) {
        start_defence(world, ti);
        return;
    }
    if is_armed(&t.carried) {
        if !matches!(t.order, Some(ResidentOrder::Attack(_))) {
            let a_id = world.residents[ai].id.clone();
            let t = &mut world.residents[ti];
            t.aboard = None;
            t.order = Some(ResidentOrder::Attack(attack_order(&a_id, true, true)));
        }
        return;
    }
    if driven_carriage_id(t).is_some() || with_caravan_carriage(world, t) {
        return;
    }
    if let Some(carriage) = world.carriages.iter().find(|k| t.aboard.as_ref() == Some(&k.id)) {
        if !stands_still(world, carriage) {
            return;
        }
    }
    let Some(city) = world.cities.iter().find(|c| t.city_id.as_ref() == Some(&c.id)) else { return };
    let Some(hall) = town_hall_of(world, city) else { return };
    let fleeing = matches!(&t.order, Some(ResidentOrder::WalkTo(o)) if o.target.x == hall.x && o.target.y == hall.y);
    if fleeing || is_at(tile((t.x, t.y)), placed(hall), MAP_SIZE) {
        return;
    }
    let (hx, hy) = (hall.x, hall.y);
    let t = &mut world.residents[ti];
    t.aboard = None;
    t.order = Some(ResidentOrder::WalkTo(WalkOrder { target: Tile { x: hx, y: hy }, path: None, progress: 0.0, army: None }));
    let (owner, what) = (t.owner.clone(), RealmEventWhat::Fled { resident_id: t.id.clone(), name: t.name.clone() });
    record_event(world, owner.as_deref(), what);
}
