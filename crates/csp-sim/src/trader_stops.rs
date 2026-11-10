//! Trader stops (`trader-stops.ts`, `CONTEXT.md`: Trader stop): on its way between two of its
//! places a wandering trader stops for a while at each NPC or Player city near that way. Plain data
//! (ADR 0002): the cities go into `Trader.calls`, the stop it is at into `Trader.stand`, and the game
//! gives its driver the same drive orders as for the rest of its loop.

use std::collections::HashSet;

use csp_shared::balance::{
    CARRIAGE_SPEED, TRADER_DRIVE_TRIES, TRADER_STOP_REACH, TRADER_STOP_TICKS, WALL_ENCLOSES_MAX,
};
use csp_shared::footprint::{footprint_tiles, middle_of};
use csp_shared::terrain::{
    is_passable_terrain, terrain_at, tile_index, wrap, wrap_delta, wrap_distance, TerrainMap,
};
use csp_shared::world::{
    BuildingKind, City, DriveOrder, ResidentOrder, Tile, TraderStand, WorldState,
};

use crate::caravans::horse_lies_down;
use crate::queries::city::town_hall_of;
use crate::queries::names::placed;
use crate::queries::trader_trade::trader_standing;
use crate::sight::InvariantViolation;
use crate::terrain_gen::js_hypot;
use crate::walls::wall_map;

/// A way shorter than this, in tiles, is no way at all (`SAME_PLACE`).
const SAME_PLACE: f64 = 16.0;

/// Whether a wandering trader stops at a city (`takesStops`): one of an NPC
/// or a Player with a finished town hall.
pub fn takes_stops(world: &WorldState, city: &City) -> bool {
    city.trade_org.is_none() && town_hall_of(world, city).is_some_and(|h| h.site.is_none())
}

/// How far along the straight way from `from` to `to` it passes `at` within `TRADER_STOP_REACH`,
/// 0 to 1 (`passesWithinReach`); `None` when it passes further off.
pub fn passes_within_reach(
    from: (i32, i32),
    to: (i32, i32),
    at: (i32, i32),
    size: i32,
) -> Option<f64> {
    let dx = f64::from(wrap_delta(from.0, to.0, size));
    let dy = f64::from(wrap_delta(from.1, to.1, size));
    let px = f64::from(wrap_delta(from.0, at.0, size));
    let py = f64::from(wrap_delta(from.1, at.1, size));
    let along = 0f64.max(1f64.min((px * dx + py * dy) / (dx * dx + dy * dy)));
    (js_hypot(px - along * dx, py - along * dy) <= TRADER_STOP_REACH).then_some(along)
}

/// Whether a wandering trader stops at `city` on its loop (`onATradersLoop` of
/// `trader-stops.ts`, `CONTEXT.md`: Trader stop).
pub fn on_a_traders_loop(world: &WorldState, city: &City, size: i32) -> bool {
    if !takes_stops(world, city) {
        return false;
    }
    let hall = town_hall_of(world, city).expect("takes stops");
    let at = middle_of(placed(hall), size);
    let place_of = |id: &String| {
        let place = world.cities.iter().find(|c| &c.id == id)?;
        town_hall_of(world, place).map(|h| middle_of(placed(h), size))
    };
    for trader in &world.traders {
        let places: Vec<Option<(i32, i32)>> = trader.r#loop.iter().map(place_of).collect();
        for i in 0..places.len() {
            let (Some(from), Some(to)) = (places[i], places[(i + 1) % places.len()]) else {
                continue;
            };
            if wrap_distance(size, from, to) < SAME_PLACE {
                continue;
            }
            if passes_within_reach(from, to, at, size).is_some() {
                return true;
            }
        }
    }
    false
}

/// How far from a town hall it looks for a tile to stand on: past the most a wall can shut in
/// (`STOP_SEARCH`).
fn stop_search() -> i32 {
    (WALL_ENCLOSES_MAX.sqrt() / 2.0).ceil() as i32 + 1
}

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x as i32, y as i32)
}

/// The cities a trader driving straight from `from` to `to` passes within `TRADER_STOP_REACH` of
/// its town hall, in the order it passes them (`callsOnTheWay`, `CONTEXT.md`: Trader stop). None on
/// a way of no length. `size` is the map's.
pub fn calls_on_the_way(
    world: &WorldState,
    from: (f64, f64),
    to: (f64, f64),
    size: i32,
) -> Vec<String> {
    let (from, to) = (tile(from.0, from.1), tile(to.0, to.1));
    if wrap_distance(size, from, to) < SAME_PLACE {
        return Vec::new();
    }
    let mut passed: Vec<(String, f64)> = Vec::new();
    for city in &world.cities {
        if !takes_stops(world, city) {
            continue;
        }
        let hall = town_hall_of(world, city).expect("takes stops");
        if let Some(along) = passes_within_reach(from, to, middle_of(placed(hall), size), size) {
            passed.push((city.id.clone(), along));
        }
    }
    // A stable sort, as `Array.sort` is.
    passed.sort_by(|a, b| a.1.total_cmp(&b.1));
    passed.into_iter().map(|(id, _)| id).collect()
}

/// Where a wandering trader stands at a city (`stopTile`, `CONTEXT.md`: Trader stop): the free
/// tile nearest its town hall that lies outside every ring of walls, so a gate closed against its
/// armed escort doesn't stop it, and on land a carriage can drive; of those, the nearest to where
/// it comes `from`. Free: no building but a road on it, and no other trader standing or bound
/// there. `None` when there is none within reach.
pub fn stop_tile(
    world: &WorldState,
    terrain: &TerrainMap,
    city: &City,
    from: (f64, f64),
) -> Option<(i32, i32)> {
    let hall = town_hall_of(world, city)?;
    let size = terrain.size;
    let inside = wall_map(world, terrain).inside;
    let mut taken: HashSet<(i32, i32)> = HashSet::new();
    for b in &world.buildings {
        if b.kind != BuildingKind::Road {
            taken.extend(footprint_tiles(placed(b), size));
        }
    }
    for t in &world.traders {
        if let Some(s) = &t.stand {
            taken.insert(tile(s.x, s.y));
        }
    }
    let free = |x: i32, y: i32| {
        let ground = terrain_at(terrain, x, y);
        is_passable_terrain(ground)
            && CARRIAGE_SPEED.get(ground).is_some()
            && !inside.contains(&tile_index(size, x, y))
            && !taken.contains(&(x, y))
    };
    let from = tile(from.0, from.1);
    let (hx, hy) = tile(hall.x, hall.y);
    // A town hall's footprint is 3 tiles along each side; rings of tiles round it, nearest first.
    for d in 1..=stop_search() {
        let mut best: Option<(i32, i32, f64)> = None;
        for dy in -d..=2 + d {
            for dx in -d..=2 + d {
                if dy != -d && dy != 2 + d && dx != -d && dx != 2 + d {
                    continue;
                }
                let (x, y) = (wrap(hx + dx, size), wrap(hy + dy, size));
                if !free(x, y) {
                    continue;
                }
                let away = wrap_distance(size, (x, y), from);
                if best.is_none_or(|b| away < b.2) {
                    best = Some((x, y, away));
                }
            }
        }
        if let Some((x, y, _)) = best {
            return Some((x, y));
        }
    }
    None
}

/// A wandering trader's stops, for one tick of its driver `ri` idle with carriage `ki` (`runStops`,
/// `CONTEXT.md`: Trader stop): it stands out its time at the stop it is at, then takes the next of
/// its calls, drives to the tile there (`stop_tile`) and stands for `TRADER_STOP_TICKS`. A city
/// that stopped taking stops is passed by, and so is one whose tile it fails to reach in
/// `TRADER_DRIVE_TRIES` drives. Whether the driver has what to do here; with no stop left it goes
/// on along its loop.
pub fn run_stops(
    world: &mut WorldState,
    ti: usize,
    ri: usize,
    ki: usize,
    terrain: &TerrainMap,
) -> bool {
    loop {
        if world.traders[ti].stand.is_none() {
            let next =
                world.traders[ti].calls.as_mut().and_then(|c| (!c.is_empty()).then(|| c.remove(0)));
            let Some(next) = next else { return false };
            let k = (world.carriages[ki].x, world.carriages[ki].y);
            let at = world
                .cities
                .iter()
                .find(|c| c.id == next)
                .filter(|c| takes_stops(world, c))
                .and_then(|c| stop_tile(world, terrain, c, k));
            let Some((x, y)) = at else { continue };
            let t = &mut world.traders[ti];
            t.stand =
                Some(TraderStand { city_id: next, x: f64::from(x), y: f64::from(y), until: None });
            t.misses = 0.0;
        }
        let stand = world.traders[ti].stand.clone().expect("just set");
        let passed_by = |world: &mut WorldState| {
            let t = &mut world.traders[ti];
            t.stand = None;
            t.misses = 0.0;
        };
        let takes = world
            .cities
            .iter()
            .find(|c| c.id == stand.city_id)
            .is_some_and(|c| takes_stops(world, c));
        if !takes {
            passed_by(world);
            continue;
        }
        if let Some(until) = stand.until {
            if (world.tick as f64) < until {
                return true;
            }
            passed_by(world);
            continue;
        }
        let k = &world.carriages[ki];
        if k.x == stand.x && k.y == stand.y {
            let until = world.tick as f64 + TRADER_STOP_TICKS;
            let t = &mut world.traders[ti];
            if let Some(s) = t.stand.as_mut() {
                s.until = Some(until);
            }
            t.misses = 0.0;
            return true;
        }
        // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
        if horse_lies_down(world, ki) {
            return true;
        }
        if world.traders[ti].misses >= TRADER_DRIVE_TRIES {
            passed_by(world);
            continue;
        }
        world.traders[ti].misses += 1.0;
        let carriage_id = world.carriages[ki].id.clone();
        world.residents[ri].order = Some(ResidentOrder::Drive(DriveOrder {
            carriage_id,
            target: Tile { x: stand.x, y: stand.y },
            path: None,
            progress: 0.0,
            army: None,
            near: None,
        }));
        return true;
    }
}

/// Trader stops hold together (`traderStopsSound`, `CONTEXT.md`: Trader stop; ADR 0004): no trader
/// means to stop at a city twice, or to stand longer than `TRADER_STOP_TICKS`; one whose time at a
/// stop has begun has its carriage on the stop's tile until the time is up; and no two stand on the
/// same tile, where a trade could only reach one of them.
pub fn trader_stops_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let n = crate::invariants::js_number;
    let mut out = Vec::new();
    let mut tiles = HashSet::new();
    let tick = world.tick as f64;
    for t in &world.traders {
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "trader-stops-sound".into(),
                message: format!("trader {} {message}", t.id),
                entity_ids: vec![t.id.clone()],
            })
        };
        let calls = t.calls.clone().unwrap_or_default();
        if calls.iter().collect::<HashSet<_>>().len() != calls.len() {
            fail("calls at a city twice".into());
        }
        let Some(stand) = &t.stand else { continue };
        let Some(until) = stand.until else { continue };
        if until > tick + TRADER_STOP_TICKS {
            fail(format!("stands until {}, too long", n(until)));
        }
        if tick < until && t.driver_id.is_some() && trader_standing(world, t).is_none() {
            fail(format!(
                "has left its stop at ({}, {}) with time to stand",
                n(stand.x),
                n(stand.y)
            ));
        }
        if tick >= until {
            continue;
        }
        let at = format!("{},{}", n(stand.x), n(stand.y));
        if !tiles.insert(at.clone()) {
            fail(format!("stands on ({at}) with another trader"));
        }
    }
    out
}

#[cfg(test)]
mod tests;
