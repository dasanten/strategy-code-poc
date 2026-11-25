//! Boats and ships: where they float, who is aboard, and their haul routes.

use std::collections::HashMap;

use csp_shared::balance::{GOOD_WEIGHT, PASSENGER_WEIGHT};
use csp_shared::terrain::{is_passable_terrain, is_water, terrain_at, TerrainMap};
use csp_shared::world::{HaulPhase, HaulStop, ResidentOrder, VesselKind, WorldState};

use super::shared::{driven_carriage_id, of_resident, Out};
use super::{invariant, js_number, violation, Invariant};
use crate::queries::residents::{can_work, stock_weight};
use crate::queries::vessels::{floats_on, rowing_now, vessel_capacity, vessel_of_resident};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("vessels-in-place", vessels_in_place),
    invariant("vessel-passengers", vessel_passengers),
    invariant("ship-crew", ship_crew),
    invariant("water-haul-routes-sound", water_haul_routes_sound),
];

/// A vessel always stands on a water tile, one vessel per tile (`CONTEXT.md`: Vessel, Boat), and a
/// ship on Sea, never Lake (`CONTEXT.md`: Ship). That it holds no more than it can, its passengers
/// counted in, is `vessel-passengers`.
pub fn vessels_in_place(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "vessels-in-place";
    let mut out = Vec::new();
    let mut on: HashMap<(i32, i32), &str> = HashMap::new();
    for v in &world.vessels {
        let (x, y) = (v.x as i32, v.y as i32);
        let at = format!("({}, {})", js_number(v.x), js_number(v.y));
        let t = terrain_at(terrain, x, y);
        if !is_water(t) {
            out.push(violation(name, format!("vessel {} is on land at {at}", v.id), &[&v.id]));
        } else if !floats_on(v.kind, t) {
            out.push(violation(name, format!("ship {} is on a Lake at {at}", v.id), &[&v.id]));
        }
        if let Some(other) = on.insert((x, y), &v.id) {
            let m = format!("vessel {} shares the water tile {at} with {other}", v.id);
            out.push(violation(name, m, &[&v.id, other]));
        }
    }
    out
}

/// A vessel's passenger stands on its water tile, never on land, is of its realm and neither
/// drives nor rides; goods and passengers never weigh more than the vessel holds (`CONTEXT.md`:
/// Beside a vessel, Passenger, What vessels carry).
pub fn vessel_passengers(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "vessel-passengers";
    let mut out = Vec::new();
    let mut fail = |ids: &[&str], m: String| out.push(violation(name, m, ids));
    let mut aboard: HashMap<&str, f64> = HashMap::new();
    for r in &world.residents {
        let Some(v) = r.aboard.as_deref().and_then(|id| world.vessels.iter().find(|v| v.id == id))
        else {
            continue;
        };
        // Its rower and its crew are no passengers (`CONTEXT.md`: Rowing, Crew).
        if v.rower_id.as_deref() != Some(r.id.as_str()) && !v.crew_ids.contains(&r.id) {
            *aboard.entry(&v.id).or_insert(0.0) += 1.0;
        }
        let at = format!("({}, {})", js_number(r.x), js_number(r.y));
        if v.x != r.x || v.y != r.y {
            let m = format!(
                "resident {} at {at} is aboard vessel {} at ({}, {})",
                r.id,
                v.id,
                js_number(v.x),
                js_number(v.y)
            );
            fail(&[&r.id, &v.id], m);
        }
        if !is_water(terrain_at(terrain, r.x as i32, r.y as i32)) {
            fail(
                &[&r.id, &v.id],
                format!("resident {} is aboard vessel {} on land at {at}", r.id, v.id),
            );
        }
        if !of_resident(v.realm_id.as_deref(), None, r) {
            let m = format!("resident {} is aboard vessel {} of another realm", r.id, v.id);
            fail(&[&r.id, &v.id], m);
        }
        if driven_carriage_id(r).is_some() {
            fail(&[&r.id, &v.id], format!("resident {} drives aboard vessel {}", r.id, v.id));
        }
        if r.riding.is_some() {
            fail(&[&r.id, &v.id], format!("resident {} rides aboard vessel {}", r.id, v.id));
        }
    }
    // Whoever rows a boat is at its oars, aboard it and grown (`CONTEXT.md`: Rowing); a ship's
    // captain on a haul route is one of its crew aboard it (Haul route by water).
    let tick = world.tick as f64;
    for r in &world.residents {
        let Some(vessel_id) = rowing_now(r) else { continue };
        let at_oars = world.vessels.iter().any(|v| {
            let helm = match v.kind {
                VesselKind::Boat => v.rower_id.as_deref() == Some(r.id.as_str()),
                VesselKind::Ship => v.crew_ids.contains(&r.id),
            };
            v.id == vessel_id && helm && r.aboard.as_deref() == Some(v.id.as_str())
        });
        if !at_oars {
            let m =
                format!("resident {} rows vessel {} without being at its oars", r.id, vessel_id);
            fail(&[&r.id, vessel_id], m);
        }
        if !can_work(r.born_at, tick) {
            fail(&[&r.id], format!("child {} rows vessel {}", r.id, vessel_id));
        }
    }
    for v in &world.vessels {
        if let Some(rower) = v.rower_id.as_deref() {
            let aboard_it =
                world.residents.iter().any(|r| r.id == rower && r.aboard.as_deref() == Some(&v.id));
            if !aboard_it {
                fail(&[&v.id], format!("vessel {} has rower {rower}, who is not aboard", v.id));
            }
        }
        let people = aboard.get(v.id.as_str()).copied().unwrap_or(0.0);
        let kg = stock_weight(&v.load) + people * PASSENGER_WEIGHT;
        if kg > vessel_capacity(v) + 1e-9 {
            let m = format!(
                "vessel {} holds {} kg of goods and passengers, more than it can ({} kg)",
                v.id,
                js_number(kg),
                js_number(vessel_capacity(v))
            );
            fail(&[&v.id], m);
        }
    }
    out
}

/// Only a ship has a crew, and each of its crew is a grown resident of its realm aboard it, once,
/// and of no other vessel's crew (`CONTEXT.md`: Crew).
pub fn ship_crew(world: &WorldState, _terrain: &TerrainMap) -> Out {
    let name = "ship-crew";
    let mut out = Vec::new();
    let mut fail = |ids: &[&str], m: String| out.push(violation(name, m, ids));
    let mut crewing: HashMap<&str, &str> = HashMap::new();
    let tick = world.tick as f64;
    for v in &world.vessels {
        if !v.crew_ids.is_empty() && v.kind != VesselKind::Ship {
            fail(&[&v.id], format!("boat {} has a crew", v.id));
        }
        for id in &v.crew_ids {
            if let Some(other) = crewing.insert(id, &v.id) {
                fail(&[id, &v.id], format!("resident {id} crews both {other} and {}", v.id));
            }
            let Some(r) = world.residents.iter().find(|r| &r.id == id) else {
                fail(&[&v.id], format!("ship {} has crew {id}, who is gone", v.id));
                continue;
            };
            if r.aboard.as_deref() != Some(v.id.as_str()) {
                fail(&[id, &v.id], format!("crew {id} of ship {} is not aboard it", v.id));
            }
            // A crew of another realm is taking it (`CONTEXT.md`: Sailing), with nobody else aboard.
            let taking = world
                .residents
                .iter()
                .filter(|o| o.aboard.as_deref() == Some(v.id.as_str()))
                .all(|o| o.owner.is_some() && o.owner == r.owner);
            if !vessel_of_resident(v, r) && !taking {
                fail(&[id, &v.id], format!("crew {id} of ship {} is not of its realm", v.id));
            }
            if !can_work(r.born_at, tick) {
                fail(&[id, &v.id], format!("child {id} crews ship {}", v.id));
            }
        }
    }
    out
}

/// Haul routes by water stay sound (`CONTEXT.md`: Haul route by water): two different stops on
/// land, goods that go one way each, Food kept that fits on the vessel; at a stop the rower stands
/// on it, or is still aboard having just come alongside it; rowing on, they hold nothing for the
/// route and row to a water tile.
pub fn water_haul_routes_sound(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "water-haul-routes-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::HaulByWater(o)) = &r.order else { continue };
        let mut fail = |m: String| {
            out.push(violation(name, format!("resident {} {m}", r.id), &[&r.id, &o.vessel_id]))
        };
        let (from, to) = (o.from, o.to);
        if from.x == to.x && from.y == to.y {
            fail("hauls between one tile and itself".into());
        }
        for s in [from, to] {
            if !is_passable_terrain(terrain_at(terrain, s.x as i32, s.y as i32)) {
                let (x, y) = (js_number(s.x), js_number(s.y));
                fail(format!("hauls by water to ({x}, {y}), which is no land"));
            }
        }
        if o.goods.is_empty() {
            fail("hauls no goods".into());
        }
        if o.return_goods.iter().any(|g| o.goods.contains(g)) {
            fail("hauls a good both ways".into());
        }
        let v = world.vessels.iter().find(|v| v.id == o.vessel_id);
        let food_kg = GOOD_WEIGHT.get("food").unwrap_or(0.0);
        let capacity = v.map_or(f64::INFINITY, vessel_capacity);
        if o.keep_food < 0.0 || o.keep_food * food_kg > capacity {
            fail(format!("keeps {} Food for the rower", js_number(o.keep_food)));
        }
        let stop = if o.stop == HaulStop::From { from } else { to };
        let aboard = v.is_some_and(|v| r.aboard.as_deref() == Some(v.id.as_str()));
        match o.phase {
            HaulPhase::Loading => {
                let on_stop = r.aboard.is_none() && r.x == stop.x && r.y == stop.y;
                if !on_stop && !aboard {
                    fail(format!(
                        "loads at a stop but stands at ({}, {})",
                        js_number(r.x),
                        js_number(r.y)
                    ));
                }
            }
            HaulPhase::Driving => {
                if o.moving.is_some() {
                    fail("holds goods for the route while rowing".into());
                }
                let water =
                    o.water.is_some_and(|w| is_water(terrain_at(terrain, w.x as i32, w.y as i32)));
                if !water {
                    fail("rows to no water tile".into());
                }
            }
        }
    }
    out
}
