//! An NPC city's scouts (`apps/server/src/npc-scouts.ts`, `CONTEXT.md`: Scout; ADR 0026). They
//! run the game's Explore default like a Player's explorer, but what is unexplored is what their
//! city doesn't know. A city's knowledge goes by sectors (`NPC_SCOUT_SECTOR`), so it stays small
//! plain data: `City.scouted`, the sectors scouts brought home, and `CityPlan.scouts`, what each
//! scout out has seen and not brought home yet.

use std::f64::consts::{FRAC_1_SQRT_2, PI};

use csp_shared::balance::{
    NPC_NODE_REACH, NPC_RESIDENTS_PER_SCOUT, NPC_SCOUT_LIMIT, NPC_SCOUT_SECTOR, SIGHT_RANGE,
};
use csp_shared::terrain::{wrap, wrap_distance};
use csp_shared::world::{City, CityScouted, Resident, ScoutTrip, Task, WorldState};
use serde_json::json;

use crate::npc_behaviour::{default_script, npc_home};
use crate::queries::city::{city_residents, in_city_area};
use crate::random::hash_str;

/// Sectors along each side of the map (`sectorsAcross`).
fn sectors_across(size: i32) -> i32 {
    (f64::from(size) / NPC_SCOUT_SECTOR).ceil() as i32
}

/// The sector a tile lies in, as a number (`sectorOf`).
pub fn sector_of(size: i32, x: i32, y: i32) -> f64 {
    let across = f64::from(sectors_across(size));
    (f64::from(y) / NPC_SCOUT_SECTOR).floor() * across + (f64::from(x) / NPC_SCOUT_SECTOR).floor()
}

/// The middle tile of a sector by its column and row, which wrap round the map (`sectorMiddle`).
fn sector_middle(size: i32, column: i32, row: i32) -> (i32, i32) {
    let across = sectors_across(size);
    let s = NPC_SCOUT_SECTOR as i32;
    let middle = |n: i32| wrap(wrap(n, across) * s + s / 2, size);
    (middle(column), middle(row))
}

/// The sectors whose middle a resident on a tile has in sight (`sectorsInSight`).
fn sectors_in_sight(size: i32, at: (i32, i32)) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    let span = (SIGHT_RANGE / NPC_SCOUT_SECTOR).ceil() as i32 + 1;
    let column = (f64::from(at.0) / NPC_SCOUT_SECTOR).floor() as i32;
    let row = (f64::from(at.1) / NPC_SCOUT_SECTOR).floor() as i32;
    for dy in -span..=span {
        for dx in -span..=span {
            let middle = sector_middle(size, column + dx, row + dy);
            if wrap_distance(size, at, middle) <= SIGHT_RANGE {
                let s = sector_of(size, middle.0, middle.1);
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    }
    out
}

/// How many scouts a city sends at a time, by its size (`scoutsWanted`).
pub fn scouts_wanted(world: &WorldState, city: &City) -> usize {
    (city_residents(world, &city.id).len() as f64 / NPC_RESIDENTS_PER_SCOUT).ceil() as usize
}

/// Whether a city knows of a resource node (`knowsNode`, `CONTEXT.md`: Scout): within its set
/// reach it simply does; out to its limit, once a scout who saw the node's sector has come home,
/// unless it has found no way to that sector.
pub fn knows_node(city: &City, home: (i32, i32), node: (i32, i32), size: i32) -> bool {
    let d = wrap_distance(size, home, node);
    if d <= NPC_NODE_REACH {
        return true;
    }
    let Some(scouted) = &city.scouted else { return false };
    if d > NPC_SCOUT_LIMIT {
        return false;
    }
    let sector = sector_of(size, node.0, node.1);
    scouted.sectors.contains(&sector)
        && !scouted.no_way.as_ref().is_some_and(|n| n.contains(&sector))
}

/// Adds the sectors `to` lacks (`addAll`).
fn add_all(to: &mut Vec<f64>, sectors: &[f64]) {
    for s in sectors {
        if !to.contains(s) {
            to.push(*s);
        }
    }
}

/// A city's knowledge, made if it has none yet (`city.scouted ??= { sectors: [] }`).
fn scouted(city: &mut City) -> &mut CityScouted {
    city.scouted.get_or_insert_with(|| CityScouted { sectors: Vec::new(), no_way: None, done: None })
}

/// A city's builder found no way to a site past its set reach (`giveUpSite`): it gives the site's
/// sector up as it does one a scout found no way to. Whether it gave the sector up.
pub fn give_up_site(world: &mut WorldState, city_id: &str, site: (i32, i32), size: i32) -> bool {
    let Some(home) = npc_home(world, city_id) else { return false };
    if wrap_distance(size, (home.x as i32, home.y as i32), site) <= NPC_NODE_REACH {
        return false;
    }
    let Some(city) = world.cities.iter_mut().find(|c| c.id == city_id) else { return false };
    let no_way = scouted(city).no_way.get_or_insert_with(Vec::new);
    add_all(no_way, &[sector_of(size, site.0, site.1)]);
    true
}

/// Those of a city's spare hands who scout for it next (`pickScouts`), up to `scouts_wanted`:
/// while it doesn't know its limit and Food isn't short, of `unneeded`, first those already out,
/// then those with no workplace to go back to, then the rest.
pub fn pick_scouts(
    world: &WorldState,
    city: &City,
    unneeded: &[usize],
    has_place: &dyn Fn(usize) -> bool,
    food_short: bool,
) -> Vec<usize> {
    if city.trade_org.is_some() || city.scouted.as_ref().is_some_and(|s| s.done == Some(true)) || food_short {
        return Vec::new();
    }
    let scouts = world.city_plans.get(&city.id).and_then(|p| p.scouts.as_ref());
    let rank = |i: usize| {
        if scouts.is_some_and(|s| s.contains_key(&world.residents[i].id)) {
            0
        } else if has_place(i) {
            2
        } else {
            1
        }
    };
    let mut sorted = unneeded.to_vec();
    sorted.sort_by_key(|&i| rank(i));
    sorted.truncate(scouts_wanted(world, city));
    sorted
}

/// Sends a resident scouting (`sendScout`): they run the game's Explore default with no `find`.
pub fn send_scout(world: &mut WorldState, city_id: &str, i: usize) {
    world.residents[i].script = Some(default_script(Task::Explore, json!({})));
    let id = world.residents[i].id.clone();
    if let Some(plan) = world.city_plans.get_mut(city_id) {
        plan.scouts.get_or_insert_with(Default::default).entry(id).or_insert(ScoutTrip { saw: Vec::new(), no_way: None });
    }
}

/// What a city's scouts do for it each tick (`stepScouts`), with `people` the residents it runs:
/// each scout adds what they have in sight to their trip, and the tiles their script found no way
/// to. On stepping into its area they bring it all home. One gone brings nothing; one Down sees
/// nothing.
pub fn step_scouts(world: &mut WorldState, city_id: &str, people: &[usize], size: i32) {
    let Some(ids) = world.city_plans.get(city_id).and_then(|p| p.scouts.as_ref()).map(|s| s.keys().cloned().collect::<Vec<_>>()) else {
        return;
    };
    for id in ids {
        let Some(i) = people.iter().copied().find(|&i| world.residents[i].id == id) else {
            if let Some(s) = world.city_plans.get_mut(city_id).and_then(|p| p.scouts.as_mut()) {
                s.shift_remove(&id);
            }
            continue;
        };
        let r = &world.residents[i];
        if r.down_until.is_some() {
            continue;
        }
        let at = (r.x as i32, r.y as i32);
        let seen = sectors_in_sight(size, at);
        let no_way = no_way_tiles(r, size);
        let exploring = r.script.as_ref().is_some_and(|s| s.task == Some(Task::Explore));
        let home = in_city_area(world, city_id, at.0, at.1, size);
        let scouts = world.city_plans.get_mut(city_id).and_then(|p| p.scouts.as_mut()).expect("scouts");
        let trip = scouts.get_mut(&id).expect("a trip");
        add_all(&mut trip.saw, &seen);
        add_all(trip.no_way.get_or_insert_with(Vec::new), &no_way);
        if !home {
            continue;
        }
        let trip = trip.clone();
        if exploring {
            scouts.insert(id.clone(), ScoutTrip { saw: Vec::new(), no_way: None });
        } else {
            scouts.shift_remove(&id);
        }
        if let Some(city) = world.cities.iter_mut().find(|c| c.id == city_id) {
            bring_home(city, &trip);
        }
    }
    if let Some(plan) = world.city_plans.get_mut(city_id) {
        if plan.scouts.as_ref().is_some_and(|s| s.is_empty()) {
            plan.scouts = None;
        }
    }
}

/// The sectors of the tiles a scout's script found no way to (`noWayTiles`).
fn no_way_tiles(r: &Resident, size: i32) -> Vec<f64> {
    let Some(script) = r.script.as_ref().filter(|s| s.task == Some(Task::Explore)) else { return Vec::new() };
    let Some(skip) = script.memory.get("skip").and_then(|v| v.as_array()) else { return Vec::new() };
    skip.iter()
        .filter_map(|t| {
            let x = t.get("x")?.as_f64()?;
            let y = t.get("y")?.as_f64()?;
            Some(sector_of(size, x as i32, y as i32))
        })
        .collect()
}

/// A scout brings what they saw home (`bringHome`).
fn bring_home(city: &mut City, trip: &ScoutTrip) {
    let no_way = trip.no_way.as_ref().filter(|n| !n.is_empty());
    if trip.saw.is_empty() && no_way.is_none() {
        return;
    }
    let s = scouted(city);
    add_all(&mut s.sectors, &trip.saw);
    if let Some(n) = no_way {
        add_all(s.no_way.get_or_insert_with(Vec::new), n);
    }
}

/// How a scout's Explore default says it has no tile left to go to (`NOTHING_LEFT`).
const NOTHING_LEFT: &str = "nothing unexplored in reach";

/// A scout's Explore default ended (`scoutEnded`): saying nothing is left to find, the city knows
/// its limit and stops scouting.
pub fn scout_ended(city: &mut City, reason: Option<&str>) {
    if reason.is_some_and(|r| r.starts_with(NOTHING_LEFT)) {
        scouted(city).done = Some(true);
    }
}

/// Where a scout goes next (`scoutEdge`, `CONTEXT.md`: Explore, Scout): the nearest tile they can
/// go onto of a sector out to the city's limit that neither it nor they know of. Past its set reach
/// only. The nearest first, leaning toward a way out of its own, by their id.
pub fn scout_edge(
    world: &WorldState,
    city: &City,
    r: &Resident,
    size: i32,
    can_enter: &dyn Fn(i32, i32) -> bool,
    skip: &[(i32, i32)],
) -> Option<(i32, i32)> {
    let home = npc_home(world, &city.id)?;
    let home_at = (home.x as i32, home.y as i32);
    let trip = world.city_plans.get(&city.id).and_then(|p| p.scouts.as_ref()).and_then(|s| s.get(&r.id));
    let mut known: Vec<f64> = Vec::new();
    if let Some(s) = &city.scouted {
        known.extend(&s.sectors);
        known.extend(s.no_way.iter().flatten());
    }
    if let Some(t) = trip {
        known.extend(&t.saw);
        known.extend(t.no_way.iter().flatten());
    }
    known.extend(skip.iter().map(|t| sector_of(size, t.0, t.1)));
    let way = (f64::from(hash_str(&r.id) % 360) * PI) / 180.0;
    let across = sectors_across(size);
    let span = ((NPC_SCOUT_LIMIT / NPC_SCOUT_SECTOR).ceil() as i32 + 1).min((across - 1) / 2);
    let column = (home.x / NPC_SCOUT_SECTOR).floor() as i32;
    let row = (home.y / NPC_SCOUT_SECTOR).floor() as i32;
    let at = (r.x as i32, r.y as i32);
    let mut open: Vec<(i32, i32, f64)> = Vec::new();
    for dy in -span..=span {
        for dx in -span..=span {
            let middle = sector_middle(size, column + dx, row + dy);
            let d = wrap_distance(size, home_at, middle);
            if d > NPC_SCOUT_LIMIT || d + NPC_SCOUT_SECTOR * FRAC_1_SQRT_2 <= NPC_NODE_REACH {
                continue;
            }
            if known.contains(&sector_of(size, middle.0, middle.1)) {
                continue;
            }
            let out = (f64::from(dx) * way.cos() + f64::from(dy) * way.sin()) * NPC_SCOUT_SECTOR;
            open.push((column + dx, row + dy, wrap_distance(size, at, middle) - out / 2.0));
        }
    }
    open.sort_by(|a, b| a.2.total_cmp(&b.2));
    open.into_iter().find_map(|(c, r_, _)| nearest_tile_in(size, (c, r_), at, can_enter))
}

/// The tile of a sector nearest a resident that they can go onto (`nearestTileIn`).
fn nearest_tile_in(
    size: i32,
    sector: (i32, i32),
    at: (i32, i32),
    can_enter: &dyn Fn(i32, i32) -> bool,
) -> Option<(i32, i32)> {
    let s = NPC_SCOUT_SECTOR as i32;
    let half = s / 2;
    let middle = sector_middle(size, sector.0, sector.1);
    let (left, top) = (middle.0 - half, middle.1 - half);
    let mut best: Option<(i32, i32, f64)> = None;
    for dy in 0..s {
        for dx in 0..s {
            let x = wrap(left + dx, size);
            let y = wrap(top + dy, size);
            let d = wrap_distance(size, at, (x, y));
            if best.is_none_or(|b| d < b.2) && can_enter(x, y) {
                best = Some((x, y, d));
            }
        }
    }
    best.map(|b| (b.0, b.1))
}
