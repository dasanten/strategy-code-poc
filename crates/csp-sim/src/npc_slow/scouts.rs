//! `npc-scouts.test.ts`, its slow simulation: a scout out past the set reach.

use csp_shared::balance::{
    NPC_NODE_REACH, NPC_SCOUT_LIMIT, NPC_SCOUT_SECTOR, NPC_SURPLUS_CAP, NPC_TOWN, SIGHT_RANGE,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good, ResourceKind, WorldState};

use super::{add_workplace, home_mut, past_reserve, wrap_distance_f};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::random::Mulberry32;
use crate::world::create_world;

/// A town alone on Plains, nothing short of its reserve, with a lumber camp and a quarry (`town`).
fn town(size: i32) -> (WorldState, TerrainMap, String) {
    let mut terrain = plains(size);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 300, 300, &mut || m.next(), None);
    for (kind, resource) in [
        (BuildingKind::LumberCamp, ResourceKind::Forest),
        (BuildingKind::Quarry, ResourceKind::Stone),
    ] {
        let home = npc_home(&world, &city).expect("a home");
        let x = home.x + 40.0 + world.nodes.len() as f64 * 6.0;
        let y = home.y + 40.0;
        add_workplace(&mut world, &mut terrain, &city, kind, Some(resource), x, y);
    }
    let food = NPC_SURPLUS_CAP.get("food").unwrap_or(0.0);
    let stock = past_reserve(&world, &city, &[(Good::Food, food)]);
    home_mut(&mut world, &city).stock = Some(stock);
    (world, terrain, city)
}

#[test]
#[ignore = "10.8 s with eight at once; see #1092"]
fn a_scout_walks_out_past_the_set_reach_and_brings_what_they_saw_there_home() {
    let (mut world, terrain, city) = town(1300);
    let mut runner = Runner::new(&terrain);
    let size = terrain.size;
    let home = npc_home(&world, &city).expect("a home");
    let home = (home.x, home.y);
    let across = (f64::from(size) / NPC_SCOUT_SECTOR).ceil() as i32;
    let sector_side = NPC_SCOUT_SECTOR as i32;
    // A sector the city knows that nobody sees from anywhere near its set reach.
    let far_off = |sector: f64| {
        let sector = sector as i32;
        let middle = (
            (sector % across) * sector_side + sector_side / 2,
            (sector / across) * sector_side + sector_side / 2,
        );
        wrap_distance_f(size, home, (f64::from(middle.0), f64::from(middle.1)))
            > NPC_NODE_REACH + SIGHT_RANGE
    };
    let brought_home = |world: &WorldState| {
        let c = world.cities.iter().find(|c| c.id == city).expect("the city");
        c.scouted.as_ref().is_some_and(|s| s.sectors.iter().any(|&s| far_off(s)))
    };
    let mut furthest = 0.0_f64;
    let mut tick = 0;
    while tick < 120 * TICKS_PER_GAME_DAY as usize && !brought_home(&world) {
        runner.step(&mut world, &terrain);
        if tick % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        let scouts = world.city_plans.get(&city).and_then(|p| p.scouts.as_ref());
        for id in scouts.into_iter().flat_map(|s| s.keys()) {
            if let Some(r) = world.residents.iter().find(|r| &r.id == id) {
                furthest = furthest.max(wrap_distance_f(size, home, (r.x, r.y)));
            }
        }
        tick += 1;
    }
    eprintln!("furthest {furthest:.0} tiles out, home by tick {tick}");
    assert!(furthest > NPC_NODE_REACH, "{furthest}");
    assert!(furthest <= NPC_SCOUT_LIMIT + 64.0, "{furthest}");
    assert!(brought_home(&world));
    assert_eq!(check_all(&world, &terrain), []);
}
