//! Rough walk times and Food for a way (`apps/server/src/walk-time.ts`, `CONTEXT.md`: Step,
//! Riding, Explore): step by step along the straight way, at the resident's pace on each tile's
//! terrain, Plains where they haven't explored.

use csp_shared::terrain::{terrain_at, wrap, wrap_delta, Terrain, TerrainMap, DIAGONAL_STEP};
use csp_shared::world::{Resident, WorldState};

use crate::queries::estimates::food_per_tick;
use crate::queries::pace::{ride_speed, walk_speed};
use crate::queries::riding::horse_ridden;

/// About how many ticks a resident takes to walk from `a` to `b` (`walkTime`). Tiles they can't
/// walk on count at their slowest pace on land; roads and walls are left out. A rider goes at
/// their horse's pace, and at their slowest on foot where it can't go.
pub fn walk_time(
    world: &WorldState,
    terrain: &TerrainMap,
    explored: &dyn Fn(i32, i32) -> bool,
    r: &Resident,
    a: (i32, i32),
    b: (i32, i32),
) -> f64 {
    let mut ticks = 0.0;
    along_way(world, terrain, explored, r, a, b, &mut |t, _| ticks += t);
    ticks.ceil()
}

/// About how many units of Food a resident eats on the way from `a` to `b` (`wayFood`), with the
/// horse they ride: `walk_time`'s way, each step's ticks at what they eat a tick on its terrain.
pub fn way_food(
    world: &WorldState,
    terrain: &TerrainMap,
    explored: &dyn Fn(i32, i32) -> bool,
    r: &Resident,
    a: (i32, i32),
    b: (i32, i32),
) -> f64 {
    let horse = horse_ridden(world, r).map(|h| &h.stats);
    let tick = world.tick as f64;
    let mut food = 0.0;
    along_way(world, terrain, explored, r, a, b, &mut |ticks, ground| {
        food += ticks * food_per_tick(r, ground, tick, horse);
    });
    food
}

/// Each step of `walk_time`'s way, with its ticks and the ground it goes onto (`alongWay`).
fn along_way(
    world: &WorldState,
    terrain: &TerrainMap,
    explored: &dyn Fn(i32, i32) -> bool,
    r: &Resident,
    a: (i32, i32),
    b: (i32, i32),
    step: &mut dyn FnMut(f64, u8),
) {
    let size = terrain.size;
    let dx = wrap_delta(a.0, b.0, size);
    let dy = wrap_delta(a.1, b.1, size);
    let along_x = dx.abs() >= dy.abs();
    let long = if along_x { dx.abs() } else { dy.abs() };
    let short = if along_x { dy.abs() } else { dx.abs() };
    let tick = world.tick as f64;
    let slowest = walk_speed(r, Terrain::Mountain as u8, tick);
    let horse = horse_ridden(world, r);
    let pace = |g: u8| match horse {
        Some(h) => ride_speed(r, h, g),
        None => walk_speed(r, g, tick),
    };
    let (mut x, mut y) = a;
    let mut slanted = 0;
    for i in 0..long {
        // Each step goes along the longer direction, and diagonally while the steps along the
        // shorter one so far lag behind the straight line.
        let diagonal = (f64::from(slanted) + 0.5) * f64::from(long) <= f64::from((i + 1) * short);
        if diagonal {
            slanted += 1;
        }
        if along_x || diagonal {
            x = wrap(x + dx.signum(), size);
        }
        if !along_x || diagonal {
            y = wrap(y + dy.signum(), size);
        }
        let ground = if explored(x, y) { terrain_at(terrain, x, y) } else { Terrain::Plains as u8 };
        let speed = match pace(ground) {
            0.0 => slowest,
            s => s,
        };
        step((if diagonal { DIAGONAL_STEP } else { 1.0 }) / speed, ground);
    }
}

#[cfg(test)]
mod tests {
    use csp_shared::balance::WALK_TICKS_PER_TILE;

    use super::*;
    use crate::movement_test_world::{draw, horse, resident, world_with_realm};

    #[test]
    fn walks_the_straight_way_at_the_pace_of_each_tile_and_unexplored_as_plains() {
        let map = draw(&[
            "........", "ffffffff", "........", "........", "........", "........", "........",
            "........",
        ]);
        let world = world_with_realm(&map);
        let r = resident("w1", Some("r1"), 0.0, 0.0);
        // Three plains steps east.
        assert_eq!(
            walk_time(&world, &map, &|_, _| true, &r, (0, 0), (3, 0)),
            (3.0 * WALK_TICKS_PER_TILE).ceil()
        );
        // One step south onto forest is slower, but not where it is unexplored.
        let forest = walk_time(&world, &map, &|_, _| true, &r, (0, 0), (0, 1));
        assert!(forest > WALK_TICKS_PER_TILE);
        assert_eq!(
            walk_time(&world, &map, &|_, _| false, &r, (0, 0), (0, 1)),
            WALK_TICKS_PER_TILE.ceil()
        );
        // A diagonal step is √2 as long.
        assert_eq!(
            walk_time(&world, &map, &|_, _| false, &r, (0, 0), (1, 1)),
            (DIAGONAL_STEP * WALK_TICKS_PER_TILE).ceil()
        );
    }

    #[test]
    fn a_rider_goes_faster_and_eats_for_the_horse_too() {
        let map = draw(&["........"; 8]);
        let mut world = world_with_realm(&map);
        let walker = resident("w1", Some("r1"), 0.0, 0.0);
        let mut rider = walker.clone();
        rider.riding = Some("h1".into());
        world.horses.push(horse("h1", Some("r1"), 0.0, 0.0));
        let seen = |_: i32, _: i32| true;
        assert!(
            walk_time(&world, &map, &seen, &rider, (0, 0), (3, 0))
                < walk_time(&world, &map, &seen, &walker, (0, 0), (3, 0))
        );
        let on_foot = way_food(&world, &map, &seen, &walker, (0, 0), (2, 0));
        let mounted = way_food(&world, &map, &seen, &rider, (0, 0), (2, 0));
        assert!(on_foot > 0.0 && mounted > 0.0);
        assert_ne!(on_foot, mounted);
    }
}
