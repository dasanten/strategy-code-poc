//! Carriages and siege machines: who drives and rides them, and their haul routes.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    carriage_can_enter, CARRIAGE_CAPACITY, CARRIAGE_MAX_CAPACITY, GOOD_WEIGHT, PASSENGER_WEIGHT,
};
use csp_shared::terrain::{terrain_at, Terrain, TerrainMap};
use csp_shared::world::{HaulPhase, HaulStop, ResidentOrder, WorldState};

use super::shared::{driven_carriage_id, of_resident, Out};
use super::{invariant, js_number, violation, Invariant};
use crate::queries::alliance::{carriage_commander_of, commander_of};
use crate::queries::building::carriage_can_go_to;
use crate::queries::names::good_name;
use crate::queries::residents::{can_work, stock_weight};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("carriages-in-place", carriages_in_place),
    invariant("siege-machines-in-place", siege_machines_in_place),
    invariant("passengers-aboard", passengers_aboard),
    invariant("drivers-on-carriages", drivers_on_carriages),
    invariant("haul-routes-sound", haul_routes_sound),
];

/// Carriages keep to the rules (`carriagesInPlace`, `CONTEXT.md`: Carriage).
pub fn carriages_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "carriages-in-place";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String, ids: &[&str]| {
        let ids = if ids.is_empty() { vec![id] } else { ids.to_vec() };
        out.push(violation(name, format!("carriage {id} {m}"), &ids));
    };
    let mut pulling: HashMap<&str, &str> = HashMap::new();
    for k in &world.carriages {
        let (x, y) = (js_number(k.x), js_number(k.y));
        if !carriage_can_go_to(world, terrain, k.x as i32, k.y as i32) {
            fail(&k.id, format!("stands where no carriage can go at ({x}, {y})"), &[]);
        }
        let kg = stock_weight(&k.load);
        if kg > CARRIAGE_MAX_CAPACITY + 1e-9 {
            let m = format!(
                "holds {} kg, more than any carriage can ({} kg)",
                js_number(kg),
                js_number(CARRIAGE_MAX_CAPACITY)
            );
            fail(&k.id, m, &[]);
        }
        let Some(horse_id) = &k.horse_id else { continue };
        let horse = world.horses.iter().find(|h| &h.id == horse_id);
        match horse {
            None => fail(&k.id, format!("is hitched to {horse_id}, which doesn't exist"), &[]),
            Some(h) if h.x != k.x || h.y != k.y => {
                let m = format!(
                    "is at ({x}, {y}) but its horse at ({}, {})",
                    js_number(h.x),
                    js_number(h.y)
                );
                fail(&k.id, m, &[&k.id, &h.id]);
            }
            _ => {}
        }
        if let Some(h) = horse {
            if h.realm_id != k.realm_id || h.city_id != k.city_id {
                let m = format!("is hitched to {}, not its own realm's or city's", h.id);
                fail(&k.id, m, &[&k.id, &h.id]);
            }
        }
        if let Some(other) = pulling.get(horse_id.as_str()).copied() {
            let m = format!("shares horse {horse_id} with {other}");
            fail(&k.id, m, &[&k.id, other, horse_id]);
        }
        pulling.insert(horse_id, &k.id);
    }
    out
}

/// A siege machine stands where a carriage could and is not broken, and its crew are residents of
/// its realm on its tile (`CONTEXT.md`: Siege machine).
pub fn siege_machines_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "siege-machines-in-place";
    let mut out = Vec::new();
    for m in &world.siege_machines {
        let at = format!("({}, {})", js_number(m.x), js_number(m.y));
        if !carriage_can_go_to(world, terrain, m.x as i32, m.y as i32) {
            let msg = format!("siege machine {} stands where no carriage can go at {at}", m.id);
            out.push(violation(name, msg, &[&m.id]));
        }
        if m.damage.unwrap_or(0.0) >= crate::siege::machine_strength(m.kind) {
            out.push(violation(name, format!("siege machine {} is broken", m.id), &[&m.id]));
        }
        let mut seen: HashSet<&str> = HashSet::new();
        for id in &m.crew_ids {
            if !seen.insert(id) {
                let msg = format!("siege machine {} has {id} in its crew twice", m.id);
                out.push(violation(name, msg, &[&m.id, id]));
            }
            // A crew member is within reach of their machine: on its tile, of its realm.
            let with_it = world.residents.iter().find(|r| r.id == *id).is_some_and(|r| {
                (r.x as i32, r.y as i32) == (m.x as i32, m.y as i32)
                    && r.owner.is_some()
                    && r.owner == m.realm_id
            });
            if !with_it {
                let msg = format!("{id} of siege machine {}’s crew is not with it at {at}", m.id);
                out.push(violation(name, msg, &[&m.id, id]));
            }
        }
    }
    // A machine moves only with its crew: whoever pushes one is of its crew on its tile, with as
    // many crew as it needs there, and one at a time.
    let mut pushed: HashSet<&str> = HashSet::new();
    for r in &world.residents {
        let Some(ResidentOrder::Push(o)) = &r.order else { continue };
        let Some(m) = crate::siege::machine_by_id(world, &o.machine_id) else {
            let msg =
                format!("resident {} pushes siege machine {}, which is gone", r.id, o.machine_id);
            out.push(violation(name, msg, &[&r.id]));
            continue;
        };
        if let Some(p) = crate::siege::push_problem(world, r, m) {
            let msg = format!("resident {} pushes siege machine {}, but {p}", r.id, m.id);
            out.push(violation(name, msg, &[&r.id, &m.id]));
        }
        if !pushed.insert(&m.id) {
            let msg = format!("siege machine {} has two pushers", m.id);
            out.push(violation(name, msg, &[&m.id, &r.id]));
        }
    }
    // A ram strikes only with its crew, at a foreign wall or gate next to it (`CONTEXT.md`: Ram).
    for r in &world.residents {
        let Some(ResidentOrder::Ram(o)) = &r.order else { continue };
        let problem = match crate::siege::machine_by_id(world, &o.machine_id) {
            None => "which is gone".to_string(),
            Some(m) => match crate::siege::ram_problem(world, r, m, &o.target_id) {
                None => continue,
                Some(p) => p,
            },
        };
        let msg =
            format!("resident {} rams {} with {}, but {problem}", r.id, o.target_id, o.machine_id);
        out.push(violation(name, msg, &[&r.id]));
    }
    // A catapult throws only with its crew and a Stone at hand, at a foreign wall or gate in its
    // reach (`CONTEXT.md`: Catapult).
    for r in &world.residents {
        let Some(ResidentOrder::Throw(o)) = &r.order else { continue };
        let problem = match crate::siege::machine_by_id(world, &o.machine_id) {
            None => "which is gone".to_string(),
            Some(m) => match crate::siege::throw_problem(world, r, m, &o.target_id) {
                None => continue,
                Some(p) => p,
            },
        };
        let msg = format!(
            "resident {} throws at {} with {}, but {problem}",
            r.id, o.target_id, o.machine_id
        );
        out.push(violation(name, msg, &[&r.id]));
    }
    // Nobody up struck one of a ram's crew under its roof this tick.
    for r in world.residents.iter().filter(|r| crate::siege::under_roof(world, r)) {
        let Some(s) = r.struck.as_ref().filter(|s| s.tick + 1.0 == world.tick as f64) else {
            continue;
        };
        let by = world.residents.iter().find(|a| a.id == s.by);
        if by.is_some_and(|a| crate::queries::walls::is_up(world, a)) {
            let msg = format!("{} under a ram's roof was struck from above by {}", r.id, s.by);
            out.push(violation(name, msg, &[&r.id, &s.by]));
        }
    }
    out
}

/// A passenger's carriage exists, is of their realm and stands on their tile, and they neither
/// drive nor ride; goods and passengers never weigh more than any carriage holds
/// (`passengersAboard`).
pub fn passengers_aboard(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "passengers-aboard";
    let mut out = Vec::new();
    let mut fail = |ids: &[&str], m: String| out.push(violation(name, m, ids));
    let mut aboard: HashMap<&str, f64> = HashMap::new();
    for r in &world.residents {
        let Some(on) = &r.aboard else { continue };
        // Aboard a vessel: `vessel-passengers`.
        if world.vessels.iter().any(|v| &v.id == on) {
            continue;
        }
        *aboard.entry(on).or_insert(0.0) += 1.0;
        let Some(k) = world.carriages.iter().find(|c| &c.id == on) else {
            fail(&[&r.id], format!("resident {} is aboard {on}, which doesn't exist", r.id));
            continue;
        };
        if k.x != r.x || k.y != r.y {
            let m = format!(
                "resident {} at ({}, {}) is aboard carriage {} at ({}, {})",
                r.id,
                js_number(r.x),
                js_number(r.y),
                k.id,
                js_number(k.x),
                js_number(k.y)
            );
            fail(&[&r.id, &k.id], m);
        }
        if !of_resident(k.realm_id.as_deref(), k.city_id.as_deref(), r) {
            let m = format!("resident {} is aboard carriage {} of another realm", r.id, k.id);
            fail(&[&r.id, &k.id], m);
        }
        if driven_carriage_id(r).is_some() {
            fail(&[&r.id, &k.id], format!("resident {} drives aboard", r.id));
        }
        if r.riding.is_some() {
            fail(&[&r.id, &k.id], format!("resident {} rides aboard", r.id));
        }
    }
    for k in &world.carriages {
        let people = aboard.get(k.id.as_str()).copied().unwrap_or(0.0);
        let kg = stock_weight(&k.load) + people * PASSENGER_WEIGHT;
        if kg > CARRIAGE_MAX_CAPACITY + 1e-9 {
            let m = format!(
                "carriage {} holds {} kg of goods and passengers, more than any can",
                k.id,
                js_number(kg)
            );
            fail(&[&k.id], m);
        }
    }
    out
}

/// A driver stands on the carriage they drive, which exists, and is grown up; no carriage has
/// two drivers, and nobody drives another organization's carriage unless they command it
/// (`driversOnCarriages`).
pub fn drivers_on_carriages(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "drivers-on-carriages";
    let mut out = Vec::new();
    let mut driven: HashMap<&str, &str> = HashMap::new();
    for r in &world.residents {
        let Some(id) = driven_carriage_id(r) else { continue };
        let mut fail =
            |m: String| out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id, id]));
        let k = world.carriages.iter().find(|c| c.id == id);
        match k {
            None => fail(format!("drives {id}, which doesn't exist")),
            Some(k) if k.x != r.x || k.y != r.y => {
                fail(format!("drives {} but isn't on its tile", k.id))
            }
            _ => {}
        }
        if let Some(k) = k {
            // `organizationOf`, `carriageOrganization` (T86.7's `crimes.ts`).
            let org = r.owner.as_deref().or(r.city_id.as_deref());
            let carriage_org = k.realm_id.as_deref().or(k.city_id.as_deref());
            if org != carriage_org
                && commander_of(world, &r.id, r.owner.as_deref()) != carriage_commander_of(world, k)
            {
                fail(format!("drives {} of another organization without commanding it", k.id));
            }
        }
        if !can_work(r.born_at, world.tick as f64) {
            fail("drives as a child".into());
        }
        if let Some(other) = driven.get(id).copied() {
            fail(format!("drives {id} together with {other}"));
        }
        driven.insert(id, &r.id);
    }
    out
}

/// Haul routes stay sound (`haulRoutesSound`, `CONTEXT.md`: Haul route, Supply line).
pub fn haul_routes_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "haul-routes-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Haul(o)) = &r.order else { continue };
        let mut fail = |m: String| {
            out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id, &o.carriage_id]))
        };
        let (from, to) = (o.from, o.to);
        // An army stop is wherever the army is (`CONTEXT.md`: Supply line).
        let to_army = o.to_army.is_some();
        if !to_army && from.x == to.x && from.y == to.y {
            fail("hauls between one tile and itself".into());
        }
        // A stop on a road over Mountain may lose its road later; the route then finds no way.
        let stops: &[csp_shared::world::Tile] = if to_army { &[from] } else { &[from, to] };
        for s in stops {
            let t = terrain_at(terrain, s.x as i32, s.y as i32);
            if !carriage_can_enter(t) && t != Terrain::Mountain as u8 {
                let m = format!(
                    "hauls to ({}, {}), where no carriage can go",
                    js_number(s.x),
                    js_number(s.y)
                );
                fail(m);
            }
        }
        if o.goods.is_empty() {
            fail("hauls no goods".into());
        }
        let both: Vec<&str> =
            o.return_goods.iter().filter(|g| o.goods.contains(g)).map(|g| good_name(*g)).collect();
        if !both.is_empty() {
            fail(format!("hauls {} both ways", both.join(", ")));
        }
        if to_army && !o.return_goods.is_empty() {
            fail("hauls goods back from an army".into());
        }
        let food_kg = GOOD_WEIGHT.get("food").unwrap_or(0.0);
        if o.keep_food < 0.0 || o.keep_food * food_kg > CARRIAGE_CAPACITY {
            fail(format!("keeps {} Food for the horse", js_number(o.keep_food)));
        }
        let stop = if o.stop == HaulStop::From { from } else { to };
        let stop_name = if o.stop == HaulStop::From { "from" } else { "to" };
        let with_army = to_army && o.stop == HaulStop::To;
        if with_army && o.moving.is_some() {
            fail("holds goods for the route at an army".into());
        }
        if o.phase == HaulPhase::Loading && !with_army && (r.x != stop.x || r.y != stop.y) {
            fail(format!(
                "loads at the {stop_name} stop but stands at ({}, {})",
                js_number(r.x),
                js_number(r.y)
            ));
        }
        if o.phase == HaulPhase::Driving && o.moving.is_some() {
            fail("holds goods for the route while driving".into());
        }
    }
    out
}
