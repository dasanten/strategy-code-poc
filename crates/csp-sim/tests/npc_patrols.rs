//! `apps/server/src/npc-patrols.test.ts`, ported (T86.17): Patrols (`CONTEXT.md`: Soldier posts;
//! ADR 0029).

mod build_common;

use build_common::{assert_sound, new_resident, plains, realm};
use csp_shared::balance::{
    NPC_PATROLS_MAX, NPC_PATROL_ROAD_STOPS, NPC_PATROL_WALL_STOPS, NPC_SOLDIERS_ON_HALL,
    NPC_SOLDIERS_PER_PATROL, NPC_VILLAGE, OWN_FOOD,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Alarm, AlarmKind, Building, BuildingKind, City, CityJob, CityPatrol, CityPlan,
    ConstructionSite, Good, Resident, ResidentOrder, Task, Tile, TradeOrgCity, WorldState,
};
use csp_sim::alarms::start_alarm;
use csp_sim::invariants::check_all;
use csp_sim::npc_behaviour::{npc_home, step_npc_cities};
use csp_sim::npc_cities::found_npc_city;
use csp_sim::npc_patrols::{next_stop, npc_patrols_sound, patrols_wanted, share_patrols};
use csp_sim::npc_plan::plan_city;
use csp_sim::npc_posts::free_soldiers;
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::names::placed;
use csp_sim::random::Mulberry32;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;

const SIZE: i32 = 128;

struct Staged {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: Building,
    hall: Building,
}

/// A city alone on an open map, its residents free and on its storage, `armed` of them with
/// spears.
fn staged(armed: usize) -> Staged {
    staged_of(armed, 40.0)
}

fn staged_of(armed: usize, residents: f64) -> Staged {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let size = csp_shared::balance::NpcCitySize { residents, ..NPC_VILLAGE };
    let city = found_npc_city(&mut world, &terrain, &size, 30, 30, &mut || m.next(), None);
    let storage = npc_home(&world, &city).expect("a home").clone();
    let hall = town_hall_of(&world, world.cities.iter().find(|c| c.id == city).unwrap())
        .expect("a hall")
        .clone();
    for (i, r) in world.residents.iter_mut().enumerate() {
        r.x = storage.x;
        r.y = storage.y;
        r.order = None;
        r.carried = Default::default();
        r.carried.insert(Good::Food, OWN_FOOD);
        r.script = None;
        if i < armed {
            r.carried.insert(Good::Spear, 1.0);
        }
    }
    Staged { world, terrain, city, storage, hall }
}

fn city_of(world: &WorldState, id: &str) -> City {
    world.cities.iter().find(|c| c.id == id).unwrap().clone()
}

/// The city's soldiers, in order of id.
fn soldiers_of(world: &WorldState) -> Vec<String> {
    let mut ids: Vec<String> = world
        .residents
        .iter()
        .filter(|r| r.carried.get(&Good::Spear).is_some_and(|n| *n > 0.0))
        .map(|r| r.id.clone())
        .collect();
    ids.sort();
    ids
}

/// Runs the city's pass and one tick of its behaviour.
fn pass(world: &mut WorldState, city: &str) {
    plan_city(world, city, None, None, None);
    step_npc_cities(world, SIZE, None, None);
}

/// Stands everyone with a walk where it ends.
fn arrive(world: &mut WorldState) {
    for r in &mut world.residents {
        let Some(ResidentOrder::WalkTo(w)) = &r.order else { continue };
        (r.x, r.y) = (w.target.x, w.target.y);
        r.order = None;
    }
}

/// A city staged with its soldiers on their posts, and its first rounds just begun.
fn on_posts(armed: usize) -> Staged {
    let mut s = staged(armed);
    pass(&mut s.world, &s.city);
    arrive(&mut s.world);
    pass(&mut s.world, &s.city);
    s
}

/// `on_posts`, in a city with a road across it inside its wall.
fn on_posts_with_road(armed: usize) -> Staged {
    let mut s = staged(armed);
    for i in 0..8 {
        let (x, y) = (s.hall.x + 3.0 + f64::from(i), s.hall.y + 6.0);
        if s.world.buildings.iter().any(|b| b.x == x && b.y == y) {
            continue;
        }
        s.world.buildings.push(road(&format!("rd{i}"), x, y));
    }
    pass(&mut s.world, &s.city);
    arrive(&mut s.world);
    pass(&mut s.world, &s.city);
    s
}

fn road(id: &str, x: f64, y: f64) -> Building {
    building_of(id, BuildingKind::Road, None, x, y)
}

fn building_of(id: &str, kind: BuildingKind, city: Option<&str>, x: f64, y: f64) -> Building {
    let mut b = build_common::building(id, kind, x, y);
    b.city_id = city.map(str::to_string);
    b
}

fn plan_of<'w>(world: &'w WorldState, city: &str) -> &'w CityPlan {
    &world.city_plans[city]
}

fn patrollers(world: &WorldState, city: &str) -> Vec<String> {
    plan_of(world, city).patrols.iter().flatten().map(|p| p.resident_id.clone()).collect()
}

fn by_id<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

fn by_id_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

fn tile(t: &Tile) -> String {
    format!("{},{}", t.x, t.y)
}

fn all_adults(world: &WorldState) -> Vec<usize> {
    (0..world.residents.len()).collect()
}

fn walk_order(x: f64, y: f64) -> ResidentOrder {
    serde_json::from_value(
        json!({ "kind": "walkTo", "target": { "x": x, "y": y }, "path": null, "progress": 0 }),
    )
    .unwrap()
}

fn food_of(r: &Resident) -> f64 {
    r.carried.get(&Good::Food).copied().unwrap_or(0.0)
}

mod patrols {
    use super::*;

    #[test]
    fn sends_a_share_of_those_on_the_wall_up_to_the_limit_however_many_there_are() {
        assert_eq!(patrols_wanted(NPC_SOLDIERS_PER_PATROL as usize - 1), 0);
        assert_eq!(patrols_wanted(NPC_SOLDIERS_PER_PATROL as usize), 1);
        assert_eq!(patrols_wanted(1000), NPC_PATROLS_MAX as usize);
    }

    #[test]
    fn takes_them_from_the_wall_those_on_the_hall_and_at_the_gate_stay() {
        let s = on_posts(11);
        let ids = soldiers_of(&s.world);
        let held = &ids[..NPC_SOLDIERS_ON_HALL as usize + 1];
        let on_wall = ids.len() - held.len();
        let out = patrollers(&s.world, &s.city);
        assert_eq!(out.len(), patrols_wanted(on_wall));
        for id in held {
            assert!(!out.contains(id));
        }
    }

    #[test]
    fn sends_none_from_a_city_with_too_few_on_its_wall() {
        let s = on_posts((NPC_SOLDIERS_ON_HALL + NPC_SOLDIERS_PER_PATROL) as usize);
        assert!(plan_of(&s.world, &s.city).patrols.is_none());
    }

    #[test]
    fn walks_the_wall_in_stops_then_the_roads_and_back_where_they_set_out_from() {
        let s = on_posts_with_road(11);
        let plan = plan_of(&s.world, &s.city);
        let round = plan.patrols.as_ref().unwrap()[0].clone();
        let r = by_id(&s.world, &round.resident_id);
        let tiles = |kind: BuildingKind| -> HashSet<String> {
            s.world
                .buildings
                .iter()
                .filter(|b| b.kind == kind)
                .map(|b| format!("{},{}", b.x, b.y))
                .collect()
        };
        let (walls, roads) = (tiles(BuildingKind::Wall), tiles(BuildingKind::Road));
        // The first stop is the walk they are on already.
        let first = match &r.order {
            Some(ResidentOrder::WalkTo(w)) => w.target.clone(),
            other => panic!("{other:?}"),
        };
        let mut stops = vec![first];
        stops.extend(round.stops.clone());
        assert_eq!(stops.len() as f64, NPC_PATROL_WALL_STOPS + NPC_PATROL_ROAD_STOPS + 1.0);
        let between = &stops[..stops.len() - 1];
        assert_eq!(
            between.iter().filter(|t| walls.contains(&tile(t))).count() as f64,
            NPC_PATROL_WALL_STOPS
        );
        assert_eq!(
            between.iter().filter(|t| roads.contains(&tile(t))).count() as f64,
            NPC_PATROL_ROAD_STOPS
        );
        // No stop twice, and the wall's spread right round the hall rather than bunched on one side.
        let distinct: HashSet<String> = between.iter().map(tile).collect();
        assert_eq!(distinct.len(), between.len());
        let hall = town_hall_of(&s.world, &s.world.cities[0]).unwrap();
        let along: Vec<&Tile> = between.iter().filter(|t| walls.contains(&tile(t))).collect();
        assert!(along.iter().any(|t| t.x < hall.x));
        assert!(along.iter().any(|t| t.x > hall.x));
        assert!(along.iter().any(|t| t.y < hall.y));
        assert!(along.iter().any(|t| t.y > hall.y));
        // They end where they set out from, on the wall.
        assert!(walls.contains(&tile(stops.last().unwrap())));
    }

    #[test]
    fn leaves_a_road_out_to_a_far_workplace_past_its_wall_alone() {
        let mut s = staged(11);
        let far = Tile { x: 100.0, y: 30.0 };
        s.world.buildings.push(road("far", far.x, far.y));
        pass(&mut s.world, &s.city);
        arrive(&mut s.world);
        pass(&mut s.world, &s.city);
        for p in plan_of(&s.world, &s.city).patrols.as_ref().unwrap() {
            assert!(!p.stops.iter().map(tile).any(|t| t == tile(&far)));
        }
    }

    #[test]
    fn walks_only_the_longer_ring_of_a_city_with_two() {
        let mut s = staged(11);
        // An inner ring of two stretches round the hall, with a gate of its own.
        for i in 0..4 {
            let (x, y) = (s.hall.x - 2.0 + f64::from(i), s.hall.y - 2.0);
            let kind = if i == 0 { BuildingKind::Gate } else { BuildingKind::Wall };
            s.world.buildings.push(building_of(&format!("in{i}"), kind, Some(&s.city), x, y));
        }
        pass(&mut s.world, &s.city);
        arrive(&mut s.world);
        pass(&mut s.world, &s.city);
        let inner: HashSet<String> = s
            .world
            .buildings
            .iter()
            .filter(|b| b.id.starts_with("in"))
            .map(|b| format!("{},{}", b.x, b.y))
            .collect();
        let rounds = plan_of(&s.world, &s.city).patrols.clone().unwrap();
        assert!(!rounds.is_empty());
        for p in &rounds {
            for t in &p.stops[..p.stops.len() - 1] {
                assert!(!inner.contains(&tile(t)));
            }
        }
    }

    #[test]
    fn walks_the_roads_alone_in_a_city_with_no_wall_and_not_at_all_with_neither() {
        let mut s = staged(11);
        s.world.buildings.retain(|b| b.kind != BuildingKind::Wall && b.kind != BuildingKind::Gate);
        pass(&mut s.world, &s.city);
        arrive(&mut s.world);
        pass(&mut s.world, &s.city);
        assert!(plan_of(&s.world, &s.city).patrols.is_none());

        arrive(&mut s.world);
        for i in 0..5 {
            s.world.buildings.push(road(
                &format!("rd{i}"),
                s.hall.x + 4.0 + f64::from(i),
                s.hall.y,
            ));
        }
        pass(&mut s.world, &s.city);
        let rounds = plan_of(&s.world, &s.city).patrols.clone().unwrap();
        assert!(!rounds.is_empty());
        assert!(rounds[0].stops.len() as f64 <= NPC_PATROL_ROAD_STOPS + 1.0);
    }

    #[test]
    fn does_not_call_a_walk_off_at_the_next_pass_and_gives_them_no_post_meanwhile() {
        let mut s = on_posts(11);
        let id = patrollers(&s.world, &s.city)[0].clone();
        let walk = by_id(&s.world, &id).order.clone();
        assert!(matches!(walk, Some(ResidentOrder::WalkTo(_))));
        s.world.tick += 1;
        pass(&mut s.world, &s.city);
        assert_eq!(by_id(&s.world, &id).order, walk);
        let city = city_of(&s.world, &s.city);
        let free = free_soldiers(&s.world, &city, &all_adults(&s.world));
        assert!(!free.iter().any(|&i| s.world.residents[i].id == id));
    }

    #[test]
    fn takes_the_next_by_id_when_a_round_ends_after_the_last_and_comes_round_again() {
        let mut s =
            on_posts(NPC_SOLDIERS_ON_HALL as usize + 1 + 2 * NPC_SOLDIERS_PER_PATROL as usize);
        let on_wall: Vec<String> =
            soldiers_of(&s.world)[NPC_SOLDIERS_ON_HALL as usize + 1..].to_vec();
        let wanted = patrols_wanted(on_wall.len());
        assert!(wanted >= 2);
        let mut set: Vec<String> = patrollers(&s.world, &s.city);
        let mut turn = 0;
        while set.len() < on_wall.len() + wanted {
            assert!(turn < on_wall.len() * 2, "{turn}");
            turn += 1;
            let backs: Vec<(String, Tile)> = plan_of(&s.world, &s.city)
                .patrols
                .iter()
                .flatten()
                .map(|p| (p.resident_id.clone(), p.stops.last().cloned().expect("a stop")))
                .collect();
            for (id, back) in backs {
                let r = by_id_mut(&mut s.world, &id);
                (r.x, r.y) = (back.x, back.y);
                r.order = None;
            }
            for p in s.world.city_plans.get_mut(&s.city).unwrap().patrols.iter_mut().flatten() {
                p.stops.clear();
            }
            // The tick that sees their stops gone ends their rounds, and the pass after sets the
            // next off.
            step_npc_cities(&mut s.world, SIZE, None, None);
            assert!(plan_of(&s.world, &s.city).patrols.is_none());
            s.world.tick += 1;
            pass(&mut s.world, &s.city);
            set.extend(patrollers(&s.world, &s.city));
        }
        // Everyone once before anyone twice, in order of id.
        assert_eq!(set[..on_wall.len()], on_wall[..]);
        assert_eq!(set[on_wall.len()..on_wall.len() + wanted], on_wall[..wanted]);
    }

    #[test]
    fn leaves_out_one_still_walking_back_to_their_post_and_gives_the_turn_to_the_next() {
        let mut s = staged(NPC_SOLDIERS_ON_HALL as usize + 1 + NPC_SOLDIERS_PER_PATROL as usize);
        pass(&mut s.world, &s.city);
        arrive(&mut s.world);
        let first = soldiers_of(&s.world)[NPC_SOLDIERS_ON_HALL as usize + 1].clone();
        let r = by_id_mut(&mut s.world, &first);
        r.x -= 1.0;
        r.order = Some(walk_order(r.x + 1.0, r.y));
        pass(&mut s.world, &s.city);
        assert!(!patrollers(&s.world, &s.city).contains(&first));
    }

    #[test]
    fn ends_the_round_of_one_no_longer_a_soldier_at_hand_as_one_the_pass_sends_to_train() {
        let mut s = on_posts(11);
        let adults: Vec<usize> =
            (0..s.world.residents.len()).filter(|&i| s.world.residents[i].health > 0.0).collect();
        let id = patrollers(&s.world, &s.city)[0].clone();
        s.world.city_plans.get_mut(&s.city).unwrap().jobs.insert(
            id.clone(),
            serde_json::from_value::<CityJob>(json!({ "kind": "idle" })).unwrap(),
        );
        let city = city_of(&s.world, &s.city);
        share_patrols(&mut s.world, &city, &adults, SIZE, None);
        assert!(!patrollers(&s.world, &s.city).contains(&id));
    }

    #[test]
    fn ends_every_round_when_its_hall_comes_down_or_it_turns_trade_org() {
        let mut s = on_posts(11);
        assert!(plan_of(&s.world, &s.city).patrols.is_some());
        let hall = s.hall.id.clone();
        s.world.buildings.iter_mut().find(|b| b.id == hall).unwrap().site =
            Some(ConstructionSite { delivered: Default::default(), work: 0.0 });
        let city = city_of(&s.world, &s.city);
        let adults = all_adults(&s.world);
        share_patrols(&mut s.world, &city, &adults, SIZE, None);
        assert!(plan_of(&s.world, &s.city).patrols.is_none());
    }

    #[test]
    fn a_trade_org_city_sends_none() {
        let mut s = staged(11);
        s.world.cities.iter_mut().find(|c| c.id == s.city).unwrap().trade_org =
            Some(TradeOrgCity::Post);
        pass(&mut s.world, &s.city);
        arrive(&mut s.world);
        pass(&mut s.world, &s.city);
        assert!(plan_of(&s.world, &s.city).patrols.is_none());
    }

    #[test]
    fn keeps_as_plain_data() {
        let s = on_posts(11);
        let plan = plan_of(&s.world, &s.city);
        let json = serde_json::to_string(&plan.patrols).unwrap();
        let back: Option<Vec<CityPatrol>> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, plan.patrols);
        assert!(plan.patrolled_last.is_some());
    }

    #[test]
    fn takes_the_stops_in_order_and_a_round_with_none_left_goes_off_the_plan() {
        let mut plan: CityPlan = serde_json::from_value(json!({
            "plannedAt": 0, "jobs": {},
            "patrols": [{ "residentId": "a", "stops": [{ "x": 1, "y": 2 }] }]
        }))
        .unwrap();
        assert_eq!(next_stop(&mut plan, "a"), Some((1.0, 2.0)));
        assert_eq!(plan.patrols.as_ref().unwrap().len(), 1);
        assert_eq!(next_stop(&mut plan, "a"), None);
        assert!(plan.patrols.is_none());
        assert_eq!(next_stop(&mut plan, "a"), None);
    }
}

mod patrols_and_food {
    use super::*;

    #[test]
    fn sends_one_running_low_with_none_to_take_back_to_their_post_and_ends_the_round() {
        let mut s = on_posts(11);
        let id = patrollers(&s.world, &s.city)[0].clone();
        let storage = s.storage.id.clone();
        s.world
            .buildings
            .iter_mut()
            .find(|b| b.id == storage)
            .unwrap()
            .stock
            .get_or_insert_with(Default::default)
            .insert(Good::Food, 0.0);
        by_id_mut(&mut s.world, &id).carried.insert(Good::Food, 0.5);
        s.world.tick += 1;
        pass(&mut s.world, &s.city);
        assert!(!patrollers(&s.world, &s.city).contains(&id));
    }

    #[test]
    fn brings_one_low_on_food_in_from_outside_its_area_and_they_refill_there() {
        let mut s = on_posts(11);
        let id = patrollers(&s.world, &s.city)[0].clone();
        {
            let r = by_id_mut(&mut s.world, &id);
            (r.x, r.y) = (100.0, 100.0);
            r.carried.insert(Good::Food, 0.5);
        }
        s.world.tick += 1;
        pass(&mut s.world, &s.city);
        assert!(!patrollers(&s.world, &s.city).contains(&id));
        assert!(matches!(by_id(&s.world, &id).order, Some(ResidentOrder::WalkTo(_))));
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        let mut scratch = Scratch::default();
        let mut t = 0.0;
        while t < 2.0 * TICKS_PER_GAME_DAY && food_of(by_id(&s.world, &id)) < 1.0 {
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
            t += 1.0;
        }
        let r = by_id(&s.world, &id);
        assert!(r.health > 0.0);
        assert!(food_of(r) >= 0.5);
    }

    #[test]
    fn goes_on_with_a_round_while_the_storage_has_food() {
        let mut s = on_posts(11);
        let id = patrollers(&s.world, &s.city)[0].clone();
        by_id_mut(&mut s.world, &id).carried.insert(Good::Food, 0.5);
        s.world.tick += 1;
        pass(&mut s.world, &s.city);
        assert!(patrollers(&s.world, &s.city).contains(&id));
    }
}

mod in_the_running_world {
    use super::*;

    /// Those armed walking anywhere, once all are on their posts: what a patrol adds.
    fn walkers(world: &WorldState) -> usize {
        soldiers_of(world)
            .iter()
            .filter(|id| {
                matches!(
                    by_id(world, id).order,
                    Some(ResidentOrder::WalkTo(_)) | Some(ResidentOrder::Climb(_))
                )
            })
            .count()
    }

    fn broken(world: &WorldState, terrain: &TerrainMap) -> Vec<String> {
        check_all(world, terrain).into_iter().map(|v| v.message).collect()
    }

    #[test]
    #[ignore = "25 s alone; see #1092"]
    fn no_more_than_the_limit_walk_at_once_they_take_turns_and_nobody_starves() {
        let armed = NPC_SOLDIERS_ON_HALL as usize + 1 + 2 * NPC_SOLDIERS_PER_PATROL as usize;
        let mut s = staged(armed);
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        let mut scratch = Scratch::default();
        let soldiers = soldiers_of(&s.world);
        for id in &soldiers {
            by_id_mut(&mut s.world, id).carried.insert(Good::Food, 2.0);
        }
        let on_wall: Vec<String> = soldiers[NPC_SOLDIERS_ON_HALL as usize + 1..].to_vec();
        let wanted = patrols_wanted(on_wall.len());
        let (mut set, mut most, mut was): (Vec<String>, usize, Vec<String>) = Default::default();
        let hall = placed(&s.hall).to_owned();
        let ticks = (6.0 * TICKS_PER_GAME_DAY) as usize;
        for t in 0..ticks {
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
            if t % 20 == 0 {
                assert_eq!(broken(&s.world, &s.terrain), Vec::<String>::new());
            }
            let now = if s.world.city_plans.contains_key(&s.city) {
                patrollers(&s.world, &s.city)
            } else {
                vec![]
            };
            assert!(now.len() <= wanted);
            set.extend(now.iter().filter(|id| !was.contains(id)).cloned());
            was = now;
            // They all reach their posts in the first game day, and then only patrols walk, and
            // the hall is held all along.
            if t as f64 > TICKS_PER_GAME_DAY {
                most = most.max(walkers(&s.world));
                let held = soldiers
                    .iter()
                    .filter(|id| {
                        let r = by_id(&s.world, id);
                        is_at((r.x as i32, r.y as i32), hall.clone(), SIZE)
                    })
                    .count();
                assert!(held >= 1);
            }
        }
        assert!(most > 0);
        assert!(most <= wanted);
        // Everyone on the wall has had a round before anyone a second, in their order of id:
        // those quickest to their posts go first, and the turn goes on round from there.
        assert!(set.len() > on_wall.len());
        let from = on_wall.iter().position(|id| *id == set[0]).unwrap();
        let in_order: Vec<String> =
            (0..on_wall.len()).map(|i| on_wall[(from + i) % on_wall.len()].clone()).collect();
        assert_eq!(set[..on_wall.len()], in_order[..]);
        assert_eq!(set[on_wall.len()], set[0]);
        for id in &soldiers {
            let r = by_id(&s.world, id);
            assert!(r.health > 0.0);
            assert!(food_of(r) > 0.0);
        }
    }

    #[test]
    fn a_walled_in_round_doesnt_stick_its_stops_go_by_and_the_next_takes_a_turn() {
        let mut s =
            staged(NPC_SOLDIERS_ON_HALL as usize + 1 + 2 * NPC_SOLDIERS_PER_PATROL as usize);
        pass(&mut s.world, &s.city);
        arrive(&mut s.world);
        let first = soldiers_of(&s.world)[NPC_SOLDIERS_ON_HALL as usize + 1].clone();
        let (fx, fy) = {
            let r = by_id(&s.world, &first);
            (r.x as i32, r.y as i32)
        };
        // Sea all round the tile they stand on, with no way off it.
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                s.terrain.tiles[tile_index(SIZE, fx + dx, fy + dy)] = Terrain::Sea as u8;
            }
        }
        let at = (fx, fy);
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        let mut scratch = Scratch::default();
        let (mut was, mut gone) = (false, false);
        for _ in 0..180 {
            if gone {
                break;
            }
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
            if patrollers(&s.world, &s.city).contains(&first) {
                was = true;
            } else if was {
                gone = true;
            }
        }
        assert!(was);
        assert!(gone);
        let r = by_id(&s.world, &first);
        assert_eq!((r.x as i32, r.y as i32), at);
        assert!(r.order.is_none());
        // Their turn is over: the next is on their way, and they stand where they were.
        for _ in 0..120 {
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
        }
        assert!(!patrollers(&s.world, &s.city).contains(&first));
        assert!(plan_of(&s.world, &s.city).patrolled_last.as_deref().unwrap() > first.as_str());
    }

    #[test]
    fn an_alarm_takes_one_off_a_round_and_they_go_on_with_it_after() {
        let mut s = on_posts(11);
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        let mut scratch = Scratch::default();
        let id = patrollers(&s.world, &s.city)[0].clone();
        for _ in 0..30 {
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
        }
        let stops = |s: &Staged| {
            plan_of(&s.world, &s.city)
                .patrols
                .iter()
                .flatten()
                .find(|p| p.resident_id == id)
                .map(|p| p.stops.len())
                .unwrap()
        };
        let before = stops(&s);
        let i = s.world.residents.iter().position(|r| r.id == id).unwrap();
        let (x, y) = (s.world.residents[i].x, s.world.residents[i].y);
        let alarm = Alarm {
            kind: AlarmKind::Outsider,
            city_id: s.city.clone(),
            about: "x".into(),
            realm_id: None,
            x,
            y,
            tick: s.world.tick as f64,
        };
        start_alarm(&mut s.world, i, &alarm);
        let r = by_id(&s.world, &id);
        assert_eq!(r.script.as_ref().and_then(|s| s.task), Some(Task::Alarm));
        assert!(r.order.is_none());
        assert!(matches!(
            r.interrupted.as_ref().and_then(|i| i.order.as_ref()),
            Some(ResidentOrder::WalkTo(_))
        ));
        assert!(patrollers(&s.world, &s.city).contains(&id));

        // Nobody about it is there: their Alarm script ends, and they go on where they left off.
        let mut on = false;
        let mut t = 0.0;
        while t < TICKS_PER_GAME_DAY && !on {
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
            let r = by_id(&s.world, &id);
            on = r.script.is_none() && matches!(r.order, Some(ResidentOrder::WalkTo(_)));
            t += 1.0;
        }
        assert!(on);
        assert!(patrollers(&s.world, &s.city).contains(&id));
        let after = stops(&s);
        assert!(after <= before);
        assert!(after > 0);
    }

    #[test]
    fn an_outsider_in_sight_breaks_a_round_off_for_the_hall_and_the_round_ends_back_on_the_wall() {
        let mut s = on_posts(11);
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        let mut scratch = Scratch::default();
        let id = patrollers(&s.world, &s.city)[0].clone();
        let (rx, ry) = (by_id(&s.world, &id).x, by_id(&s.world, &id).y);
        let mut leader = new_resident("leader", Some("r1"), 100.0, 100.0);
        leader.born_at = s.world.tick as f64 - 20.0 * 24.0 * 3600.0;
        leader.lifespan = 60.0;
        let born_at = leader.born_at;
        s.world.residents.push(leader);
        s.world.realms.push(realm("r1", 7, "leader"));
        let mut p = new_resident("p1", Some("r1"), rx - 3.0, ry);
        p.born_at = born_at;
        p.lifespan = 60.0;
        p.carried.insert(Good::Sword, 1.0);
        s.world.residents.push(p);
        let alarmed_now = |s: &Staged| {
            by_id(&s.world, &id).script.as_ref().and_then(|s| s.task) == Some(Task::Alarm)
        };
        let mut alarmed = false;
        for _ in 0..60 {
            if alarmed {
                break;
            }
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
            alarmed = alarmed_now(&s);
        }
        assert!(alarmed);
        assert_eq!(check_all(&s.world, &s.terrain), []);
        let p = by_id_mut(&mut s.world, "p1");
        (p.x, p.y) = (100.0, 100.0);
        let mut ended = false;
        let mut t = 0.0;
        while t < 4.0 * TICKS_PER_GAME_DAY && !ended {
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
            ended = !patrollers(&s.world, &s.city).contains(&id);
            t += 1.0;
        }
        assert!(ended);
        assert!(city_of(&s.world, &s.city).occupation.is_none());
    }
}

mod npc_patrols_sound_invariant {
    use super::*;

    fn stops() -> Vec<Tile> {
        vec![Tile { x: 1.0, y: 1.0 }]
    }

    fn messages(world: &WorldState) -> Vec<String> {
        npc_patrols_sound(world).into_iter().map(|v| v.message).collect()
    }

    #[test]
    fn holds_in_a_city_with_its_rounds_under_way() {
        let mut s = on_posts(11);
        assert!(plan_of(&s.world, &s.city).patrols.is_some());
        s.world.tick = plan_of(&s.world, &s.city).planned_at as u64 + 1;
        assert_eq!(messages(&s.world), Vec::<String>::new());
    }

    #[test]
    fn catches_too_many_at_once_one_on_two_rounds_and_a_round_too_long() {
        let mut s = on_posts(11);
        let long: Vec<Tile> = (0..50).map(|_| stops()[0].clone()).collect();
        s.world.city_plans.get_mut(&s.city).unwrap().patrols = Some(
            (0..NPC_PATROLS_MAX as usize + 1)
                .map(|_| CityPatrol { resident_id: "same".into(), stops: long.clone() })
                .collect(),
        );
        let found = messages(&s.world);
        let city = &s.city;
        assert!(found
            .contains(&format!("{city} has {} on patrol at once", NPC_PATROLS_MAX as usize + 1)));
        assert!(found.contains(&format!("{city} has a soldier on two rounds")));
        assert!(found.contains(&format!("{city} has a round of 50 stops")));
    }

    #[test]
    fn catches_an_empty_list_and_rounds_in_a_trade_org_city() {
        let mut s = on_posts(11);
        s.world.city_plans.get_mut(&s.city).unwrap().patrols = Some(vec![]);
        assert_eq!(messages(&s.world), vec![format!("{} keeps an empty list of patrols", s.city)]);
        s.world.city_plans.get_mut(&s.city).unwrap().patrols =
            Some(vec![CityPatrol { resident_id: "a".into(), stops: stops() }]);
        s.world.cities.iter_mut().find(|c| c.id == s.city).unwrap().trade_org =
            Some(TradeOrgCity::Post);
        assert_eq!(
            messages(&s.world),
            vec![format!("{} is the Trade Org\u{2019}s, and has patrols", s.city)]
        );
    }

    #[test]
    fn catches_someone_else_on_patrol_right_after_a_pass_and_only_then() {
        let mut s = on_posts(11);
        let id = patrollers(&s.world, &s.city)[0].clone();
        by_id_mut(&mut s.world, &id).city_id = Some("elsewhere".into());
        let planned = plan_of(&s.world, &s.city).planned_at as u64;
        s.world.tick = planned + 30;
        assert_eq!(messages(&s.world), Vec::<String>::new());
        s.world.tick = planned + 1;
        assert_eq!(
            messages(&s.world),
            vec![format!("{} has {id} on patrol, who isn\u{2019}t its own", s.city)]
        );
    }
}

#[allow(dead_code)]
fn unused(_: Value, _: fn(&WorldState, &TerrainMap)) {
    let _ = assert_sound;
}
