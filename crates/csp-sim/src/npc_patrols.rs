//! Soldiers on patrol (`apps/server/src/npc-patrols.ts`, `CONTEXT.md`: Soldier posts; ADR 0029).
//! A few of an NPC city's soldiers on its wall walk a round along it and its roads, one after
//! another by id, and end where they set out from. A round is plain walks to a few stops.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::{
    HOME_FOOD_LOW, NPC_PATROLS_MAX, NPC_PATROL_ROAD_STOPS, NPC_PATROL_WALL_STOPS,
    NPC_SOLDIERS_AT_GATE, NPC_SOLDIERS_ON_HALL, NPC_SOLDIERS_PER_PATROL,
};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{tile_index, wrap, wrap_delta, wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, CityJobKind, CityPatrol, CityPlan, Tile, WorldState,
};

use crate::npc_behaviour::food_of;
use crate::npc_posts::{free_soldiers, reachable_walls, soldier_posts, stands_posts};
use crate::queries::city::{is_city_building, town_hall_of};
use crate::queries::names::kind_name;
use crate::queries::residents::is_armed;
use crate::sight::InvariantViolation;
use crate::survival::refill_source;

/// How many of a city's soldiers walk a round at once, with this many on its wall or walking one
/// (`patrolsWanted`).
pub fn patrols_wanted(on_wall: usize) -> usize {
    (NPC_PATROLS_MAX as usize).min((on_wall as f64 / NPC_SOLDIERS_PER_PATROL).floor() as usize)
}

/// The next stop of a resident's round, if they are on one, taken off it (`nextStop`). A round
/// with none left is over and goes off the plan, so they stand where its last stop brought them.
pub fn next_stop(plan: &mut CityPlan, resident_id: &str) -> Option<(f64, f64)> {
    let rounds = plan.patrols.as_mut()?;
    let k = rounds.iter().position(|p| p.resident_id == resident_id)?;
    if rounds[k].stops.is_empty() {
        drop_rounds(plan, |i, _| i == k);
        return None;
    }
    let stop = rounds[k].stops.remove(0);
    Some((stop.x, stop.y))
}

/// Takes these rounds off a city's plan, the list with them once it is empty (`dropRounds`).
fn drop_rounds(plan: &mut CityPlan, mut drop: impl FnMut(usize, &CityPatrol) -> bool) {
    let left: Vec<CityPatrol> = plan
        .patrols
        .take()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter(|(i, p)| !drop(*i, p))
        .map(|(_, p)| p)
        .collect();
    plan.patrols = (!left.is_empty()).then_some(left);
}

/// Who walks a round, for a city's pass (`sharePatrols`, `CONTEXT.md`: Soldier posts). A round
/// ends early for one who is no longer a soldier at hand, or who runs low on Food where there is
/// none to take. Then, while fewer walk than `patrols_wanted`, the next by id after whoever set out
/// last takes their turn, of those its posts on the wall leave standing. The city's plan is
/// `world.city_plans[city.id]`.
pub fn share_patrols(
    world: &mut WorldState,
    city: &City,
    adults: &[usize],
    size: i32,
    terrain: Option<&TerrainMap>,
) {
    if !stands_posts(world, city) {
        if let Some(plan) = world.city_plans.get_mut(&city.id) {
            plan.patrols = None;
        }
        return;
    }
    let here: HashMap<&String, usize> =
        adults.iter().map(|&i| (&world.residents[i].id, i)).collect();
    let plan = &world.city_plans[&city.id];
    let dropped: Vec<bool> = plan
        .patrols
        .iter()
        .flatten()
        .map(|p| {
            let Some(&i) = here.get(&p.resident_id) else { return true };
            let r = &world.residents[i];
            let soldier = plan.jobs.get(&r.id).is_some_and(|j| j.kind == CityJobKind::Soldier);
            if !is_armed(&r.carried) || !soldier {
                return true;
            }
            food_of(r) < HOME_FOOD_LOW && refill_source(world, r, size).is_none()
        })
        .collect();
    drop(here);
    drop_rounds(world.city_plans.get_mut(&city.id).expect("a plan"), |i, _| dropped[i]);

    let out = world.city_plans[&city.id].patrols.as_ref().map_or(0, Vec::len);
    let free = free_soldiers(world, city, adults);
    // Too few to have any on the wall, whatever its gates: most cities, most passes.
    if ((free.len() + out) as f64) < NPC_SOLDIERS_ON_HALL + NPC_SOLDIERS_PER_PATROL {
        return;
    }
    let (gates, walls) = reachable_walls(world, city, size);
    let held = (NPC_SOLDIERS_ON_HALL + gates.len() as f64 * NPC_SOLDIERS_AT_GATE) as usize;
    let walls: Vec<Building> = walls.into_iter().cloned().collect();
    let mut ranked = free.clone();
    ranked.sort_by(|&a, &b| world.residents[a].id.cmp(&world.residents[b].id));
    let on_wall: Vec<usize> = ranked.into_iter().skip(held).collect();
    let room = patrols_wanted(on_wall.len() + out) as i64 - out as i64;
    if room <= 0 {
        return;
    }

    // Only one standing on their post sets out: that is where the round brings them back to.
    let posts = soldier_posts(world, city, &free, size, terrain);
    let plan = &world.city_plans[&city.id];
    let stands: Vec<usize> = on_wall
        .into_iter()
        .filter(|&i| {
            let r = &world.residents[i];
            r.order.is_none()
                && plan.jobs.get(&r.id).is_some_and(|j| j.kind == CityJobKind::Soldier)
                && posts
                    .get(&r.id)
                    .is_some_and(|p| p.tiles.contains(&tile_index(size, r.x as i32, r.y as i32)))
        })
        .collect();
    let last = plan.patrolled_last.clone().unwrap_or_default();
    let id = |i: &usize| world.residents[*i].id.clone();
    let mut in_turn: Vec<usize> = stands.iter().copied().filter(|i| id(i) > last).collect();
    in_turn.extend(stands.iter().copied().filter(|i| id(i) <= last));
    let way = round_stops(world, city, &walls, size);
    if way.is_empty() {
        return;
    }
    for i in in_turn.into_iter().take(room as usize) {
        let r = &world.residents[i];
        let (rid, at) = (r.id.clone(), (r.x, r.y));
        let mut stops = nearest_first(&way, at, size);
        stops.push(at);
        let plan = world.city_plans.get_mut(&city.id).expect("a plan");
        let stops = stops.into_iter().map(|(x, y)| Tile { x, y }).collect();
        plan.patrols
            .get_or_insert_with(Vec::new)
            .push(CityPatrol { resident_id: rid.clone(), stops });
        plan.patrolled_last = Some(rid);
    }
}

/// The stops of a round in a city (`roundStops`): along the longest stretch of its `walls` in order
/// round its hall, then along its roads inside it. A city with neither has no round.
fn round_stops(world: &WorldState, city: &City, walls: &[Building], size: i32) -> Vec<(f64, f64)> {
    let hall = town_hall_of(world, city).expect("stands posts");
    let side = f64::from(FOOTPRINT.get(kind_name(hall.kind)).expect("a footprint")) / 2.0;
    let round = |tiles: Vec<(f64, f64)>| -> Vec<(f64, f64)> {
        // `wrapDelta` of the TypeScript on a half tile: `hall + side` may end in .5.
        let delta = |from: f64, to: f64| {
            let d = (to - from).rem_euclid(f64::from(size));
            if d > f64::from(size) / 2.0 {
                d - f64::from(size)
            } else {
                d
            }
        };
        let mut by: Vec<((f64, f64), f64)> = tiles
            .into_iter()
            .map(|t| (t, delta(hall.y + side, t.1).atan2(delta(hall.x + side, t.0))))
            .collect();
        by.sort_by(|a, b| a.1.total_cmp(&b.1));
        by.into_iter().map(|(t, _)| t).collect()
    };
    let stretch = longest_stretch(walls, size).iter().map(|w| (w.x, w.y)).collect();
    let along = thin(round(stretch), NPC_PATROL_WALL_STOPS as usize);
    let inside = roads_inside(world, city, hall, size).iter().map(|b| (b.x, b.y)).collect();
    let roads = thin(round(inside), NPC_PATROL_ROAD_STOPS as usize);
    let mut out = along.clone();
    match along.last() {
        Some(&end) => out.extend(nearest_first(&roads, end, size)),
        None => out.extend(roads),
    }
    out
}

/// `n` of `list`, evenly spread, in its order; all of a shorter one (`thin`).
fn thin<T: Clone>(list: Vec<T>, n: usize) -> Vec<T> {
    if list.len() <= n {
        return list;
    }
    (0..n).map(|i| list[i * list.len() / n].clone()).collect()
}

/// A ring of tiles from the one nearest `from`, going on the way it goes (`nearestFirst`).
fn nearest_first(tiles: &[(f64, f64)], from: (f64, f64), size: i32) -> Vec<(f64, f64)> {
    let d = |t: (f64, f64)| {
        wrap_distance(size, (from.0 as i32, from.1 as i32), (t.0 as i32, t.1 as i32))
    };
    let mut at = 0;
    for (i, t) in tiles.iter().enumerate() {
        if d(*t) < d(tiles[at]) {
            at = i;
        }
    }
    tiles[at..].iter().chain(&tiles[..at]).copied().collect()
}

/// The longest stretch of `walls` joined side to side (`longestStretch`): of a big city with an
/// inner ring, its outer one.
fn longest_stretch(walls: &[Building], size: i32) -> Vec<&Building> {
    let mut left: HashMap<usize, &Building> =
        walls.iter().map(|w| (tile_index(size, w.x as i32, w.y as i32), w)).collect();
    let mut longest: Vec<&Building> = Vec::new();
    for start in walls {
        if left.remove(&tile_index(size, start.x as i32, start.y as i32)).is_none() {
            continue;
        }
        let mut stretch = vec![start];
        let mut i = 0;
        while i < stretch.len() {
            let (x, y) = (stretch[i].x as i32, stretch[i].y as i32);
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let t = tile_index(size, wrap(x + dx, size), wrap(y + dy, size));
                if let Some(next) = left.remove(&t) {
                    stretch.push(next);
                }
            }
            i += 1;
        }
        if stretch.len() > longest.len() {
            longest = stretch;
        }
    }
    longest
}

/// The finished roads as near a city's hall as the furthest of its city buildings
/// (`roadsInside`).
fn roads_inside<'w>(
    world: &'w WorldState,
    city: &City,
    hall: &Building,
    size: i32,
) -> Vec<&'w Building> {
    let from = |b: &Building| {
        wrap_delta(hall.x as i32, b.x as i32, size)
            .abs()
            .max(wrap_delta(hall.y as i32, b.y as i32, size).abs())
    };
    let mut reach = 0;
    for b in &world.buildings {
        if b.city_id.as_ref() == Some(&city.id) && is_city_building(b) {
            reach = reach.max(from(b));
        }
    }
    world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Road && b.site.is_none() && from(b) <= reach)
        .collect()
}

/// The most stops a round has: along the wall, along the roads, and back where it set out from.
const MOST_STOPS: f64 = NPC_PATROL_WALL_STOPS + NPC_PATROL_ROAD_STOPS + 1.0;

/// Invariant `npc-patrols-sound` (ADR 0004; `CONTEXT.md`: Soldier posts): no more than
/// `NPC_PATROLS_MAX` at once, each on one round of a few tiles, and none in a Trade Org city.
/// Right after a pass, each is an armed resident of the city.
pub fn npc_patrols_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        if city.realm_id.is_some() {
            continue;
        }
        let Some(plan) = world.city_plans.get(&city.id) else { continue };
        let Some(rounds) = &plan.patrols else { continue };
        let mut fail = |message: String, ids: Vec<String>| {
            out.push(InvariantViolation {
                invariant: "npc-patrols-sound".into(),
                message: format!("{} {message}", city.id),
                entity_ids: ids,
            })
        };
        let ids: Vec<String> = rounds.iter().map(|p| p.resident_id.clone()).collect();
        if rounds.is_empty() {
            fail("keeps an empty list of patrols".into(), vec![]);
        }
        if rounds.len() as f64 > NPC_PATROLS_MAX {
            fail(format!("has {} on patrol at once", rounds.len()), ids.clone());
        }
        if ids.iter().collect::<HashSet<_>>().len() < ids.len() {
            fail("has a soldier on two rounds".into(), ids.clone());
        }
        if city.trade_org.is_some() {
            fail("is the Trade Org\u{2019}s, and has patrols".into(), ids.clone());
        }
        for p in rounds {
            if p.stops.len() as f64 > MOST_STOPS {
                fail(
                    format!("has a round of {} stops", p.stops.len()),
                    vec![p.resident_id.clone()],
                );
            }
            // Only the tick after: that of the pass itself has ended, so its orders have gone out.
            if world.tick as f64 != plan.planned_at + 1.0 {
                continue;
            }
            let r = world.residents.iter().find(|x| x.id == p.resident_id);
            if let Some(r) = r.filter(|r| r.city_id.as_ref() != Some(&city.id) || r.owner.is_some())
            {
                fail(
                    format!("has {} on patrol, who isn\u{2019}t its own", r.id),
                    vec![r.id.clone()],
                );
            }
        }
    }
    out
}
