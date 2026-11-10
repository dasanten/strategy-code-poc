//! `npc-surplus.test.ts`, its slow simulation: a town's spare hands work for surplus on the map.

use csp_shared::balance::{NPC_SURPLUS_CAP, NPC_TOWN};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, CityScouted, Good, ResourceKind};

use super::{add_workplace, home_mut, past_reserve};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::random::Mulberry32;
use crate::world::create_world;

#[test]
#[ignore = "TODO(time) alone; see #1092"]
fn spare_hands_keep_a_big_city_working_within_its_caps_on_the_map() {
    // `town()`: a town alone on Plains with a lumber camp and a quarry, its Food at its cap.
    let mut terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
    let mut places = Vec::new();
    for (kind, resource) in [
        (BuildingKind::LumberCamp, ResourceKind::Forest),
        (BuildingKind::Quarry, ResourceKind::Stone),
    ] {
        let home = npc_home(&world, &city).expect("a home");
        let x = home.x + 40.0 + world.nodes.len() as f64 * 6.0;
        let y = home.y + 40.0;
        places.push(add_workplace(&mut world, &mut terrain, &city, kind, Some(resource), x, y));
    }
    let food = NPC_SURPLUS_CAP.get("food").unwrap_or(0.0);
    let stock = past_reserve(&world, &city, &[(Good::Food, food)]);
    home_mut(&mut world, &city).stock = Some(stock);
    // It knows its limit: scouts go ahead of surplus (`CONTEXT.md`: Scout).
    world.cities.iter_mut().find(|c| c.id == city).expect("the city").scouted =
        Some(CityScouted { sectors: vec![], no_way: None, done: Some(true) });

    let mut runner = Runner::new(&terrain);
    let mut working = 0;
    for t in 0..5 * TICKS_PER_GAME_DAY as usize {
        runner.step(&mut world, &terrain);
        if t % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        if let Some(plan) = world.city_plans.get(&city) {
            let at = plan
                .jobs
                .values()
                .filter(|j| j.building_id.as_ref().is_some_and(|b| places.contains(b)))
                .count();
            working = working.max(at);
        }
    }
    assert!(working > 0);
}
