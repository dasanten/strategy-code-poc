//! The Trade Organization's second step on a debt (`trade-org-wrecks.ts`, `CONTEXT.md`: Trade Org
//! debt; ADR 0025): past the deadline its army goes to that city and tears down workplaces of it,
//! each counting for its worth against the debt, until the debt is covered or none are left. Its
//! soldiers only hold tear-down orders like any Player's (ADR 0002); the crime and what falls to the
//! ground go as anyone's.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use csp_shared::balance::{WORKPLACE_MAX_WORKERS, WORKPLACE_WRECK_WORTH};
use csp_shared::footprint::is_at;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Building, BuildingKind, City, Punishment, PunishmentHeading, RealmEventWhat, ResidentOrder,
    TearDownOrder, Tile, WorldState,
};

use crate::crimes::{building_organization, city_organization, organization_of};
use crate::events::record_event;
use crate::npc_behaviour::workplace_of;
use crate::npc_chain::own_workplaces;
use crate::queries::building::workers_of;
use crate::queries::city::town_hall_of;
use crate::queries::names::{kind_name, placed};
use crate::sight::InvariantViolation;
use crate::teardown::Felled;

/// Whether `b` is on the books of an Organization other than `org` (`onOthersBooks`:
/// `Building.cityId`, `City.workplaceIds`). There is no ownership flag (`CONTEXT.md`: Holding a
/// workplace), so a workplace that is on nobody's books is only whoever's works it.
fn on_others_books(world: &WorldState, b: &Building, org: &str) -> bool {
    if building_organization(world, b).is_some_and(|o| o != org) {
        return true;
    }
    world.cities.iter().any(|c| {
        city_organization(c) != org
            && c.workplace_ids.as_ref().is_some_and(|ids| ids.contains(&b.id))
    })
}

/// Whether `b` is a finished workplace (`isWorkplace`).
fn is_workplace(b: &Building) -> bool {
    b.site.is_none() && WORKPLACE_MAX_WORKERS.get(kind_name(b.kind)).is_some()
}

/// The worth of tearing down a workplace of `kind` (`WORKPLACE_WRECK_WORTH[kind] ?? 0`).
fn wreck_worth(kind: BuildingKind) -> f64 {
    WORKPLACE_WRECK_WORTH.get(kind_name(kind)).unwrap_or(0.0)
}

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

/// The workplaces of `city` that are its Organization's (`workplacesOfCity`, `CONTEXT.md`: Holding
/// a workplace), nearest its town hall first, by index: finished ones on its books (a farm laid out
/// for it, an NPC city's `workplace_ids`) and those its residents work, also while away carrying.
/// Never one on another Organization's books or with someone of another Organization working it.
pub fn workplaces_of_city(world: &WorldState, city: &City, size: i32) -> Vec<usize> {
    let org = city_organization(city);
    let mut worked: HashSet<String> = HashSet::new();
    for r in &world.residents {
        if r.health <= 0.0
            || r.city_id.as_deref() != Some(city.id.as_str())
            || organization_of(r) != Some(org)
        {
            continue;
        }
        if let Some(id) = workplace_of(r) {
            worked.insert(id);
        }
    }
    for b in own_workplaces(world, city) {
        worked.insert(b.id.clone());
    }
    let hall = town_hall_of(world, city).map_or((0, 0), |h| tile(h.x, h.y));
    let mut out: Vec<usize> = (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            worked.contains(&b.id)
                && is_workplace(b)
                && !on_others_books(world, b, org)
                && workers_of(world, b).iter().all(|r| organization_of(r) == Some(org))
        })
        .collect();
    let d = |i: usize| {
        let b = &world.buildings[i];
        wrap_distance(size, hall, tile(b.x, b.y))
    };
    out.sort_by(|&a, &b| {
        d(a).total_cmp(&d(b)).then_with(|| world.buildings[a].id.cmp(&world.buildings[b].id))
    });
    out
}

/// Brings up to date what a wrecking army means to tear down at `city`, where it now is
/// (`findWorkplaces`): what it found stays, so a workplace doesn't escape it by its workers leaving
/// or dying, unless someone of another Organization holds it by now, and what has become a
/// workplace of the city since is added.
pub fn find_workplaces(world: &mut WorldState, pi: usize, city: &City, size: i32) {
    let org = city_organization(city);
    let by_id: HashMap<&str, &Building> =
        world.buildings.iter().map(|b| (b.id.as_str(), b)).collect();
    let known: Vec<String> = world.punishments[pi]
        .wrecks
        .iter()
        .flatten()
        .filter(|id| {
            by_id.get(id.as_str()).is_some_and(|b| {
                workers_of(world, b).iter().all(|r| organization_of(r) == Some(org))
            })
        })
        .cloned()
        .collect();
    let found: Vec<String> = workplaces_of_city(world, city, size)
        .into_iter()
        .map(|i| world.buildings[i].id.clone())
        .collect();
    let mut wrecks = known.clone();
    wrecks.extend(found.into_iter().filter(|id| !known.contains(id)));
    world.punishments[pi].wrecks = Some(wrecks);
}

/// The workplaces a wrecking army is at now (`workplacesToWreck`), by index: the first of what it
/// means to tear down whose worth covers `owed`, so that it brings down no more than the debt asks
/// for while it works several at once.
pub fn workplaces_to_wreck(world: &WorldState, p: &Punishment, owed: f64) -> Vec<usize> {
    let mut out = Vec::new();
    let mut worth = 0.0;
    for id in p.wrecks.iter().flatten() {
        if worth >= owed {
            break;
        }
        let Some(i) = world.buildings.iter().position(|x| &x.id == id) else { continue };
        out.push(i);
        worth += wreck_worth(world.buildings[i].kind);
    }
    out
}

/// A soldier's part in it (`tearDownNext`): they stay at the workplace they are tearing down while
/// it is among `targets`; else they walk to the nearest of them (`head_for`) and start, the same
/// order a Player gives (`tearDown`).
pub fn tear_down_next(
    world: &mut WorldState,
    ri: usize,
    targets: &[usize],
    size: i32,
    head_for: impl FnOnce(&mut WorldState, usize, (f64, f64)),
) {
    if targets.is_empty() {
        return;
    }
    let r = &world.residents[ri];
    if let Some(ResidentOrder::TearDown(o)) = &r.order {
        if targets.iter().any(|&b| world.buildings[b].id == o.building_id) {
            return;
        }
    }
    let at = tile(r.x, r.y);
    let d = |b: usize| wrap_distance(size, at, tile(world.buildings[b].x, world.buildings[b].y));
    // The first of the nearest, as `reduce` with `<` keeps.
    let mut b = targets[0];
    for &c in &targets[1..] {
        if d(c) < d(b) {
            b = c;
        }
    }
    let building = &world.buildings[b];
    if !is_at(at, placed(building), size) {
        let to = (building.x, building.y);
        head_for(world, ri, to);
    } else {
        let id = building.id.clone();
        let r = &mut world.residents[ri];
        r.order = Some(ResidentOrder::TearDown(TearDownOrder {
            building_id: id,
            at: Tile { x: r.x, y: r.y },
        }));
    }
}

/// One building a punishment's soldier brought down this tick, for the invariant (`WreckRecord`).
#[derive(Debug, Clone, PartialEq)]
pub struct WreckRecord {
    pub resident_id: String,
    pub building_id: String,
    pub kind: BuildingKind,
    /// The Organization on whose books it was as it fell, if any.
    pub org: Option<String>,
    pub culprit_org: String,
    /// Whether the punishment had it down to tear down.
    pub listed: bool,
}

thread_local! {
    /// What punishments' soldiers brought down in the latest tick, kept beside the world
    /// (`ledger`): by the world's address, as the TypeScript keeps it by the world object.
    static LEDGER: RefCell<HashMap<usize, Vec<WreckRecord>>> = RefCell::new(HashMap::new());
}

fn key(world: &WorldState) -> usize {
    world as *const WorldState as usize
}

/// What came down this tick (`countWrecked`, after `resolve_tearing_down`): a workplace a wrecking
/// army's soldier brought down counts its worth against the debt, as far as there is any, and the
/// realm log reports the building. A debt so covered is gone.
pub fn count_wrecked(world: &mut WorldState, felled: &[Felled]) {
    let mut records = Vec::new();
    for Felled { resident_id, building: b } in felled {
        let Some(pi) = world
            .punishments
            .iter()
            .position(|x| x.members.iter().any(|m| &m.resident_id == resident_id))
        else {
            continue;
        };
        let p = &world.punishments[pi];
        let listed = p.heading == PunishmentHeading::Out
            && p.wrecks.as_ref().is_some_and(|w| w.contains(&b.id));
        records.push(WreckRecord {
            resident_id: resident_id.clone(),
            building_id: b.id.clone(),
            kind: b.kind,
            org: building_organization(world, b),
            culprit_org: p.culprit_org.clone(),
            listed,
        });
        if !listed {
            continue;
        }
        let culprit = p.culprit_org.clone();
        let city_id = p.city_id.clone();
        if let Some(w) = world.punishments[pi].wrecks.as_mut() {
            w.retain(|id| id != &b.id);
        }
        let di = world.debts.iter().position(|d| d.org == culprit);
        let coins = wreck_worth(b.kind).min(di.map_or(0.0, |d| world.debts[d].coins));
        let mut owed = 0.0;
        if let Some(d) = di {
            world.debts[d].coins -= coins;
            owed = world.debts[d].coins;
            let p = &mut world.punishments[pi];
            p.took += coins;
            p.worth = p.took + owed;
            if owed <= 0.0 {
                world.debts.remove(d);
            }
        }
        let city = world
            .cities
            .iter()
            .find(|c| c.id == city_id)
            .map_or_else(|| "a city".to_string(), |c| c.name.clone());
        let what = RealmEventWhat::Wrecked {
            building: b.kind,
            x: b.x,
            y: b.y,
            city_id,
            city,
            coins,
            owed,
        };
        record_event(world, Some(&culprit), what);
    }
    LEDGER.with(|l| l.borrow_mut().insert(key(world), records));
}

/// Test hook: what came down in the latest tick (`wreckRecordsOf`), and lets a test tamper with it.
pub fn with_wreck_records<T>(world: &WorldState, f: impl FnOnce(&mut Vec<WreckRecord>) -> T) -> T {
    LEDGER.with(|l| f(l.borrow_mut().entry(key(world)).or_default()))
}

/// Its army never tears down anything but the culprit's workplaces (`wrecksSound`, `CONTEXT.md`:
/// Trade Org debt; ADR 0004). Only a wrecking army on its way there holds tear-down orders, only for
/// what it means to tear down, and all that is finished workplaces; what a soldier brought down
/// this tick was one of those, on nobody's books but the culprit's.
pub fn wrecks_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |message: String, entity_ids: Vec<String>| {
        out.push(InvariantViolation { invariant: "wrecks-sound".into(), message, entity_ids })
    };
    let by_id: HashMap<&str, &Building> =
        world.buildings.iter().map(|b| (b.id.as_str(), b)).collect();
    for p in &world.punishments {
        for id in p.wrecks.iter().flatten() {
            if let Some(b) = by_id.get(id.as_str()) {
                if !is_workplace(b) {
                    fail(
                        format!(
                            "punishment {} means to tear down {} {id}",
                            p.id,
                            kind_name(b.kind)
                        ),
                        vec![p.id.clone(), id.clone()],
                    );
                }
            }
        }
        for m in &p.members {
            let order = world
                .residents
                .iter()
                .find(|r| r.id == m.resident_id)
                .and_then(|r| r.order.as_ref());
            let Some(ResidentOrder::TearDown(o)) = order else { continue };
            let listed = p.wrecks.as_ref().is_some_and(|w| w.contains(&o.building_id));
            if p.heading != PunishmentHeading::Out || !listed {
                fail(
                    format!(
                        "{} of punishment {} is tearing down {}",
                        m.resident_id, p.id, o.building_id
                    ),
                    vec![p.id.clone(), m.resident_id.clone(), o.building_id.clone()],
                );
            }
        }
    }
    let records = LEDGER.with(|l| l.borrow().get(&key(world)).cloned().unwrap_or_default());
    for w in records {
        let ids = vec![w.resident_id.clone(), w.building_id.clone()];
        if !w.listed {
            fail(
                format!("{} brought down {}, not on its list", w.resident_id, w.building_id),
                ids.clone(),
            );
        }
        if WORKPLACE_MAX_WORKERS.get(kind_name(w.kind)).is_none() {
            fail(
                format!(
                    "{} brought down {} {}, no workplace",
                    w.resident_id,
                    kind_name(w.kind),
                    w.building_id
                ),
                ids.clone(),
            );
        }
        if let Some(org) = w.org.as_deref().filter(|o| *o != w.culprit_org) {
            fail(
                format!(
                    "{} brought down {} of {org}, not {}",
                    w.resident_id, w.building_id, w.culprit_org
                ),
                ids,
            );
        }
    }
    out
}

#[cfg(test)]
mod tests;
