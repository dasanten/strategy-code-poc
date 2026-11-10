//! `apps/server/src/stealing.test.ts`: stealing a carriage by driving it off (`CONTEXT.md`:
//! Stealing a carriage or horse).

mod build_common;
mod ts_match;

use std::sync::Arc;

use build_common::{add_city, new_resident, player, realm, Answer, Orders};
use csp_shared::balance::{
    ticks_for_age, AVERAGE_HORSE_STATS, CARRIAGE_STOLEN_WORTH, HORSE_STOLEN_WORTH, MAX_HEALTH,
    MAX_HUNGER, OWN_FOOD, SIGHT_RANGE,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Alliance, Carriage, DriveOrder, Good, Horse, HorseStats, Resident, ResidentOrder, Task, Tile,
    WorldState,
};
use csp_sim::events::events_for;
use csp_sim::invariants::{check_all, invariant_named};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::script_runner::{DefaultScriptHost, TaskOrder};
use csp_sim::script_tables::DEFAULT_SCRIPTS;
use csp_sim::tick::Scratch;
use csp_sim::trade_org_punishment::loss_of;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use ts_match::{assert_matches, json_of};

const SIZE: i32 = 256;

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

/// Realm r1 (Player 7, Leader t1 at (20, 20)) and realm r2 (Player 8, Leader o1 at (40, 40)), and
/// at (20, 20) r2's parked carriage k2, loaded with 5 Food and with its horse h2 hitched.
struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    orders: Orders,
}

fn setup() -> Setup {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "t1"));
    world.realms.push(realm("r2", 8, "o1"));
    let mut s = Setup { world, terrain, orders: Orders::default() };
    s.person("t1", Some("r1"), 20.0, 20.0);
    s.person("o1", Some("r2"), 40.0, 40.0);
    s.horse_of("h2", Some("r2"));
    s.world.carriages.push(Carriage {
        id: "k2".into(),
        realm_id: Some("r2".into()),
        city_id: None,
        x: 20.0,
        y: 20.0,
        horse_id: Some("h2".into()),
        load: [(Good::Food, 5.0)].into_iter().collect(),
    });
    s
}

impl Setup {
    /// A grown resident of `realm` at (x, y), carrying their own Food (`person`).
    fn person(&mut self, id: &str, realm: Option<&str>, x: f64, y: f64) -> usize {
        let mut r = new_resident(id, realm, x, y);
        r.carried = [(Good::Food, OWN_FOOD)].into_iter().collect();
        self.world.tick = self.world.tick.max(ticks_for_age(30.0) as u64);
        self.world.residents.push(r);
        self.world.residents.len() - 1
    }

    /// A fed, sound horse of `realm_id` at (20, 20) (`horseOf`).
    fn horse_of(&mut self, id: &str, realm_id: Option<&str>) {
        self.world.horses.push(Horse {
            id: id.into(),
            realm_id: realm_id.map(str::to_string),
            city_id: None,
            x: 20.0,
            y: 20.0,
            hunger: MAX_HUNGER,
            health: MAX_HEALTH,
            name: format!("Horse {id}"),
            stats: HorseStats {
                speed: AVERAGE_HORSE_STATS.speed,
                strength: AVERAGE_HORSE_STATS.strength,
                endurance: AVERAGE_HORSE_STATS.endurance,
            },
            born_at: 0.0,
            down_until: None,
        });
    }

    fn r(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).expect("a resident")
    }
    fn thief(&mut self) -> &mut Resident {
        self.r("t1")
    }
    fn carriage(&mut self) -> &mut Carriage {
        &mut self.world.carriages[0]
    }
    fn horse(&mut self) -> &mut Horse {
        self.world.horses.iter_mut().find(|h| h.id == "h2").expect("h2")
    }

    fn receive(&mut self, sender: &OrderSender, o: Value) -> Answer {
        self.orders.receive(&self.world, sender, o, &self.terrain)
    }

    /// Mara's resident drives k2 off to (25, 20) (`driveOff`).
    fn drive_off_by(&mut self, resident_id: &str) -> Answer {
        let o = json!({ "kind": "drive", "residentId": resident_id, "carriageId": "k2", "x": 25, "y": 20 });
        self.receive(&player(7), o)
    }
    fn drive_off(&mut self) -> Answer {
        self.drive_off_by("t1")
    }

    fn apply_all(&mut self) {
        self.orders.apply_all(&mut self.world, &self.terrain);
    }

    /// Steps the world with walking until the thief's order is done.
    fn drive_out(&mut self, check: bool) {
        let mut walking = Walking::new(Arc::new(self.terrain.clone()));
        let mut scratch = Scratch::default();
        for _ in 0..10_000 {
            if self.thief().order.is_none() {
                return;
            }
            step_world(&mut self.world, &self.terrain, &mut scratch, Some(&mut walking), None);
            if check {
                assert_sound(&self.world, &self.terrain);
            }
        }
        panic!("the thief never got there");
    }

    /// The events of `kind` in a Player's log (`logged`).
    fn logged(&self, user_id: u64, kind: &str) -> Vec<Value> {
        events_for(&self.world, user_id, 0)
            .into_iter()
            .map(json_of)
            .filter(|e| e["kind"] == kind)
            .collect()
    }
}

#[track_caller]
fn assert_sound(world: &WorldState, terrain: &TerrainMap) {
    let broken: Vec<String> = check_all(world, terrain)
        .iter()
        .map(|v| format!("{}: {}", v.invariant, v.message))
        .collect();
    assert!(broken.is_empty(), "{broken:?}");
}

fn rejected(reason: &str) -> Answer {
    Err(reason.into())
}

fn drive_order(carriage: &str, x: f64, y: f64) -> ResidentOrder {
    ResidentOrder::Drive(DriveOrder {
        carriage_id: carriage.into(),
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: None,
        near: None,
    })
}

fn kind_of(r: &Resident) -> Option<String> {
    r.order.as_ref().map(|o| json_of(o)["kind"].as_str().expect("a kind").to_string())
}

/// The ids an invariant names, one list per violation.
fn named(name: &str, world: &WorldState, terrain: &TerrainMap) -> Vec<Vec<String>> {
    let inv = invariant_named(name).expect("an invariant");
    (inv.check)(world, terrain).into_iter().map(|v| v.entity_ids).collect()
}

mod driving_off_in_another_organizations_carriage {
    use super::*;

    #[test]
    fn moves_carriage_load_and_horse_to_the_thiefs_realm_and_commits_one_theft() {
        let mut s = setup();
        assert_eq!(s.drive_off(), Ok(()));
        // Nothing changes hands before the order is applied.
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r2"));
        s.apply_all();
        assert_matches(
            s.carriage(),
            json!({ "realmId": "r1", "cityId": null, "load": { "food": 5 } }),
        );
        assert_matches(s.horse(), json!({ "realmId": "r1", "cityId": null }));
        assert_eq!(s.carriage().horse_id.as_deref(), Some("h2"));
        let order = s.thief().order.clone();
        assert_matches(
            &order,
            json!({ "kind": "drive", "carriageId": "k2", "target": { "x": 25, "y": 20 } }),
        );
        assert_eq!(s.world.crimes.len(), 1);
        assert_matches(
            &s.world.crimes[0],
            json!({
                "kind": "theft", "victimOrg": "r2", "carriage": true, "horse": "Horse h2",
                "goods": { "food": 5 }, "culprit": { "residentId": "t1", "org": "r1" }
            }),
        );
        assert_sound(&s.world, &s.terrain);
    }

    #[test]
    fn then_drives_it_like_any_carriage_of_the_realm_keeping_to_the_invariants() {
        let mut s = setup();
        s.drive_off().unwrap();
        s.apply_all();
        s.drive_out(true);
        let (k, h) = (s.world.carriages[0].clone(), s.horse().clone());
        assert_eq!([k.x, k.y, h.x, h.y], [25.0, 20.0, 25.0, 20.0]);
        // It is the thief's own now: driving it again steals nothing more.
        let again =
            json!({ "kind": "drive", "residentId": "t1", "carriageId": "k2", "x": 20, "y": 20 });
        assert_eq!(s.receive(&player(7), again), Ok(()));
        s.apply_all();
        assert_eq!(s.world.crimes.len(), 1);
    }

    #[test]
    fn tells_the_victim_at_once_it_is_gone_and_where_without_the_thief_the_thief_what_they_took() {
        let mut s = setup();
        s.drive_off().unwrap();
        s.apply_all();
        let gone = s.logged(8, "transportGone");
        assert_eq!(gone.len(), 1);
        assert_matches(
            &gone[0],
            json!({ "kind": "transportGone", "x": 20, "y": 20, "carriage": true, "horse": "Horse h2" }),
        );
        let text = Value::Array(gone).to_string();
        assert!(!text.contains("t1") && !text.contains("r1"), "{text}");
        assert_eq!(s.logged(8, "crimeKnown"), Vec::<Value>::new());
        let taken = s.logged(7, "transportTaken");
        assert_eq!(taken.len(), 1);
        assert_matches(
            &taken[0],
            json!({
                "kind": "transportTaken", "residentId": "t1", "carriage": true,
                "horse": "Horse h2", "goods": { "food": 5 }
            }),
        );
        assert!(taken[0]["from"].as_str().is_some_and(|f| f.contains("realm")), "{}", taken[0]);
    }

    #[test]
    fn is_known_through_a_witness_like_any_crime() {
        let mut s = setup();
        s.person("w2", Some("r2"), 20.0 + SIGHT_RANGE, 20.0);
        s.person("w3", Some("r2"), 20.0 + SIGHT_RANGE + 2.0, 20.0);
        s.drive_off().unwrap();
        s.apply_all();
        assert!(s.world.crimes[0].witnesses.contains(&"w2".to_string()));
        assert!(!s.world.crimes[0].witnesses.contains(&"w3".to_string()));
    }

    #[test]
    fn makes_each_taking_a_theft_of_its_own_apart_from_goods_taken_there() {
        let mut s = setup();
        let (x, y, name, tick) = {
            let t = s.thief().clone();
            (t.x, t.y, t.name, s.world.tick)
        };
        s.world.crimes.push(
            serde_json::from_value(json!({
                "id": "x1", "kind": "theft", "tick": tick, "x": x, "y": y,
                "culprit": { "residentId": "t1", "name": name, "org": "r1", "orgName": "r1" },
                "victimOrg": "r2", "goods": { "wood": 1 }, "witnesses": [], "knownBy": []
            }))
            .expect("a crime"),
        );
        s.drive_off().unwrap();
        s.apply_all();
        let goods: Vec<Value> = s.world.crimes.iter().map(|c| json_of(&c.goods)).collect();
        assert_eq!(goods, [json!({ "wood": 1.0 }), json!({ "food": 5.0 })]);
    }

    #[test]
    fn counts_the_carriage_the_horse_and_the_load_in_what_the_theft_is_worth() {
        let mut s = setup();
        s.drive_off().unwrap();
        s.apply_all();
        let crime = &s.world.crimes[0];
        let load_worth =
            loss_of(&csp_shared::world::Crime { carriage: None, horse: None, ..crime.clone() });
        assert_eq!(loss_of(crime), load_worth + CARRIAGE_STOLEN_WORTH + HORSE_STOLEN_WORTH);
    }

    #[test]
    fn is_refused_while_someone_drives_it() {
        let mut s = setup();
        let i = s.person("o2", Some("r2"), 20.0, 20.0);
        s.world.residents[i].order = Some(drive_order("k2", 30.0, 20.0));
        assert_eq!(s.drive_off(), rejected("someone is driving that carriage"));
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r2"));
    }

    #[test]
    fn is_refused_with_anyone_aboard() {
        let mut s = setup();
        let i = s.person("o2", Some("r2"), 20.0, 20.0);
        s.world.residents[i].aboard = Some("k2".into());
        assert_eq!(s.drive_off(), rejected("someone is aboard that carriage"));
    }

    #[test]
    fn is_refused_while_guarded_and_allowed_when_an_armed_resident_of_the_thiefs_realm_is_there_too(
    ) {
        let mut s = setup();
        s.person("o2", Some("r2"), 20.0, 20.0);
        // Unarmed, they guard nothing.
        assert_eq!(s.drive_off(), Ok(()));
        s.apply_all();
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r1"));
        s.carriage().realm_id = Some("r2".into());
        s.world.horses[0].realm_id = Some("r2".into());
        s.thief().order = None;
        s.world.crimes.clear();

        s.r("o2").carried.insert(Good::Spear, 1.0);
        let refused = rejected("an armed resident guards that carriage");
        assert_eq!(s.drive_off(), refused);
        // Next to it is not on its tile.
        s.r("o2").x = 21.0;
        assert_eq!(s.drive_off(), Ok(()));
        s.r("o2").x = 20.0;
        // Someone else's armed resident doesn't lift the guard, one of the thief's realm does.
        let other = s.person("z1", None, 20.0, 20.0);
        s.world.residents[other].carried.insert(Good::Sword, 1.0);
        assert_eq!(s.drive_off(), refused);
        let armed = s.person("t2", Some("r1"), 20.0, 20.0);
        s.world.residents[armed].carried.insert(Good::Sword, 1.0);
        assert_eq!(s.drive_off(), Ok(()));
        s.world.residents[armed].carried.clear();
        // The thief themselves armed counts as well.
        s.thief().carried.insert(Good::Spear, 1.0);
        assert_eq!(s.drive_off(), Ok(()));
    }

    #[test]
    fn needs_a_grown_resident_on_its_tile() {
        let mut s = setup();
        s.thief().x = 21.0;
        assert_eq!(s.drive_off(), rejected("that carriage is not on the resident’s tile"));
        s.thief().x = 20.0;
        let tick = s.world.tick as f64;
        s.thief().born_at = tick - ticks_for_age(5.0);
        assert_eq!(s.drive_off(), rejected("children can’t steal"));
    }

    #[test]
    fn hitches_a_free_horse_of_the_thiefs_own_before_stealing_one() {
        let mut s = setup();
        s.carriage().horse_id = None;
        s.horse_of("h1", Some("r1"));
        assert_eq!(s.drive_off(), Ok(()));
        s.apply_all();
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r1"));
        assert_eq!(s.horse().realm_id.as_deref(), Some("r2"));
        assert_eq!(s.world.crimes[0].horse, None);
        s.drive_out(false);
        assert_eq!(s.carriage().horse_id.as_deref(), Some("h1"));
    }

    #[test]
    fn refuses_a_down_hitched_horse() {
        let mut s = setup();
        let tick = s.world.tick as f64;
        s.horse().down_until = Some(tick + 100.0);
        assert_eq!(s.drive_off(), rejected("its horse is Down"));
    }

    #[test]
    fn lets_the_first_of_two_thieves_in_a_tick_have_it() {
        let mut s = setup();
        s.person("t2", Some("r1"), 20.0, 20.0);
        assert_eq!(s.drive_off(), Ok(()));
        assert_eq!(s.drive_off_by("t2"), Ok(()));
        s.apply_all();
        assert_eq!(kind_of(s.thief()).as_deref(), Some("drive"));
        assert!(s.r("t2").order.is_none());
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r1"));
        assert_eq!(s.world.crimes.len(), 1);
    }

    #[test]
    fn takes_a_carriage_of_nobody_with_no_crime_and_no_one_to_tell() {
        let mut s = setup();
        s.carriage().realm_id = None;
        s.horse().realm_id = None;
        assert_eq!(s.drive_off(), Ok(()));
        s.apply_all();
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r1"));
        assert_eq!(s.horse().realm_id.as_deref(), Some("r1"));
        assert!(s.world.crimes.is_empty());
        assert_eq!(s.logged(8, "transportGone"), Vec::<Value>::new());
        let taken = s.logged(7, "transportTaken");
        assert_eq!(taken.len(), 1);
        assert_matches(&taken[0], json!({ "from": null, "goods": { "food": 5 } }));
    }

    #[test]
    fn takes_an_npc_citys_carriage_from_the_city_and_its_armed_residents_guard_it() {
        let mut s = setup();
        s.carriage().realm_id = None;
        s.carriage().city_id = Some("n1".into());
        s.horse().realm_id = None;
        s.horse().city_id = Some("n1".into());
        let guard = s.person("n2", None, 20.0, 20.0);
        s.world.residents[guard].city_id = Some("n1".into());
        s.world.residents[guard].carried.insert(Good::Spear, 1.0);
        assert_eq!(s.drive_off(), rejected("an armed resident guards that carriage"));
        s.world.residents[guard].carried.clear();
        assert_eq!(s.drive_off(), Ok(()));
        s.apply_all();
        assert_matches(s.carriage(), json!({ "realmId": "r1", "cityId": null }));
        assert_matches(s.horse(), json!({ "realmId": "r1", "cityId": null }));
        assert_matches(&s.world.crimes[0], json!({ "victimOrg": "n1" }));
    }
}

mod the_alliance_armys_carriages {
    use super::*;

    fn allied(s: &mut Setup, leader_id: &str) {
        let alliance: Alliance = serde_json::from_value(json!({
            "id": "a1", "name": "North", "leaderId": leader_id,
            "members": [{ "realmId": "r1", "joinedAt": 0 }, { "realmId": "r2", "joinedAt": 0 }],
            "invites": [],
            "army": [{ "is": "carriage", "id": "k2", "recallAt": null }]
        }))
        .expect("an alliance");
        s.world.alliances.push(alliance);
    }

    #[test]
    fn are_driven_by_their_commander_which_is_no_theft() {
        let mut s = setup();
        allied(&mut s, "r1");
        assert_eq!(s.drive_off(), Ok(()));
        s.apply_all();
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r2"));
        assert_eq!(kind_of(s.thief()).as_deref(), Some("drive"));
        assert!(s.world.crimes.is_empty());
        assert_eq!(s.logged(8, "transportGone"), Vec::<Value>::new());
        assert_sound(&s.world, &s.terrain);
    }

    #[test]
    fn are_not_their_owners_to_drive_while_handed_over_and_no_theft_from_themselves() {
        let mut s = setup();
        allied(&mut s, "r1");
        s.world.alliances[0].leader_id = "r1".into();
        s.person("o2", Some("r2"), 20.0, 20.0);
        let o =
            json!({ "kind": "drive", "residentId": "o2", "carriageId": "k2", "x": 25, "y": 20 });
        assert_eq!(
            s.receive(&OrderSender::player(8, "Ovid"), o),
            rejected("not one of your carriages")
        );
    }

    #[test]
    fn can_be_stolen_by_a_third_realm_and_leave_the_army_then() {
        let mut s = setup();
        allied(&mut s, "r2");
        s.world.alliances[0].members.retain(|m| m.realm_id == "r2");
        assert_eq!(s.drive_off(), Ok(()));
        s.apply_all();
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r1"));
        assert!(s.world.alliances[0].army.is_empty());
        assert_sound(&s.world, &s.terrain);
    }
}

mod never_by_accident {
    use super::*;

    /// Whether `source` calls `drive(` as a word of its own (`/\bdrive\(/`).
    fn calls_drive(source: &str) -> bool {
        source.match_indices("drive(").any(|(i, _)| {
            source[..i].chars().next_back().is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
        })
    }

    #[test]
    fn has_no_default_script_drive_anything_so_none_can_steal() {
        for (task, _, source) in DEFAULT_SCRIPTS {
            assert!(!calls_drive(source), "{task:?} drives");
        }
    }

    struct Defaults;
    impl DefaultScriptHost for Defaults {
        fn default_script(&self, _: u64, _: Task) -> u64 {
            1
        }
    }

    #[test]
    fn keeps_the_haul_task_to_the_realms_own_carriages() {
        let mut s = setup();
        let mut kinds = order_kinds();
        kinds.insert("task", TaskOrder::new(Arc::new(Defaults)));
        let mut orders = OrderQueue::new(kinds, Some(Arc::new(s.terrain.clone())));
        let haul = json!({
            "kind": "task", "task": "haul", "residentId": "t1", "carriageId": "k2", "x": 25,
            "y": 20, "goods": ["food"], "returnGoods": [], "keepFood": 0
        });
        let reply = orders.receive(&s.world, &player(7), &json!("q"), &haul);
        assert!(matches!(reply, OrderReply::Rejected { .. }), "{reply:?}");
        orders.apply_all(&mut s.world);
        assert!(s.thief().script.is_none());
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r2"));
    }

    #[test]
    fn never_picks_another_realms_carriage_as_the_nearest_to_fetch_from() {
        let mut s = setup();
        let reply = s.receive(
            &player(7),
            json!({ "kind": "fetch", "residentId": "t1", "goods": { "food": 2 } }),
        );
        assert!(reply.is_err());
        s.apply_all();
        assert!(s.thief().order.is_none());
        assert_eq!(json_of(&s.carriage().load), json!({ "food": 5.0 }));
    }

    #[test]
    fn keeps_a_haul_to_the_realms_own_carriages() {
        let mut s = setup();
        let haul = json!({
            "kind": "haul", "residentId": "t1", "carriageId": "k2", "x": 25, "y": 20,
            "goods": ["food"], "keepFood": 0
        });
        assert_eq!(s.receive(&player(7), haul), rejected("not one of your carriages"));
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r2"));
    }

    #[test]
    fn keeps_unhitching_and_boarding_to_the_realms_own() {
        let mut s = setup();
        for kind in ["unhitch", "board"] {
            let o = json!({ "kind": kind, "residentId": "t1", "carriageId": "k2" });
            assert_eq!(s.receive(&player(7), o), rejected("not a carriage of your realm"));
        }
    }

    #[test]
    fn keeps_hitching_to_the_realms_own_horses_it_steals_nothing() {
        let mut s = setup();
        let o = json!({ "kind": "hitch", "residentId": "t1", "carriageId": "k2", "horseId": "h2" });
        assert_eq!(s.receive(&player(7), o), rejected("not a carriage of your realm"));
        assert_eq!(s.horse().realm_id.as_deref(), Some("r2"));
    }

    struct Mara;
    impl QueueHost for Mara {
        fn sender(&self, user_id: u64) -> Option<OrderSender> {
            (user_id == 7).then(|| player(7))
        }
    }

    #[test]
    fn refuses_another_realms_carriage_in_a_queue_and_skips_a_step_whose_carriage_was_stolen() {
        let mut s = setup();
        let queue = json!({
            "kind": "queue", "residentId": "t1",
            "steps": [{ "order": { "kind": "drive", "carriageId": "k2", "x": 25, "y": 20 } }]
        });
        assert_eq!(
            s.receive(&player(7), queue.clone()),
            rejected("step 1: not a carriage of your realm")
        );
        // Planned while it was the realm's, and stolen since: the step doesn't steal it back.
        s.carriage().realm_id = Some("r1".into());
        s.horse().realm_id = Some("r1".into());
        assert_eq!(s.receive(&player(7), queue), Ok(()));
        s.apply_all();
        s.carriage().realm_id = Some("r2".into());
        s.horse().realm_id = Some("r2".into());
        let terrain = Arc::new(s.terrain.clone());
        let mut runner = QueueRunner::new(Box::new(Mara), order_kinds(), Some(terrain));
        runner.run_all(&mut s.world, &mut Scratch::default());
        assert!(s.thief().order.is_none());
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r2"));
        assert!(s.world.crimes.is_empty());
        let skipped = s.logged(7, "queueStepSkipped");
        assert_eq!(skipped.len(), 1);
        assert_matches(&skipped[0], json!({ "reason": "not a carriage of your realm" }));
    }

    #[test]
    fn ends_a_fetch_from_or_a_store_at_a_carriage_stolen_since() {
        let mut s = setup();
        let own = s.person("o2", Some("r2"), 20.0, 20.0);
        s.world.residents[own].order = Some(
            serde_json::from_value(json!({
                "kind": "fetch", "from": { "kind": "carriage", "carriageId": "k2" },
                "goods": { "food": null }, "phase": "taking", "path": null, "progress": 0
            }))
            .expect("a fetch order"),
        );
        s.carriage().realm_id = Some("r1".into());
        s.horse().realm_id = Some("r1".into());
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        step_world(&mut s.world, &s.terrain, &mut Scratch::default(), Some(&mut walking), None);
        let o2 = s.r("o2").clone();
        assert!(o2.order.is_none());
        assert_matches(
            &o2.order_ended,
            json!({ "kind": "fetch", "reason": "the carriage is gone" }),
        );
        assert_eq!(json_of(&s.carriage().load), json!({ "food": 5.0 }));
        assert!(s.world.crimes.is_empty());
    }
}

/// `CONTEXT.md`: What joins with a city.
mod a_stolen_carriage_when_a_city_joins_a_realm {
    use super::*;

    /// The carriage stolen from NPC city n1 and driven off by t2 of r1's city c1.
    fn stolen() -> Setup {
        let mut s = setup();
        add_city(&mut s.world, "n1", None, 100.0, 100.0);
        add_city(&mut s.world, "c1", Some("r1"), 150.0, 150.0);
        s.carriage().realm_id = None;
        s.carriage().city_id = Some("n1".into());
        s.horse().realm_id = None;
        s.horse().city_id = Some("n1".into());
        // No Leader, who wouldn't join with a city.
        let t = s.person("t2", Some("r1"), 20.0, 20.0);
        s.world.residents[t].city_id = Some("c1".into());
        s.drive_off_by("t2").unwrap();
        s.apply_all();
        assert_eq!(kind_of(s.r("t2")).as_deref(), Some("drive"));
        s
    }

    #[track_caller]
    fn sound(s: &Setup) {
        assert_eq!(named("carriages-in-place", &s.world, &s.terrain), Vec::<Vec<String>>::new());
        assert_eq!(named("drivers-on-carriages", &s.world, &s.terrain), Vec::<Vec<String>>::new());
    }

    #[test]
    fn stays_the_thiefs_when_the_city_it_was_stolen_from_joins_another_realm() {
        let mut s = stolen();
        csp_sim::capture::join_realm(&mut s.world, "n1", "r2", SIZE);
        assert_matches(s.carriage(), json!({ "realmId": "r1", "cityId": null }));
        assert_matches(s.horse(), json!({ "realmId": "r1", "cityId": null }));
        assert_eq!(kind_of(s.r("t2")).as_deref(), Some("drive"));
        sound(&s);
    }

    #[test]
    fn goes_with_the_thief_and_its_horse_when_the_thiefs_own_city_joins_another_realm() {
        let mut s = stolen();
        csp_sim::capture::join_realm(&mut s.world, "c1", "r2", SIZE);
        assert_eq!(s.r("t2").owner.as_deref(), Some("r2"));
        assert!(s.r("t2").order.is_none());
        assert_eq!(s.carriage().realm_id.as_deref(), Some("r2"));
        assert_eq!(s.horse().realm_id.as_deref(), Some("r2"));
        sound(&s);
    }
}

mod the_invariants {
    use super::*;

    #[test]
    fn catch_a_hitched_horse_of_another_realm_than_its_carriage() {
        let mut s = setup();
        assert_eq!(named("carriages-in-place", &s.world, &s.terrain), Vec::<Vec<String>>::new());
        s.horse().realm_id = Some("r1".into());
        assert_eq!(named("carriages-in-place", &s.world, &s.terrain), [["k2", "h2"]]);
    }

    #[test]
    fn catch_someone_driving_another_organizations_carriage_they_dont_command() {
        let mut s = setup();
        s.thief().order = Some(drive_order("k2", 25.0, 20.0));
        assert_eq!(named("drivers-on-carriages", &s.world, &s.terrain), [["t1", "k2"]]);
        s.carriage().realm_id = Some("r1".into());
        s.horse().realm_id = Some("r1".into());
        assert_eq!(named("drivers-on-carriages", &s.world, &s.terrain), Vec::<Vec<String>>::new());
    }
}
