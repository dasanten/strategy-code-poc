//! `npc-far-nodes.test.ts`, its slow simulations: an NPC city builds on the far nodes its scouts
//! found (`CONTEXT.md`: NPC city, Scout; ADR 0026), and its road and crew follow out there.

use csp_shared::balance::{BUILD_MATERIALS, CREW_FOOD, NPC_NODE_REACH, NPC_SURPLUS_CAP, NPC_TOWN};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, CityScouted, Good, ResourceKind, WorldState};

use super::{add_node, home_mut, wrap_distance_f};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_scouts::sector_of;
use crate::npc_test_world::{plains, Runner};
use crate::queries::building::{building_pile, road_at};
use crate::queries::npc_trade::npc_reserve;
use crate::random::{new_id, Mulberry32};
use crate::world::create_world;

/// A node past the set reach and inside the limit.
const FAR: f64 = 300.0;

/// A town alone on Plains with no node of anything near it, and its reserve in store, with a
/// forest node `FAR` east of home that it has heard of (`town`, `nodeAt`, `scouted`).
fn town_with_far_forest() -> (WorldState, TerrainMap, String, (f64, f64)) {
    let mut terrain = plains(1300);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 300, 300, &mut || m.next(), None);
    world.nodes.clear();
    let reserve =
        npc_reserve(&world, world.cities.iter().find(|c| c.id == city).expect("the city"));
    home_mut(&mut world, &city).stock = Some(reserve);
    let home = npc_home(&world, &city).expect("a home");
    let node = (home.x + FAR, home.y);
    add_node(&mut world, &mut terrain, ResourceKind::Forest, node.0, node.1);
    let sector = sector_of(terrain.size, node.0 as i32, node.1 as i32);
    world.cities.iter_mut().find(|c| c.id == city).expect("the city").scouted =
        Some(CityScouted { sectors: vec![sector], no_way: None, done: None });
    (world, terrain, city, node)
}

fn people(world: &WorldState, city: &str) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| world.residents[i].city_id.as_deref() == Some(city))
        .collect()
}

fn no_way(world: &WorldState, city: &str) -> Option<Vec<f64>> {
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    c.scouted.as_ref().and_then(|s| s.no_way.clone())
}

#[test]
#[ignore = "59 s alone; see #1092"]
fn a_road_follows_out_to_a_far_workplace() {
    let (mut world, terrain, city, node) = town_with_far_forest();
    let place = new_id("b", &mut world.next_id);
    world.buildings.push(crate::test_support::building(
        &place,
        BuildingKind::LumberCamp,
        None,
        node.0,
        node.1,
    ));
    let c = world.cities.iter_mut().find(|c| c.id == city).expect("the city");
    c.workplace_ids.get_or_insert_with(Vec::new).push(place.clone());
    // Nothing short, and Stone for the whole way.
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    let mut stock = npc_reserve(&world, c);
    let had = |g: Good| stock.get(&g).copied().unwrap_or(0.0);
    let food = had(Good::Food) + 2.0 * NPC_SURPLUS_CAP.get("food").unwrap_or(0.0);
    let wood = had(Good::Wood) + NPC_SURPLUS_CAP.get("wood").unwrap_or(0.0);
    let road_stone = BUILD_MATERIALS.get("road").and_then(|m| m.get("stone")).unwrap_or(0.0);
    let stone = had(Good::Stone) + 2.0 * FAR * road_stone;
    stock.insert(Good::Food, food);
    stock.insert(Good::Wood, wood);
    stock.insert(Good::Stone, stone);
    home_mut(&mut world, &city).stock = Some(stock);

    let way = |world: &WorldState| -> Option<Vec<(f64, f64)>> {
        let roads = world.city_plans.get(&city)?.roads.as_ref()?;
        roads.iter().find(|r| r.to == place).map(|r| r.tiles.clone())
    };
    let laid = |world: &WorldState| {
        way(world)
            .unwrap_or_default()
            .iter()
            .filter(|(x, y)| road_at(world, *x as i32, *y as i32).is_some_and(|r| r.site.is_none()))
            .count()
    };
    let built =
        |world: &WorldState| way(world).is_some_and(|w| !w.is_empty() && laid(world) == w.len());
    let mut runner = Runner::new(&terrain);
    let mut i = 0;
    while i < 150 * TICKS_PER_GAME_DAY as usize && !built(&world) {
        runner.step(&mut world, &terrain);
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        i += 1;
    }
    let tiles = way(&world).expect("a way");
    eprintln!("road of {} tiles laid by tick {}", tiles.len(), world.tick);
    assert_eq!(tiles.last(), Some(&node));
    assert!(tiles.len() as f64 > NPC_NODE_REACH);
    assert_eq!(laid(&world), tiles.len());
    assert_eq!(no_way(&world, &city), None);
}

#[test]
#[ignore = "77 s alone; see #1092"]
fn a_city_short_of_a_good_builds_on_a_far_node_and_its_crew_stays_fed_there() {
    let (mut world, terrain, city, node) = town_with_far_forest();
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    let mut stock = npc_reserve(&world, c);
    let food = stock.get(&Good::Food).copied().unwrap_or(0.0) + 600.0;
    stock.insert(Good::Wood, 0.0);
    stock.insert(Good::Food, food);
    home_mut(&mut world, &city).stock = Some(stock);
    let size = terrain.size;
    let camp = |world: &WorldState| {
        world
            .buildings
            .iter()
            .find(|b| {
                b.kind == BuildingKind::LumberCamp && wrap_distance_f(size, (b.x, b.y), node) <= 2.0
            })
            .cloned()
    };
    let mut runner = Runner::new(&terrain);
    let mut i = 0;
    while i < 60 * TICKS_PER_GAME_DAY as usize && camp(&world).is_none_or(|c| c.site.is_some()) {
        runner.step(&mut world, &terrain);
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
        i += 1;
    }
    let place = camp(&world).expect("a lumber camp on the node");
    eprintln!("camp finished by tick {}", world.tick);
    assert!(place.site.is_none());
    let c = world.cities.iter().find(|c| c.id == city).expect("the city");
    assert!(c.workplace_ids.as_ref().is_some_and(|w| w.contains(&place.id)));
    let home = npc_home(&world, &city).expect("a home");
    assert!(wrap_distance_f(size, (home.x, home.y), (place.x, place.y)) > NPC_NODE_REACH);

    // Thirty days at it, on the Food the carrier brings. What they bring keeps going out of the
    // store, so Wood stays short and the crew stays.
    let everyone = people(&world, &city).len();
    let crew = |world: &WorldState| -> Vec<usize> {
        people(world, &city)
            .into_iter()
            .filter(|&i| {
                world.residents[i].script.as_ref().is_some_and(|s| {
                    s.memory.get("workplaceId").and_then(|v| v.as_str()) == Some(place.id.as_str())
                })
            })
            .collect()
    };
    let pile_food = |world: &WorldState| {
        building_pile(world, &place).and_then(|p| p.goods.get(&Good::Food)).copied().unwrap_or(0.0)
    };
    let mut last_pile = pile_food(&world);
    let (mut brought, mut hungry) = (0, 0);
    for i in 0..30 * TICKS_PER_GAME_DAY as usize {
        home_mut(&mut world, &city)
            .stock
            .get_or_insert_with(Default::default)
            .insert(Good::Wood, 0.0);
        runner.step(&mut world, &terrain);
        hungry += crew(&world).iter().filter(|&&i| world.residents[i].hunger <= 0.0).count();
        let pile = pile_food(&world);
        if pile > last_pile {
            brought += 1;
        }
        last_pile = pile;
        if i % TICKS_PER_GAME_DAY as usize == 0 {
            assert_eq!(check_all(&world, &terrain), []);
        }
    }
    assert!(!crew(&world).is_empty());
    assert!(brought > 0);
    assert!(last_pile <= CREW_FOOD, "{last_pile}");
    assert_eq!(hungry, 0);
    let down: Vec<&str> = people(&world, &city)
        .into_iter()
        .filter(|&i| world.residents[i].down_until.is_some())
        .map(|i| world.residents[i].id.as_str())
        .collect();
    assert_eq!(down, Vec::<&str>::new());
    assert!(people(&world, &city).len() >= everyone);
}
