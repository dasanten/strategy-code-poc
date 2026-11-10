//! `apps/server/src/stealing-horse.test.ts`, ported (T86.17, part 5): mounting another
//! organization's horse, hitching it to the realm's own carriage, driving off in another's
//! carriage (`CONTEXT.md`: Stealing a carriage or horse), and never by accident.

mod build_common;
mod scripts_common;

use std::sync::Arc;

use build_common::*;
use csp_shared::balance::{
    AVERAGE_HORSE_STATS, HORSE_STOLEN_WORTH, MAX_HEALTH, MAX_HUNGER, OWN_FOOD,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, Carriage, Good, Horse, HorseStats, Resident, Stock, WorldState,
};
use csp_sim::default_scripts::DEFAULT_SCRIPTS;
use csp_sim::events::events_for;
use csp_sim::order_sender::{Account, OrderSender};
use csp_sim::orders::order_kinds;
use csp_sim::queries::breeding::breeding_pair;
use csp_sim::queries::horses::HorseOwner;
use csp_sim::queues::{QueueHost, QueueRunner};
use csp_sim::tick::Scratch;
use csp_sim::trade_org_punishment::loss_of;
use scripts_common::{assert_matches, from};
use serde_json::{json, Value};

const SIZE: i32 = 256;

fn mara() -> OrderSender {
    player(7)
}

fn ovid() -> OrderSender {
    player(8)
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    orders: Orders,
}

/// Realm r1 (Player 7, Leader t1 at (20, 20)) and realm r2 (Player 8, Leader o1 at (40, 40)), and
/// at (20, 20) r2's free horse h2.
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = empty_world(&terrain);
    world.realms.push(realm("r1", 7, "t1"));
    world.realms.push(realm("r2", 8, "o1"));
    let mut s = Setup { world, terrain, orders: Orders::default() };
    s.person("t1", Some("r1"), 20.0, 20.0);
    s.person("o1", Some("r2"), 40.0, 40.0);
    s.horse_of("h2", Some("r2"), 20.0, 20.0);
    s
}

impl Setup {
    fn person(&mut self, id: &str, realm: Option<&str>, x: f64, y: f64) {
        let mut r = new_resident(id, realm, x, y);
        r.carried = Stock::from([(Good::Food, OWN_FOOD)]);
        self.world.residents.push(r);
    }

    fn horse_of(&mut self, id: &str, realm: Option<&str>, x: f64, y: f64) {
        self.world.horses.push(Horse {
            id: id.into(),
            realm_id: realm.map(str::to_string),
            city_id: None,
            x,
            y,
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

    fn carriage_of(&mut self, id: &str, realm: Option<&str>) {
        self.world.carriages.push(Carriage {
            id: id.into(),
            realm_id: realm.map(str::to_string),
            city_id: None,
            x: 20.0,
            y: 20.0,
            horse_id: None,
            load: Stock::new(),
        });
    }

    fn r(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    fn h(&mut self, id: &str) -> &mut Horse {
        self.world.horses.iter_mut().find(|h| h.id == id).unwrap()
    }

    fn k(&mut self, id: &str) -> &mut Carriage {
        self.world.carriages.iter_mut().find(|k| k.id == id).unwrap()
    }

    fn receive(&mut self, sender: &OrderSender, order: Value) -> Answer {
        self.orders.receive(&self.world, sender, order, &self.terrain)
    }

    fn apply(&mut self) {
        self.orders.apply_all(&mut self.world, &self.terrain);
    }

    fn mount(&mut self) -> Answer {
        self.mount_as("t1", "h2")
    }

    fn mount_as(&mut self, resident: &str, horse: &str) -> Answer {
        self.receive(&mara(), json!({ "kind": "mount", "residentId": resident, "horseId": horse }))
    }

    fn drive(&mut self, more: Value) -> Answer {
        self.drive_carriage("k1", more)
    }

    fn drive_carriage(&mut self, carriage: &str, more: Value) -> Answer {
        let mut order = json!({
            "kind": "drive", "residentId": "t1", "carriageId": carriage, "x": 25, "y": 20
        });
        if let Some(m) = more.as_object() {
            order.as_object_mut().unwrap().extend(m.clone());
        }
        self.receive(&mara(), order)
    }

    /// Steps the world with walking until the thief's order ends, every invariant holding on the
    /// way.
    fn until_thief_done(&mut self) {
        run_walking(&mut self.world, &self.terrain, 2000, |w| {
            w.residents.iter().find(|r| r.id == "t1").unwrap().order.is_none()
        });
    }

    fn logged(&self, user_id: u64, kind: &str) -> Vec<Value> {
        events_for(&self.world, user_id, 0)
            .into_iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|v| v["kind"] == kind)
            .collect()
    }

    fn crime(&self, i: usize) -> Value {
        serde_json::to_value(&self.world.crimes[i]).unwrap()
    }
}

fn ok() -> Answer {
    Ok(())
}

fn refused(reason: &str) -> Answer {
    Err(reason.to_string())
}

// mounting another organization's horse

#[test]
fn moves_it_to_the_thiefs_realm_and_commits_one_theft_and_they_ride_it() {
    let mut s = setup();
    assert_eq!(s.mount(), ok());
    // Nothing changes hands before the order is applied.
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
    s.apply();
    assert_eq!((s.h("h2").realm_id.clone(), s.h("h2").city_id.clone()), (Some("r1".into()), None));
    assert_eq!(s.r("t1").riding.as_deref(), Some("h2"));
    assert_eq!(s.world.crimes.len(), 1);
    assert_matches(
        &s.crime(0),
        json!({
            "kind": "theft", "victimOrg": "r2", "horse": "Horse h2",
            "culprit": { "residentId": "t1", "org": "r1" }
        }),
    );
    assert_eq!(s.world.crimes[0].carriage, None);
    assert_eq!(loss_of(&s.world.crimes[0]), HORSE_STOLEN_WORTH);
    assert_sound(&s.world, &s.terrain);
}

#[test]
fn rides_on_past_the_tick_step_riders_has_nothing_to_drop() {
    let mut s = setup();
    let _ = s.mount();
    s.apply();
    run_walking(&mut s.world, &s.terrain, 1, |_| false);
    assert_eq!(s.r("t1").riding.as_deref(), Some("h2"));
    assert_sound(&s.world, &s.terrain);
}

#[test]
fn tells_the_victim_at_once_it_is_gone_and_where_without_the_thief() {
    let mut s = setup();
    let _ = s.mount();
    s.apply();
    let gone = s.logged(8, "transportGone");
    assert_eq!(gone.len(), 1);
    assert_matches(&gone[0], json!({ "x": 20, "y": 20, "horse": "Horse h2" }));
    assert!(!serde_json::to_string(&gone).unwrap().contains("t1"));
    let taken = s.logged(7, "transportTaken");
    assert_eq!(taken.len(), 1);
    assert_matches(&taken[0], json!({ "residentId": "t1", "horse": "Horse h2" }));
    assert!(taken[0]["from"].is_string());
}

#[test]
fn is_refused_while_someone_rides_it_it_is_down_or_it_is_hitched() {
    let mut s = setup();
    s.person("o2", Some("r2"), 20.0, 20.0);
    s.r("o2").riding = Some("h2".into());
    assert_eq!(s.mount(), refused("someone else rides that horse"));
    s.r("o2").riding = None;
    let down = s.world.tick as f64 + 100.0;
    s.h("h2").down_until = Some(down);
    assert_eq!(s.mount(), refused("that horse is Down"));
    s.h("h2").down_until = None;
    s.carriage_of("k2", Some("r2"));
    s.k("k2").horse_id = Some("h2".into());
    assert_eq!(s.mount(), refused("that horse is hitched to a carriage"));
    assert!(s.world.crimes.is_empty());
}

#[test]
fn is_refused_while_guarded_and_allowed_when_an_armed_resident_of_the_thiefs_realm_is_there_too() {
    let mut s = setup();
    s.person("o2", Some("r2"), 20.0, 20.0);
    assert_eq!(s.mount(), ok());
    s.r("o2").carried.insert(Good::Spear, 1.0);
    assert_eq!(s.mount(), refused("an armed resident guards that horse"));
    s.person("t2", Some("r1"), 20.0, 20.0);
    s.r("t2").carried.insert(Good::Sword, 1.0);
    assert_eq!(s.mount(), ok());
    s.r("t2").carried = Stock::new();
    s.r("t1").carried.insert(Good::Spear, 1.0);
    assert_eq!(s.mount(), ok());
}

#[test]
fn needs_a_grown_resident_on_its_tile_on_foot() {
    let mut s = setup();
    s.person("c1", Some("r1"), 20.0, 20.0);
    s.r("c1").born_at = s.world.tick as f64;
    assert_eq!(s.mount_as("c1", "h2"), refused("children can’t steal"));
    s.r("t1").x = 21.0;
    assert_eq!(s.mount(), refused("that horse is not on the resident’s tile"));
    s.r("t1").x = 20.0;
    s.horse_of("h1", Some("r1"), 20.0, 20.0);
    s.r("t1").riding = Some("h1".into());
    assert_eq!(s.mount(), refused("already riding another horse"));
}

#[test]
fn lets_the_first_of_two_thieves_in_a_tick_have_it() {
    let mut s = setup();
    s.person("t2", Some("r1"), 20.0, 20.0);
    let _ = s.mount();
    let _ = s.mount_as("t2", "h2");
    s.apply();
    assert_eq!(s.r("t1").riding.as_deref(), Some("h2"));
    assert_eq!(s.r("t2").riding, None);
    assert_eq!(s.world.crimes.len(), 1);
}

#[test]
fn takes_a_horse_in_its_owners_stable_a_stable_doesnt_protect_it() {
    let mut s = setup();
    let mut st = building("st", BuildingKind::Stable, 20.0, 20.0);
    st.realm_id = Some("r2".into());
    st.stock = Some(Stock::new());
    s.world.buildings.push(st);
    assert_eq!(s.mount(), ok());
    s.apply();
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r1"));
    assert_eq!(s.r("t1").riding.as_deref(), Some("h2"));
}

#[test]
fn takes_a_horse_of_nobody_with_no_crime_and_no_one_to_tell() {
    let mut s = setup();
    s.h("h2").realm_id = None;
    assert_eq!(s.mount(), ok());
    s.apply();
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r1"));
    assert!(s.world.crimes.is_empty());
    assert!(s.logged(8, "transportGone").is_empty());
    let taken = s.logged(7, "transportTaken");
    assert_eq!(taken.len(), 1);
    assert!(taken[0]["from"].is_null());
}

#[test]
fn takes_an_npc_citys_horse_from_the_city_and_its_armed_residents_guard_it() {
    let mut s = setup();
    s.h("h2").realm_id = None;
    s.h("h2").city_id = Some("n1".into());
    s.person("n2", None, 20.0, 20.0);
    s.r("n2").city_id = Some("n1".into());
    s.r("n2").carried.insert(Good::Spear, 1.0);
    assert_eq!(s.mount(), refused("an armed resident guards that horse"));
    s.r("n2").carried = Stock::new();
    assert_eq!(s.mount(), ok());
    s.apply();
    assert_eq!((s.h("h2").realm_id.clone(), s.h("h2").city_id.clone()), (Some("r1".into()), None));
    assert_matches(&s.crime(0), json!({ "victimOrg": "n1" }));
}

#[test]
fn lets_nobody_steal_to_ride_for_a_realm_they_are_only_on_loan_to() {
    let mut s = setup();
    s.person("m1", None, 20.0, 20.0);
    s.r("m1").city_id = Some("n1".into());
    s.world.contracts.push(from(json!({
        "id": "c1", "lenderId": "n1", "hirerId": "r1", "offeredBy": "lender",
        "residentIds": ["m1"], "days": 7, "pricePerWeek": 0, "storageId": "",
        "startedAt": 0, "paidWeeks": 0
    })));
    assert_eq!(s.mount_as("m1", "h2"), refused("not a horse of your realm"));
}

#[test]
fn is_no_theft_for_the_horses_own_realm() {
    let mut s = setup();
    s.person("o2", Some("r2"), 20.0, 20.0);
    // r2's own Player mounting their own horse is no theft.
    let answer =
        s.receive(&ovid(), json!({ "kind": "mount", "residentId": "o2", "horseId": "h2" }));
    assert_eq!(answer, ok());
    s.apply();
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
    assert!(s.world.crimes.is_empty());
}

// hitching another organization's horse to the realm's own carriage

#[test]
fn steals_the_horse_the_order_names_hitches_it_and_commits_one_theft() {
    let mut s = setup();
    s.carriage_of("k1", Some("r1"));
    assert_eq!(s.drive(json!({ "horseId": "h2" })), ok());
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
    s.apply();
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r1"));
    assert_eq!(s.k("k1").horse_id.as_deref(), Some("h2"));
    assert_matches(
        &scripts_common::order_json(s.r("t1")),
        json!({ "kind": "drive", "carriageId": "k1" }),
    );
    assert_eq!(s.world.crimes.len(), 1);
    assert_matches(&s.crime(0), json!({ "victimOrg": "r2", "horse": "Horse h2" }));
    assert_eq!(s.world.crimes[0].carriage, None);
    assert_eq!(s.logged(8, "transportGone").len(), 1);
    s.until_thief_done();
    let k = s.k("k1").clone();
    assert_eq!((k.x, k.y, k.horse_id.as_deref()), (25.0, 20.0, Some("h2")));
}

#[test]
fn hitches_a_horse_of_the_drivers_own_first_stealing_nothing() {
    let mut s = setup();
    s.carriage_of("k1", Some("r1"));
    s.horse_of("h1", Some("r1"), 20.0, 20.0);
    assert_eq!(s.drive(json!({ "horseId": "h2" })), ok());
    s.apply();
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
    assert!(s.world.crimes.is_empty());
    s.until_thief_done();
    assert_eq!(s.k("k1").horse_id.as_deref(), Some("h1"));
}

#[test]
fn never_steals_with_a_drive_that_names_no_horse() {
    let mut s = setup();
    s.carriage_of("k1", Some("r1"));
    assert_eq!(s.drive(json!({})), refused("no horse here to pull that carriage"));
    s.apply();
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
    assert!(s.world.crimes.is_empty());
}

#[test]
fn hitching_is_refused_while_the_horse_is_ridden_down_or_guarded() {
    let mut s = setup();
    s.carriage_of("k1", Some("r1"));
    let named = || json!({ "horseId": "h2" });
    let no_horse = "no horse here to pull that carriage";
    s.person("o2", Some("r2"), 20.0, 20.0);
    s.r("o2").riding = Some("h2".into());
    assert_eq!(s.drive(named()), refused(no_horse));
    s.r("o2").riding = None;
    let down = s.world.tick as f64 + 100.0;
    s.h("h2").down_until = Some(down);
    assert_eq!(s.drive(named()), refused(no_horse));
    s.h("h2").down_until = None;
    s.r("o2").carried.insert(Good::Spear, 1.0);
    assert_eq!(s.drive(named()), refused("an armed resident guards that horse"));
    s.r("o2").carried = Stock::new();
    assert_eq!(s.drive(named()), ok());
    assert!(s.world.crimes.is_empty());
}

#[test]
fn never_takes_a_horse_for_a_carriage_the_realm_only_commands() {
    let mut s = setup();
    s.carriage_of("k1", Some("r3"));
    s.world.alliances.push(from(json!({
        "id": "a1", "name": "A", "leaderId": "r1", "members": [], "invites": [],
        "army": [{ "is": "carriage", "id": "k1", "recallAt": null }]
    })));
    assert_eq!(s.drive(json!({ "horseId": "h2" })), refused("no horse here to pull that carriage"));
    s.apply();
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
}

// driving off in another organization's carriage with none hitched

#[test]
fn steals_its_owners_free_horse_with_it_as_one_theft() {
    let mut s = setup();
    s.carriage_of("k2", Some("r2"));
    assert_eq!(s.drive_carriage("k2", json!({})), ok());
    s.apply();
    let k = s.k("k2").clone();
    assert_eq!((k.realm_id.as_deref(), k.horse_id.as_deref()), (Some("r1"), Some("h2")));
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r1"));
    assert_eq!(s.world.crimes.len(), 1);
    assert_matches(
        &s.crime(0),
        json!({ "carriage": true, "horse": "Horse h2", "victimOrg": "r2" }),
    );
    assert_sound(&s.world, &s.terrain);
}

#[test]
fn makes_a_third_organizations_horse_a_theft_of_its_own() {
    let mut s = setup();
    s.carriage_of("k3", Some("r3"));
    s.world.realms.push(realm("r3", 9, "o3"));
    s.person("o3", Some("r3"), 60.0, 60.0);
    assert_eq!(s.drive_carriage("k3", json!({})), ok());
    s.apply();
    let k = s.k("k3").clone();
    assert_eq!((k.realm_id.as_deref(), k.horse_id.as_deref()), (Some("r1"), Some("h2")));
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r1"));
    assert_eq!(s.world.crimes.len(), 2);
    let mut victims: Vec<&str> = s.world.crimes.iter().map(|c| c.victim_org.as_str()).collect();
    victims.sort();
    assert_eq!(victims, vec!["r2", "r3"]);
    assert_sound(&s.world, &s.terrain);
}

#[test]
fn prefers_a_horse_of_the_thiefs_own_and_one_it_can_take_over_a_guarded_one() {
    let mut s = setup();
    s.carriage_of("k3", Some("r3"));
    s.person("o2", Some("r2"), 20.0, 20.0);
    s.r("o2").carried.insert(Good::Spear, 1.0);
    s.horse_of("h3", Some("r3"), 20.0, 20.0);
    assert_eq!(s.drive_carriage("k3", json!({})), ok());
    s.apply();
    assert_eq!(s.k("k3").horse_id.as_deref(), Some("h3"));
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));

    let mut fresh = setup();
    fresh.carriage_of("k2", Some("r2"));
    fresh.horse_of("h1", Some("r1"), 20.0, 20.0);
    let _ = fresh.drive_carriage("k2", json!({}));
    fresh.apply();
    assert_eq!(fresh.h("h2").realm_id.as_deref(), Some("r2"));
    assert_eq!(fresh.k("k2").horse_id, None);
    fresh.until_thief_done();
    assert_eq!(fresh.k("k2").horse_id.as_deref(), Some("h1"));
}

// never by accident

#[test]
fn has_no_default_script_mount_or_drive_anything_so_none_can_steal() {
    for (_, _, source) in DEFAULT_SCRIPTS.iter() {
        for word in ["mount", "drive"] {
            let call = format!("{word}(");
            let found = source.match_indices(&call).any(|(i, _)| {
                !source[..i].chars().next_back().is_some_and(|c| c.is_alphanumeric() || c == '_')
            });
            assert!(!found, "a default script calls {call}");
        }
    }
}

#[test]
fn has_breed_horses_pick_only_the_realms_own_in_a_stable() {
    let mut s = setup();
    let stable = building("st", BuildingKind::Stable, 20.0, 20.0);
    s.horse_of("h3", Some("r2"), 20.0, 20.0);
    let owner = HorseOwner::Realm("r1");
    assert!(breeding_pair(&s.world, &stable, owner, None).is_none());
    s.horse_of("h4", Some("r1"), 20.0, 20.0);
    assert!(breeding_pair(&s.world, &stable, owner, None).is_none());
    s.horse_of("h5", Some("r1"), 20.0, 20.0);
    let pair = breeding_pair(&s.world, &stable, owner, None).unwrap();
    assert_eq!([pair[0].id.as_str(), pair[1].id.as_str()], ["h4", "h5"]);
}

#[test]
fn refuses_another_realms_horse_in_a_queue_for_mounting_or_hitching() {
    let mut s = setup();
    s.carriage_of("k1", Some("r1"));
    let queue = |order: Value| json!({ "kind": "queue", "residentId": "t1", "steps": [{ "order": order }] });
    assert_eq!(
        s.receive(&mara(), queue(json!({ "kind": "mount", "horseId": "h2" }))),
        refused("step 1: not a horse of your realm")
    );
    assert_eq!(
        s.receive(
            &mara(),
            queue(
                json!({ "kind": "drive", "carriageId": "k1", "x": 25, "y": 20, "horseId": "h2" })
            )
        ),
        refused("step 1: not a horse of your realm")
    );
}

struct Mara;

impl QueueHost for Mara {
    fn sender(&self, user_id: u64) -> Option<OrderSender> {
        (user_id == 7).then(mara)
    }
}

#[test]
fn skips_a_step_whose_horse_was_stolen_since_it_doesnt_steal_it_back() {
    let mut s = setup();
    s.h("h2").realm_id = Some("r1".into());
    let queue = json!({
        "kind": "queue", "residentId": "t1", "steps": [{ "order": { "kind": "mount", "horseId": "h2" } }]
    });
    assert_eq!(s.receive(&mara(), queue), ok());
    s.apply();
    s.h("h2").realm_id = Some("r2".into());
    let mut runner =
        QueueRunner::new(Box::new(Mara), order_kinds(), Some(Arc::new(s.terrain.clone())));
    runner.run_all(&mut s.world, &mut Scratch::default());
    assert_eq!(s.r("t1").riding, None);
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
    assert!(s.world.crimes.is_empty());
}

#[test]
fn has_an_npc_citys_resident_ride_only_the_citys() {
    let mut s = setup();
    s.person("n2", None, 20.0, 20.0);
    s.r("n2").city_id = Some("n1".into());
    let sender = OrderSender {
        user_id: 0,
        account: Account { name: "n1".into(), is_admin: false },
        npc_city_id: Some("n1".into()),
    };
    let answer =
        s.receive(&sender, json!({ "kind": "mount", "residentId": "n2", "horseId": "h2" }));
    assert_eq!(answer, refused("not a horse of your realm"));
    assert_eq!(s.h("h2").realm_id.as_deref(), Some("r2"));
}

// the invariants

#[test]
fn the_invariants_catch_someone_riding_a_horse_of_another_organization() {
    let mut s = setup();
    s.r("t1").riding = Some("h2".into());
    let riders = csp_sim::invariants::world_invariants()
        .into_iter()
        .find(|i| i.name == "riders-on-horses")
        .unwrap();
    let found = riders.check(&s.world, &s.terrain);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].entity_ids, vec!["t1".to_string(), "h2".to_string()]);
    s.h("h2").realm_id = Some("r1".into());
    assert!(riders.check(&s.world, &s.terrain).is_empty());
}
