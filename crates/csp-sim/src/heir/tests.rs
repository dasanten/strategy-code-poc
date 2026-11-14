//! Naming an heir (T103.1, `CONTEXT.md`: Heir): who qualifies, replacing and clearing, when the
//! heir lapses, the invariant, and the game API.

use std::sync::Arc;

use csp_shared::world::{
    Alliance, DeathCause, HeirLapse, MercenaryContract, RealmEventWhat, WorldState,
};
use serde_json::json;

use super::*;
use crate::game_test_world::{player, run_script};
use crate::leader::{apply_hand_over, HandOverRequest};
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::city::town_hall_of;
use crate::script_api::{Is, SCRIPT_API};
use crate::starting_city::found_starting_city;
use crate::survival::die_all;
use crate::test_world::{city_terrain, live, live_mut};
use crate::tick::Scratch;
use crate::world::{create_world, step_world};

const MARA: u64 = 1;
const TOBIN: u64 = 2;

/// Mara's and Tobin's starting cities; `heir` and `other` are grown residents of Mara's who
/// aren't her Leader, standing far from her Leader.
struct Setup {
    world: WorldState,
    realm: String,
    tobin: String,
    leader: String,
    heir: String,
    other: String,
}

fn setup() -> Setup {
    let terrain = city_terrain();
    let mut world = create_world(terrain, 1);
    found_starting_city(&mut world, terrain, MARA, None);
    found_starting_city(&mut world, terrain, TOBIN, None);
    let realm = world.realms.iter().find(|r| r.user_id == MARA).unwrap().clone();
    let tobin = world.realms.iter().find(|r| r.user_id == TOBIN).unwrap().id.clone();
    let leader = realm.leader_id.clone();
    let grown: Vec<String> = world
        .residents
        .iter()
        .filter(|r| {
            r.owner.as_deref() == Some(realm.id.as_str())
                && r.id != leader
                && can_work(r.born_at, world.tick as f64)
        })
        .map(|r| r.id.clone())
        .collect();
    let city = world
        .cities
        .iter()
        .find(|c| c.realm_id.as_deref() == Some(realm.id.as_str()))
        .unwrap()
        .clone();
    let hall = town_hall_of(&world, &city).unwrap().clone();
    // Naming is from anywhere: the heir stands out in the field.
    let size = f64::from(terrain.size);
    for id in &grown[..2] {
        let r = live_mut(&mut world, id);
        r.x = (hall.x + 40.0) % size;
        r.y = hall.y;
        r.order = None;
    }
    Setup { world, realm: realm.id, tobin, leader, heir: grown[0].clone(), other: grown[1].clone() }
}

/// Mara's resident `asker` names `heir`: "ok" or the reason it was refused.
fn name_heir(world: &mut WorldState, asker: &str, heir: &str) -> String {
    let o = HeirRequest { resident_id: Some(asker), heir_id: Some(heir) };
    if let Some(reason) = validate_name_heir(world, MARA, &o) {
        return reason;
    }
    apply_name_heir(world, MARA, &o);
    "ok".into()
}

fn heir_of(world: &WorldState, realm: &str) -> Option<String> {
    world.realms.iter().find(|r| r.id == realm).unwrap().heir_id.clone()
}

fn name(world: &WorldState, id: &str) -> String {
    live(world, id).unwrap().name.clone()
}

fn last_lapse(world: &WorldState) -> Option<RealmEventWhat> {
    world
        .events
        .iter()
        .rev()
        .find(|e| e.user_id == MARA && matches!(e.what, RealmEventWhat::HeirLapsed { .. }))
        .map(|e| e.what.clone())
}

fn lapsed(heir_id: &str, heir: &str, why: HeirLapse) -> Option<RealmEventWhat> {
    Some(RealmEventWhat::HeirLapsed { heir_id: heir_id.into(), heir: heir.into(), why })
}

fn contract(world: &mut WorldState, r: &str, lender: &str, hirer: &str, started: bool) {
    let storage = world
        .buildings
        .iter()
        .find(|b| b.kind == csp_shared::world::BuildingKind::Storage)
        .unwrap()
        .id
        .clone();
    let c: MercenaryContract = serde_json::from_value(json!({
        "id": format!("contract-{r}"), "lenderId": lender, "hirerId": hirer, "offeredBy": "lender",
        "residentIds": [r], "days": 5, "pricePerWeek": 3, "storageId": storage,
        "startedAt": if started { Some(world.tick) } else { None }, "paidWeeks": 0
    }))
    .unwrap();
    world.contracts.push(c);
}

fn alliance(realm: &str, army: &[&str]) -> Alliance {
    serde_json::from_value(json!({
        "id": "alliance1", "name": "North", "leaderId": realm,
        "members": [{ "realmId": realm, "joinedAt": 0, "leaving": null }], "invites": [],
        "army": army.iter().map(|id| json!({ "is": "resident", "id": id, "recallAt": null })).collect::<Vec<_>>()
    }))
    .unwrap()
}

#[test]
fn names_an_adult_of_the_realm_from_anywhere_and_a_second_replaces_the_first() {
    let Setup { mut world, realm, leader, heir, other, .. } = setup();
    assert_eq!(heir_of(&world, &realm), None);
    // Any resident of the realm may ask, as for renaming; the heir need not stand by the Leader.
    assert_eq!(name_heir(&mut world, &other, &heir), "ok");
    assert_eq!(heir_of(&world, &realm), Some(heir.clone()));
    assert!(heirs_qualify(&world).is_empty());
    assert_eq!(name_heir(&mut world, &leader, &other), "ok");
    assert_eq!(heir_of(&world, &realm), Some(other));
    // Replacing is no lapse.
    assert_eq!(last_lapse(&world), None);
}

#[test]
fn refuses_a_child_the_leader_a_lent_or_offered_soldier_and_one_in_the_alliance_army() {
    let Setup { mut world, realm, tobin, leader, heir, other } = setup();
    let n = name(&world, &heir);
    assert_eq!(
        name_heir(&mut world, &other, &leader),
        format!("{} is your Leader", name(&world, &leader))
    );
    let born = live(&world, &heir).unwrap().born_at;
    let tick = world.tick as f64;
    live_mut(&mut world, &heir).born_at = tick;
    assert_eq!(name_heir(&mut world, &leader, &heir), format!("{n} is a child"));
    live_mut(&mut world, &heir).born_at = born;
    contract(&mut world, &heir, &realm, &tobin, true);
    assert_eq!(name_heir(&mut world, &leader, &heir), format!("{n} is in a mercenary contract"));
    world.contracts[0].started_at = None;
    assert_eq!(
        name_heir(&mut world, &leader, &heir),
        format!("{n} is named in a mercenary contract offer")
    );
    world.contracts.clear();
    world.alliances.push(alliance(&realm, &[&heir]));
    assert_eq!(name_heir(&mut world, &leader, &heir), format!("{n} is in the alliance army"));
    assert_eq!(heir_of(&world, &realm), None);
}

#[test]
fn refuses_a_homeless_resident_another_realms_and_a_stranger_asking() {
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    let n = name(&world, &heir);
    live_mut(&mut world, &heir).city_id = None;
    assert_eq!(
        name_heir(&mut world, &leader, &heir),
        format!("{n} lives in no city of your realm")
    );
    let theirs = world
        .residents
        .iter()
        .find(|r| r.owner.as_deref() == Some(tobin.as_str()) && r.id != leader)
        .unwrap()
        .id
        .clone();
    assert_eq!(name_heir(&mut world, &leader, &theirs), "not one of your residents");
    // Tobin's resident can't name Mara's heir.
    assert_eq!(name_heir(&mut world, &theirs, &leader), "not one of your residents");
    assert_eq!(heir_of(&world, &realm), None);
}

#[test]
fn clears_the_heir_and_refuses_with_none() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    let o = HeirRequest { resident_id: Some(&leader), heir_id: None };
    assert_eq!(validate_clear_heir(&world, MARA, &o).as_deref(), Some("your realm has no heir"));
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    assert_eq!(validate_clear_heir(&world, MARA, &o), None);
    apply_clear_heir(&mut world, MARA, &o);
    assert_eq!(heir_of(&world, &realm), None);
    assert_eq!(last_lapse(&world), None);
}

#[test]
fn lapses_on_death_with_a_log_line() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    let n = name(&world, &heir);
    let size = city_terrain().size;
    die_all(&mut world, std::slice::from_ref(&heir), DeathCause::OldAge, size, None);
    assert_eq!(heir_of(&world, &realm), None);
    assert_eq!(last_lapse(&world), lapsed(&heir, &n, HeirLapse::Died));
    assert!(heirs_qualify(&world).is_empty());
}

#[test]
fn lapses_on_leaving_the_realm_or_becoming_homeless() {
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    let n = name(&world, &heir);
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    live_mut(&mut world, &heir).city_id = None;
    assert!(!heirs_qualify(&world).is_empty());
    lapse_heirs(&mut world);
    assert_eq!(last_lapse(&world), lapsed(&heir, &n, HeirLapse::Homeless));
    assert_eq!(heir_of(&world, &realm), None);

    let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.as_str()));
    live_mut(&mut world, &heir).city_id = city.map(|c| c.id.clone());
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    live_mut(&mut world, &heir).owner = Some(tobin);
    lapse_heirs(&mut world);
    assert_eq!(last_lapse(&world), lapsed(&heir, &n, HeirLapse::LeftRealm));
    assert_eq!(heir_of(&world, &realm), None);
}

#[test]
fn lapses_on_being_lent_as_the_world_steps_or_handed_to_the_alliance_army() {
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    let n = name(&world, &heir);
    let terrain = city_terrain();
    let mut scratch = Scratch::default();
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    contract(&mut world, &heir, &realm, &tobin, true);
    step_world(&mut world, terrain, &mut scratch, None, None);
    assert_eq!(last_lapse(&world), lapsed(&heir, &n, HeirLapse::Lent));
    assert_eq!(heir_of(&world, &realm), None);

    world.contracts.clear();
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    world.alliances.push(alliance(&realm, &[&heir]));
    lapse_heirs(&mut world);
    assert_eq!(last_lapse(&world), lapsed(&heir, &n, HeirLapse::AllianceArmy));
    assert_eq!(heir_of(&world, &realm), None);
    assert!(heirs_qualify(&world).is_empty());
}

#[test]
fn lapses_on_a_leader_handover_to_them() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    let n = name(&world, &heir);
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    // A handover needs both in the same city: on its town hall.
    let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.as_str()));
    let hall = town_hall_of(&world, city.unwrap()).unwrap().clone();
    for id in [&leader, &heir] {
        let r = live_mut(&mut world, id);
        r.x = hall.x;
        r.y = hall.y;
    }
    let size = Some(city_terrain().size);
    let o = HandOverRequest { resident_id: Some(&leader), new_leader_id: Some(&heir) };
    assert_eq!(crate::leader::validate_hand_over(&world, MARA, &o, size), None);
    apply_hand_over(&mut world, MARA, &o, size);
    assert_eq!(world.realms.iter().find(|r| r.id == realm).unwrap().leader_id, heir);
    assert_eq!(heir_of(&world, &realm), None);
    assert_eq!(last_lapse(&world), lapsed(&heir, &n, HeirLapse::BecameLeader));
    assert!(heirs_qualify(&world).is_empty());
}

#[test]
fn invariant_every_heir_is_a_living_adult_of_the_realm_living_in_it_and_serving_no_one() {
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    assert_eq!(name_heir(&mut world, &leader, &heir), "ok");
    assert!(heirs_qualify(&world).is_empty());
    let tick = world.tick as f64;
    live_mut(&mut world, &heir).born_at = tick;
    assert!(heirs_qualify(&world)[0].message.ends_with("is a child"));
    world.realms.iter_mut().find(|r| r.id == realm).unwrap().heir_id = Some(leader.clone());
    assert!(heirs_qualify(&world)[0].message.ends_with("is its Leader"));
    let theirs = world.realms.iter().find(|r| r.id == tobin).unwrap().leader_id.clone();
    world.realms.iter_mut().find(|r| r.id == realm).unwrap().heir_id = Some(theirs);
    assert!(heirs_qualify(&world)[0].message.ends_with("is not of the realm"));
}

#[test]
fn a_script_names_and_clears_the_heir_and_sees_only_its_own_realms() {
    for name in ["nameHeir", "clearHeir"] {
        assert!(SCRIPT_API.iter().any(|b| b.name == name && matches!(b.is, Is::Action)));
    }
    assert!(SCRIPT_API.iter().any(|b| b.name == "realm" && matches!(b.is, Is::Query)));
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    let terrain = city_terrain();
    let mara = player(MARA);
    let mut queue = OrderQueue::new(order_kinds(), Some(Arc::new(terrain.clone())));
    let mut send = |world: &mut WorldState, requests: &[csp_shared::world::OrderRequest]| {
        let order = serde_json::to_value(&requests[0]).unwrap();
        let reply = queue.receive(world, &mara, &"q".into(), &order);
        assert!(matches!(reply, OrderReply::Ack { .. }), "{reply:?}");
        queue.apply_all(world);
    };

    let source = format!("memory.answer = nameHeir(\"{heir}\")");
    let (answer, requests) = run_script(&world, terrain, &mara, &leader, &source);
    assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
    let asked = json!([{ "kind": "nameHeir", "residentId": leader, "heirId": heir }]);
    assert_eq!(serde_json::to_value(&requests).unwrap(), asked);
    send(&mut world, &requests);
    assert_eq!(heir_of(&world, &realm), Some(heir.clone()));

    // The realm's view shows its own heir; another realm's is null, also once it names one.
    let source = "memory.answer = realm().heir";
    let (answer, _) = run_script(&world, terrain, &mara, &leader, source);
    assert_eq!(answer, Some(json!(heir)));
    world.realms.iter_mut().find(|r| r.id == tobin).unwrap().heir_id = Some("someone".into());
    let source = format!("memory.answer = [realm(\"{tobin}\").id, realm(\"{tobin}\").heir]");
    let (answer, _) = run_script(&world, terrain, &mara, &leader, &source);
    assert_eq!(answer, Some(json!([tobin, null])));
    world.realms.iter_mut().find(|r| r.id == tobin).unwrap().heir_id = None;

    // A refused name answers why.
    let source = format!("memory.answer = nameHeir(\"{leader}\")");
    let (answer, requests) = run_script(&world, terrain, &mara, &heir, &source);
    assert_eq!(answer, Some(json!(format!("{} is your Leader", name(&world, &leader)))));
    assert_eq!(requests, vec![]);

    let (answer, requests) =
        run_script(&world, terrain, &mara, &leader, "memory.answer = clearHeir()");
    assert!(matches!(answer, None | Some(serde_json::Value::Null)), "{answer:?}");
    send(&mut world, &requests);
    assert_eq!(heir_of(&world, &realm), None);
    let source = "memory.answer = realm().heir";
    let (answer, _) = run_script(&world, terrain, &mara, &leader, source);
    assert_eq!(answer, Some(json!(null)));
}
