//! The movement estimates of `packages/shared/src/estimates.ts` (`CONTEXT.md`: Doing, Estimates):
//! how long a way takes and how much Food is eaten on it. The text helpers there (`aboutTime`,
//! `timeLeft`, `workLeft`, ...) only word these for the client and stay with it.

use csp_shared::balance::{FOOD_PER_DAY, HORSE_FOOD_PER_DAY};
use csp_shared::terrain::{step_length, Terrain};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    FetchPhase, HaulPhase, HorseStats, Resident, ResidentOrder, StorePhase, TilePath, WorldState,
};

use super::carriages::horse_for;
use super::pace::{drive_speed, horse_food_factor, ride_speed, walk_speed};
use super::residents::food_use;
use super::riding::horse_ridden;

/// Ticks a way of `path` from `from` takes (`wayTicks`): each step its length at the pace onto
/// the tile it goes to, less the `progress` already made into the first. A step at no pace counts
/// as one at `slowest`.
pub fn way_ticks(
    size: i32,
    from: (f64, f64),
    path: &[(f64, f64)],
    progress: f64,
    pace: &dyn Fn(f64, f64) -> f64,
    slowest: f64,
) -> f64 {
    let mut ticks = 0.0;
    let (mut x, mut y) = from;
    for (i, &(nx, ny)) in path.iter().enumerate() {
        let speed = match pace(nx, ny) {
            s if s == 0.0 || s.is_nan() => slowest,
            s => s,
        };
        let length = match step_length(size, x as i32, y as i32, nx as i32, ny as i32) {
            0.0 => 1.0,
            l => l,
        };
        ticks += (if i == 0 { 0.0f64.max(length - progress) } else { length }) / speed;
        (x, y) = (nx, ny);
    }
    ticks
}

/// About how many ticks until a walking, riding or driving resident arrives (`arrivalTicks`), at
/// the pace that applies on each tile today. `ground` is a tile's ground as the movement rules see
/// it (`groundAt`). None while they go nowhere or their way is still being found.
pub fn arrival_ticks(
    world: &WorldState,
    size: i32,
    ground: &dyn Fn(f64, f64) -> u8,
    r: &Resident,
) -> Option<f64> {
    let (path, progress): (&TilePath, f64) = match r.order.as_ref()? {
        ResidentOrder::WalkTo(o) => (o.path.as_ref()?, o.progress),
        ResidentOrder::Relocate(o) => (o.path.as_ref()?, o.progress),
        ResidentOrder::Drive(o) => (o.path.as_ref()?, o.progress),
        ResidentOrder::Haul(o) if o.phase == HaulPhase::Driving => (o.path.as_ref()?, o.progress),
        ResidentOrder::Store(o) if o.phase == StorePhase::Walking => (o.path.as_ref()?, o.progress),
        ResidentOrder::Fetch(o) if o.phase == FetchPhase::Walking => (o.path.as_ref()?, o.progress),
        _ => return None,
    };
    let tick = world.tick as f64;
    let slowest = walk_speed(r, Terrain::Mountain as u8, tick);
    let carriage_id = match r.order.as_ref()? {
        ResidentOrder::Drive(o) => Some(&o.carriage_id),
        ResidentOrder::Haul(o) => Some(&o.carriage_id),
        _ => None,
    };
    let pace: Box<dyn Fn(u8) -> f64> = match carriage_id {
        None => match horse_ridden(world, r) {
            Some(h) => Box::new(move |g| ride_speed(r, h, g)),
            None => Box::new(move |g| walk_speed(r, g, tick)),
        },
        Some(id) => {
            let carriage = world.carriages.iter().find(|k| k.id == *id);
            match carriage.and_then(|k| horse_for(world, k)) {
                Some(h) => Box::new(move |g| drive_speed(r, &h.stats, g)),
                // Without a horse each step goes at once, a tile a tick.
                None => Box::new(|_| 1.0),
            }
        }
    };
    Some(way_ticks(size, (r.x, r.y), path, progress, &|x, y| pace(ground(x, y)), slowest))
}

/// About how much Food a resident eats a tick on `terrain`, with the horse they ride
/// (`foodPerTick`).
pub fn food_per_tick(r: &Resident, terrain: u8, tick: f64, horse: Option<&HorseStats>) -> f64 {
    let own = (FOOD_PER_DAY * food_use(r, terrain, tick)) / TICKS_PER_GAME_DAY;
    match horse {
        None => own,
        Some(h) => own + (HORSE_FOOD_PER_DAY * horse_food_factor(h)) / TICKS_PER_GAME_DAY,
    }
}

#[cfg(test)]
mod tests {
    //! `packages/shared/src/estimates.test.ts`, its arrival estimates. The text helpers' tests stay
    //! with the client's copy.
    use csp_shared::balance::{
        CARRIAGE_SPEED, HORSE_STAT_AVERAGE, HUNGRY_HORSE_PACE, TERRAIN_SPEED, WALK_TICKS_PER_TILE,
    };
    use csp_shared::terrain::DIAGONAL_STEP;
    use csp_shared::world::{
        DriveOrder, FetchOrder, GoodsPlace, ResidentOrder, SkillName, StoreOrder, Tile, WalkOrder,
    };

    use super::*;
    use crate::movement_test_world::{carriage, horse, plains, resident, world_with_realm};

    fn path() -> TilePath {
        vec![(1.0, 0.0), (2.0, 0.0), (3.0, 0.0), (4.0, 0.0)]
    }
    /// Four tiles east along row 0: Plains, then Forest, then a road over Mountain.
    fn ground(x: f64, _y: f64) -> u8 {
        if x <= 2.0 {
            Terrain::Plains as u8
        } else if x == 3.0 {
            Terrain::Forest as u8
        } else {
            Terrain::Road as u8
        }
    }
    fn walk() -> ResidentOrder {
        ResidentOrder::WalkTo(WalkOrder {
            target: Tile { x: 4.0, y: 0.0 },
            path: Some(path()),
            progress: 0.0,
            army: None,
        })
    }
    fn walker(order: Option<ResidentOrder>) -> Resident {
        let mut r = resident("r1", Some("r1"), 0.0, 0.0);
        r.order = order;
        r
    }
    fn arrival(world: &WorldState, r: &Resident) -> Option<f64> {
        arrival_ticks(world, 64, &ground, r)
    }
    fn speed(table: csp_shared::balance::TerrainTable, t: Terrain) -> f64 {
        table.get(t as u8).expect("a speed")
    }
    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.005
    }

    #[test]
    fn adds_up_each_step_at_the_walking_pace_of_the_ground_it_goes_onto() {
        let world = world_with_realm(&plains(64));
        let forest = WALK_TICKS_PER_TILE / speed(TERRAIN_SPEED, Terrain::Forest);
        let road = WALK_TICKS_PER_TILE / speed(TERRAIN_SPEED, Terrain::Road);
        let t = arrival(&world, &walker(Some(walk()))).expect("an estimate");
        assert!(close(t, 2.0 * WALK_TICKS_PER_TILE + forest + road));
    }

    #[test]
    fn counts_what_is_already_walked_of_the_next_step_and_a_diagonal_step_as_further() {
        let world = world_with_realm(&plains(64));
        let halfway = ResidentOrder::WalkTo(WalkOrder {
            target: Tile { x: 4.0, y: 0.0 },
            path: Some(vec![(1.0, 1.0)]),
            progress: 0.5,
            army: None,
        });
        let t = arrival(&world, &walker(Some(halfway))).expect("an estimate");
        assert!(close(
            t,
            ((DIAGONAL_STEP - 0.5) * WALK_TICKS_PER_TILE) / speed(TERRAIN_SPEED, Terrain::Plains)
        ));
    }

    #[test]
    fn goes_at_the_horses_pace_on_a_horse_half_that_while_it_is_hungry() {
        let mut world = world_with_realm(&plains(64));
        let mut rider = walker(Some(walk()));
        rider.riding = Some("h1".into());
        let plains_t = WALK_TICKS_PER_TILE / speed(CARRIAGE_SPEED, Terrain::Plains);
        let forest = WALK_TICKS_PER_TILE / speed(CARRIAGE_SPEED, Terrain::Forest);
        let road = WALK_TICKS_PER_TILE / speed(CARRIAGE_SPEED, Terrain::Road);
        world.horses = vec![horse("h1", Some("r1"), 0.0, 0.0)];
        let fed = arrival(&world, &rider).expect("an estimate");
        assert!(close(fed, 2.0 * plains_t + forest + road));
        world.horses[0].hunger = 0.0;
        let hungry = arrival(&world, &rider).expect("an estimate");
        assert!(close(hungry, fed / HUNGRY_HORSE_PACE));
        // A faster horse gets there sooner.
        world.horses[0].hunger = 100.0;
        world.horses[0].stats.speed = HORSE_STAT_AVERAGE + 10.0;
        assert!(arrival(&world, &rider).expect("an estimate") < fed);
    }

    #[test]
    fn drives_at_the_pace_of_the_carriages_horse_sooner_with_driving_skill() {
        let mut world = world_with_realm(&plains(64));
        let drive = ResidentOrder::Drive(DriveOrder {
            carriage_id: "k1".into(),
            target: Tile { x: 4.0, y: 0.0 },
            path: Some(path()),
            progress: 0.0,
            army: None,
            near: None,
        });
        world.horses = vec![horse("h1", Some("r1"), 0.0, 0.0)];
        world.carriages = vec![carriage("k1", Some("r1"), 0.0, 0.0, Some("h1"))];
        let driven = arrival(&world, &walker(Some(drive.clone()))).expect("an estimate");
        let want = WALK_TICKS_PER_TILE
            * (2.0 / speed(CARRIAGE_SPEED, Terrain::Plains)
                + 1.0 / speed(CARRIAGE_SPEED, Terrain::Forest)
                + 1.0 / speed(CARRIAGE_SPEED, Terrain::Road));
        assert!(close(driven, want));
        let mut skilled = walker(Some(drive));
        skilled.skills.insert(SkillName::Driving, 20.0);
        assert!(arrival(&world, &skilled).expect("an estimate") < driven);
    }

    #[test]
    fn times_a_store_or_fetch_order_while_it_walks_to_its_place_as_a_walk() {
        let world = world_with_realm(&plains(64));
        let walked = arrival(&world, &walker(Some(walk()))).expect("an estimate");
        let place = GoodsPlace::Storage { storage_id: "s1".into() };
        let order = |phase: StorePhase| {
            let store = serde_json::json!({
                "goods": {"wood": null}, "to": serde_json::to_value(&place).expect("a place"),
                "phase": serde_json::to_value(phase).expect("a phase"), "path": [], "progress": 0
            });
            let mut store: StoreOrder = serde_json::from_value(store).expect("a store order");
            store.path = Some(path());
            ResidentOrder::Store(store)
        };
        let fetch = serde_json::json!({
            "goods": {"food": 4}, "from": serde_json::to_value(&place).expect("a place"),
            "phase": "walking", "path": [], "progress": 0
        });
        let mut fetch: FetchOrder = serde_json::from_value(fetch).expect("a fetch order");
        fetch.path = Some(path());
        let store_t =
            arrival(&world, &walker(Some(order(StorePhase::Walking)))).expect("an estimate");
        assert!(close(store_t, walked));
        let fetch_t =
            arrival(&world, &walker(Some(ResidentOrder::Fetch(fetch)))).expect("an estimate");
        assert!(close(fetch_t, walked));
        // There already, putting or taking: nowhere to go.
        assert_eq!(arrival(&world, &walker(Some(order(StorePhase::Putting)))), None);
    }

    #[test]
    fn says_nothing_while_the_way_is_still_being_found_or_they_go_nowhere() {
        let world = world_with_realm(&plains(64));
        let searching = ResidentOrder::WalkTo(WalkOrder {
            target: Tile { x: 4.0, y: 0.0 },
            path: None,
            progress: 0.0,
            army: None,
        });
        assert_eq!(arrival(&world, &walker(Some(searching))), None);
        assert_eq!(arrival(&world, &walker(None)), None);
    }

    #[test]
    fn counts_a_step_at_no_pace_as_one_at_the_slowest() {
        let r = walker(Some(walk()));
        let slowest = walk_speed(&r, Terrain::Mountain as u8, 0.0);
        assert!(close(
            way_ticks(64, (r.x, r.y), &[(1.0, 0.0)], 0.0, &|_, _| 0.0, slowest),
            1.0 / slowest
        ));
    }
}
