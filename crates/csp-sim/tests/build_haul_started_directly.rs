//! `apps/server/src/build-haul-started-directly.test.ts`, ported (T86.17): Build and Haul started
//! directly (`CONTEXT.md`: Default script, Started directly; ADR 0014). Build's site is the param
//! `site`; unset, the construction site on the resident's tile when it starts, which they join.
//! Haul's carriage is the param `carriage`, but its route comes only from the Haul order: started
//! without one it ends. Neither target is kept between starts.

mod build_common;
mod p_scripts_host;

use build_common::*;
use csp_shared::balance::{AVERAGE_HORSE_STATS, MAX_HEALTH, MAX_HUNGER, OWN_FOOD};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, Carriage, ConstructionSite, Horse, HorseStats, RealmEventWhat,
    Resident, ResidentOrder, Task, WorldState,
};
use csp_sim::building::finish_site;
use csp_sim::default_scripts::TASKS;
use csp_sim::invariants::world_invariants;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{OrderQueue, OrderReply};
use csp_sim::queries::building::{build_materials, build_work_of};
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::script_api::ScriptParam;
use csp_sim::script_params::start_params_problem;
use csp_sim::script_runner::defaults_have_a_target;
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use p_scripts_host::{default_scripts, DefaultScripts};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const SIZE: i32 = 32;

fn me() -> OrderSender {
    player(7)
}

/// Player 7's version of a task's default (`defaultScripts`).
fn script_of(task: Task) -> u64 {
    7 * 100 + TASKS.iter().position(|t| *t == task).unwrap() as u64 + 1
}

struct Host;
impl QueueHost for Host {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 7).then(me)
    }
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    orders: OrderQueue,
    queues: QueueRunner,
    scripts: DefaultScripts,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with city c1 and its storage s1 at (12, 6): resident w1 standing on house
/// site hs (6, 6), whose footprint runs to (7, 7); farm site fs of c1 at (14, 12); resident w2 on
/// an empty tile (20, 20) with carriage k1 and horse h1 of the realm.
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "w1"));
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0);
    let mut hs = site("hs", BuildingKind::House, 6.0, 6.0);
    hs.city_id = None;
    let mut fs = site("fs", BuildingKind::Farm, 14.0, 12.0);
    fs.city_id = Some("c1".into());
    let mut s1 = building("s1", BuildingKind::Storage, 12.0, 6.0);
    s1.city_id = Some("c1".into());
    s1.stock = Some(serde_json::from_value(json!({ "food": 50 })).unwrap());
    world.buildings.extend([hs, fs, s1]);
    for (id, x, y) in [("w1", 7.0, 7.0), ("w2", 20.0, 20.0)] {
        let mut r = new_resident(id, Some("r1"), x, y);
        r.city_id = Some("c1".into());
        r.carried = serde_json::from_value(json!({ "food": OWN_FOOD })).unwrap();
        world.residents.push(r);
    }
    world.horses.push(Horse {
        id: "h1".into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 20.0,
        y: 20.0,
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
        x: 20.0,
        y: 20.0,
        horse_id: None,
        load: Default::default(),
    });
    let scripts = default_scripts(&terrain, vec![me()], Arc::new(Mutex::new(HashMap::new())));
    let arc = Arc::new(terrain.clone());
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(arc.clone()));
    let queues = QueueRunner::new(Box::new(Host), scripts.kinds.clone(), Some(arc.clone()));
    Setup {
        world,
        terrain,
        orders,
        queues,
        scripts,
        walking: Walking::new(arc),
        scratch: Scratch::default(),
    }
}

impl Setup {
    /// One tick as the game runs it: orders, queues, scripts (with invariants), the world steps.
    fn tick(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = 100.0;
        }
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        assert_eq!(self.scripts.run_all(&mut self.world, &mut self.scratch), vec![]);
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
    }

    fn give(&mut self, order: Value, resident_id: &str) {
        let mut o = json!({ "residentId": resident_id });
        o.as_object_mut().unwrap().extend(order.as_object().unwrap().clone());
        let answer = self.orders.receive(&self.world, &me(), &json!("q"), &o);
        assert!(matches!(answer, OrderReply::Ack { .. }), "{answer:?}");
    }

    fn stopped(&self) -> Vec<String> {
        self.world
            .events
            .iter()
            .filter_map(|e| match &e.what {
                RealmEventWhat::ScriptStopped { reason, .. } => Some(reason.clone()),
                _ => None,
            })
            .collect()
    }

    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }

    /// The site a resident is building.
    fn building(&self, id: &str) -> Option<String> {
        match &self.r(id).order {
            Some(ResidentOrder::Build(b)) => b.site_id.clone(),
            _ => None,
        }
    }

    fn param(&self, id: &str, script: u64) -> Option<Value> {
        self.r(id)
            .script_params
            .as_ref()
            .and_then(|p| p.get(&script))
            .map(|v| serde_json::to_value(v).unwrap())
    }

    /// Ticks until `done` or `max`.
    fn until(&mut self, max: usize, done: impl Fn(&Setup) -> bool) {
        for _ in 0..max {
            if done(self) {
                break;
            }
            self.tick();
        }
    }
}

fn find<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).unwrap()
}

fn as_building() -> Vec<ScriptParam> {
    vec![serde_json::from_value(
        json!({ "name": "target", "type": "building", "line": 1, "column": 1 }),
    )
    .unwrap()]
}

mod build {
    use super::*;

    #[test]
    fn joins_the_site_the_resident_stands_on_with_run_script_on_an_empty_tile_it_ends() {
        let mut s = setup();
        let build = script_of(Task::Build);
        s.give(json!({ "kind": "runScript", "scriptId": build }), "w1");
        s.give(json!({ "kind": "runScript", "scriptId": build }), "w2");
        s.tick();
        // w1 stands on the site's footprint with nobody else of the crew: they stay on their tile
        // (`CONTEXT.md`: Spreading over the footprint).
        let memory = Value::Object(s.r("w1").script.as_ref().unwrap().memory.clone());
        assert_eq!(memory["building"], "house");
        assert_eq!(memory["at"], json!({ "x": 7, "y": 7 }));
        assert_eq!(memory["siteId"], "hs");
        // Nothing to build on w2's tile: the script ends, and the realm log says why.
        assert!(s.r("w2").script.is_none());
        assert!(s.r("w2").order.is_none());
        assert_eq!(s.stopped(), vec!["no construction site on their tile".to_string()]);
        s.until(20, |s| s.building("w1").as_deref() == Some("hs"));
        assert_eq!(s.building("w1").as_deref(), Some("hs"));
        // Joined, not laid out anew.
        assert_eq!(s.world.buildings.iter().filter(|b| b.site.is_some()).count(), 2);
        for _ in 0..20 {
            s.tick();
        }
        assert!(find(&s.world, "hs").site.as_ref().unwrap().work > 0.0);
    }

    #[test]
    fn as_a_queue_step_joins_the_site_the_resident_stands_on_when_the_step_starts() {
        let mut s = setup();
        s.give(
            json!({
                "kind": "queue",
                "steps": [
                    { "order": { "kind": "walkTo", "x": 15, "y": 13 } },
                    { "order": { "kind": "runScript", "scriptId": script_of(Task::Build) } },
                ]
            }),
            "w2",
        );
        s.until(100, |s| s.building("w2").as_deref() == Some("fs"));
        assert_eq!(s.building("w2").as_deref(), Some("fs"));
        assert_eq!(s.r("w2").queue.as_ref().unwrap().current, 1);
        assert_eq!(s.stopped(), Vec::<String>::new());
    }

    #[test]
    fn joins_the_site_picked_before_it_starts_wherever_the_resident_stands() {
        let mut s = setup();
        s.give(
            json!({ "kind": "runScript", "scriptId": script_of(Task::Build), "params": { "site": "fs" } }),
            "w2",
        );
        s.until(100, |s| s.building("w2").as_deref() == Some("fs"));
        assert_eq!(s.building("w2").as_deref(), Some("fs"));
    }

    #[test]
    fn never_keeps_the_site_given_build_there_run_again_on_an_empty_tile_it_ends() {
        let mut s = setup();
        let build = script_of(Task::Build);
        s.give(
            json!({ "kind": "task", "task": "build", "building": "farm", "at": { "x": 14, "y": 12 } }),
            "w2",
        );
        s.tick();
        // Giving the task to join a site of the realm's fills the param, which the card shows.
        assert_eq!(s.param("w2", build), Some(json!({ "site": "fs" })));
        s.give(json!({ "kind": "runScript", "scriptId": build }), "w2");
        s.tick();
        assert_eq!(s.param("w2", build), None);
        assert_eq!(s.stopped(), vec!["no construction site on their tile".to_string()]);
    }

    #[test]
    fn still_lays_out_a_new_site_as_the_build_order_with_no_site_to_fill() {
        let mut s = setup();
        s.give(json!({ "kind": "task", "task": "build", "building": "storage" }), "w2");
        s.until(5, |s| s.building("w2").is_some());
        let laid = s
            .world
            .buildings
            .iter()
            .find(|b| b.site.is_some() && b.x == 20.0 && b.y == 20.0)
            .unwrap();
        assert_eq!(laid.kind, BuildingKind::Storage);
        assert_eq!(s.building("w2").as_deref(), Some(laid.id.as_str()));
        assert_eq!(s.param("w2", script_of(Task::Build)), None);
    }

    #[test]
    fn ends_when_the_one_picked_is_no_construction_site() {
        let mut s = setup();
        s.give(
            json!({ "kind": "runScript", "scriptId": script_of(Task::Build), "params": { "site": "s1" } }),
            "w1",
        );
        s.tick();
        assert!(s.r("w1").script.is_none());
        assert_eq!(s.stopped(), vec!["the storage is no construction site".to_string()]);
    }
}

mod a_construction_site_is_the_realms_that_laid_it_out {
    use super::*;

    #[test]
    fn laid_out_by_the_realms_resident_can_be_picked_as_site_and_as_any_building_param() {
        let mut s = setup();
        s.give(
            json!({ "kind": "task", "task": "build", "building": "house", "at": { "x": 9, "y": 7 } }),
            "w2",
        );
        s.until(1000, |s| s.building("w2").is_some());
        let laid = s
            .world
            .buildings
            .iter()
            .find(|b| b.site.is_some() && b.x == 9.0 && b.y == 7.0)
            .unwrap()
            .clone();
        // Of no city until finished, yet the realm's: its resident laid it out.
        assert_eq!(laid.kind, BuildingKind::House);
        assert_eq!(laid.city_id, None);
        assert_eq!(laid.realm_id.as_deref(), Some("r1"));
        assert_eq!(
            start_params_problem(
                &s.world,
                "r1",
                &as_building(),
                Some(&json!({ "target": laid.id }))
            ),
            None
        );
        // Picked as Build's site, w1 walks over and joins it.
        s.give(
            json!({ "kind": "runScript", "scriptId": script_of(Task::Build), "params": { "site": laid.id } }),
            "w1",
        );
        s.until(100, |s| s.building("w1").as_deref() == Some(laid.id.as_str()));
        assert_eq!(s.building("w1").as_deref(), Some(laid.id.as_str()));
    }

    #[test]
    fn another_realms_site_or_nobodys_cant_be_picked() {
        let mut s = setup();
        s.world.realms.push(realm("r2", 8, "w2"));
        let mut theirs = site("ts", BuildingKind::TownHall, 24.0, 2.0);
        theirs.realm_id = Some("r2".into());
        s.world.buildings.push(theirs);
        let pick = |s: &Setup, realm: &str, id: &str| {
            start_params_problem(&s.world, realm, &as_building(), Some(&json!({ "target": id })))
        };
        assert_eq!(pick(&s, "r2", "ts"), None);
        for id in ["ts", "hs"] {
            assert_eq!(
                pick(&s, "r1", id).as_deref(),
                Some("target: must be a building of yours, or a workplace or construction site you know")
            );
        }
    }

    #[test]
    fn giving_build_on_a_house_site_of_the_realms_fills_site() {
        let mut s = setup();
        s.world.buildings.iter_mut().find(|b| b.id == "hs").unwrap().realm_id = Some("r1".into());
        s.give(
            json!({ "kind": "task", "task": "build", "building": "house", "at": { "x": 6, "y": 6 } }),
            "w1",
        );
        s.tick();
        assert_eq!(s.param("w1", script_of(Task::Build)), Some(json!({ "site": "hs" })));
    }

    #[test]
    fn finished_belongs_where_its_kind_does_a_realm_gone_leaves_none() {
        let mut s = setup();
        let w2 = s.r("w2").clone();
        let done = |s: &mut Setup, id: &str| {
            let i = s.world.buildings.iter().position(|b| b.id == id).unwrap();
            let kind = s.world.buildings[i].kind;
            let b = &mut s.world.buildings[i];
            b.realm_id = Some("r1".into());
            b.site = Some(ConstructionSite {
                delivered: build_materials(kind),
                work: build_work_of(kind),
            });
            assert!(finish_site(&mut s.world, i, &w2));
            s.world.buildings[i].realm_id.clone()
        };
        assert_eq!(done(&mut s, "hs"), None);
        // A storage out of every city is the builder's realm's outpost storage, as before.
        s.world.buildings.push(building("os", BuildingKind::Storage, 26.0, 26.0));
        assert_eq!(done(&mut s, "os").as_deref(), Some("r1"));
        let mut gs = building("gs", BuildingKind::House, 2.0, 26.0);
        gs.realm_id = Some("r9".into());
        gs.site = Some(ConstructionSite { delivered: Default::default(), work: 0.0 });
        s.world.buildings.push(gs);
        let invariant =
            world_invariants().into_iter().find(|i| i.name == "outpost-storage-realms").unwrap();
        let found: Vec<Vec<String>> =
            invariant.check(&s.world, &s.terrain).into_iter().map(|v| v.entity_ids).collect();
        assert_eq!(found, vec![vec!["gs".to_string()]]);
    }
}

mod haul {
    use super::*;

    #[test]
    fn ends_with_run_script_its_route_comes_only_from_the_haul_order() {
        let mut s = setup();
        s.give(json!({ "kind": "runScript", "scriptId": script_of(Task::Haul) }), "w2");
        s.tick();
        assert!(s.r("w2").script.is_none());
        assert!(s.r("w2").order.is_none());
        assert_eq!(s.stopped(), vec!["no route given".to_string()]);
    }

    #[test]
    fn as_the_haul_order_fills_the_carriage_and_drives_the_route() {
        let mut s = setup();
        s.give(
            json!({
                "kind": "task", "task": "haul", "carriageId": "k1", "x": 26, "y": 20,
                "goods": ["food"], "keepFood": 0
            }),
            "w2",
        );
        s.tick();
        assert_eq!(s.param("w2", script_of(Task::Haul)), Some(json!({ "carriage": "k1" })));
        match &s.r("w2").order {
            Some(ResidentOrder::Haul(h)) => {
                assert_eq!(h.carriage_id, "k1");
                assert_eq!((h.to.x, h.to.y), (26.0, 20.0));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(s.stopped(), Vec::<String>::new());
    }
}

mod invariants {
    use super::*;

    #[test]
    fn flag_a_resident_running_build_or_haul_that_knows_no_target() {
        let mut s = setup();
        let script = |id: u64, memory: Value| {
            serde_json::from_value(json!({ "scriptId": id, "memory": memory })).unwrap()
        };
        s.world.residents[0].script = Some(script(
            script_of(Task::Build),
            json!({ "building": "house", "at": { "x": 6, "y": 6 } }),
        ));
        s.world.residents[1].script = Some(script(script_of(Task::Build), json!({})));
        let found = defaults_have_a_target(&s.world, &|_| Some(Task::Build));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].invariant, "builders-have-a-site");
        assert_eq!(found[0].entity_ids, vec!["w2".to_string()]);

        s.world.residents[1].script =
            Some(script(script_of(Task::Haul), json!({ "carriageId": "k1" })));
        let found = defaults_have_a_target(&s.world, &|r| {
            Some(if r.id == "w2" { Task::Haul } else { Task::Build })
        });
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].invariant, "haulers-have-a-route");
        assert_eq!(found[0].entity_ids, vec!["w2".to_string()]);
    }
}
