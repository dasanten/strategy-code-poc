//! `apps/server/src/outpost-storage.test.ts`. Outpost storage (`CONTEXT.md`: Outpost storage): a
//! storage of no city belongs to the realm whose residents finished it and counts as a storage of
//! that realm everywhere; a city that grows over it takes it in.

mod build_common;
mod ts_match;

use std::sync::Arc;

use build_common::{add_city, building, new_resident, player, realm, Orders};
use csp_shared::balance::{
    AVERAGE_HORSE_STATS, BUILD_MATERIALS, BUILD_WORK, CITY_BUILDING_REACH, FOOD_PER_DAY,
    HOME_FOOD_LOW, MAX_HEALTH, MAX_HUNGER, OUTPOST_REFILL_REACH, OWN_FOOD,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Carriage, ConstructionSite, Good, GoodsSpot, Horse, HorseStats, Pile,
    Resident, Stat, Stock, Task, WorldState,
};
use csp_sim::carrying::{resolve_carrying, CarryAction, CarryKind};
use csp_sim::cities::update_city_membership;
use csp_sim::crimes::building_organization;
use csp_sim::invariants::{check_all, invariant_named};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::order_kinds;
use csp_sim::queries::building::teardown_work;
use csp_sim::queries::city::building_realm;
use csp_sim::queries::guard::outpost_storage_guarded;
use csp_sim::script_runner::{ScriptHost, ScriptRunner};
use csp_sim::script_tables::DEFAULT_SCRIPTS;
use csp_sim::scripts::RunnableScript;
use csp_sim::survival::{drop_goods, step_refill};
use csp_sim::teardown::{resolve_tearing_down, TearDownAction};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use ts_match::{assert_matches, json_of};

const SIZE: i32 = 160;

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

/// Realm r1 (Player 7) with city c1 at (40, 40) and a storage `home` in it; realm r2 (Player 8)
/// with Leader b1 at (0, 0). w1 of r1 stands far off at (10, 10).
fn setup() -> WorldState {
    let mut world = create_world(&terrain(), 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "b1"));
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0);
    let mut home = building("home", BuildingKind::Storage, 44.0, 40.0);
    home.city_id = Some("c1".into());
    home.stock = Some(Stock::new());
    world.buildings.push(home);
    resident(&mut world, "w1", "r1", 10.0, 10.0);
    resident(&mut world, "b1", "r2", 0.0, 0.0);
    world
}

fn resident(world: &mut WorldState, id: &str, owner: &str, x: f64, y: f64) -> usize {
    let mut r = new_resident(id, Some(owner), x, y);
    r.stats.strength = Stat { base: 10.0, trained: 0.0 };
    r.carried = food(OWN_FOOD);
    world.residents.push(r);
    world.residents.len() - 1
}

fn food(n: f64) -> Stock {
    [(Good::Food, n)].into_iter().collect()
}

/// An outpost storage of `realm_id` at (x, y).
fn outpost(world: &mut WorldState, x: f64, y: f64, realm_id: &str, id: &str) {
    let mut b = building(id, BuildingKind::Storage, x, y);
    b.realm_id = Some(realm_id.into());
    b.stock = Some(Stock::new());
    world.buildings.push(b);
}

fn b<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).expect("a building")
}
fn b_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Building {
    world.buildings.iter_mut().find(|b| b.id == id).expect("a building")
}
fn r<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("a resident")
}
fn held(world: &WorldState, id: &str, good: Good) -> f64 {
    b(world, id).stock.as_ref().and_then(|s| s.get(&good)).copied().unwrap_or(0.0)
}

#[track_caller]
fn assert_sound(world: &WorldState) {
    let broken: Vec<String> = check_all(world, &terrain())
        .into_iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert_eq!(broken, Vec::<String>::new());
}

fn found(name: &str, world: &WorldState) -> Vec<Vec<String>> {
    (invariant_named(name).expect("an invariant").check)(world, &terrain())
        .into_iter()
        .map(|v| v.entity_ids)
        .collect()
}

fn step(world: &mut WorldState) {
    step_world(world, &terrain(), &mut Scratch::default(), None, None);
}

mod an_outpost_storage {
    use super::*;

    #[test]
    fn finished_outside_any_city_belongs_to_the_builders_realm() {
        let mut world = setup();
        let mut q = Orders::default();
        let order = json!({ "kind": "build", "residentId": "w1", "building": "storage" });
        assert_eq!(q.receive(&world, &player(7), order, &terrain()), Ok(()));
        q.apply_all(&mut world, &terrain());
        step(&mut world);
        let site = world
            .buildings
            .iter()
            .find(|b| b.kind == BuildingKind::Storage && b.site.is_some())
            .expect("a site")
            .id
            .clone();
        assert_matches(b(&world, &site), json!({ "x": 10, "y": 10, "cityId": null }));
        // The site is the realm's whose resident laid it out (`CONTEXT.md`: Construction site).
        assert_eq!(b(&world, &site).realm_id.as_deref(), Some("r1"));
        // The last of the work finishes it.
        let materials: Stock =
            serde_json::from_value(json_of(&BUILD_MATERIALS.get("storage").expect("materials")))
                .expect("a stock");
        let work = BUILD_WORK.get("storage").unwrap_or(1.0) - 1.0;
        b_mut(&mut world, &site).site = Some(ConstructionSite { delivered: materials, work });
        step(&mut world);
        let built = b(&world, &site);
        assert!(built.site.is_none());
        assert_matches(built, json!({ "cityId": null, "realmId": "r1" }));
        assert_eq!(building_realm(&world, built), Some("r1"));
        assert_eq!(building_organization(&world, built).as_deref(), Some("r1"));
        // It founds no city.
        assert_eq!(world.cities.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["c1"]);
        assert_sound(&world);
    }

    struct WorkHost;
    impl ScriptHost for WorkHost {
        fn script(&self, _: u64) -> Option<RunnableScript> {
            let (_, name, source) =
                DEFAULT_SCRIPTS.iter().find(|(t, _, _)| *t == Task::Work).expect("Work");
            Some(RunnableScript {
                user_id: 7,
                name: name.to_string(),
                version: 1,
                source: source.to_string(),
                follows_default: true,
                task: None,
            })
        }
        fn sender(&self, user_id: u64) -> Option<OrderSender> {
            Some(OrderSender::player(user_id, "Mara"))
        }
        fn explored(&self, _: u64, _: i32, _: i32) -> bool {
            true
        }
    }

    #[test]
    fn is_the_nearest_storage_for_a_workplace_next_to_it_where_its_workers_carry_the_output() {
        let mut world = setup();
        let mut farm = building("farm", BuildingKind::Farm, 6.0, 6.0);
        farm.city_id = Some("c1".into());
        world.buildings.push(farm);
        outpost(&mut world, 11.0, 6.0, "r1", "out");
        // Another realm's outpost storage, nearer still, is not theirs to fill.
        outpost(&mut world, 6.0, 10.0, "r2", "theirs");
        world.residents.retain(|r| r.id == "b1");
        for id in ["w1", "w2"] {
            let i = resident(&mut world, id, "r1", 6.0, 6.0);
            let r = &mut world.residents[i];
            r.city_id = Some("c1".into());
            r.order = Some(
                serde_json::from_value(json!({
                    "kind": "workAt", "buildingId": "farm", "at": { "x": 6, "y": 6 }, "progress": 0
                }))
                .expect("a workAt order"),
            );
            r.script = Some(
                serde_json::from_value(
                    json!({ "scriptId": 1, "memory": { "workplaceId": "farm" } }),
                )
                .expect("a script"),
            );
        }
        world.piles.push(Pile { id: "p".into(), x: 6.0, y: 6.0, goods: food(100.0) });
        let map = Arc::new(terrain());
        let mut runner = ScriptRunner::new(map.clone(), Arc::new(WorkHost), order_kinds());
        let mut walking = Walking::new(map.clone());
        let mut scratch = Scratch::default();
        for _ in 0..600 {
            if held(&world, "out", Good::Food) > 0.0 {
                break;
            }
            for r in &mut world.residents {
                r.hunger = MAX_HUNGER;
            }
            let broken: Vec<String> = runner
                .run_all(&mut world, &mut scratch, true)
                .into_iter()
                .map(|v| v.message)
                .collect();
            assert_eq!(broken, Vec::<String>::new());
            step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
        }
        assert!(held(&world, "out", Good::Food) > 0.0);
        assert_eq!(json_of(&b(&world, "home").stock), json!({}));
        assert_eq!(json_of(&b(&world, "theirs").stock), json!({}));
        assert!(world.crimes.is_empty());
        assert_sound(&world);
    }

    #[test]
    fn is_a_stop_a_carriage_route_loads_and_unloads_at() {
        let mut world = setup();
        outpost(&mut world, 20.0, 10.0, "r1", "out");
        b_mut(&mut world, "out").stock = Some(food(30.0));
        r(&mut world, "w1").carried = food(2.0);
        world.horses.push(Horse {
            id: "h1".into(),
            realm_id: Some("r1".into()),
            city_id: None,
            x: 10.0,
            y: 10.0,
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
            x: 10.0,
            y: 10.0,
            horse_id: None,
            load: Stock::new(),
        });
        drop_goods(&mut world, 10.0, 10.0, &[(Good::IronOre, 20.0)].into_iter().collect(), SIZE);
        let mut q = Orders::default();
        let haul = json!({
            "kind": "haul", "residentId": "w1", "carriageId": "k1", "x": 20, "y": 10,
            "goods": ["ironOre"], "returnGoods": ["food"], "keepFood": 0
        });
        assert_eq!(q.receive(&world, &player(7), haul, &terrain()), Ok(()));
        q.apply_all(&mut world, &terrain());
        let map = Arc::new(terrain());
        let mut walking = Walking::new(map.clone());
        let mut scratch = Scratch::default();
        let back = |w: &WorldState| {
            w.piles.iter().any(|p| {
                p.x == 10.0 && p.y == 10.0 && p.goods.get(&Good::Food).is_some_and(|n| *n > 0.0)
            })
        };
        for _ in 0..2000 {
            if back(&world) {
                break;
            }
            r(&mut world, "w1").hunger = MAX_HUNGER;
            step_world(&mut world, &map, &mut scratch, Some(&mut walking), None);
            assert_sound(&world);
        }
        // The ore went into it, and its Food came back to the first stop.
        assert_eq!(held(&world, "out", Good::IronOre), 20.0);
        assert!(back(&world));
        assert!(held(&world, "out", Good::Food) < 30.0);
        assert!(world.crimes.is_empty());
    }

    #[test]
    fn is_taken_in_by_a_city_that_grows_over_it_and_stays_its_realms_when_cut_off_again() {
        let mut world = setup();
        // Out of reach of the city's town hall, whose footprint runs to (42, 42).
        outpost(&mut world, 44.0 + 2.0 * CITY_BUILDING_REACH, 46.0, "r1", "out");
        update_city_membership(&mut world, SIZE);
        assert_matches(b(&world, "out"), json!({ "cityId": null, "realmId": "r1" }));

        // A house between them chains it into the city.
        world.buildings.push(building(
            "house",
            BuildingKind::House,
            43.0 + CITY_BUILDING_REACH,
            46.0,
        ));
        update_city_membership(&mut world, SIZE);
        assert_eq!(b(&world, "house").city_id.as_deref(), Some("c1"));
        assert_eq!(b(&world, "out").city_id.as_deref(), Some("c1"));
        assert_eq!(b(&world, "out").realm_id, None);
        assert_sound(&world);

        world.buildings.retain(|b| b.id != "house");
        update_city_membership(&mut world, SIZE);
        assert_matches(b(&world, "out"), json!({ "cityId": null, "realmId": "r1" }));
        assert_sound(&world);
    }

    #[test]
    fn stays_its_realms_when_another_realms_city_takes_it_in_and_lets_it_go() {
        let mut world = setup();
        add_city(&mut world, "c2", Some("r2"), 10.0, 40.0);
        outpost(&mut world, 14.0, 40.0, "r1", "out");
        update_city_membership(&mut world, SIZE);
        // Inside c2 it is c2's storage, so r2's.
        assert_eq!(b(&world, "out").city_id.as_deref(), Some("c2"));
        assert_eq!(building_realm(&world, b(&world, "out")), Some("r2"));
        // Cut off from c2, it is the realm's of the city it last belonged to.
        b_mut(&mut world, "out").y = 60.0;
        update_city_membership(&mut world, SIZE);
        assert_matches(b(&world, "out"), json!({ "cityId": null, "realmId": "r2" }));
    }

    #[test]
    fn is_what_a_citys_storages_become_when_its_town_hall_is_torn_down() {
        let mut world = setup();
        let hall = b(&world, "c1-hall").clone();
        let w1 = r(&mut world, "w1");
        (w1.x, w1.y) = (hall.x, hall.y);
        w1.order = Some(
            serde_json::from_value(json!({
                "kind": "tearDown", "buildingId": hall.id, "at": { "x": hall.x, "y": hall.y }
            }))
            .expect("a tearDown order"),
        );
        b_mut(&mut world, "c1-hall").teardown = Some(teardown_work(&hall));
        step(&mut world);
        assert!(world.cities.is_empty());
        assert_matches(b(&world, "home"), json!({ "cityId": null, "realmId": "r1" }));
        assert_sound(&world);
    }

    #[test]
    fn breaks_the_invariants_with_a_realm_it_cant_have() {
        let mut world = setup();
        b_mut(&mut world, "home").realm_id = Some("r1".into());
        outpost(&mut world, 10.0, 20.0, "r9", "gone");
        assert_eq!(found("outpost-storage-realms", &world), [["home"], ["gone"]]);
    }
}

mod an_outpost_storages_stock {
    use super::*;

    /// r2's b1 on r1's outpost storage at (60, 60) holding 9 Food, asking for 3 (`atOutpost`).
    fn at_outpost() -> WorldState {
        let mut world = setup();
        outpost(&mut world, 60.0, 60.0, "r1", "out");
        b_mut(&mut world, "out").stock = Some(food(9.0));
        let b1 = r(&mut world, "b1");
        (b1.x, b1.y) = (60.0, 60.0);
        world
    }

    fn take(resident: &str, units: f64) -> CarryAction {
        CarryAction {
            kind: CarryKind::Take,
            resident_id: resident.into(),
            spot: GoodsSpot::Storage { storage_id: "out".into() },
            goods: food(units),
        }
    }

    fn stock_of(world: &WorldState) -> Value {
        json_of(&b(world, "out").stock)
    }

    #[test]
    fn cant_be_taken_by_another_realm_while_an_armed_resident_of_its_realm_guards_it() {
        let mut world = at_outpost();
        let g = resident(&mut world, "g1", "r1", 61.0, 60.0);
        world.residents[g].carried.insert(Good::Spear, 1.0);
        resolve_carrying(&mut world, &[take("b1", 3.0)], SIZE);
        assert_eq!(stock_of(&world), json!({ "food": 9.0 }));
        assert_eq!(r(&mut world, "b1").carried.get(&Good::Food), Some(&OWN_FOOD));
        assert!(world.crimes.is_empty());
    }

    #[test]
    fn is_guarded_only_by_armed_residents_and_not_while_someone_elses_armed_one_is_there() {
        let mut world = at_outpost();
        let g = resident(&mut world, "g1", "r1", 61.0, 60.0);
        let guarded = |w: &WorldState| outpost_storage_guarded(w, b(w, "out"), SIZE);
        assert!(!guarded(&world));
        world.residents[g].carried.insert(Good::Spear, 1.0);
        assert!(guarded(&world));
        r(&mut world, "b1").carried.insert(Good::Sword, 1.0);
        assert!(!guarded(&world));
        resolve_carrying(&mut world, &[take("b1", 3.0)], SIZE);
        assert_eq!(stock_of(&world), json!({ "food": 6.0 }));
    }

    #[test]
    fn can_be_taken_from_unguarded_and_a_witness_makes_it_a_known_theft() {
        let mut world = at_outpost();
        // An unarmed resident of r1 nearby sees it but doesn't guard it.
        resident(&mut world, "w2", "r1", 62.0, 60.0);
        resolve_carrying(&mut world, &[take("b1", 3.0)], SIZE);
        assert_eq!(stock_of(&world), json!({ "food": 6.0 }));
        assert_eq!(r(&mut world, "b1").carried.get(&Good::Food), Some(&(OWN_FOOD + 3.0)));
        assert_eq!(world.crimes.len(), 1);
        assert_matches(
            &world.crimes[0],
            json!({ "kind": "theft", "victimOrg": "r1", "goods": { "food": 3 }, "witnesses": ["w2"] }),
        );
        // The witness brings the news home: the theft is known to r1.
        let w2 = r(&mut world, "w2");
        (w2.x, w2.y) = (40.0, 40.0);
        step(&mut world);
        assert!(world.crimes[0].known_by.contains(&"r1".to_string()));
    }

    #[test]
    fn stays_its_own_realms_to_take_from_while_guarded() {
        let mut world = at_outpost();
        let g = resident(&mut world, "g1", "r1", 61.0, 60.0);
        world.residents[g].carried.insert(Good::Spear, 1.0);
        resident(&mut world, "w2", "r1", 60.0, 60.0);
        resolve_carrying(&mut world, &[take("w2", 2.0)], SIZE);
        assert_eq!(stock_of(&world), json!({ "food": 7.0 }));
        assert!(world.crimes.is_empty());
    }

    #[test]
    fn torn_down_by_another_realm_is_a_crime_against_its_realm() {
        let mut world = at_outpost();
        let work = teardown_work(b(&world, "out"));
        b_mut(&mut world, "out").teardown = Some(work);
        r(&mut world, "b1").order = Some(
            serde_json::from_value(json!({
                "kind": "tearDown", "buildingId": "out", "at": { "x": 60, "y": 60 }
            }))
            .expect("a tearDown order"),
        );
        let map = terrain();
        let acts = [TearDownAction { resident_id: "b1".into() }];
        resolve_tearing_down(&mut world, &acts, Some(&map), &mut Scratch::default());
        assert!(world.buildings.iter().all(|b| b.id != "out"));
        assert_matches(
            &world.crimes[0],
            json!({ "kind": "tearDown", "building": "storage", "victimOrg": "r1" }),
        );
    }
}

mod refilling_at_an_outpost_storage {
    use super::*;

    #[test]
    fn keeps_a_miner_next_to_a_stocked_one_fed_far_from_home() {
        let mut world = setup();
        world.residents.retain(|r| r.id == "w1");
        world.realms.retain(|r| r.id == "r1");
        outpost(&mut world, 100.0, 100.0, "r1", "out");
        b_mut(&mut world, "out").stock = Some(food(50.0));
        let w1 = r(&mut world, "w1");
        (w1.x, w1.y) = (99.0, 100.0);
        // Own food alone lasts far less than this.
        let map = terrain();
        let mut scratch = Scratch::default();
        for _ in 0..20 * TICKS_PER_GAME_DAY as usize {
            step_world(&mut world, &map, &mut scratch, None, None);
            assert_eq!(found("refilled-when-low", &world), Vec::<Vec<String>>::new());
        }
        assert_eq!(world.residents.len(), 1);
        assert_eq!(world.residents[0].health, MAX_HEALTH);
        assert!(held(&world, "out", Good::Food) < 50.0 - 20.0 * FOOD_PER_DAY + 1.0);
        assert_eq!(json_of(&b(&world, "home").stock), json!({}));
        assert_sound(&world);
    }

    #[test]
    fn feeds_only_residents_of_its_realm_within_reach() {
        let mut world = setup();
        world.residents.clear();
        outpost(&mut world, 100.0, 100.0, "r1", "out");
        b_mut(&mut world, "out").stock = Some(food(50.0));
        for (id, owner, x) in [
            ("near", "r1", 100.0 - OUTPOST_REFILL_REACH),
            ("far", "r1", 100.0 - OUTPOST_REFILL_REACH - 1.0),
            ("stranger", "r2", 99.0),
        ] {
            let i = resident(&mut world, id, owner, x, 100.0);
            world.residents[i].carried.clear();
        }
        assert_eq!(found("refilled-when-low", &world), [["near"]]);
        step_refill(&mut world, SIZE);
        let near = r(&mut world, "near").carried.get(&Good::Food).copied().unwrap_or(0.0);
        assert!(near >= HOME_FOOD_LOW);
        assert!(r(&mut world, "far").carried.is_empty());
        assert!(r(&mut world, "stranger").carried.is_empty());
        assert_eq!(held(&world, "out", Good::Food), 50.0 - near);
        assert_eq!(found("refilled-when-low", &world), Vec::<Vec<String>>::new());
    }
}
