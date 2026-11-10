//! `alarm-theft.test.ts`: a theft seen, and force at home (`CONTEXT.md`: Alarm, Crime; ADR 0028).
//! A theft from a realm in its City area raises an alarm for those there who see it, and in that
//! area striking someone occupying the town hall, or a thief the realm knows of, is no crime.

use std::collections::HashMap;
use std::sync::Arc;

use csp_shared::balance::{AVERAGE_HORSE_STATS, MAX_HEALTH, MAX_HUNGER, OWN_FOOD, SIGHT_RANGE};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, Carriage, City, CrimeKind, Good, GoodsSpot, Horse, Pile, Realm, Resident,
    ResidentOrder, Stock, WorldState,
};
use serde_json::{json, Value};

use super::alarms_sound;
use crate::carrying::{resolve_carrying, CarryAction, CarryKind};
use crate::combat::attack_order;
use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{OrderQueue, OrderReply};
use crate::queries::city::town_hall_of;
use crate::queries::names::held;
use crate::queries::standing::standing_of;
use crate::queues::{QueueHost, QueueRunner};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::script_runner::default_host::DefaultScripts;
use crate::script_tables::SCRIPT_VIEWS;
use crate::scripts::RunnableScript;
use crate::stealing::{take_over, Taken};
use crate::test_support::add_city;
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 256;

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

struct Senders;

impl QueueHost for Senders {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 7).then(me)
    }
}

fn from<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).unwrap()
}

fn new_r(id: &str, seed: f64, owner: &str, x: f64, y: f64) -> Resident {
    let mut m = Mulberry32::new(seed);
    let fields = NewResident { id, owner: Some(owner), city_id: None, x, y, tick: 0.0 };
    new_resident(&mut || m.next(), &fields, None)
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    scripts: DefaultScripts,
    orders: OrderQueue,
    queues: QueueRunner,
    walking: Walking,
    scratch: Scratch,
}

/// Realm r1 (Player 7) with city c1, its town hall at (9, 3): armed w1 on farm f1 at (6, 6),
/// storage s1 at (14, 9). Realm r2 (Player 8): x1, armed, not there yet. Realm r3 has an outpost
/// storage at (40, 12) (`setup`).
fn setup_with(library: HashMap<u64, RunnableScript>) -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 7, "w1"), ("r2", 8, "l2"), ("r3", 9, "l3")] {
        world.realms.push(from::<Realm>(json!({ "id": id, "userId": user, "leaderId": leader })));
    }
    add_city(&mut world, "c1", Some("r1"), 9.0, 3.0);
    for b in [
        json!({ "id": "f1", "kind": "farm", "cityId": "c1", "x": 6, "y": 6 }),
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 14, "y": 9, "stock": { "food": 50 } }),
        json!({ "id": "s3", "kind": "storage", "cityId": null, "realmId": "r3", "x": 40, "y": 12, "stock": { "food": 50 } }),
    ] {
        world.buildings.push(from::<Building>(b));
    }
    let mut r = new_r("w1", 1.0, "r1", 6.0, 6.0);
    r.city_id = Some("c1".into());
    r.carried = Stock::from([(Good::Food, OWN_FOOD), (Good::Spear, 1.0)]);
    let mut x1 = new_r("x1", 2.0, "r2", 200.0, 200.0);
    x1.carried = Stock::from([(Good::Sword, 1.0)]);
    let l2 = new_r("l2", 3.0, "r2", 220.0, 220.0);
    let l3 = new_r("l3", 4.0, "r3", 150.0, 220.0);
    world.residents.extend([r, x1, l2, l3]);
    let terrain = Arc::new(terrain);
    let scripts = DefaultScripts::with_library(terrain.clone(), &[me()], library);
    let orders = OrderQueue::new(scripts.kinds.clone(), Some(terrain.clone()));
    let queues = QueueRunner::new(Box::new(Senders), scripts.kinds.clone(), Some(terrain.clone()));
    let walking = Walking::new(terrain.clone());
    Setup { world, terrain, scripts, orders, queues, walking, scratch: Scratch::default() }
}

fn setup() -> Setup {
    setup_with(HashMap::new())
}

impl Setup {
    fn r(&self, id: &str) -> Option<&Resident> {
        self.world.residents.iter().find(|r| r.id == id)
    }

    fn w1(&self) -> &Resident {
        self.r("w1").unwrap()
    }

    fn x1(&self) -> &Resident {
        self.r("x1").unwrap()
    }

    fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    fn city(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == "c1").unwrap()
    }

    fn b(&self, id: &str) -> Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap().clone()
    }

    fn tick(&mut self) {
        for x in &mut self.world.residents {
            x.hunger = MAX_HUNGER;
        }
        self.orders.apply_all(&mut self.world);
        self.queues.run_all(&mut self.world, &mut self.scratch);
        assert_eq!(self.scripts.run_all(&mut self.world, &mut self.scratch), []);
        step_world(
            &mut self.world,
            &self.terrain,
            &mut self.scratch,
            Some(&mut self.walking),
            None,
        );
        assert_eq!(check_all(&self.world, &self.terrain), []);
    }

    fn until(&mut self, done: impl Fn(&Setup) -> bool, limit: usize) -> bool {
        for _ in 0..limit {
            if done(self) {
                break;
            }
            self.tick();
        }
        done(self)
    }

    fn give(&mut self, order: Value) -> String {
        let mut o = json!({ "residentId": "w1" });
        o.as_object_mut().unwrap().extend(order.as_object().unwrap().clone());
        match self.orders.receive(&self.world, &me(), &json!("q"), &o) {
            OrderReply::Ack { .. } => "ack".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }

    fn take(&mut self, spot: GoodsSpot, goods: Stock) {
        let action = CarryAction { kind: CarryKind::Take, resident_id: "x1".into(), spot, goods };
        resolve_carrying(&mut self.world, &[action], SIZE);
    }

    /// x1 stands at `from` (the storage s1 unless said) and takes food from it (`steal`).
    fn steal_from(&mut self, from: &str) {
        let b = self.b(from);
        let x1 = self.r_mut("x1");
        x1.x = b.x;
        x1.y = b.y;
        x1.order = None;
        self.take(GoodsSpot::Storage { storage_id: from.into() }, Stock::from([(Good::Food, 2.0)]));
    }

    fn steal(&mut self) {
        self.steal_from("s1");
    }

    fn put_x1(&mut self, x: f64, y: f64) {
        let x1 = self.r_mut("x1");
        x1.x = x;
        x1.y = y;
    }

    fn put_w1(&mut self, x: f64, y: f64) {
        let w1 = self.r_mut("w1");
        w1.x = x;
        w1.y = y;
    }

    /// w1, running no Alarm script, walks beside x1 and strikes them, until the first blow is out
    /// (`strike`).
    fn strike(&mut self) {
        let (x, y) = (self.x1().x, self.x1().y);
        let w1 = self.r_mut("w1");
        w1.alarm_script_id = Some(from(json!("none")));
        w1.script = None;
        w1.interrupted = None;
        w1.x = x + 1.0;
        w1.y = y;
        w1.order = Some(ResidentOrder::Attack(attack_order("x1", false, false)));
        assert!(self.until(|s| s.r("x1").is_none_or(|x| x.struck.is_some()), 200));
    }

    /// What w1 has done that counts as a crime, by kind (`crimesOfW1`).
    fn crimes_of_w1(&self) -> Vec<CrimeKind> {
        let mine = self.world.crimes.iter().filter(|c| c.culprit.resident_id == "w1");
        mine.map(|c| c.kind).collect()
    }

    fn script(&self) -> Value {
        self.w1().script.as_ref().map_or(Value::Null, |s| serde_json::to_value(s).unwrap())
    }

    fn task(&self) -> Value {
        self.script()["task"].clone()
    }

    fn order(&self) -> Value {
        self.w1().order.as_ref().map_or(Value::Null, |o| serde_json::to_value(o).unwrap())
    }

    fn crime(&self, i: usize) -> Value {
        serde_json::to_value(&self.world.crimes[i]).unwrap()
    }
}

fn logged(r: &Resident) -> Vec<String> {
    r.script_log.iter().flatten().map(|l| l.text.clone()).collect()
}

fn alarm_task(s: &Setup) -> bool {
    s.task() == "alarm"
}

// a theft seen

#[test]
fn sends_armed_residents_who_see_it_after_the_thief() {
    let mut s = setup();
    s.steal();
    let script = s.script();
    assert_eq!(script["task"], "alarm");
    let alarm = &script["alarm"];
    let want = json!({ "kind": "theft", "cityId": "c1", "about": "x1", "realmId": "r2", "x": 14.0, "y": 9.0 });
    for (k, v) in want.as_object().unwrap() {
        assert_eq!(
            crate::test_support::as_numbers(&alarm[k]),
            crate::test_support::as_numbers(v),
            "{k}"
        );
    }
    s.tick();
    assert_eq!(
        (s.order()["kind"].clone(), s.order()["targetId"].clone()),
        (json!("attack"), json!("x1"))
    );
    let doing = s.script()["memory"]["doing"].as_str().unwrap_or("").to_string();
    assert!(doing.contains(&s.x1().name), "{doing}");
}

#[test]
fn ends_once_the_thief_has_left_the_area_and_back_to_work() {
    let mut s = setup();
    assert_eq!(s.give(json!({ "kind": "task", "task": "work", "workplaceId": "f1" })), "ack");
    s.tick();
    s.tick();
    s.steal();
    s.tick();
    assert_eq!(s.task(), "alarm");
    // Still in sight, out of the area.
    s.put_x1(30.0, 30.0);
    assert!(s.until(|s| !alarm_task(s), 5));
    assert!(s.until(|s| s.order()["kind"] == "workAt", 200));
    assert!(s.w1().interrupted.is_none());
}

#[test]
fn ends_once_the_thief_is_out_of_sight_in_the_area_or_not() {
    let mut s = setup();
    s.steal();
    s.tick();
    assert_eq!(s.task(), "alarm");
    s.put_x1(200.0, 200.0);
    assert!(s.until(|s| !alarm_task(s), 5));
}

#[test]
fn ends_once_the_thief_is_dead() {
    let mut s = setup();
    s.steal();
    s.tick();
    s.world.residents.retain(|x| x.id != "x1");
    assert!(s.until(|s| !alarm_task(s), 5));
}

#[test]
fn raises_nothing_for_someone_in_the_area_out_of_sight_of_it() {
    let mut s = setup();
    // The farm far off stretches the city's area past sight range of the storage.
    let store = s.b("s1");
    let x = store.x + SIGHT_RANGE + 10.0;
    s.world
        .buildings
        .push(from(json!({ "id": "f2", "kind": "farm", "cityId": "c1", "x": x, "y": store.y })));
    s.put_w1(x, store.y);
    s.steal();
    assert_eq!(s.w1().script, None);
}

#[test]
fn raises_nothing_for_a_theft_outside_the_area_in_sight_of_them_or_not() {
    let mut s = setup();
    let out = json!({ "id": "s2", "kind": "storage", "cityId": null, "realmId": "r1", "x": 30, "y": 30, "stock": { "food": 5 } });
    s.world.buildings.push(from(out));
    s.steal_from("s2");
    assert_eq!(s.world.crimes.len(), 1);
    assert_eq!(s.w1().script, None);
}

#[test]
fn raises_nothing_for_a_theft_from_another_realm_nor_for_taking_from_ones_own() {
    let mut s = setup();
    s.steal_from("s3");
    assert_eq!(s.world.crimes.len(), 1);
    assert_eq!(s.w1().script, None);
    s.r_mut("x1").owner = Some("r1".into());
    s.steal();
    assert_eq!(s.world.crimes.len(), 1);
    assert_eq!(s.w1().script, None);
}

#[test]
fn raises_nothing_for_what_lies_in_a_pile_which_is_anyones_to_take() {
    let mut s = setup();
    s.world.piles.push(Pile {
        id: "p1".into(),
        x: 12.0,
        y: 8.0,
        goods: Stock::from([(Good::Food, 5.0)]),
    });
    s.put_x1(12.0, 8.0);
    s.take(GoodsSpot::Ground, Stock::from([(Good::Food, 1.0)]));
    assert_eq!(held(&s.x1().carried, Good::Food), 1.0);
    assert!(s.world.crimes.is_empty());
    assert_eq!(s.w1().script, None);
}

#[test]
fn raises_nothing_on_a_resident_set_to_none_and_nothing_for_an_unarmed_one() {
    let mut s = setup();
    s.r_mut("w1").alarm_script_id = Some(from(json!("none")));
    s.steal();
    assert_eq!(s.w1().script, None);
    s.r_mut("w1").alarm_script_id = None;
    s.r_mut("w1").carried = Stock::from([(Good::Food, OWN_FOOD)]);
    s.steal();
    assert_eq!(s.w1().script, None);
}

#[test]
fn takes_goods_from_a_carriage_a_carriage_and_a_horse_as_thefts_too() {
    let st = AVERAGE_HORSE_STATS;
    let horse = || -> Horse {
        from(json!({
            "id": "h1", "realmId": "r1", "cityId": null, "x": 12, "y": 8, "hunger": MAX_HUNGER,
            "health": MAX_HEALTH, "name": "Bay",
            "stats": { "speed": st.speed, "strength": st.strength, "endurance": st.endurance }, "bornAt": 0,
        }))
    };
    let carriage = |id: &str| Carriage {
        id: id.into(),
        realm_id: Some("r1".into()),
        city_id: None,
        x: 12.0,
        y: 8.0,
        horse_id: None,
        load: Stock::from([(Good::Food, 5.0)]),
    };
    let rung = |take: &dyn Fn(&mut Setup)| {
        let mut s = setup();
        s.put_x1(12.0, 8.0);
        take(&mut s);
        s.script()["alarm"]["kind"].clone()
    };
    let by_horse = rung(&|s| {
        s.world.horses.push(horse());
        take_over(&mut s.world, "x1", "r2", Taken { carriage: None, horse: Some(0) }, SIZE);
    });
    assert_eq!(by_horse, "theft");
    let by_carriage = rung(&|s| {
        s.world.carriages.push(carriage("k1"));
        take_over(&mut s.world, "x1", "r2", Taken { carriage: Some(0), horse: None }, SIZE);
    });
    assert_eq!(by_carriage, "theft");
    let from_load = rung(&|s| {
        s.world.carriages.push(carriage("k2"));
        s.take(GoodsSpot::Carriage { carriage_id: "k2".into() }, Stock::from([(Good::Food, 1.0)]));
    });
    assert_eq!(from_load, "theft");
}

#[test]
fn doesnt_interrupt_the_alarm_already_running() {
    let mut s = setup();
    s.steal();
    s.tick();
    let running = s.w1().script.clone();
    s.steal();
    assert_eq!(s.w1().script, running);
}

// force at home

/// Stands x1 on the town hall (`onHall`).
fn on_hall(s: &mut Setup) {
    let hall = town_hall_of(&s.world, s.city()).unwrap().clone();
    s.put_x1(hall.x, hall.y);
}

#[test]
fn striking_a_thief_one_of_my_residents_saw_costs_nothing() {
    let mut s = setup();
    s.steal();
    let before = standing_of(&s.world, "r2", "r1");
    s.strike();
    assert_eq!(s.crimes_of_w1(), []);
    assert_eq!(standing_of(&s.world, "r2", "r1"), before);
}

#[test]
fn killing_them_costs_nothing_either() {
    let mut s = setup();
    s.steal();
    let x1 = s.r_mut("x1");
    x1.carried = Stock::new();
    x1.health = 1.0;
    s.strike();
    assert!(s.until(|s| s.r("x1").is_none(), 300));
    assert_eq!(s.crimes_of_w1(), []);
}

#[test]
fn goes_by_what_news_brought_home_too_the_witnesss_part_done() {
    let mut s = setup();
    s.steal();
    s.tick();
    let crime = s.crime(0);
    assert_eq!((crime["knownBy"].clone(), crime["witnesses"].clone()), (json!(["r1"]), json!([])));
    s.strike();
    assert_eq!(s.crimes_of_w1(), []);
}

#[test]
fn goes_by_what_a_resident_saw_before_it_is_known_at_home() {
    let mut s = setup();
    // w2 sees it from outside the area, and stays out of it.
    s.world.residents.push(new_r("w2", 5.0, "r1", 40.0, 9.0));
    s.put_w1(200.0, 100.0);
    s.steal();
    let crime = s.crime(0);
    assert_eq!((crime["witnesses"].clone(), crime["knownBy"].clone()), (json!(["w2"]), json!([])));
    s.strike();
    assert_eq!(s.crimes_of_w1(), []);
}

#[test]
fn a_thief_nobody_of_mine_saw_and_no_news_of_is_still_a_crime() {
    let mut s = setup();
    s.put_w1(200.0, 100.0);
    s.steal();
    assert!(!s.world.crimes.iter().any(|c| c.witnesses.iter().any(|w| w == "w1")));
    s.strike();
    assert_eq!(s.crimes_of_w1(), [CrimeKind::Attack]);
}

#[test]
fn a_thief_of_another_realm_only_is_still_a_crime() {
    let mut s = setup();
    s.steal_from("s3");
    s.put_x1(12.0, 8.0);
    s.strike();
    assert_eq!(s.crimes_of_w1(), [CrimeKind::Attack]);
}

#[test]
fn a_known_thief_outside_the_area_is_still_a_crime() {
    let mut s = setup();
    s.steal();
    s.put_x1(60.0, 60.0);
    s.strike();
    assert_eq!(s.crimes_of_w1(), [CrimeKind::Attack]);
}

#[test]
fn a_peaceful_passer_by_is_still_a_crime_armed_or_not() {
    let mut s = setup();
    s.put_x1(12.0, 8.0);
    s.strike();
    assert_eq!(s.crimes_of_w1(), [CrimeKind::Attack]);
    let mut t = setup();
    t.r_mut("x1").carried = Stock::new();
    t.put_x1(12.0, 8.0);
    t.strike();
    assert_eq!(t.crimes_of_w1(), [CrimeKind::Attack]);
}

#[test]
fn someone_occupying_the_town_hall_costs_nothing() {
    let mut s = setup();
    on_hall(&mut s);
    s.tick();
    let occupation = serde_json::to_value(&s.city().occupation).unwrap();
    assert_eq!(occupation["realmId"], "r2");
    s.strike();
    assert_eq!(s.crimes_of_w1(), []);
}

#[test]
fn stays_so_once_a_defender_on_the_hall_has_broken_the_occupation() {
    let mut s = setup();
    on_hall(&mut s);
    s.tick();
    let (x, y) = (s.x1().x, s.x1().y);
    let mut w2 = new_r("w2", 5.0, "r1", x, y);
    w2.carried = Stock::from([(Good::Spear, 1.0)]);
    w2.alarm_script_id = Some(from(json!("none")));
    s.world.residents.push(w2);
    s.tick();
    assert_eq!(s.city().occupation, None);
    s.strike();
    assert_eq!(s.crimes_of_w1(), []);
}

#[test]
fn one_of_theirs_off_the_hall_isnt_occupying_nor_is_someone_unarmed_on_it() {
    let mut s = setup();
    s.put_x1(12.0, 8.0);
    let mut on = new_r("x2", 5.0, "r2", 9.0, 3.0);
    on.carried = Stock::from([(Good::Sword, 1.0)]);
    s.world.residents.push(on);
    s.tick();
    let occupation = serde_json::to_value(&s.city().occupation).unwrap();
    assert_eq!(occupation["realmId"], "r2");
    s.strike();
    assert_eq!(s.crimes_of_w1(), [CrimeKind::Attack]);
    let mut t = setup();
    on_hall(&mut t);
    t.r_mut("x1").carried = Stock::new();
    t.strike();
    assert_eq!(t.crimes_of_w1(), [CrimeKind::Attack]);
}

#[test]
fn the_alarm_defaults_own_chase_costs_nothing() {
    let mut s = setup();
    s.steal();
    s.put_x1(12.0, 8.0);
    assert!(s.until(|s| s.x1().struck.is_some(), 200));
    assert_eq!(s.crimes_of_w1(), []);
}

// knownThief

/// A script that logs what `residents()` says of x1, and `me`'s own (`reader`).
fn reader() -> RunnableScript {
    RunnableScript {
        user_id: 7,
        name: "Eyes".into(),
        version: 1,
        follows_default: false,
        source: "for (r of residents()) { if (r.id == \"x1\") { log(\"x1 \" + r.knownThief) } }\nlog(\"me \" + me.knownThief)\nend()".into(),
        task: None,
    }
}

fn asked() -> Setup {
    let mut s = setup_with(HashMap::from([(750, reader())]));
    s.r_mut("w1").alarm_script_id = Some(from(json!("none")));
    s
}

fn ask(s: &mut Setup) -> Vec<String> {
    s.give(json!({ "kind": "runScript", "scriptId": 750 }));
    s.tick();
    logged(s.w1())
}

#[test]
fn is_documented_in_the_view_scripts_read() {
    let resident = SCRIPT_VIEWS.iter().find(|v| v.name == "resident").unwrap();
    assert!(resident.fields.iter().any(|f| f.name == "knownThief"));
}

#[test]
fn says_yes_of_a_thief_one_of_my_residents_saw() {
    let mut s = asked();
    s.steal();
    assert!(ask(&mut s).contains(&"x1 true".to_string()));
}

#[test]
fn says_no_of_someone_who_stole_unseen_by_mine() {
    let mut s = asked();
    s.put_w1(200.0, 100.0);
    s.steal();
    s.put_w1(6.0, 6.0);
    assert!(ask(&mut s).contains(&"x1 false".to_string()));
}

#[test]
fn says_no_of_a_thief_who_stole_only_from_someone_else_seen_or_not() {
    let mut s = asked();
    s.steal_from("s3");
    let crime = s.crime(0);
    assert_eq!(
        (crime["victimOrg"].clone(), crime["witnesses"].clone()),
        (json!("r3"), json!(["w1"]))
    );
    assert!(ask(&mut s).contains(&"x1 false".to_string()));
}

#[test]
fn says_no_of_someone_who_has_stolen_nothing_and_is_there_only_for_those_in_residents() {
    let mut s = asked();
    s.put_x1(12.0, 8.0);
    let said = ask(&mut s);
    assert!(said.contains(&"x1 false".to_string()), "{said:?}");
    assert!(said.contains(&"me null".to_string()), "{said:?}");
}

// invariants (ADR 0004)

#[test]
fn flags_an_alarm_script_about_the_one_running_it() {
    let mut s = setup();
    let w1 = s.r_mut("w1");
    w1.script = Some(from(json!({
        "scriptId": 0, "task": "alarm", "memory": {},
        "alarm": { "kind": "theft", "cityId": "c1", "about": "w1", "realmId": "r1", "x": 14, "y": 9, "tick": 0 },
    })));
    w1.interrupted = Some(from(json!({ "order": null })));
    let broken = alarms_sound(&s.world);
    assert_eq!(broken.len(), 1, "{broken:?}");
    assert_eq!(broken[0].invariant, "alarms-sound");
    assert_eq!(broken[0].entity_ids, ["w1"]);
}
