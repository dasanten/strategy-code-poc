//! Siege machines (`CONTEXT.md`: Siege machine, ADR 0037, T110.1): a ram is laid out anywhere a
//! carriage could stand and built from carried goods; finished, it stands as a machine of the
//! finisher's realm. Its crew walk onto it; with its crew size there one of them pushes it, slowly,
//! the crew going along. Blows break it, leaving part of its materials; its realm tears it down.

// Epic 127: this file still has `_ =>` arms over enums; its tickets name each variant or say
// why the wildcard is right, then remove this line.
#![allow(clippy::wildcard_enum_match_arm)]

use csp_shared::balance::{
    BROKEN_MATERIALS_RETURNED, BUILD_MATERIALS, BUILD_WORK, LIFESPAN_MAX, OWN_FOOD, RAM_CREW,
    RAM_STRENGTH, SIEGE_PUSH_SHARE, TEARDOWN_MATERIALS_RETURNED,
};
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    BuildingKind, ConstructionSite, Good, ResidentOrder, SiegeMachine, SiegeMachineKind, Stock,
    WorldState,
};
use serde_json::json;

use super::*;
use crate::game_test_world::{player, run_script, Game};
use crate::invariants::check_all;
use crate::movement_test_world::{building, draw, realm, resident, world_with_realm};
use crate::queries::building::{build_materials, build_problem, construction_at, BUILDABLE};
use crate::sight::entities_in_sight;
use crate::world_index::WorldIndex;

/// Plains 24 tiles wide, a Lake on the east edge (x 22..) and a Forest strip at x 16..=17.
fn map() -> TerrainMap {
    let rows: Vec<String> = (0..24)
        .map(|_| {
            (0..24)
                .map(|x| match x {
                    22.. => '~',
                    16 | 17 => 'f',
                    _ => '.',
                })
                .collect()
        })
        .collect();
    let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
    draw(&rows)
}

const CREW: [&str; 4] = ["w1", "c2", "c3", "c4"];

/// Realm r1 (Player 7) with grown residents w1, c2, c3, c4 at (4, 4), and realm r2 (Player 8)
/// with e1 at (12, 4); everyone carries their own Food.
fn world() -> WorldState {
    let mut world = world_with_realm(&map());
    world.realms.push(realm("r2", 8, "e1"));
    for id in CREW {
        world.residents.push(resident(id, Some("r1"), 4.0, 4.0));
    }
    world.residents.push(resident("e1", Some("r2"), 12.0, 4.0));
    for r in &mut world.residents {
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        r.lifespan = LIFESPAN_MAX;
    }
    world
}

fn ram(id: &str, realm: Option<&str>, x: f64, y: f64) -> SiegeMachine {
    SiegeMachine {
        id: id.into(),
        kind: SiegeMachineKind::Ram,
        realm_id: realm.map(str::to_string),
        x,
        y,
        damage: None,
        teardown: None,
        crew_ids: Vec::new(),
    }
}

/// The world with r1's ram m1 at (4, 4) under its whole crew.
fn crewed() -> Game {
    let mut world = world();
    let mut m = ram("m1", Some("r1"), 4.0, 4.0);
    m.crew_ids = CREW.iter().map(|s| s.to_string()).collect();
    world.siege_machines.push(m);
    Game::new(world, map())
}

fn m1(game: &Game) -> &SiegeMachine {
    game.world.siege_machines.iter().find(|m| m.id == "m1").expect("ram m1")
}

fn push(game: &mut Game, by: &str, x: i32, y: i32) -> String {
    game.order(7, json!({"kind": "push", "residentId": by, "machineId": "m1", "x": x, "y": y}))
}

/// Ticks until `id`'s order is done, at most `max`; the ticks taken.
fn until_done(game: &mut Game, id: &str, max: usize) -> usize {
    for t in 0..max {
        if game.r(id).order.is_none() {
            return t;
        }
        game.tick();
    }
    panic!("{id}'s order is still not done after {max} ticks");
}

mod building_one {
    use super::*;

    #[test]
    fn is_a_buildable_site_of_wood_and_some_iron() {
        assert!(BUILDABLE.contains(&BuildingKind::Ram));
        let materials = BUILD_MATERIALS.get("ram").unwrap();
        assert!(materials.get("wood").unwrap() > materials.get("iron").unwrap());
        assert!(materials.get("iron").unwrap() > 0.0);
        assert!(BUILD_WORK.get("ram").unwrap() > 0.0);
    }

    #[test]
    fn goes_anywhere_a_carriage_could_stand_off_nodes_and_buildings() {
        let mut world = world();
        let map = map();
        let problem = |w: &WorldState, x, y| build_problem(w, x, y, BuildingKind::Ram, Some(&map));
        assert_eq!(problem(&world, 4, 4), None);
        assert_eq!(problem(&world, 16, 4), None, "in Forest too");
        assert_eq!(
            problem(&world, 22, 4).as_deref(),
            Some("a ram is built where a carriage could stand")
        );
        world.nodes.push(
            serde_json::from_value(json!({"id": "n1", "kind": "forest", "x": 6, "y": 6}))
                .expect("a node"),
        );
        assert_eq!(problem(&world, 6, 6).as_deref(), Some("a ram goes off any resource node"));
        world.buildings.push(building("s1", BuildingKind::Storage, 8.0, 8.0));
        assert_eq!(problem(&world, 9, 9).as_deref(), Some("there is already a building there"));
        let mut s = building("rs", BuildingKind::Ram, 2.0, 2.0);
        s.site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
        world.buildings.push(s);
        assert_eq!(
            problem(&world, 2, 2).as_deref(),
            Some("there is already a siege machine site on this tile")
        );
    }

    /// A ram site is laid out by a build order and built from the goods carried there: put in by
    /// hand, then worked until it is finished, it is gone and a ram of the finisher's realm stands
    /// where it was.
    #[test]
    fn is_laid_out_built_from_carried_goods_and_becomes_a_ram_of_the_finishers_realm() {
        let mut world = world();
        let materials = build_materials(BuildingKind::Ram);
        // The crew share the load: a quarter of the Wood each, and w1 the Iron too.
        let wood = materials[&Good::Wood] / CREW.len() as f64;
        for r in world.residents.iter_mut().filter(|r| CREW.contains(&r.id.as_str())) {
            r.carried.insert(Good::Wood, wood);
        }
        world.residents[0].carried.insert(Good::Iron, materials[&Good::Iron]);
        let mut game = Game::new(world, map());
        let build = json!({"kind": "build", "residentId": "w1", "building": "ram"});
        assert_eq!(game.order(7, build.clone()), "ack");
        game.tick();
        let site = construction_at(&game.world, 4, 4, BuildingKind::Ram).expect("a ram site");
        assert!(site.site.is_some() && site.city_id.is_none());
        let site_id = site.id.clone();
        for id in CREW {
            let carried = game.r(id).carried.clone();
            let goods: serde_json::Map<String, serde_json::Value> = carried
                .iter()
                .filter(|(g, _)| **g != Good::Food)
                .map(|(g, u)| (crate::queries::names::good_name(*g).to_string(), json!(u)))
                .collect();
            let drop = json!({"kind": "drop", "residentId": id,
                "spot": {"kind": "site", "siteId": site_id}, "goods": goods});
            assert_eq!(game.order(7, drop), "ack");
        }
        game.tick();
        let site = construction_at(&game.world, 4, 4, BuildingKind::Ram).expect("a ram site");
        assert_eq!(site.site.as_ref().map(|s| s.delivered.clone()), Some(materials.clone()));
        // The whole crew works it, so it finishes in a quarter of the time.
        for id in CREW {
            let b = json!({"kind": "build", "residentId": id, "building": "ram"});
            assert_eq!(game.order(7, b), "ack");
        }
        let work = BUILD_WORK.get("ram").unwrap() as usize;
        for _ in 0..work {
            if !game.world.siege_machines.is_empty() {
                break;
            }
            game.tick();
        }
        assert!(construction_at(&game.world, 4, 4, BuildingKind::Ram).is_none());
        let m = &game.world.siege_machines[0];
        assert_eq!(
            (m.kind, m.realm_id.as_deref(), m.x, m.y),
            (SiegeMachineKind::Ram, Some("r1"), 4.0, 4.0)
        );
        assert!(m.crew_ids.is_empty() && m.damage.is_none());
        assert!(game.world.residents.iter().all(|r| r.order.is_none()));
    }
}

mod crew_and_push {
    use super::*;

    #[test]
    fn residents_of_its_realm_walk_onto_it_and_join_its_crew() {
        let mut world = world();
        world.siege_machines.push(ram("m1", Some("r1"), 8.0, 4.0));
        let mut game = Game::new(world, map());
        let crew = |id: &str| json!({"kind": "crew", "residentId": id, "machineId": "m1"});
        assert_eq!(game.order(8, crew("e1")), "not a ram of your realm");
        assert_eq!(game.order(7, crew("w1")), "ack");
        assert!(
            matches!(&game.r("w1").order, Some(ResidentOrder::Crew(o)) if o.machine_id == "m1")
        );
        until_done(&mut game, "w1", 200);
        assert_eq!((game.r("w1").x, game.r("w1").y), (8.0, 4.0));
        assert_eq!(m1(&game).crew_ids, ["w1"]);
        assert_eq!(game.order(7, crew("w1")), "already one of the ram’s crew");
    }

    #[test]
    fn another_realm_crews_it_not() {
        let mut world = world();
        world.siege_machines.push(ram("m1", Some("r2"), 8.0, 4.0));
        let mut game = Game::new(world, map());
        let crew = json!({"kind": "crew", "residentId": "w1", "machineId": "m1"});
        assert_eq!(game.order(7, crew), "not a ram of your realm");
    }

    #[test]
    fn under_crewed_it_wont_move() {
        let mut game = crewed();
        game.world.siege_machines[0].crew_ids.truncate(RAM_CREW as usize - 1);
        assert_eq!(push(&mut game, "w1", 10, 4), "the ram needs 1 more crew to be pushed");
        // Not one of its crew.
        game.world.siege_machines[0].crew_ids = CREW.iter().map(|s| s.to_string()).collect();
        game.world.siege_machines[0].crew_ids.retain(|c| c != "c4");
        assert_eq!(push(&mut game, "c4", 10, 4), "only one of its crew on its tile pushes a ram");
        game.run(20);
        assert_eq!((m1(&game).x, m1(&game).y), (4.0, 4.0));
    }

    /// Crewed, it is pushed at its pace, `SIEGE_PUSH_SHARE` of a carriage's: half of walking on
    /// Plains; its crew go along on its tile.
    #[test]
    fn crewed_it_moves_at_its_speed_and_its_crew_with_it() {
        let mut game = crewed();
        assert_eq!(push(&mut game, "w1", 10, 4), "ack");
        assert!(
            matches!(&game.r("w1").order, Some(ResidentOrder::Push(o)) if o.machine_id == "m1")
        );
        let ticks = until_done(&mut game, "w1", 2000);
        assert_eq!((m1(&game).x, m1(&game).y), (10.0, 4.0));
        for id in CREW {
            assert_eq!((game.r(id).x, game.r(id).y), (10.0, 4.0), "{id} went along");
        }
        assert_eq!(m1(&game).crew_ids.len(), 4);
        // Six Plains tiles at a quarter of a carriage's pace there, which is twice walking.
        let per_tile = 1.0 / push_speed(Terrain::Plains as u8);
        let want = 6.0 * per_tile;
        assert!((ticks as f64 - want).abs() <= 2.0, "{ticks} ticks, about {want} wanted");
        assert!(
            (per_tile - csp_shared::balance::WALK_TICKS_PER_TILE / (2.0 * SIEGE_PUSH_SHARE)).abs()
                < 1e-9
        );
    }

    #[test]
    fn it_goes_where_a_carriage_could_and_slower_in_forest() {
        assert!(push_speed(Terrain::Forest as u8) < push_speed(Terrain::Plains as u8));
        assert_eq!(push_speed(Terrain::Mountain as u8), 0.0);
        let mut game = crewed();
        assert_eq!(push(&mut game, "w1", 22, 4), "a ram can’t be pushed there");
    }

    #[test]
    fn a_crew_member_who_walks_off_leaves_the_crew_and_it_stops() {
        let mut game = crewed();
        assert_eq!(push(&mut game, "w1", 12, 4), "ack");
        game.run(20);
        let at = m1(&game).x;
        let walk = json!({"kind": "walkTo", "residentId": "c4", "x": 4, "y": 10});
        assert_eq!(game.order(7, walk), "ack");
        game.run(30);
        assert!(!m1(&game).crew_ids.contains(&"c4".to_string()));
        assert!(game.r("w1").order.is_none(), "the push ends below its crew size");
        let stopped = m1(&game).x;
        assert!(stopped >= at && stopped < 12.0);
        game.run(30);
        assert_eq!(m1(&game).x, stopped);
    }

    #[test]
    fn scripts_crew_and_push_it_as_the_orders_do() {
        let mut world = world();
        let mut m = ram("m1", Some("r1"), 4.0, 4.0);
        m.crew_ids = vec!["w1".into()];
        world.siege_machines.push(m);
        let map = map();
        let (answer, requests) =
            run_script(&world, &map, &player(7), "c2", "memory.answer = crew(machines()[0])");
        assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].kind, "crew");
        assert_eq!(requests[0].fields.get("machineId"), Some(&json!("m1")));
        // Under-crewed, the push is refused with its reason.
        let (answer, requests) =
            run_script(&world, &map, &player(7), "w1", "memory.answer = push(\"m1\", 8, 4)");
        assert_eq!(answer, Some(json!("the ram needs 3 more crew to be pushed")));
        assert!(requests.is_empty());
        world.siege_machines[0].crew_ids = CREW.iter().map(|s| s.to_string()).collect();
        let (_, requests) = run_script(&world, &map, &player(7), "w1", "push(\"m1\", 8, 4)");
        assert_eq!(requests.len(), 1);
        assert_eq!(
            (requests[0].kind.as_str(), requests[0].fields.get("x")),
            ("push", Some(&json!(8)))
        );
        // It sees the ram as a machine, its kind and crew.
        let (answer, _) = run_script(
            &world,
            &map,
            &player(7),
            "w1",
            "memory.answer = [machines()[0].kind, machines()[0].realmId, machines()[0].crewIds]",
        );
        assert_eq!(answer, Some(json!(["ram", "r1", ["w1", "c2", "c3", "c4"]])));
    }
}

mod breaking_and_tearing_down {
    use super::*;

    /// Attacked, it takes every blow like a wall; at `RAM_STRENGTH` it breaks, leaving
    /// `BROKEN_MATERIALS_RETURNED` of its materials on its tile, and its crew is no crew.
    #[test]
    fn attacked_it_breaks_and_leaves_part_of_its_materials() {
        let mut game = crewed();
        game.world.siege_machines[0].damage = Some(RAM_STRENGTH - 1.0);
        game.r_mut("e1").x = 5.0;
        let attack = json!({"kind": "attack", "residentId": "e1", "targetId": "m1"});
        assert_eq!(game.order(8, attack), "ack");
        for _ in 0..40 {
            if game.world.siege_machines.is_empty() {
                break;
            }
            game.tick();
        }
        assert!(game.world.siege_machines.is_empty(), "the ram broke");
        let pile = game.world.piles.iter().find(|p| (p.x, p.y) == (4.0, 4.0)).expect("a pile");
        let wood =
            (build_materials(BuildingKind::Ram)[&Good::Wood] * BROKEN_MATERIALS_RETURNED).floor();
        assert_eq!(pile.goods.get(&Good::Wood), Some(&wood));
        assert!(game.r("e1").order.is_none());
    }

    #[test]
    fn its_own_realm_may_not_attack_it() {
        let mut game = crewed();
        let attack = json!({"kind": "attack", "residentId": "w1", "targetId": "m1"});
        assert_eq!(game.order(7, attack), "that is one of your own siege machines");
    }

    #[test]
    fn its_realm_tears_it_down_and_nobody_else() {
        let mut game = crewed();
        game.r_mut("e1").x = 4.0;
        let tear = |id: &str| json!({"kind": "tearDown", "residentId": id, "buildingId": "m1"});
        assert_eq!(game.order(8, tear("e1")), "only its own realm tears down a ram");
        assert_eq!(game.order(7, tear("w1")), "ack");
        let work = machine_teardown_work(SiegeMachineKind::Ram) as usize;
        for _ in 0..work + 5 {
            if game.world.siege_machines.is_empty() {
                break;
            }
            game.tick();
        }
        assert!(game.world.siege_machines.is_empty(), "torn down");
        let pile = game.world.piles.iter().find(|p| (p.x, p.y) == (4.0, 4.0)).expect("a pile");
        let iron =
            (build_materials(BuildingKind::Ram)[&Good::Iron] * TEARDOWN_MATERIALS_RETURNED).floor();
        assert_eq!(pile.goods.get(&Good::Iron).copied().unwrap_or(0.0), iron);
    }

    #[test]
    fn a_ram_of_a_realm_that_ends_belongs_to_nobody_and_has_no_crew() {
        let mut game = crewed();
        crate::survival::end_realm(&mut game.world, "r1", 24);
        assert_eq!(m1(&game).realm_id, None);
        assert!(m1(&game).crew_ids.is_empty());
    }
}

mod seen {
    use super::*;

    #[test]
    fn anyone_with_its_tile_in_sight_sees_its_kind_owner_and_crew_and_last_seen_keeps_it_not() {
        let mut game = crewed();
        let index = WorldIndex::new(&game.world, 24);
        let seen = entities_in_sight(&game.world, &index, Some("r2"), None);
        let m = seen
            .iter()
            .find_map(|e| match e {
                SeenEntity::Machine(m) => Some(m.clone()),
                _ => None,
            })
            .expect("r2 sees the ram");
        assert_eq!(
            (m.kind, m.realm_id.as_deref(), m.crew_ids.len()),
            (SiegeMachineKind::Ram, Some("r1"), 4)
        );
        game.run(2);
        assert!(game
            .world
            .last_seen
            .values()
            .flatten()
            .all(|r| { !serde_json::to_string(r).unwrap_or_default().contains("\"m1\"") }));
    }
}

mod sent {
    use super::*;
    use crate::sight::{sent_inside_unseen, sent_out_of_sight};

    /// The invariants on what goes out to a Player hold with a ram in sight, and a whole tick with
    /// one in the world runs (the sight invariant once had no spot for a machine).
    #[test]
    fn what_is_sent_of_a_ram_breaks_no_sight_invariant() {
        let mut game = crewed();
        let index = WorldIndex::new(&game.world, 24);
        for realm in ["r1", "r2"] {
            let sent = entities_in_sight(&game.world, &index, Some(realm), None);
            assert!(sent.iter().any(|e| e.is() == "machine"), "{realm}");
            assert!(sent_out_of_sight(&game.world, &index, realm, &sent).is_empty(), "{realm}");
            assert!(sent_inside_unseen(&game.world, &index, realm, &sent).is_empty(), "{realm}");
        }
        game.run(3);
    }
}

mod invariants {
    use super::*;

    fn broken(world: &WorldState) -> Vec<String> {
        check_all(world, &map()).into_iter().map(|v| v.message).collect()
    }

    #[test]
    fn a_crew_member_is_with_their_machine() {
        let mut game = crewed();
        assert!(broken(&game.world).is_empty(), "{:?}", broken(&game.world));
        game.r_mut("c4").x = 6.0;
        assert_eq!(broken(&game.world), ["c4 of siege machine m1’s crew is not with it at (4, 4)"]);
    }

    #[test]
    fn a_machine_moves_only_with_its_crew() {
        let mut game = crewed();
        game.world.siege_machines[0].crew_ids.pop();
        game.r_mut("w1").order = Some(ResidentOrder::Push(csp_shared::world::PushOrder {
            machine_id: "m1".into(),
            target: csp_shared::world::Tile { x: 8.0, y: 4.0 },
            path: None,
            progress: 0.0,
        }));
        assert_eq!(
            broken(&game.world),
            ["resident w1 pushes siege machine m1, but the ram needs 1 more crew to be pushed"]
        );
    }

    #[test]
    fn a_ram_site_stands_off_buildings() {
        let mut world = world();
        world.buildings.push(building("s1", BuildingKind::Storage, 8.0, 8.0));
        let mut s = building("rs", BuildingKind::Ram, 9.0, 9.0);
        s.site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
        world.buildings.push(s);
        assert_eq!(broken(&world), ["rs is a ram site on a storage"]);
    }

    #[test]
    fn a_machine_stands_where_a_carriage_could() {
        let mut world = world();
        world.siege_machines.push(ram("m1", Some("r1"), 22.0, 4.0));
        assert_eq!(broken(&world), ["siege machine m1 stands where no carriage can go at (22, 4)"]);
    }
}
