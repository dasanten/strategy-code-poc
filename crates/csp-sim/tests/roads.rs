//! `apps/server/src/roads.test.ts`: building roads, and moving and finding paths on them
//! (`CONTEXT.md`: Road).

mod build_common;
mod ts_match;

use std::sync::Arc;

use build_common::{building, new_resident, player, realm, Orders};
use csp_shared::balance::{
    AVERAGE_HORSE_STATS, BUILD_MATERIALS, BUILD_WORK, CARRIAGE_SPEED, MAX_HEALTH, MAX_HUNGER,
    MOUNTAIN_ROAD_WORK_FACTOR, TERRAIN_SPEED, WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::{ground_at, Terrain, TerrainMap, DIAGONAL_STEP};
use csp_shared::world::{
    Building, BuildingKind, Carriage, ConstructionSite, Good, Horse, HorseStats, Stock, WorldState,
};
use csp_sim::invariants::{check_all, invariant_named};
use csp_sim::pathfinding::{PathFinder, PathOptions, PathResult, WALKING_COSTS};
use csp_sim::queries::building::{building_at, road_at, road_tiles, teardown_work};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use ts_match::json_of;

/// A square map drawn as text (sides join): . plains, f forest, h hills, ^ mountain, ~ lake.
fn draw(rows: &[&str]) -> TerrainMap {
    let tiles = rows
        .iter()
        .flat_map(|r| r.chars())
        .map(|c| match c {
            '.' => Terrain::Plains as u8,
            'f' => Terrain::Forest as u8,
            'h' => Terrain::Hills as u8,
            '^' => Terrain::Mountain as u8,
            '~' => Terrain::Lake as u8,
            other => panic!("no terrain drawn as {other:?}"),
        })
        .collect();
    TerrainMap { size: rows.len() as i32, tiles }
}

fn filled(c: char, side: usize) -> TerrainMap {
    let row = c.to_string().repeat(side);
    draw(&vec![row.as_str(); side])
}

/// A world on `map` with realm r1 (Player 7) and its resident w1 at (x, y), average stats.
fn setup(map: &TerrainMap, x: f64, y: f64) -> (WorldState, Orders) {
    let mut world = create_world(map, 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "w1"));
    world.residents.push(new_resident("w1", Some("r1"), x, y));
    (world, Orders::default())
}

/// A finished road on (x, y).
fn road(world: &mut WorldState, x: f64, y: f64) -> String {
    road_named(world, x, y, &format!("rd{x},{y}"))
}
fn road_named(world: &mut WorldState, x: f64, y: f64, id: &str) -> String {
    world.buildings.push(building(id, BuildingKind::Road, x, y));
    id.to_string()
}

fn b_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Building {
    world.buildings.iter_mut().find(|b| b.id == id).expect("a building")
}

/// Steps the world, keeping residents fed.
fn run(world: &mut WorldState, map: &TerrainMap, ticks: usize, walking: Option<&mut Walking>) {
    let mut scratch = Scratch::default();
    match walking {
        Some(w) => {
            for _ in 0..ticks {
                for r in &mut world.residents {
                    r.hunger = MAX_HUNGER;
                }
                step_world(world, map, &mut scratch, Some(&mut *w), None);
            }
        }
        None => {
            for _ in 0..ticks {
                for r in &mut world.residents {
                    r.hunger = MAX_HUNGER;
                }
                step_world(world, map, &mut scratch, None, None);
            }
        }
    }
}

/// Ticks until w1's walk or drive order is done.
fn ticks_to_arrive(world: &mut WorldState, map: &TerrainMap) -> usize {
    let mut walking = Walking::new(Arc::new(map.clone()));
    let mut t = 0;
    while world.residents[0].order.is_some() && t < 5000 {
        run(world, map, 1, Some(&mut walking));
        t += 1;
    }
    t
}

#[track_caller]
fn assert_sound(world: &WorldState, map: &TerrainMap) {
    let broken: Vec<String> = check_all(world, map)
        .into_iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert_eq!(broken, Vec::<String>::new());
}

fn road_stock() -> Stock {
    serde_json::from_value(json_of(&BUILD_MATERIALS.get("road").expect("a road's materials")))
        .expect("a stock")
}

fn build() -> Value {
    json!({ "kind": "build", "residentId": "w1", "building": "road" })
}

fn drop_at(site: &str, goods: Value) -> Value {
    json!({ "kind": "drop", "residentId": "w1", "spot": { "kind": "site", "siteId": site }, "goods": goods })
}

fn order(world: &mut WorldState, map: &TerrainMap, q: &mut Orders, o: Value) {
    q.receive(world, &player(7), o, map).ok();
    q.apply_all(world, map);
}

fn road_work() -> f64 {
    BUILD_WORK.get("road").expect("a road's work")
}

fn walk_to(x: f64, y: f64) -> Value {
    json!({ "kind": "walkTo", "target": { "x": x, "y": y }, "path": null, "progress": 0 })
}

mod building_a_road {
    use super::*;

    fn map() -> TerrainMap {
        draw(&[
            "........", ".fh^~...", "........", "........", "........", "........", "........",
            "........",
        ])
    }

    #[test]
    fn lays_out_a_site_on_passable_land_and_finishes_it_from_stone_and_work() {
        let map = map();
        let (mut world, mut q) = setup(&map, 1.0, 1.0);
        assert_eq!(q.receive(&world, &player(7), build(), &map), Ok(()));
        q.apply_all(&mut world, &map);
        run(&mut world, &map, 1, None);
        let site = road_at(&world, 1, 1).expect("a road site").clone();
        let s = site.site.as_ref().expect("still a site");
        assert!(s.delivered.is_empty());
        assert_eq!(site.city_id, None);
        assert!(building_at(&world, 1, 1, map.size).is_none());

        world.residents[0].carried =
            [(Good::Stone, road_stock()[&Good::Stone])].into_iter().collect();
        order(&mut world, &map, &mut q, drop_at(&site.id, json!({ "stone": 5 })));
        run(&mut world, &map, 2, None);
        let delivered = |w: &WorldState| {
            w.buildings.iter().find(|b| b.id == site.id).and_then(|b| b.site.clone())
        };
        assert_eq!(delivered(&world).expect("a site").delivered, road_stock());

        order(&mut world, &map, &mut q, build());
        run(&mut world, &map, road_work() as usize + 2, None);
        assert!(delivered(&world).is_none());
        assert!(world.residents[0].order.is_none());
        assert_sound(&world, &map);

        // Hills and Mountain take a road too; a Lake doesn't; one road per tile.
        world.residents[0].x = 2.0;
        assert_eq!(q.receive(&world, &player(7), build(), &map), Ok(()));
        world.residents[0].x = 3.0;
        assert_eq!(q.receive(&world, &player(7), build(), &map), Ok(()));
        world.residents[0].x = 4.0;
        assert_eq!(
            q.receive(&world, &player(7), build(), &map),
            Err("a road goes on passable land".into())
        );
        world.residents[0].x = 1.0;
        assert_eq!(
            q.receive(&world, &player(7), build(), &map),
            Err("there is already a road on this tile".into())
        );
    }

    /// The same resident builds a road on (x, 1), materials in; the ticks it takes.
    fn ticks_to_build(map: &TerrainMap, x: f64) -> f64 {
        let (mut world, mut q) = setup(map, x, 1.0);
        world.residents[0].carried = road_stock();
        order(&mut world, map, &mut q, build());
        run(&mut world, map, 1, None);
        let site = road_at(&world, x as i32, 1).expect("a site").id.clone();
        order(&mut world, map, &mut q, drop_at(&site, json_of(&road_stock())));
        run(&mut world, map, 1, None);
        let site_of =
            |w: &WorldState| w.buildings.iter().find(|b| b.id == site).and_then(|b| b.site.clone());
        assert_eq!(site_of(&world).expect("a site").delivered, road_stock());
        order(&mut world, map, &mut q, build());
        let mut t = 2.0;
        while site_of(&world).is_some() && t < 100.0 * road_work() {
            run(&mut world, map, 1, None);
            t += 1.0;
        }
        assert!(site_of(&world).is_none());
        assert_sound(&world, map);
        t
    }

    #[test]
    fn needs_four_times_the_work_on_mountain_and_the_same_stone_as_on_plains() {
        let map = map();
        let plains = ticks_to_build(&map, 1.0);
        let mountain = ticks_to_build(&map, 3.0);
        // Construction learned along the way speeds both up a little, the longer build a little
        // more.
        let ratio = mountain / plains;
        assert!(ratio > MOUNTAIN_ROAD_WORK_FACTOR * 0.9, "{ratio}");
        assert!(ratio <= MOUNTAIN_ROAD_WORK_FACTOR * 1.05, "{ratio}");
    }

    fn ticks_to_tear_down(map: &TerrainMap, x: f64) -> f64 {
        let (mut world, mut q) = setup(map, x, 1.0);
        let rd = road(&mut world, x, 1.0);
        order(
            &mut world,
            map,
            &mut q,
            json!({ "kind": "tearDown", "residentId": "w1", "buildingId": rd }),
        );
        let mut t = 0.0;
        while road_at(&world, x as i32, 1).is_some() && t < 100.0 * road_work() {
            run(&mut world, map, 1, None);
            t += 1.0;
        }
        assert!(road_at(&world, x as i32, 1).is_none());
        t
    }

    #[test]
    fn takes_four_times_the_work_to_tear_down_on_mountain() {
        let map = map();
        let ratio = ticks_to_tear_down(&map, 3.0) / ticks_to_tear_down(&map, 1.0);
        assert!(ratio > MOUNTAIN_ROAD_WORK_FACTOR * 0.9, "{ratio}");
        assert!(ratio <= MOUNTAIN_ROAD_WORK_FACTOR * 1.05, "{ratio}");
    }

    #[test]
    fn shares_a_tile_with_a_building_such_as_a_gate_and_a_building_can_go_on_a_road() {
        let map = map();
        let (mut world, mut q) = setup(&map, 4.0, 4.0);
        world.buildings.push(building("g1", BuildingKind::Gate, 4.0, 4.0));
        order(&mut world, &map, &mut q, build());
        run(&mut world, &map, 1, None);
        assert_eq!(building_at(&world, 4, 4, map.size).map(|b| b.id.as_str()), Some("g1"));
        assert!(road_at(&world, 4, 4).and_then(|b| b.site.as_ref()).is_some());
        assert_sound(&world, &map);

        // A road with no building yet: a stable can still go there.
        road(&mut world, 5.0, 4.0);
        world.residents[0].x = 5.0;
        let stable = json!({ "kind": "build", "residentId": "w1", "building": "stable" });
        assert_eq!(q.receive(&world, &player(7), stable, &map), Ok(()));
    }

    #[test]
    fn takes_deliveries_for_the_road_site_and_the_building_site_on_one_tile_apart() {
        let map = map();
        let (mut world, mut q) = setup(&map, 4.0, 4.0);
        let mut gate = building("b1", BuildingKind::Gate, 4.0, 4.0);
        gate.site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
        world.buildings.push(gate);
        let rd = road(&mut world, 4.0, 4.0);
        b_mut(&mut world, &rd).site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
        world.residents[0].carried = [(Good::Wood, 3.0), (Good::Stone, 3.0)].into_iter().collect();
        order(&mut world, &map, &mut q, drop_at(&rd, json!({ "stone": 3 })));
        run(&mut world, &map, 2, None);
        order(&mut world, &map, &mut q, drop_at("b1", json!({ "wood": 3 })));
        run(&mut world, &map, 2, None);
        let delivered = |id: &str| {
            json_of(
                &world
                    .buildings
                    .iter()
                    .find(|b| b.id == id)
                    .unwrap()
                    .site
                    .as_ref()
                    .unwrap()
                    .delivered,
            )
        };
        assert_eq!(delivered(&rd), json!({ "stone": 1.0 }));
        assert_eq!(delivered("b1"), json!({ "wood": 3.0 }));
        assert_sound(&world, &map);
    }

    #[test]
    fn is_torn_down_like_any_building_leaving_the_building_it_shared_the_tile_with() {
        let map = map();
        let (mut world, mut q) = setup(&map, 4.0, 4.0);
        world.buildings.push(building("g1", BuildingKind::Gate, 4.0, 4.0));
        let rd = road(&mut world, 4.0, 4.0);
        let work = teardown_work(world.buildings.iter().find(|b| b.id == rd).unwrap());
        order(
            &mut world,
            &map,
            &mut q,
            json!({ "kind": "tearDown", "residentId": "w1", "buildingId": rd }),
        );
        run(&mut world, &map, work.ceil() as usize + 2, None);
        assert!(road_at(&world, 4, 4).is_none());
        assert_eq!(building_at(&world, 4, 4, map.size).map(|b| b.id.as_str()), Some("g1"));
        // Half of a road's one Stone, rounded down, is nothing left over.
        assert!(world.piles.is_empty());
        assert!(world.residents[0].order.is_none());
        assert_sound(&world, &map);
    }
}

mod moving_on_a_road {
    use super::*;

    fn speed(table: &csp_shared::balance::TerrainTable) -> f64 {
        table.get(Terrain::Road as u8).expect("a road speed")
    }

    #[test]
    fn walks_at_road_speed_whatever_the_terrain_beneath() {
        let forest = filled('f', 16);
        let ticks = |with_road: bool| {
            let (mut world, _) = setup(&forest, 2.0, 2.0);
            if with_road {
                for x in 3..=6 {
                    road(&mut world, f64::from(x), 2.0);
                }
            }
            world.residents[0].order = Some(serde_json::from_value(walk_to(6.0, 2.0)).unwrap());
            ticks_to_arrive(&mut world, &forest) as f64 / 4.0
        };
        let on_road = ticks(true);
        assert!((on_road - WALK_TICKS_PER_TILE / speed(&TERRAIN_SPEED)).abs() < 2.0, "{on_road}");
        assert!(ticks(false) > on_road * 1.5);
    }

    #[test]
    fn drives_a_carriage_at_road_speed_whatever_the_terrain_beneath() {
        let forest = filled('f', 16);
        let ticks = |with_road: bool| {
            let (mut world, _) = setup(&forest, 2.0, 2.0);
            world.horses.push(Horse {
                id: "h1".into(),
                realm_id: Some("r1".into()),
                city_id: None,
                x: 2.0,
                y: 2.0,
                hunger: MAX_HUNGER,
                health: MAX_HEALTH,
                name: "Rowan".into(),
                stats: HorseStats {
                    speed: AVERAGE_HORSE_STATS.speed,
                    strength: AVERAGE_HORSE_STATS.strength,
                    endurance: AVERAGE_HORSE_STATS.endurance,
                },
                born_at: 0.0,
                down_until: None,
            });
            world.carriages.push(Carriage {
                id: "k1".into(),
                realm_id: Some("r1".into()),
                city_id: None,
                x: 2.0,
                y: 2.0,
                horse_id: None,
                load: Stock::new(),
            });
            if with_road {
                for x in 3..=6 {
                    road(&mut world, f64::from(x), 2.0);
                }
            }
            world.residents[0].order = Some(
                serde_json::from_value(json!({
                    "kind": "drive", "carriageId": "k1", "target": { "x": 6, "y": 2 },
                    "path": null, "progress": 0
                }))
                .unwrap(),
            );
            ticks_to_arrive(&mut world, &forest) as f64 / 4.0
        };
        let on_road = ticks(true);
        assert!((on_road - WALK_TICKS_PER_TILE / speed(&CARRIAGE_SPEED)).abs() < 2.0, "{on_road}");
        assert!(ticks(false) > on_road * 3.0);
    }

    #[test]
    fn burns_food_as_on_plains_even_over_hills() {
        let hills = filled('h', 8);
        let plains = filled('.', 8);
        let drain = |map: &TerrainMap, with_road: bool| {
            let (mut world, _) = setup(map, 2.0, 2.0);
            if with_road {
                road(&mut world, 2.0, 2.0);
            }
            step_world(&mut world, map, &mut Scratch::default(), None, None);
            MAX_HUNGER - world.residents[0].hunger
        };
        assert!((drain(&hills, true) - drain(&plains, false)).abs() < 0.005);
        assert!(drain(&hills, false) > drain(&plains, false));
    }

    #[test]
    fn ignores_road_sites_nobody_goes_faster_on_one_yet() {
        let map = filled('h', 8);
        let mut world = create_world(&map, 1);
        road(&mut world, 1.0, 1.0);
        let site = road(&mut world, 2.0, 1.0);
        b_mut(&mut world, &site).site =
            Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
        let roads = road_tiles(&world, map.size);
        assert_eq!(ground_at(&map, &roads, 1, 1), Terrain::Road as u8);
        assert_eq!(ground_at(&map, &roads, 2, 1), Terrain::Hills as u8);
    }
}

mod pathfinding_with_roads {
    use super::*;

    /// Mountains between (1, 5) and (9, 5), plains round them; a road could run along row 1.
    fn map() -> TerrainMap {
        draw(&[
            "~~~~~~~~~~~",
            "~.........~",
            "~.^^^^^^^.~",
            "~.^^^^^^^.~",
            "~.^^^^^^^.~",
            "~.^^^^^^^.~",
            "~.^^^^^^^.~",
            "~.^^^^^^^.~",
            "~.^^^^^^^.~",
            "~.........~",
            "~~~~~~~~~~~",
        ])
    }

    fn lay_road(world: &mut WorldState) {
        for y in 1..=5 {
            road(world, 1.0, f64::from(y));
            road(world, 9.0, f64::from(y));
        }
        for x in 2..=8 {
            road(world, f64::from(x), 1.0);
        }
    }

    fn found(r: PathResult) -> (Vec<(i32, i32)>, f64) {
        match r {
            PathResult::Found { path, cost } => (path, cost),
            other => panic!("no path: {other:?}"),
        }
    }

    #[test]
    fn prefers_a_road_to_plains_of_the_same_length() {
        let map = map();
        let mut finder = PathFinder::new(Arc::new(map.clone()));
        let find = |f: &mut PathFinder| {
            found(f.find_path((1, 5), (9, 5), &WALKING_COSTS, PathOptions::default()))
        };
        let (_, before) = find(&mut finder);
        // Round the mountains, cutting the two corners diagonally: 12 straight steps and 2
        // diagonal.
        let round = 12.0 + 2.0 * DIAGONAL_STEP;
        assert!((before - round).abs() < 5e-5, "{before}");

        let mut world = create_world(&map, 1);
        lay_road(&mut world);
        finder.set_roads(road_tiles(&world, map.size));
        let (path, cost) = find(&mut finder);
        // Along the road: 3 up, a diagonal, 6 across, a diagonal, 3 down, all at road speed.
        assert_eq!(path.len(), 14);
        assert!(path.iter().all(|&(x, y)| x == 1 || x == 9 || y == 1), "{path:?}");
        let road_speed = TERRAIN_SPEED.get(Terrain::Road as u8).unwrap();
        assert!((cost - round / road_speed).abs() < 5e-5, "{cost}");

        // Torn down, the road is forgotten.
        finder.set_roads([]);
        let (_, after) = find(&mut finder);
        assert!((after - round).abs() < 5e-5, "{after}");
    }

    #[test]
    fn sends_walkers_along_the_road() {
        let map = map();
        let (mut world, _) = setup(&map, 1.0, 5.0);
        lay_road(&mut world);
        world.residents[0].order = Some(serde_json::from_value(walk_to(9.0, 5.0)).unwrap());
        let mut walking = Walking::new(Arc::new(map.clone()));
        let mut visited = std::collections::HashSet::new();
        let mut t = 0;
        while world.residents[0].order.is_some() && t < 5000 {
            run(&mut world, &map, 1, Some(&mut walking));
            visited.insert((world.residents[0].x as i32, world.residents[0].y as i32));
            t += 1;
        }
        assert!(visited.contains(&(5, 1)));
        assert_sound(&world, &map);
    }
}

mod road_invariants {
    use super::*;

    #[test]
    fn catch_a_road_of_a_city_and_two_roads_on_one_tile_but_not_a_road_on_mountain() {
        let map = draw(&["^...", "....", "....", "...."]);
        let mut world = create_world(&map, 1);
        road_named(&mut world, 0.0, 0.0, "a");
        road_named(&mut world, 1.0, 1.0, "b");
        b_mut(&mut world, "b").city_id = Some("c9".into());
        road_named(&mut world, 2.0, 2.0, "c");
        road_named(&mut world, 2.0, 2.0, "d");
        let messages: Vec<String> =
            (invariant_named("buildings-in-place").expect("an invariant").check)(&world, &map)
                .into_iter()
                .map(|v| v.message)
                .collect();
        assert!(!messages.iter().any(|m| m.starts_with("a ")), "{messages:?}");
        assert!(messages.contains(&"b is a road of city c9".to_string()), "{messages:?}");
        assert!(
            // `/^d overlaps .+ on tile .2,2.$/`
            messages.iter().any(|m| m.starts_with("d overlaps ")
                && m.rsplit_once(" on tile ").is_some_and(|(_, t)| {
                    t.chars().count() == 5 && t.chars().skip(1).take(3).collect::<String>() == "2,2"
                })),
            "{messages:?}"
        );
    }
}
