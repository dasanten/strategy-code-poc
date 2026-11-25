//! Combat (`CONTEXT.md`: Combat, Walls in combat, Crime, Loot, Down, Under attack, On a carriage
//! under attack), ported from `apps/server/src/combat.ts`: the attack order, the blows it
//! requests (ADR 0002) and their resolution one after another at the end of the tick.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{MAP_SIZE, SIGHT_RANGE, STRIKE_TICKS, WALL_DEFENCE};
use csp_shared::footprint::{is_at, near_footprint};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    AttackOrder, Building, CrimeKind, DeathCause, Good, OrderRequest, Realm, RealmEventWhat,
    Resident, ResidentOrder, Struck, Task, Tile, WalkOrder, WorldState,
};

use serde_json::Value;

use crate::cities::update_city_membership;
use crate::crimes::{
    building_organization, city_organization, commit_crime, known_thieves, organization_of,
    CrimeAgainst,
};
use crate::defence::{defends_by_script, end_hold_if_over, start_defence, Alarms};
use crate::equipment::Slot;
use crate::events::record_event;
use crate::goods_made::GoodsMade;
use crate::order_meta::OrderMeta;
use crate::order_sender::commands;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::text_field;
use crate::queries::alliance::contract_of;
use crate::queries::carriages::{driven_carriage_id, stands_still};
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{in_city_area, stands_occupying};
use crate::queries::combat::{
    attack_power, attack_ticks, blow_damage, combat_learned, dodge_chance, in_contact,
    ranged_weapon, shooting_weapon, shot_damage, shot_reach, tiles_apart,
};
use crate::queries::names::{held, placed};
use crate::queries::residents::{is_armed, is_down};
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::{in_inner_ring, of_trade_org_hq, trade_org_hq};
use crate::queries::vessels::{
    across_docked_ship, being_rowed, between_vessels, rowed_vessel_id, vessel_aboard,
};
use crate::queries::walls::{
    broken_returns, foreign_wall, is_up, is_wall_or_gate, on_own_wall, reaches_for_height,
    wall_strength, wall_strength_left,
};
use crate::random::{hash_str, Mulberry32};
use crate::running::{
    same_when_equal, Arrival, By, Going, GoingMut, RunningOrder, Ties, TiesMut, To,
};
use crate::script_actions::{arg, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;
use crate::survival::{die_all, drop_goods};
use crate::wear::wear_slot;

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
    /// A siege machine (`CONTEXT.md`: Siege machine): broken by blows like a wall.
    Machine(usize),
}

/// The target `target_id` names (`attackTarget`): the resident of that id, or else the finished
/// wall or gate, or the siege machine; None once it is gone.
pub fn attack_target(world: &WorldState, target_id: &str) -> Option<Target> {
    if let Some(i) = world.residents.iter().position(|x| x.id == target_id) {
        return Some(Target::Resident(i));
    }
    if let Some(i) = crate::siege::machine_index(world, target_id) {
        return Some(Target::Machine(i));
    }
    let i = world.buildings.iter().position(|x| x.id == target_id)?;
    is_wall_or_gate(&world.buildings[i]).then_some(Target::Building(i))
}

fn spot_of(world: &WorldState, t: Target) -> (f64, f64) {
    match t {
        Target::Resident(i) => (world.residents[i].x, world.residents[i].y),
        Target::Building(i) => (world.buildings[i].x, world.buildings[i].y),
        Target::Machine(i) => (world.siege_machines[i].x, world.siege_machines[i].y),
    }
}

fn tile(p: (f64, f64)) -> (i32, i32) {
    (p.0 as i32, p.1 as i32)
}

/// Whether the resident at `ai` can strike the target (`CONTEXT.md`: Combat, Fighting at a
/// vessel, High ground): in contact with it, not from one vessel at someone aboard another, and
/// not from the ground at someone up. Those aboard a vessel are reached from beside it, as if it
/// were the next land tile; those aboard a docked ship from anywhere on its haven, and the other
/// way round. A shot reaches within the archer's reach, from the ground at someone up too: the one
/// way to hit them from below (`CONTEXT.md`: Ranged combat).
fn reaches(world: &WorldState, size: i32, ai: usize, t: Target) -> bool {
    let a = &world.residents[ai];
    let contact = in_contact(size, tile((a.x, a.y)), tile(spot_of(world, t)));
    match t {
        Target::Resident(ti) => {
            let b = &world.residents[ti];
            // A ram's crew under its roof can't be struck from above nor shot (`CONTEXT.md`: Ram).
            let sheltered = crate::siege::under_roof(world, b);
            let blow = (contact || across_docked_ship(world, a, b))
                && reaches_for_height(world, a, b)
                && !(sheltered && is_up(world, a));
            let shot = !sheltered && within_shot(world, size, a, b);
            (blow || shot) && !between_vessels(world, a, b)
        }
        // A wall or gate is struck in contact, never shot at; a tower from beside any tile of it
        // (`CONTEXT.md`: Tower).
        Target::Building(bi) => {
            let b = &world.buildings[bi];
            contact || near_footprint(placed(b), tile((a.x, a.y)), 1, size)
        }
        // So is a siege machine, and only from the ground: defenders come down and out for it.
        Target::Machine(_) => contact && !is_up(world, a),
    }
}

/// Whether `a` shoots at `b` from where they stand (`CONTEXT.md`: Ranged combat): a Bow or
/// Crossbow equipped, an Arrow carried, and `b` within its reach from there (further from up on a
/// wall). Sight is checked by the attack order itself; nothing else blocks a shot for now.
fn within_shot(world: &WorldState, size: i32, a: &Resident, b: &Resident) -> bool {
    shooting_weapon(a).is_some()
        && shot_reach(world, a)
            .is_some_and(|reach| tiles_apart(size, tile((a.x, a.y)), tile((b.x, b.y))) <= reach)
}

/// Whether the resident at `ai` can strike or shoot the resident at `ti` from where they stand:
/// what an attack order walks until (`attack_holds`). With nothing to shoot, that is contact.
pub fn strikes_from_here(world: &WorldState, size: i32, ai: usize, ti: usize) -> bool {
    reaches(world, size, ai, Target::Resident(ti))
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
    home.iter().any(|c| stands_occupying(world, c, t, size))
        || known_thieves(world, org).contains(&t.id)
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
    if hq.is_some()
        && of_trade_org_hq(world, a)
        && !of_trade_org_hq(world, t)
        && in_inner_ring(world, (t.x, t.y), size)
    {
        return false;
    }
    if a.owner.is_none() {
        let post = world.cities.iter().find(|c| {
            a.city_id.as_ref() == Some(&c.id)
                && c.trade_org == Some(csp_shared::world::TradeOrgCity::Post)
        });
        if post.is_some_and(|p| known_thieves(world, &p.id).contains(&t.id)) {
            return false;
        }
        // An NPC city's soldier out after a thief it knows of takes back what was taken.
        if crate::npc_hunts::hunting(world, a, t) {
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
    let kept = t
        .interrupted
        .as_ref()
        .filter(|_| t.script.as_ref().and_then(|s| s.task) != Some(Task::Alarm));
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
    let Some(target) = o.and_then(|o| o.ties().strikes) else { return true };
    match world.residents.iter().find(|x| x.id == target) {
        None => !ours(target),
        Some(their_target) => !sides.contains(&organization_of(their_target).map(str::to_string)),
    }
}

/// The input of an attack order (`AttackRequest`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AttackRequest {
    pub resident_id: Option<String>,
    pub target_id: Option<String>,
    /// A shot (`shoot`): only from a Bow or Crossbow with Arrows, at a resident in reach from
    /// where the resident stands, so the order starts without a step (`CONTEXT.md`: Ranged combat).
    pub shoot: bool,
}

/// `attack.validate` (`CONTEXT.md`: Combat): one of the Player's residents goes after a resident
/// of another realm, or of none, that the Player sees; or a wall or gate of another realm's city,
/// or of none. An NPC city's Alarm default gives it too. `size` is the map's, when known.
pub fn validate_attack(
    world: &WorldState,
    sender: &OrderSender,
    order: &AttackRequest,
    size: Option<i32>,
) -> Option<&'static str> {
    let npc = sender.npc_city_id.as_deref();
    let realm = if npc.is_none() {
        world.realms.iter().find(|r| r.user_id == sender.user_id)
    } else {
        None
    };
    let side = npc.or(realm.map(|r| r.id.as_str()));
    let Some(side) = side else { return Some("not one of your residents") };
    let Some(me) = ordered_resident(world, sender, order.resident_id.as_deref()) else {
        return Some("not one of your residents");
    };
    let me = &world.residents[me];
    let target_id = order.target_id.as_deref();
    if let Some(t) = target_id.filter(|t| !fights_back(me, t)) {
        if let Some(no) = crate::lent::refusal(world, me, t) {
            return Some(no);
        }
    }
    let resident = world.residents.iter().find(|x| Some(x.id.as_str()) == target_id);
    if resident.is_some_and(|r| organization_of(r) == Some(side)) {
        return Some("that is one of your own residents");
    }
    let machine = target_id.and_then(|id| crate::siege::machine_by_id(world, id));
    let target = match (resident, machine) {
        (Some(r), _) => (r.x, r.y),
        // Any siege machine but the side's own (`CONTEXT.md`: Siege machine: broken by blows).
        (None, Some(m)) => {
            if m.realm_id.as_deref() == Some(side) {
                return Some("that is one of your own siege machines");
            }
            (m.x, m.y)
        }
        (None, None) => {
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
        None => {
            x.owner.is_none() && x.city_id.as_deref() == npc && contract_of(world, &x.id).is_none()
        }
    };
    let seen = world
        .residents
        .iter()
        .any(|x| ours(x) && wrap_distance(size, tile((x.x, x.y)), tile(target)) <= SIGHT_RANGE);
    // A ram's crew under its roof can't be struck from above nor shot, and a siege machine is
    // struck from the ground (`CONTEXT.md`: Ram).
    let roofed = resident.is_some_and(|t| crate::siege::under_roof(world, t));
    if seen && roofed && (order.shoot || is_up(world, me)) {
        return Some("they are under the ram’s roof");
    }
    if seen && machine.is_some() && is_up(world, me) {
        return Some("a siege machine is struck from the ground");
    }
    if seen && order.shoot {
        return shoot_problem(world, size, me, resident);
    }
    // An archer shoots up at them (`CONTEXT.md`: Ranged combat); nobody else on the ground reaches.
    let below = resident.is_some_and(|t| !reaches_for_height(world, me, t))
        && shooting_weapon(me).is_none();
    if seen && below {
        Some("they are up on the wall")
    } else if seen {
        None
    } else if resident.is_some() {
        Some("that resident is out of sight")
    } else if machine.is_some() {
        Some("that siege machine is out of sight")
    } else {
        Some("that wall is out of sight")
    }
}

/// Why `me` can't shoot `target` from where they stand (`shoot`), None when they can: a Bow or
/// Crossbow equipped, an Arrow carried, and a resident within its reach, not aboard another vessel.
fn shoot_problem(
    world: &WorldState,
    size: i32,
    me: &Resident,
    target: Option<&Resident>,
) -> Option<&'static str> {
    if ranged_weapon(me).is_none() {
        return Some("no bow or crossbow equipped");
    }
    if shooting_weapon(me).is_none() {
        return Some("no arrows");
    }
    let Some(t) = target else { return Some("only residents are shot at") };
    if between_vessels(world, me, t) || !within_shot(world, size, me, t) {
        return Some("out of reach");
    }
    None
}

use crate::alarms::{answers_attack, goes_after_occupier};

/// Whether `r`, running their defence script, goes after `target_id`, who struck them: fighting
/// back, never a crime, and allowed even against the city that lent them.
fn fights_back(r: &Resident, target_id: &str) -> bool {
    r.interrupted.is_some()
        && r.script.as_ref().and_then(|s| s.task) != Some(Task::Alarm)
        && r.struck.as_ref().is_some_and(|s| s.by == target_id)
}

/// `attack.apply`: a defence script going after who struck them fights back, in a fight already
/// logged; an Alarm script answering an attack, or going after an occupier, strikes back too.
pub fn apply_attack(world: &mut WorldState, order: &AttackRequest, size: Option<i32>) {
    let (Some(resident_id), Some(target_id)) =
        (order.resident_id.as_deref(), order.target_id.as_deref())
    else {
        return;
    };
    let Some(i) = world.residents.iter().position(|x| x.id == resident_id) else { return };
    let r = &world.residents[i];
    let defending = fights_back(r, target_id);
    let no_crime = answers_attack(r, target_id)
        || size.is_some_and(|size| goes_after_occupier(world, r, target_id, size));
    world.residents[i].order =
        Some(ResidentOrder::Attack(attack_order(target_id, defending, defending || no_crime)));
}

fn attack_request(order: &OrderRequest) -> AttackRequest {
    AttackRequest {
        resident_id: text_field(order, "residentId"),
        target_id: text_field(order, "targetId"),
        shoot: order.fields.get("shoot").and_then(Value::as_bool).unwrap_or(false),
    }
}

pub(crate) static ATTACK_META: OrderMeta = OrderMeta::fns(
    "attack",
    |w, s, o, t| validate_attack(w, s, &attack_request(o), t.map(|t| t.size)).map(str::to_string),
    |w, _, o, t| apply_attack(w, &attack_request(o), t.map(|t| t.size)),
)
.gets_off_first()
.npc_city()
.script(&[ATTACK_ACTION, SHOOT_ACTION]);

const ATTACK_ACTION: ScriptAction = ScriptAction {
    name: "attack",
    group: ActionGroup::Fighting,
    request: Request::Fields(&[arg("targetId")]),
    cost: 10.0,
    description: "Go after a resident I see and strike them, or strike a wall or gate of another realm until it falls. With a Bow or Crossbow and Arrows I walk only until they are in my `reach` and shoot from there.",
    returns: ScriptType::String,
};

const SHOOT_ACTION: ScriptAction = ScriptAction {
    name: "shoot",
    group: ActionGroup::Fighting,
    request: Request::ByHand(&["targetId"]),
    cost: 10.0,
    description: "Shoot a resident I see who is in my `reach` now, with my Bow or Crossbow and an Arrow a shot, without a step. The order goes on as an attack: should they get out of reach I go after them, so `stop()` to stay where I am.",
    returns: ScriptType::String,
};

impl RunningOrder for AttackOrder {
    fn going(&self) -> Option<Going<'_>> {
        Some(Going {
            path: &self.path,
            progress: self.progress,
            now: true,
            by: By::Foot,
            to: To::Foe(&self.target_id),
            near: true,
            after: None,
            estimated: false,
        })
    }
    fn going_mut(&mut self) -> Option<GoingMut<'_>> {
        Some(GoingMut::new(&mut self.path, &mut self.progress))
    }
    fn arrive(&mut self) -> Arrival {
        GoingMut::new(&mut self.path, &mut self.progress).reset();
        Arrival::GoesOn
    }
    fn resume(&mut self, _: &WorldState, _: &Resident) -> bool {
        GoingMut::new(&mut self.path, &mut self.progress).reset_found();
        true
    }
    same_when_equal!();
    fn ties(&self) -> Ties<'_> {
        Ties {
            army: self.army.as_deref(),
            strikes: (self.defending != Some(true)).then_some(self.target_id.as_str()),
            falls_with: Some(&self.target_id),
            ..Ties::NONE
        }
    }
    fn ties_mut(&mut self) -> TiesMut<'_> {
        TiesMut { army: Some(&mut self.army), ..TiesMut::none() }
    }
}

/// Requests this tick's blows from residents' attack orders (`requestStrikes`), on a map of
/// `size` tiles. An order whose target is gone or out of the attacker's sight ends. An attacker in
/// contact stops walking and gets `1 / STRIKE_TICKS` closer to their next blow; once there, they
/// strike.
pub fn request_strikes(world: &mut WorldState, size: i32) -> Vec<StrikeAction> {
    let by_id: HashMap<String, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.clone(), i)).collect();
    let mut strikes = Vec::new();
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::Attack(o)) = &world.residents[ri].order else { continue };
        let target = by_id
            .get(&o.target_id)
            .map(|&i| Target::Resident(i))
            .or_else(|| attack_target(world, &o.target_id));
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
        if !reaches(world, size, ri, target) {
            // From up on a wall nothing reaches a ram or its crew under its roof: the order ends
            // rather than waits up there (`CONTEXT.md`: Ram).
            let a = &world.residents[ri];
            let roofed = match target {
                Target::Resident(t) => crate::siege::under_roof(world, &world.residents[t]),
                Target::Machine(_) => true,
                Target::Building(_) => false,
            };
            if roofed && is_up(world, a) {
                world.residents[ri].order = None;
                continue;
            }
            // In contact from the ground with someone up: no blow reaches them, so the order ends
            // rather than waits below (`CONTEXT.md`: High ground).
            if let Target::Resident(t) = target {
                let (a, b) = (&world.residents[ri], &world.residents[t]);
                let contact = in_contact(size, tile((a.x, a.y)), tile((b.x, b.y)));
                if contact && !reaches_for_height(world, a, b) {
                    world.residents[ri].order = None;
                }
            }
            continue;
        }
        let (target_id, ticks) = match target {
            Target::Resident(t) => {
                (world.residents[t].id.clone(), attack_ticks(&world.residents[ri]))
            }
            Target::Building(b) => (world.buildings[b].id.clone(), STRIKE_TICKS),
            Target::Machine(m) => (world.siege_machines[m].id.clone(), STRIKE_TICKS),
        };
        let r = &mut world.residents[ri];
        let Some(ResidentOrder::Attack(o)) = &mut r.order else { continue };
        o.path = None;
        o.progress = 0.0;
        o.strike += 1.0 / ticks;
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
pub fn resolve_strikes(
    world: &mut WorldState,
    strikes: &[StrikeAction],
    size: i32,
    alarms: &mut dyn Alarms,
    made: &mut GoodsMade,
) -> CombatResult {
    let mut killers: Vec<(String, String)> = Vec::new();
    let mut died: Vec<String> = Vec::new();
    let mut broken: Vec<Building> = Vec::new();
    let mut machines_broken: Vec<String> = Vec::new();
    let mut blows = 0;
    for StrikeAction { attacker_id, target_id } in strikes {
        let Some(ai) = world.residents.iter().position(|x| x.id == *attacker_id) else { continue };
        let Some(target) = attack_target(world, target_id) else { continue };
        if world.residents[ai].health <= 0.0 {
            continue;
        }
        let a = &world.residents[ai];
        let Some(ResidentOrder::Attack(o)) = &a.order else { continue };
        let real_id = match target {
            Target::Resident(t) => &world.residents[t].id,
            Target::Building(b) => &world.buildings[b].id,
            Target::Machine(m) => &world.siege_machines[m].id,
        };
        if o.target_id != *real_id || !reaches(world, size, ai, target) {
            continue;
        }
        let started = o.started;
        let ti = match target {
            Target::Building(bi) => {
                blows += 1;
                let wall_id = world.buildings[bi].id.clone();
                alarms.raise_wall_attacked(world, attacker_id, &wall_id, size);
                if let Some(b) = break_wall(world, ai, &wall_id, size, made) {
                    broken.push(b);
                }
                wear_slot(world, ai, Slot::Weapon, 1.0);
                continue;
            }
            Target::Machine(mi) => {
                blows += 1;
                let machine_id = world.siege_machines[mi].id.clone();
                if break_machine(world, ai, &machine_id, size, made) {
                    machines_broken.push(machine_id);
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
        // A shot looses one of the Arrows they carry, whether it lands or not (`CONTEXT.md`:
        // Ranged combat).
        let shot = shooting_weapon(&world.residents[ai]);
        if shot.is_some() {
            let carried = &mut world.residents[ai].carried;
            let left = held(carried, Good::Arrows) - 1.0;
            if left > 0.0 {
                carried.insert(Good::Arrows, left);
            } else {
                carried.shift_remove(&Good::Arrows);
            }
        }
        let learned_a = combat_learned(&world.residents[ai], tf);
        *world.residents[ai].skills.entry(csp_shared::world::SkillName::Combat).or_insert(0.0) +=
            learned_a;
        let learned_t = combat_learned(&world.residents[ti], tf);
        *world.residents[ti].skills.entry(csp_shared::world::SkillName::Combat).or_insert(0.0) +=
            learned_t;
        let roll = Mulberry32::new(f64::from(hash_str(&format!(
            "{}:{}:{}:strike",
            world.seed, tick, attacker_id
        ))))
        .next();
        let t = &world.residents[ti];
        let climbing = matches!(t.order, Some(ResidentOrder::Climb(_)));
        if !down && !climbing && roll < dodge_chance(t, tf) {
            // The blow was struck, if not taken (`CONTEXT.md`: Wear).
            wear_slot(world, ai, Slot::Weapon, 1.0);
            continue;
        }
        let cover = if on_own_wall(world, t) { WALL_DEFENCE } else { 1.0 };
        let damage = match shot {
            Some(weapon) => shot_damage(&world.residents[ai], t, weapon),
            None => blow_damage(&world.residents[ai], t, tf),
        } * cover;
        // The gear fights as well as new up to the blow that breaks it (`CONTEXT.md`: Wear).
        wear_slot(world, ai, Slot::Weapon, 1.0);
        wear_slot(world, ti, Slot::Shield, 1.0);
        wear_slot(world, ti, Slot::Armour, 1.0);
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
    let named = move |id: &str| killers.iter().find(|(k, _)| k == id).map(|(_, by)| by.clone());
    let (_, ended) = die_all(world, &died, DeathCause::Killed, size, Some(&named));
    if !broken.is_empty() {
        update_city_membership(world, size);
    }
    let gone: HashSet<&str> = died
        .iter()
        .map(String::as_str)
        .chain(broken.iter().map(|b| b.id.as_str()))
        .chain(machines_broken.iter().map(String::as_str))
        .collect();
    for r in &mut world.residents {
        if matches!(&r.order, Some(ResidentOrder::Attack(o)) if gone.contains(o.target_id.as_str()))
        {
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
fn break_wall(
    world: &mut WorldState,
    ai: usize,
    wall_id: &str,
    size: i32,
    made: &mut GoodsMade,
) -> Option<Building> {
    let tick = world.tick as f64;
    let learned = combat_learned(&world.residents[ai], tick);
    *world.residents[ai].skills.entry(csp_shared::world::SkillName::Combat).or_insert(0.0) +=
        learned;
    let power = attack_power(&world.residents[ai], tick);
    let bi = world.buildings.iter().position(|b| b.id == wall_id)?;
    let b = &mut world.buildings[bi];
    b.damage = Some(wall_strength(b).min(b.damage.unwrap_or(0.0) + power));
    if wall_strength_left(b) > 0.0 {
        return None;
    }
    let victim_org = building_organization(world, &world.buildings[bi]);
    let against = CrimeAgainst {
        victim_org,
        building: Some(world.buildings[bi].kind),
        ..CrimeAgainst::default()
    };
    let attacker_id = world.residents[ai].id.clone();
    commit_crime(world, size, CrimeKind::TearDown, &attacker_id, against);
    let b = world.buildings.remove(bi);
    let returned = broken_returns(&b);
    drop_goods(world, b.x, b.y, &returned, MAP_SIZE);
    made.note(&returned);
    Some(b)
}

/// A blow from the resident at `ai` at the siege machine `machine_id` (`CONTEXT.md`: Siege
/// machine): like a blow at a wall it always lands, its attacker's `attackPower` going onto the
/// machine's damage, and teaches Combat. Once it has taken its strength it breaks: it is gone, its
/// crew with it no longer, and `BROKEN_MATERIALS_RETURNED` of its materials lie on its tile.
/// Breaking another Organization's machine is a crime of tearing down by whoever strikes the last
/// blow. Returns whether it broke.
fn break_machine(
    world: &mut WorldState,
    ai: usize,
    machine_id: &str,
    size: i32,
    made: &mut GoodsMade,
) -> bool {
    let tick = world.tick as f64;
    let learned = combat_learned(&world.residents[ai], tick);
    *world.residents[ai].skills.entry(csp_shared::world::SkillName::Combat).or_insert(0.0) +=
        learned;
    let power = attack_power(&world.residents[ai], tick);
    let Some(mi) = crate::siege::machine_index(world, machine_id) else { return false };
    let m = &mut world.siege_machines[mi];
    let strength = crate::siege::machine_strength(m.kind);
    let damage = strength.min(m.damage.unwrap_or(0.0) + power);
    m.damage = Some(damage);
    if damage < strength {
        return false;
    }
    let against = CrimeAgainst {
        victim_org: world.siege_machines[mi].realm_id.clone(),
        building: Some(world.siege_machines[mi].kind.spec().built_as),
        ..CrimeAgainst::default()
    };
    let attacker_id = world.residents[ai].id.clone();
    commit_crime(world, size, CrimeKind::TearDown, &attacker_id, against);
    let m = world.siege_machines.remove(mi);
    let returned = crate::siege::broken_machine_returns(m.kind);
    drop_goods(world, m.x, m.y, &returned, MAP_SIZE);
    made.note(&returned);
    true
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
        .or_else(|| {
            world.traders.iter().find(|c| c.driver_id.as_deref() == me).map(|c| &c.carriage_id)
        })
        .or_else(|| {
            world
                .supply_wagons
                .iter()
                .find(|w| w.driver_id.as_deref() == me)
                .map(|w| &w.carriage_id)
        });
    let carriage = carriage_id.and_then(|id| world.carriages.iter().find(|k| k.id == *id));
    carriage.is_some_and(|k| k.x == t.x && k.y == t.y)
}

/// Gets the resident at `ti` off the carriage they are aboard. Aboard a vessel they stay, on its
/// water tile: should what they do next take them away, the walking puts them ashore first
/// (`CONTEXT.md`: Fighting at a vessel, No ferrying by itself).
fn off_carriage(world: &mut WorldState, ti: usize) {
    if crate::queries::vessels::vessel_aboard(world, &world.residents[ti]).is_none() {
        world.residents[ti].aboard = None;
    }
}

/// The resident at `ti`, hit by the one at `ai` and still alive, reacts (`react`): a Player's
/// resident runs their defence script; others, armed, fight back unless already attacking
/// someone, off any carriage they are aboard; unarmed, or struck from above with no way to strike
/// back (`CONTEXT.md`: High ground), they flee home to their city's town hall, but a driver drives on and a passenger stays aboard a carriage being driven, and so a rower
/// rows on and a passenger stays aboard a boat being rowed.
fn react(world: &mut WorldState, ti: usize, ai: usize) {
    // A blow ends the Leader's rally; it doesn't come back after the defence script.
    crate::rally::end_when_struck(world, ti);
    let t = &world.residents[ti];
    // A climber climbs on, and someone swapping gear finishes the swap first (`CONTEXT.md`:
    // Equipment): they strike no blows meanwhile.
    if t.order.as_ref().is_some_and(|o| o.ties().kept_when_struck) {
        return;
    }
    if defends_by_script(world, t) {
        start_defence(world, ti);
        return;
    }
    // Struck from above, only an archer can answer: they shoot back up (`CONTEXT.md`: Ranged combat).
    let from_above =
        is_up(world, &world.residents[ai]) && !is_up(world, t) && shooting_weapon(t).is_none();
    let attacking = matches!(t.order, Some(ResidentOrder::Attack(_)));
    if is_armed(t) && (!from_above || attacking) {
        if !attacking {
            let a_id = world.residents[ai].id.clone();
            off_carriage(world, ti);
            let t = &mut world.residents[ti];
            t.order = Some(ResidentOrder::Attack(attack_order(&a_id, true, true)));
        }
        return;
    }
    let rowing = rowed_vessel_id(t).is_some();
    if driven_carriage_id(t).is_some() || rowing || with_caravan_carriage(world, t) {
        return;
    }
    if let Some(carriage) = world.carriages.iter().find(|k| t.aboard.as_ref() == Some(&k.id)) {
        if !stands_still(world, carriage) {
            return;
        }
    }
    // A boat being rowed is the way out too (`CONTEXT.md`: Fighting at a vessel).
    if vessel_aboard(world, t).is_some_and(|v| being_rowed(world, v)) {
        return;
    }
    let Some(city) = world.cities.iter().find(|c| t.city_id.as_ref() == Some(&c.id)) else {
        return;
    };
    let Some(hall) = town_hall_of(world, city) else { return };
    let fleeing = matches!(&t.order, Some(ResidentOrder::WalkTo(o)) if o.target.x == hall.x && o.target.y == hall.y);
    if fleeing || is_at(tile((t.x, t.y)), placed(hall), MAP_SIZE) {
        return;
    }
    let (hx, hy) = (hall.x, hall.y);
    off_carriage(world, ti);
    let t = &mut world.residents[ti];
    t.order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x: hx, y: hy },
        path: None,
        progress: 0.0,
        army: None,
    }));
    let (owner, what) =
        (t.owner.clone(), RealmEventWhat::Fled { resident_id: t.id.clone(), name: t.name.clone() });
    record_event(world, owner.as_deref(), what);
}

#[cfg(test)]
mod archer_defaults_tests;
#[cfg(test)]
mod high_ground_tests;
#[cfg(test)]
mod shooting_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod wall_shooting_tests;
