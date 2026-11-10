//! `apps/server/src/trade-org-wrecks.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{TRADE_ORG_ARMY, WORKPLACE_MAX_WORKERS};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    CrimeKind, Debt, DebtStep, Good, PunishedWhat, PunishedWhere, PunishmentEnd, PunishmentHeading,
    Resident, Stock, WorldState,
};
use serde_json::{json, Value};

use super::*;
use crate::combat::attack_order;
use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::names::held_in;
use crate::queries::warehouse::warehouse_keeps;
use crate::queries::warehouse_trade::debt_of;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::trade_org_punishment::step_punishments;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const SIZE: i32 = 640;
/// Where the HQ's town hall stands, and Ashford's.
const MID: f64 = 320.0;
const ASHFORD: (f64, f64) = (MID, MID + 88.0);

fn farm() -> f64 {
    WORKPLACE_WRECK_WORTH.get("farm").unwrap()
}

fn smelter() -> f64 {
    WORKPLACE_WRECK_WORTH.get("smelter").unwrap()
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    hq: String,
    queue: OrderQueue,
    walking: Walking,
    scratch: Scratch,
}

fn person(world: &mut WorldState, id: &str, owner: &str, city: &str, x: f64, y: f64) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner: Some(owner), city_id: Some(city), x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

fn order_of(v: Value) -> ResidentOrder {
    serde_json::from_value(v).unwrap()
}

/// The resident works the workplace where they stand.
fn work(r: &mut Resident, building_id: &str) {
    r.order = Some(order_of(json!({
        "kind": "workAt", "buildingId": building_id, "at": { "x": r.x, "y": r.y }, "progress": 0
    })));
}

fn add(world: &mut WorldState, id: &str, kind: &str, city: Option<&str>, x: f64, y: f64) {
    world.buildings.push(
        serde_json::from_value(json!({ "id": id, "kind": kind, "cityId": city, "x": x, "y": y }))
            .unwrap(),
    );
}

/// The Trade Org HQ; realm r1 (Player 7, Leader a1) with city c1, Ashford, owing `owed`: a storage
/// s1 and a house h1, its farm f1 and further off its farm f3, and smelter m1, which its resident
/// w1 works. Nearby are realm r2's city c2 with its farm f2 and an idle smelter i1 nobody works.
fn setup(owed: f64) -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, MID as i32, MID as i32, &mut || m.next());
    for (id, user, leader) in [("r1", 7, "a1"), ("r2", 8, "z1")] {
        world.realms.push(
            serde_json::from_value(json!({ "id": id, "userId": user, "leaderId": leader }))
                .unwrap(),
        );
    }
    add_city(&mut world, "c1", Some("r1"), ASHFORD.0, ASHFORD.1, None);
    add_city(&mut world, "c2", Some("r2"), MID + 60.0, MID + 88.0, None);
    world.cities.iter_mut().find(|c| c.id == "c2").unwrap().name = "Farhold".into();
    let (x, y) = ASHFORD;
    add(&mut world, "s1", "storage", Some("c1"), x + 4.0, y);
    world.buildings.last_mut().unwrap().stock =
        Some([(Good::Coins, 500.0), (Good::Iron, 40.0)].into_iter().collect());
    add(&mut world, "h1", "house", Some("c1"), x - 4.0, y);
    add(&mut world, "f1", "farm", Some("c1"), x, y + 6.0);
    add(&mut world, "m1", "smelter", None, x + 10.0, y + 10.0);
    add(&mut world, "f3", "farm", Some("c1"), x - 20.0, y + 20.0);
    add(&mut world, "f2", "farm", Some("c2"), MID + 60.0, y + 6.0);
    add(&mut world, "i1", "smelter", None, x + 14.0, y - 8.0);
    person(&mut world, "a1", "r1", "c1", x - 4.0, y + 4.0);
    let w1 = person(&mut world, "w1", "r1", "c1", x + 10.0, y + 10.0);
    work(&mut world.residents[w1], "m1");
    person(&mut world, "z1", "r2", "c2", MID + 60.0, y + 3.0);
    let soldiers: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            world.residents[i].owner.is_none()
                && world.residents[i].city_id.as_deref() == Some(hq.as_str())
        })
        .take(TRADE_ORG_ARMY.guard as usize + 4)
        .collect();
    for i in soldiers {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    world.debts.push(Debt {
        org: "r1".into(),
        coins: owed,
        step: Some(DebtStep::Wrecks),
        deadline: None,
        trips: None,
        city_id: Some("c1".into()),
    });
    let shared = Arc::new(terrain.clone());
    Setup {
        world,
        terrain,
        hq,
        queue: OrderQueue::new(order_kinds(), Some(shared.clone())),
        walking: Walking::new(shared),
        scratch: Scratch::default(),
    }
}

fn c1(world: &WorldState) -> City {
    world.cities.iter().find(|c| c.id == "c1").unwrap().clone()
}

fn res<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

/// Sends out the army for the debt and stands it in the city. Returns its id.
fn army_in_the_city(world: &mut WorldState) -> String {
    step_punishments(world, SIZE);
    let hall = town_hall_of(world, &c1(world)).unwrap();
    let (hx, hy) = (hall.x, hall.y);
    let ids: Vec<String> =
        world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    for (mi, id) in ids.iter().enumerate() {
        let r = res(world, id);
        r.x = hx;
        r.y = hy;
        world.punishments[0].members[mi].packed = Some(true);
    }
    world.punishments[0].id.clone()
}

/// Steps the world, keeping everyone fed, with every invariant checked now and then.
fn run(s: &mut Setup, ticks: usize, until: &dyn Fn(&WorldState) -> bool) {
    for i in 0..ticks {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
        if i % 50 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), vec![]);
        }
        if until(&s.world) {
            break;
        }
    }
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

fn never(_: &WorldState) -> bool {
    false
}

fn standing(world: &WorldState, id: &str) -> bool {
    world.buildings.iter().any(|b| b.id == id)
}

fn wrecked(world: &WorldState) -> Vec<&RealmEventWhat> {
    world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::Wrecked { .. }))
        .collect()
}

fn punished(world: &WorldState) -> Vec<&RealmEventWhat> {
    world
        .events
        .iter()
        .map(|e| &e.what)
        .filter(|w| matches!(w, RealmEventWhat::Punished { .. }))
        .collect()
}

fn last_punished(world: &WorldState) -> &RealmEventWhat {
    punished(world).into_iter().last().unwrap()
}

fn heading(world: &WorldState, id: &str) -> Option<PunishmentHeading> {
    world.punishments.iter().find(|p| p.id == id).map(|p| p.heading)
}

fn heads_home(id: &str) -> impl Fn(&WorldState) -> bool + '_ {
    move |w| heading(w, id) == Some(PunishmentHeading::Home)
}

fn ids(list: Vec<usize>, world: &WorldState) -> Vec<String> {
    list.into_iter().map(|i| world.buildings[i].id.clone()).collect()
}

// its worth

#[test]
fn is_set_for_every_kind_of_workplace() {
    let mut worth: Vec<&str> = WORKPLACE_WRECK_WORTH.0.iter().map(|(k, _)| *k).collect();
    let mut workers: Vec<&str> = WORKPLACE_MAX_WORKERS.0.iter().map(|(k, _)| *k).collect();
    worth.sort();
    workers.sort();
    assert_eq!(worth, workers);
    assert!(WORKPLACE_WRECK_WORTH.0.iter().all(|(_, w)| *w > 0.0));
}

// its next army

#[test]
fn goes_only_at_the_step_wrecks_saying_so() {
    let mut s = setup(100.0);
    let tick = s.world.tick as f64;
    s.world.debts[0].step = Some(DebtStep::Demanded);
    s.world.debts[0].deadline = Some(tick + 1000.0);
    step_punishments(&mut s.world, SIZE);
    assert!(s.world.punishments.is_empty());
    s.world.debts[0].step = Some(DebtStep::Wrecks);
    s.world.debts[0].deadline = None;
    step_punishments(&mut s.world, SIZE);
    let p = &s.world.punishments[0];
    assert_eq!((p.culprit_org.as_str(), p.city_id.as_str(), p.worth), ("r1", "c1", 100.0));
    assert_eq!(p.wrecks, Some(vec![]));
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished { what: PunishedWhat::Coming, city, wrecks: Some(true), .. } if city == "Ashford"
    ));
}

#[test]
fn goes_to_the_city_the_debt_keeps_or_with_that_gone_to_their_city_nearest_the_hq() {
    let mut near = setup(100.0);
    add_city(&mut near.world, "c9", Some("r1"), MID, MID + 200.0, None);
    near.world.debts[0].city_id = Some("c9".into());
    step_punishments(&mut near.world, SIZE);
    assert_eq!(near.world.punishments[0].city_id, "c9");

    let mut gone = setup(100.0);
    add_city(&mut gone.world, "c9", Some("r1"), MID, MID + 200.0, None);
    gone.world.debts[0].city_id = Some("c0".into());
    step_punishments(&mut gone.world, SIZE);
    assert_eq!(gone.world.punishments[0].city_id, "c1");
}

#[test]
fn waits_for_a_spare_soldier() {
    let mut s = setup(100.0);
    let hq = s.hq.clone();
    for r in &mut s.world.residents {
        if r.city_id.as_deref() == Some(hq.as_str()) {
            r.carried.shift_remove(&Good::Spear);
        }
    }
    step_punishments(&mut s.world, SIZE);
    assert!(s.world.punishments.is_empty());
}

#[test]
fn goes_one_at_a_time_against_one_organization() {
    let mut s = setup(100.0);
    step_punishments(&mut s.world, SIZE);
    step_punishments(&mut s.world, SIZE);
    assert_eq!(s.world.punishments.len(), 1);
}

#[test]
fn leaves_no_debt_of_its_own_when_it_is_lost() {
    let mut s = setup(100.0);
    army_in_the_city(&mut s.world);
    step_punishments(&mut s.world, SIZE);
    let ids: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    for id in &ids {
        res(&mut s.world, id).health = 0.0;
    }
    step_punishments(&mut s.world, SIZE);
    assert!(s.world.punishments.is_empty());
    assert_eq!(debt_of(&s.world, "r1"), 100.0);
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::Lost,
            r#where: Some(PunishedWhere::AtCity),
            wrecks: Some(true),
            ..
        }
    ));
}

// the workplaces of a city

#[test]
fn are_those_on_its_books_and_those_its_residents_work() {
    let s = setup(100.0);
    let list = workplaces_of_city(&s.world, &c1(&s.world), SIZE);
    assert_eq!(ids(list, &s.world), ["f1", "m1", "f3"]);
}

#[test]
fn count_one_its_worker_is_away_from_carrying_by_the_work_defaults_memory() {
    let mut s = setup(100.0);
    let w1 = res(&mut s.world, "w1");
    w1.order = None;
    w1.script = Some(
        serde_json::from_value(json!({ "scriptId": 1, "memory": { "workplaceId": "i1" } }))
            .unwrap(),
    );
    let list = workplaces_of_city(&s.world, &c1(&s.world), SIZE);
    assert!(ids(list, &s.world).contains(&"i1".to_string()));
}

#[test]
fn leave_out_a_farm_of_theirs_someone_of_another_organization_works() {
    let mut s = setup(100.0);
    let z2 = person(&mut s.world, "z2", "r2", "c2", ASHFORD.0, ASHFORD.1 + 6.0);
    work(&mut s.world.residents[z2], "f1");
    let list = workplaces_of_city(&s.world, &c1(&s.world), SIZE);
    assert_eq!(ids(list, &s.world), ["m1", "f3"]);
}

#[test]
fn leave_out_a_farm_of_another_organization_its_residents_work() {
    let mut s = setup(100.0);
    let w1 = res(&mut s.world, "w1");
    w1.x = MID + 60.0;
    w1.y = ASHFORD.1 + 6.0;
    work(w1, "f2");
    let list = workplaces_of_city(&s.world, &c1(&s.world), SIZE);
    assert_eq!(ids(list, &s.world), ["f1", "f3"]);
}

#[test]
fn leave_out_a_site() {
    let mut s = setup(100.0);
    s.world.buildings.iter_mut().find(|b| b.id == "f1").unwrap().site =
        Some(serde_json::from_value(json!({ "delivered": {}, "work": 10 })).unwrap());
    let list = workplaces_of_city(&s.world, &c1(&s.world), SIZE);
    assert_eq!(ids(list, &s.world), ["m1", "f3"]);
}

// tearing down

#[test]
fn goes_on_until_the_debt_is_covered_and_then_it_goes_home() {
    let mut s = setup(farm() + 50.0);
    let p = army_in_the_city(&mut s.world);
    run(&mut s, 4000, &heads_home(&p));
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    // Nearest the town hall first; what they didn't need stays.
    assert!(!standing(&s.world, "f1"));
    assert!(!standing(&s.world, "m1"));
    assert!(standing(&s.world, "f3"));
    assert!(s.world.debts.is_empty());
    assert_eq!(s.world.punishments[0].took, farm() + 50.0);
    let w = wrecked(&s.world);
    assert_eq!(w.len(), 2);
    assert!(
        matches!(
            w[0],
            RealmEventWhat::Wrecked { building: BuildingKind::Farm, x, y, coins, owed, city, .. }
                if *x == ASHFORD.0 && *y == ASHFORD.1 + 6.0 && *coins == farm() && *owed == 50.0 && city == "Ashford"
        ),
        "{:?}",
        w[0]
    );
    assert!(
        matches!(
            w[1],
            RealmEventWhat::Wrecked { building: BuildingKind::Smelter, coins, owed, .. } if *coins == 50.0 && *owed == 0.0
        ),
        "{:?}",
        w[1]
    );
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::Left,
            why: Some(PunishmentEnd::Enough),
            wrecks: Some(true),
            ..
        }
    ));
    run(&mut s, 4000, &|w| w.punishments.is_empty());
    assert!(s.world.punishments.is_empty());
}

#[test]
fn tears_down_by_the_order_anyone_gives_and_takes_no_goods() {
    let mut s = setup(farm());
    let p = army_in_the_city(&mut s.world);
    let members: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    let tearing = |w: &WorldState| {
        w.residents.iter().position(|r| {
            matches!(r.order, Some(ResidentOrder::TearDown(_))) && members.contains(&r.id)
        })
    };
    run(&mut s, 4000, &|w| tearing(w).is_some());
    let r = &s.world.residents[tearing(&s.world).unwrap()];
    let want =
        order_of(json!({ "kind": "tearDown", "buildingId": "f1", "at": { "x": r.x, "y": r.y } }));
    assert_eq!(r.order, Some(want));
    run(&mut s, 4000, &heads_home(&p));
    let storage = s.world.buildings.iter().find(|b| b.id == "s1").unwrap();
    assert_eq!(held_in(storage.stock.as_ref(), Good::Coins), 500.0);
    assert_eq!(held_in(storage.stock.as_ref(), Good::Iron), 40.0);
    // Taking it down is a crime like anyone's, of no consequence to the debt.
    let crimes: Vec<_> = s.world.crimes.iter().filter(|c| c.kind == CrimeKind::TearDown).collect();
    assert_eq!(crimes.len(), 1);
    assert_eq!(
        (crimes[0].victim_org.as_str(), crimes[0].building),
        ("r1", Some(BuildingKind::Farm))
    );
}

#[test]
#[ignore = "5.8-6.5 s, over the 5 s limit: three workplaces torn down, then the next army (T86.14)"]
fn with_none_left_goes_home_with_the_debt_still_owed_and_comes_again() {
    let owed = 5000.0;
    let mut s = setup(owed);
    let p = army_in_the_city(&mut s.world);
    run(&mut s, 6000, &heads_home(&p));
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    for id in ["f1", "m1", "f3"] {
        assert!(!standing(&s.world, id));
    }
    let took = 2.0 * farm() + smelter();
    assert_eq!(debt_of(&s.world, "r1"), owed - took);
    assert_eq!(s.world.punishments[0].took, took);
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::Left,
            why: Some(PunishmentEnd::NoWorkplaces),
            took: Some(t),
            wrecks: Some(true),
            ..
        } if *t == took
    ));
    // It never touched anything but those: what isn't the culprit's workplaces still stands.
    for id in ["s1", "h1", "f2", "i1"] {
        assert!(standing(&s.world, id));
    }
    assert!(town_hall_of(&s.world, &c1(&s.world)).is_some());
    assert_eq!(wrecked(&s.world).len(), 3);
    let first = p.clone();
    run(&mut s, 4000, &move |w| w.punishments.iter().any(|x| x.id != first));
    assert!(s.world.punishments.iter().any(|x| x.id != p));
    let coming = punished(&s.world)
        .into_iter()
        .filter(|e| matches!(e, RealmEventWhat::Punished { what: PunishedWhat::Coming, .. }))
        .count();
    assert_eq!(coming, 2);
}

#[test]
fn goes_on_with_one_whose_workers_left_once_it_found_it() {
    let mut s = setup(5000.0);
    let p = army_in_the_city(&mut s.world);
    step_punishments(&mut s.world, SIZE);
    let wrecks = s.world.punishments[0].wrecks.clone();
    assert_eq!(wrecks, Some(vec!["f1".into(), "m1".into(), "f3".into()]));
    res(&mut s.world, "w1").order = None;
    run(&mut s, 6000, &heads_home(&p));
    assert!(!standing(&s.world, "m1"));
}

#[test]
fn leaves_one_that_someone_of_another_organization_has_taken_over() {
    let mut s = setup(5000.0);
    let p = army_in_the_city(&mut s.world);
    step_punishments(&mut s.world, SIZE);
    assert!(s.world.punishments[0].wrecks.as_ref().unwrap().contains(&"f3".to_string()));
    let z2 = person(&mut s.world, "z2", "r2", "c2", ASHFORD.0 - 20.0, ASHFORD.1 + 20.0);
    work(&mut s.world.residents[z2], "f3");
    s.world.buildings.iter_mut().find(|b| b.id == "f3").unwrap().city_id = None;
    run(&mut s, 6000, &heads_home(&p));
    assert!(standing(&s.world, "f3"));
    let wrecks = &s.world.punishments.iter().find(|x| x.id == p).unwrap().wrecks;
    assert!(!wrecks.as_ref().unwrap().contains(&"f3".to_string()));
}

#[test]
fn fights_those_who_resist_and_then_carries_on() {
    let mut s = setup(5000.0);
    army_in_the_city(&mut s.world);
    let ids: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    res(&mut s.world, "a1").order =
        Some(ResidentOrder::Attack(attack_order(&ids[0], false, false)));
    step_punishments(&mut s.world, SIZE);
    for id in &ids {
        let o = &res(&mut s.world, id).order;
        assert!(matches!(o, Some(ResidentOrder::Attack(a)) if a.target_id == "a1"), "{o:?}");
    }
    res(&mut s.world, "a1").order = None;
    for id in &ids {
        res(&mut s.world, id).order = None;
    }
    step_punishments(&mut s.world, SIZE);
    for id in &ids {
        let o = &res(&mut s.world, id).order;
        assert!(
            matches!(o, Some(ResidentOrder::WalkTo(_)) | Some(ResidentOrder::TearDown(_))),
            "{o:?}"
        );
    }
}

// paying while it is there

/// Mara's resident a1 on the HQ's coin warehouse with `coins`.
fn at_the_warehouse(world: &mut WorldState, coins: f64) {
    let w =
        world.buildings.iter().find(|b| warehouse_keeps(world, b).contains(&Good::Coins)).unwrap();
    let (x, y) = (w.x, w.y);
    let a1 = res(world, "a1");
    a1.x = x;
    a1.y = y;
    a1.carried = [(Good::Coins, coins)].into_iter().collect::<Stock>();
}

fn pay(s: &mut Setup, coins: f64) -> OrderReply {
    let said = s.queue.receive(
        &s.world,
        &OrderSender::player(7, "Mara"),
        &json!("q"),
        &json!({ "kind": "payDebt", "residentId": "a1", "coins": coins }),
    );
    s.queue.apply_all(&mut s.world);
    said
}

#[test]
fn in_full_stops_it_and_sends_it_home() {
    let mut s = setup(5000.0);
    let p = army_in_the_city(&mut s.world);
    run(&mut s, 4000, &|w| !wrecked(w).is_empty());
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Out));
    let owed = debt_of(&s.world, "r1");
    at_the_warehouse(&mut s.world, owed);
    assert!(matches!(pay(&mut s, owed), OrderReply::Ack { .. }));
    run(&mut s, 2, &heads_home(&p));
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    assert!(s.world.debts.is_empty());
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::Left,
            why: Some(PunishmentEnd::Paid),
            wrecks: Some(true),
            ..
        }
    ));
    let members: Vec<String> =
        s.world.punishments[0].members.iter().map(|m| m.resident_id.clone()).collect();
    for id in &members {
        assert!(!matches!(res(&mut s.world, id).order, Some(ResidentOrder::TearDown(_))));
    }
    let left = s.world.buildings.iter().filter(|b| b.id == "m1" || b.id == "f3").count();
    run(&mut s, 4000, &|w| w.punishments.is_empty());
    assert!(s.world.punishments.is_empty());
    assert_eq!(s.world.buildings.iter().filter(|b| b.id == "m1" || b.id == "f3").count(), left);
}

#[test]
fn in_part_only_lowers_what_it_counts_for() {
    let mut s = setup(5000.0);
    let p = army_in_the_city(&mut s.world);
    at_the_warehouse(&mut s.world, 4900.0);
    pay(&mut s, 4900.0);
    run(&mut s, 1, &never);
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Out));
    assert_eq!(debt_of(&s.world, "r1"), 100.0);
    run(&mut s, 4000, &heads_home(&p));
    // A hundred Coins take the one nearest farm and no more.
    assert!(!standing(&s.world, "f1"));
    assert!(standing(&s.world, "m1"));
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished { what: PunishedWhat::Left, why: Some(PunishmentEnd::Enough), .. }
    ));
}

#[test]
fn on_the_way_there_turns_it_back() {
    let mut s = setup(5000.0);
    step_punishments(&mut s.world, SIZE);
    let p = s.world.punishments[0].id.clone();
    at_the_warehouse(&mut s.world, 5000.0);
    pay(&mut s, 5000.0);
    run(&mut s, 2, &heads_home(&p));
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Home));
    assert!(matches!(
        last_punished(&s.world),
        RealmEventWhat::Punished {
            what: PunishedWhat::TurnedBack,
            why: Some(PunishmentEnd::Paid),
            ..
        }
    ));
    assert!(wrecked(&s.world).is_empty());
}

// the invariant

#[test]
fn holds_a_soldier_to_what_the_army_means_to_tear_down() {
    let mut s = setup(5000.0);
    let p = army_in_the_city(&mut s.world);
    step_punishments(&mut s.world, SIZE);
    assert_eq!(wrecks_sound(&s.world), vec![]);
    let rid = s.world.punishments[0].members[0].resident_id.clone();
    let r = res(&mut s.world, &rid);
    r.order = Some(order_of(
        json!({ "kind": "tearDown", "buildingId": "h1", "at": { "x": r.x, "y": r.y } }),
    ));
    let got = wrecks_sound(&s.world);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].invariant, "wrecks-sound");
    assert_eq!(got[0].entity_ids, vec![p, rid, "h1".to_string()]);
}

#[test]
fn holds_an_army_out_to_take_goods_to_tearing_down_nothing() {
    let mut s = setup(5000.0);
    army_in_the_city(&mut s.world);
    s.world.punishments[0].wrecks = None;
    let rid = s.world.punishments[0].members[0].resident_id.clone();
    let r = res(&mut s.world, &rid);
    r.order = Some(order_of(
        json!({ "kind": "tearDown", "buildingId": "f1", "at": { "x": r.x, "y": r.y } }),
    ));
    assert_eq!(wrecks_sound(&s.world).len(), 1);
}

#[test]
fn finds_what_is_no_workplace_on_its_list() {
    let mut s = setup(5000.0);
    army_in_the_city(&mut s.world);
    s.world.punishments[0].wrecks = Some(vec!["h1".into()]);
    assert_eq!(wrecks_sound(&s.world).len(), 1);
}

#[test]
fn catches_a_building_that_came_down_by_a_soldier_and_wasnt_the_culprits_workplace() {
    let mut s = setup(farm());
    let p = army_in_the_city(&mut s.world);
    run(&mut s, 4000, &|w| !wrecked(w).is_empty());
    assert_eq!(heading(&s.world, &p), Some(PunishmentHeading::Out));
    let record = with_wreck_records(&s.world, |r| r[0].clone());
    assert_eq!(record.building_id, "f1");
    assert!(record.listed);
    assert_eq!((record.org.as_deref(), record.culprit_org.as_str()), (Some("r1"), "r1"));
    assert_eq!(wrecks_sound(&s.world), vec![]);
    with_wreck_records(&s.world, |r| r[0].org = Some("r2".into()));
    assert_eq!(wrecks_sound(&s.world).len(), 1);
    with_wreck_records(&s.world, |r| {
        r[0].org = Some("r1".into());
        r[0].listed = false;
    });
    assert_eq!(wrecks_sound(&s.world).len(), 1);
    with_wreck_records(&s.world, |r| {
        r[0].listed = true;
        r[0].kind = BuildingKind::House;
    });
    assert_eq!(wrecks_sound(&s.world).len(), 1);
}
