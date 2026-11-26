//! A world built from what one Player is sent (T122.4, ADR 0045): the client's mirror of the
//! world, kept in the rules module's memory and read by the same rules as the server's world.
//!
//! The server sends what is in the Player's sight as [`SeenEntity`]s (`sight.rs`), the `welcome`
//! message all of it and each `tick` message what changed and what left. [`SightMirror`] turns them
//! back into the world's own types and keeps them in place, each found by id, so a tick costs what
//! it changed.
//!
//! What a Player isn't sent gets a default, each documented where it is filled in below and listed
//! in `docs/wasm-rules.md` with the rules it can change: a stranger's health and hunger read as
//! full, a load or stock not seen inside as empty, a script's memory as empty, everything out of
//! sight as not there at all (realms, events, crimes, contracts and the rest of `WorldState`).

use std::collections::HashMap;

use csp_shared::balance::{MAX_HEALTH, MAX_HUNGER};
use csp_shared::protocol::{
    ScriptIdOnly, SeenArmy, SeenCaravan, SeenCarriage, SeenEntity, SeenHorse, SeenInterrupted,
    SeenMachine, SeenResident, SeenScript, SeenTrader, SeenVessel,
};
use csp_shared::world::{
    Army, Caravan, CaravanStop, Carriage, Horse, Interrupted, Patch, Resident, RunningScript,
    SiegeMachine, Trader, TraderStop, Vessel, WorldState,
};

/// Down until when, for someone seen to be Down without being told until when: as long as it
/// lasts. `is_down` only asks whether there is one.
pub const DOWN_UNTIL_UNSEEN: f64 = f64::INFINITY;

/// Which of the world's lists something in sight is kept in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Resident,
    Building,
    City,
    Horse,
    Carriage,
    Pile,
    Army,
    Caravan,
    Trader,
    Vessel,
    Machine,
    Patch,
}

/// What one Player sees, as a world the rules read.
#[derive(Debug, Default)]
pub struct SightMirror {
    size: i32,
    world: WorldState,
    /// Where each thing in sight stands in its list of `world`.
    at: HashMap<String, (Kind, usize)>,
}

impl SightMirror {
    pub fn new() -> Self {
        Self::default()
    }

    /// The world as far as the Player sees it.
    pub fn world(&self) -> &WorldState {
        &self.world
    }

    /// The map's size, from the `welcome` message.
    pub fn size(&self) -> i32 {
        self.size
    }

    /// How many things are in sight.
    pub fn count(&self) -> usize {
        self.at.len()
    }

    /// Starts over from a `welcome` message: the map's `size` and everything in sight, in the
    /// server's order.
    pub fn welcome(&mut self, size: i32, entities: impl IntoIterator<Item = SeenEntity>) {
        let tick = self.world.tick;
        self.size = size;
        self.world = WorldState::default();
        self.at.clear();
        for e in entities {
            self.put(e);
        }
        self.changed(tick);
    }

    /// Takes in a `tick` message: what came into sight or changed, then what left it.
    pub fn tick(&mut self, changed: impl IntoIterator<Item = SeenEntity>, gone: &[String]) {
        let tick = self.world.tick;
        for e in changed {
            self.put(e);
        }
        for id in gone {
            self.remove(id);
        }
        self.changed(tick);
    }

    /// The lookups the rules keep (`world_index`) have the tick in their stamp: a new one each
    /// update, so they are built again on their next use.
    fn changed(&mut self, tick: u64) {
        self.world.tick = tick + 1;
    }

    /// Something in sight, new or changed: changed in place, new at the end of its list.
    fn put(&mut self, e: SeenEntity) {
        let id = e.id().to_string();
        let w = &mut self.world;
        let (kind, len) = match e {
            SeenEntity::Resident(r) => put(&mut w.residents, &self.at, &id, resident(*r)),
            SeenEntity::Building(b) => put(&mut w.buildings, &self.at, &id, b.building),
            SeenEntity::City(c) => put(&mut w.cities, &self.at, &id, c.city),
            SeenEntity::Horse(h) => put(&mut w.horses, &self.at, &id, horse(h)),
            SeenEntity::Carriage(k) => put(&mut w.carriages, &self.at, &id, carriage(k)),
            SeenEntity::Pile(p) => put(&mut w.piles, &self.at, &id, p),
            SeenEntity::Army(a) => put(&mut w.armies, &self.at, &id, army(a)),
            SeenEntity::Caravan(c) => put(&mut w.caravans, &self.at, &id, caravan(c)),
            SeenEntity::Trader(t) => put(&mut w.traders, &self.at, &id, trader(t)),
            SeenEntity::Vessel(v) => put(&mut w.vessels, &self.at, &id, vessel(v)),
            SeenEntity::Machine(m) => put(&mut w.siege_machines, &self.at, &id, machine(m)),
            SeenEntity::Patch(p) => {
                let patch = Patch { x: p.x, y: p.y, left: p.left, at: p.at };
                put(&mut w.patches, &self.at, &id, patch)
            }
        };
        // `put` answers `None` for one it changed in place, else the new one's place.
        if let Some(at) = len {
            self.at.insert(id, (kind, at));
        }
    }

    /// Something that left sight. The others keep their order, as the server's lists do.
    fn remove(&mut self, id: &str) {
        let Some((kind, i)) = self.at.remove(id) else { return };
        let w = &mut self.world;
        match kind {
            Kind::Resident => drop(w.residents.remove(i)),
            Kind::Building => drop(w.buildings.remove(i)),
            Kind::City => drop(w.cities.remove(i)),
            Kind::Horse => drop(w.horses.remove(i)),
            Kind::Carriage => drop(w.carriages.remove(i)),
            Kind::Pile => drop(w.piles.remove(i)),
            Kind::Army => drop(w.armies.remove(i)),
            Kind::Caravan => drop(w.caravans.remove(i)),
            Kind::Trader => drop(w.traders.remove(i)),
            Kind::Vessel => drop(w.vessels.remove(i)),
            Kind::Machine => drop(w.siege_machines.remove(i)),
            Kind::Patch => drop(w.patches.remove(i)),
        }
        for (k, at) in self.at.values_mut() {
            if *k == kind && *at > i {
                *at -= 1;
            }
        }
    }
}

/// What can be kept in one of the world's lists, and in which.
trait Kept {
    const KIND: Kind;
}

macro_rules! kept {
    ($($ty:ty => $kind:ident,)*) => {
        $(impl Kept for $ty {
            const KIND: Kind = Kind::$kind;
        })*
    };
}

kept! {
    Resident => Resident,
    csp_shared::world::Building => Building,
    csp_shared::world::City => City,
    Horse => Horse,
    Carriage => Carriage,
    csp_shared::world::Pile => Pile,
    Army => Army,
    Caravan => Caravan,
    Trader => Trader,
    Vessel => Vessel,
    SiegeMachine => Machine,
    Patch => Patch,
}

/// Puts `item` into `list` in place of the one with its id, or at the end: its kind, and its new
/// place if it is new.
fn put<T: Kept>(
    list: &mut Vec<T>,
    at: &HashMap<String, (Kind, usize)>,
    id: &str,
    item: T,
) -> (Kind, Option<usize>) {
    match at.get(id) {
        Some(&(kind, i)) if kind == T::KIND => {
            list[i] = item;
            (kind, None)
        }
        _ => {
            list.push(item);
            (T::KIND, Some(list.len() - 1))
        }
    }
}

/// The script someone runs, as far as it is seen: which one, its task and what its Doing line
/// says. Its memory isn't sent: empty here.
fn script(s: SeenScript) -> RunningScript {
    RunningScript {
        script_id: s.script_id,
        task: s.task,
        memory: Default::default(),
        settings_from: s.settings_from,
        error_logged_at: None,
        budget_logged_at: None,
        last_error: None,
        last_run: None,
        // Since when isn't sent; that it waits is.
        waiting_since: s.waiting.filter(|w| *w).map(|_| 0.0),
        alarm: None,
        alarm_under: None,
    }
}

/// An army's script, of which only the id is seen.
fn script_id_only(s: ScriptIdOnly) -> RunningScript {
    script(SeenScript::only(s.script_id))
}

/// A resident as far as they are seen. Health, hunger and since when they are Down only for those
/// whose fare the Player sees: a stranger reads as full health and fed, and Down without an end.
/// Never sent: their script's memory and log, whether an order holds against blows, the Alarm
/// that a defence script interrupted.
pub fn resident(r: SeenResident) -> Resident {
    Resident {
        id: r.id,
        name: r.name,
        game_name: r.game_name,
        owner: r.owner,
        city_id: r.city_id,
        x: r.x,
        y: r.y,
        stats: r.stats,
        skills: r.skills,
        health: r.health.unwrap_or(MAX_HEALTH),
        hunger: r.hunger.unwrap_or(MAX_HUNGER),
        born_at: r.born_at,
        lifespan: r.lifespan,
        carried: r.carried,
        equipped: r.equipped,
        order: r.order,
        order_ended: r.order_ended,
        struck: r.struck,
        script: r.script.map(script),
        interrupted: r.interrupted.map(|i: SeenInterrupted| Interrupted {
            order: i.order,
            script: i.script.map(script),
            alarm: None,
        }),
        given_under_attack: None,
        defence_script_id: r.defence_script_id,
        alarm_script_id: r.alarm_script_id,
        script_params: r.script_params,
        script_log: None,
        queue: r.queue,
        pair: r.pair,
        carrying: r.carrying,
        riding: r.riding,
        aboard: r.aboard,
        down_until: r.down_until.or(r.down.filter(|d| *d).map(|_| DOWN_UNTIL_UNSEEN)),
        up: r.up,
    }
}

/// A horse as far as it is seen: a stranger's reads as full health and fed, and Down without an
/// end.
/// A horse as far as it is seen: a stranger's reads as fed and unhurt.
pub fn horse(h: SeenHorse) -> Horse {
    Horse {
        id: h.id,
        name: h.name,
        realm_id: h.realm_id,
        city_id: h.city_id,
        x: h.x,
        y: h.y,
        hunger: h.hunger.unwrap_or(MAX_HUNGER),
        health: h.health.unwrap_or(MAX_HEALTH),
        stats: h.stats,
        born_at: h.born_at,
        down_until: h.down_until.or(h.down.filter(|d| *d).map(|_| DOWN_UNTIL_UNSEEN)),
    }
}

/// A carriage: its load only when seen inside, else empty (its load level is sent, not kept).
fn carriage(k: SeenCarriage) -> Carriage {
    Carriage {
        id: k.id,
        realm_id: k.realm_id,
        city_id: k.city_id,
        x: k.x,
        y: k.y,
        horse_id: k.horse_id,
        load: k.load.unwrap_or_default(),
    }
}

/// A vessel: its load only when seen inside, else empty.
fn vessel(v: SeenVessel) -> Vessel {
    Vessel {
        id: v.id,
        kind: v.kind,
        realm_id: v.realm_id,
        x: v.x,
        y: v.y,
        load: v.load.unwrap_or_default(),
        rower_id: v.rower_id,
        crew_ids: v.crew_ids,
    }
}

fn machine(m: SeenMachine) -> SiegeMachine {
    SiegeMachine {
        id: m.id,
        kind: m.kind,
        realm_id: m.realm_id,
        x: m.x,
        y: m.y,
        damage: m.damage,
        teardown: m.teardown,
        crew_ids: m.crew_ids,
    }
}

/// One of the Player's armies; its script's memory isn't sent.
fn army(a: SeenArmy) -> Army {
    Army {
        id: a.id,
        name: a.name,
        realm_id: a.realm_id,
        member_ids: a.member_ids,
        order: a.order,
        script: a.script.map(script_id_only),
    }
}

/// A Trade Org caravan: who it is and which way it heads. Where at a stop it stands, what it
/// loads and its job aren't sent: at the storage, with nothing to do.
fn caravan(c: SeenCaravan) -> Caravan {
    Caravan {
        id: c.id,
        post_id: c.post_id,
        carriage_id: c.carriage_id,
        driver_id: c.driver_id,
        escort_ids: c.escort_ids,
        heading: c.heading,
        stop: CaravanStop::Storage,
        to_load: None,
        holding: None,
        job: None,
        transfer: None,
    }
}

/// A wandering trader: who it is and which way it heads. Its plan, its stand and what it keeps
/// in mind aren't sent: at the storage, with nothing planned (its prices at a stop are sent, not
/// kept).
fn trader(t: SeenTrader) -> Trader {
    Trader {
        id: t.id,
        carriage_id: t.carriage_id,
        driver_id: t.driver_id,
        escort_ids: t.escort_ids,
        // The places it goes round aren't sent.
        r#loop: Vec::new(),
        post_id: t.post_id,
        heading: t.heading,
        stop: TraderStop::Storage,
        plan: None,
        holding: None,
        misses: 0.0,
        robberies: 0.0,
        calls: None,
        stand: None,
    }
}
