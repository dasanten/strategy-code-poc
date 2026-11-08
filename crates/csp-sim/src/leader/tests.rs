//! `apps/server/src/leader.test.ts`, ported one to one where the handover itself runs it. The
//! alliance and contract orders are T86.11's, so an alliance or contract is set up as data here;
//! the Leader's death is `dieAll`'s (T86.3); handing over from a script is the game API's (T86.12).

use csp_shared::world::{
    Alliance, MercenaryContract, RealmEventWhat, Resident, ResidentOrder, Tile, WalkOrder, WorldState,
};

use super::*;
use crate::combat::attack_order;
use crate::queries::alliance::alliance_of;
use crate::queries::city::town_hall_of;
use crate::starting_city::found_starting_city;
use crate::test_world::{city_terrain, live, live_mut};
use crate::world::create_world;

const MARA: u64 = 1;
const TOBIN: u64 = 2;

/// Mara's and Tobin's starting cities. Mara's Leader and `heir`, a grown resident of hers, both
/// stand on her town hall.
struct Setup {
    world: WorldState,
    realm: String,
    tobin: String,
    leader: String,
    heir: String,
    city: String,
}

fn setup() -> Setup {
    let terrain = city_terrain();
    let mut world = create_world(terrain, 1);
    found_starting_city(&mut world, terrain, MARA, None);
    found_starting_city(&mut world, terrain, TOBIN, None);
    let realm = world.realms.iter().find(|r| r.user_id == MARA).unwrap().clone();
    let tobin = world.realms.iter().find(|r| r.user_id == TOBIN).unwrap().id.clone();
    let leader = realm.leader_id.clone();
    let heir = world
        .residents
        .iter()
        .find(|r| r.owner.as_deref() == Some(realm.id.as_str()) && r.id != leader && can_work(r.born_at, world.tick as f64))
        .unwrap()
        .id
        .clone();
    let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.id.as_str())).unwrap().clone();
    let hall = town_hall_of(&world, &city).unwrap().clone();
    for id in [&leader, &heir] {
        let r = live_mut(&mut world, id);
        r.x = hall.x;
        r.y = hall.y;
        r.order = None;
    }
    Setup { world, realm: realm.id, tobin, leader, heir, city: city.id }
}

fn hand_over(world: &mut WorldState, to: &str, from: &str, sender: u64) -> String {
    let size = Some(city_terrain().size);
    let o = HandOverRequest { resident_id: Some(from), new_leader_id: Some(to) };
    if let Some(reason) = validate_hand_over(world, sender, &o, size) {
        return reason;
    }
    apply_hand_over(world, sender, &o, size);
    "ok".into()
}

fn leader_of(world: &WorldState, realm: &str) -> String {
    world.realms.iter().find(|r| r.id == realm).unwrap().leader_id.clone()
}

fn name(world: &WorldState, id: &str) -> String {
    live(world, id).unwrap().name.clone()
}

/// A contract between two realms naming `r`, offered or in force.
fn contract(world: &mut WorldState, r: &str, lender: &str, hirer: &str, started: bool) {
    let storage = world.buildings.iter().find(|b| b.kind == csp_shared::world::BuildingKind::Storage).unwrap().id.clone();
    let c: MercenaryContract = serde_json::from_value(serde_json::json!({
        "id": format!("contract-{r}"), "lenderId": lender, "hirerId": hirer, "offeredBy": "lender",
        "residentIds": [r], "days": 5, "pricePerWeek": 3, "storageId": storage,
        "startedAt": if started { Some(world.tick) } else { None }, "paidWeeks": 0
    }))
    .unwrap();
    world.contracts.push(c);
}

fn alliance(realm: &str, army: &[&str]) -> Alliance {
    serde_json::from_value(serde_json::json!({
        "id": "alliance1", "name": "North", "leaderId": realm,
        "members": [{ "realmId": realm, "joinedAt": 0, "leaving": null }], "invites": [],
        "army": army.iter().map(|id| serde_json::json!({ "is": "resident", "id": id, "recallAt": null })).collect::<Vec<_>>()
    }))
    .unwrap()
}

#[test]
fn makes_a_grown_resident_in_the_same_city_the_leader_and_changes_nothing_else() {
    let Setup { mut world, realm, leader, heir, city, .. } = setup();
    let (lx, ly) = (live(&world, &leader).unwrap().x, live(&world, &leader).unwrap().y);
    live_mut(&mut world, &leader).order =
        Some(ResidentOrder::WalkTo(WalkOrder { target: Tile { x: lx + 1.0, y: ly }, path: None, progress: 0.0, army: None }));
    let cities = world.cities.clone();
    let residents = world.residents.len();
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), "ok");
    assert_eq!(leader_of(&world, &realm), heir);
    // The old Leader stays on as an ordinary resident of the realm, doing what they did.
    assert_eq!(live(&world, &leader).unwrap().owner.as_deref(), Some(realm.as_str()));
    assert!(matches!(live(&world, &leader).unwrap().order, Some(ResidentOrder::WalkTo(_))));
    assert_eq!(world.cities, cities);
    assert_eq!(world.residents.len(), residents);
    let last = world.events.last().unwrap();
    assert_eq!(last.user_id, MARA);
    let city = world.cities.iter().find(|c| c.id == city).unwrap();
    assert_eq!(
        last.what,
        RealmEventWhat::LeaderHandedOver {
            from_id: leader.clone(),
            from: name(&world, &leader),
            to_id: heir.clone(),
            to: name(&world, &heir),
            city_id: city.id.clone(),
            city: city.name.clone(),
            x: lx,
            y: ly,
        }
    );
    assert!(leaders_serve_no_one(&world).is_empty());
}

#[test]
fn keeps_the_realms_alliance_its_leader_role_and_its_contracts() {
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    world.alliances.push(alliance(&realm, &[]));
    let lent = world
        .residents
        .iter()
        .find(|r| r.owner.as_deref() == Some(realm.as_str()) && r.id != leader && r.id != heir)
        .unwrap()
        .id
        .clone();
    contract(&mut world, &lent, &realm, &tobin, true);
    let contracts = world.contracts.clone();
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), "ok");
    assert_eq!(alliance_of(&world, &realm).map(|a| a.leader_id.as_str()), Some(realm.as_str()));
    assert_eq!(world.contracts, contracts);
}

#[test]
fn happens_also_while_the_leader_is_in_a_fight() {
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    let foe = world.residents.iter().find(|r| r.owner.as_deref() == Some(tobin.as_str())).unwrap().id.clone();
    live_mut(&mut world, &leader).order = Some(ResidentOrder::Attack(attack_order(&foe, false, false)));
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), "ok");
    assert_eq!(leader_of(&world, &realm), heir);
    assert_eq!(world.realms.len(), 2);
}

#[test]
fn refuses_a_child() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    let tick = world.tick as f64;
    live_mut(&mut world, &heir).born_at = tick;
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), format!("{} is a child", name(&world, &heir)));
    assert_ne!(leader_of(&world, &realm), heir);
}

#[test]
fn refuses_a_resident_of_another_realm() {
    let Setup { mut world, tobin, leader, .. } = setup();
    let tick = world.tick as f64;
    let at = (live(&world, &leader).unwrap().x, live(&world, &leader).unwrap().y);
    let other: &mut Resident = world
        .residents
        .iter_mut()
        .find(|r| r.owner.as_deref() == Some(tobin.as_str()) && can_work(r.born_at, tick))
        .unwrap();
    other.x = at.0;
    other.y = at.1;
    let other = other.id.clone();
    assert_eq!(hand_over(&mut world, &other, &leader, MARA), "not one of your residents");
}

#[test]
fn refuses_one_hired_out_or_named_in_an_offer() {
    let Setup { mut world, realm, tobin, leader, heir, .. } = setup();
    contract(&mut world, &heir, &realm, &tobin, true);
    let n = name(&world, &heir);
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), format!("{n} is in a mercenary contract"));
    world.contracts[0].started_at = None;
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), format!("{n} is named in a mercenary contract offer"));
    assert_ne!(leader_of(&world, &realm), heir);
}

#[test]
fn refuses_one_in_an_alliance_army() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    world.alliances.push(alliance(&realm, &[&heir]));
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), format!("{} is in the alliance army", name(&world, &heir)));
    assert_ne!(leader_of(&world, &realm), heir);
}

#[test]
fn refuses_when_the_two_dont_stand_in_the_same_city_of_the_realm() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    let size = f64::from(city_terrain().size);
    let n = name(&world, &heir);
    let must = format!("{n} must stand in the same city as your Leader");
    // A member of the city, but out in the field.
    let h = live_mut(&mut world, &heir);
    h.x = (h.x + 40.0) % size;
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), must);
    let lx = live(&world, &leader).unwrap().x;
    live_mut(&mut world, &heir).x = lx;
    live_mut(&mut world, &leader).x = (lx + 40.0) % size;
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), must);
    assert_eq!(leader_of(&world, &realm), leader);
    // Standing in another realm's city doesn't do either.
    let other = world.cities.iter().find(|c| c.realm_id.as_deref() != Some(realm.as_str())).unwrap().clone();
    let hall = town_hall_of(&world, &other).unwrap().clone();
    for id in [&leader, &heir] {
        let r = live_mut(&mut world, id);
        r.x = hall.x;
        r.y = hall.y;
    }
    assert_eq!(hand_over(&mut world, &heir, &leader, MARA), must);
}

#[test]
fn is_the_leaders_to_give_not_another_residents_not_another_players_not_twice() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    let at = (live(&world, &leader).unwrap().x, live(&world, &leader).unwrap().y);
    let third = world
        .residents
        .iter_mut()
        .find(|r| r.owner.as_deref() == Some(realm.as_str()) && r.id != leader && r.id != heir)
        .unwrap();
    third.x = at.0;
    third.y = at.1;
    let third = third.id.clone();
    assert_eq!(hand_over(&mut world, &third, &heir, MARA), "only your Leader can hand over the realm");
    assert_eq!(hand_over(&mut world, &heir, &leader, TOBIN), "only your Leader can hand over the realm");
    assert_eq!(hand_over(&mut world, &leader, &leader, MARA), format!("{} is your Leader already", name(&world, &leader)));
    assert_eq!(leader_of(&world, &realm), leader);
    assert!(!world.events.iter().any(|e| matches!(e.what, RealmEventWhat::LeaderHandedOver { .. })));
}

#[test]
fn is_checked_again_when_it_applies() {
    let Setup { mut world, realm, leader, heir, .. } = setup();
    let size = city_terrain().size;
    let o = HandOverRequest { resident_id: Some(&leader), new_leader_id: Some(&heir) };
    assert_eq!(validate_hand_over(&world, MARA, &o, Some(size)), None);
    let h = live_mut(&mut world, &heir);
    h.x = (h.x + 40.0) % f64::from(size);
    apply_hand_over(&mut world, MARA, &o, Some(size));
    assert_ne!(leader_of(&world, &realm), heir);
}

#[test]
#[ignore = "needs dieAll ending a realm (T86.3)"]
fn the_old_leaders_death_breaks_nothing_up_the_new_leaders_does() {}

#[test]
#[ignore = "needs the contract and alliance orders (T86.11)"]
fn a_leader_cant_be_hired_out_or_handed_to_an_alliance_army() {}

#[test]
fn invariant_every_realms_leader_is_a_living_adult_of_that_realm_serving_no_one_else() {
    let Setup { mut world, realm, tobin, leader, .. } = setup();
    assert!(leaders_serve_no_one(&world).is_empty());
    contract(&mut world, &leader, &realm, &tobin, true);
    assert_eq!(leaders_serve_no_one(&world).len(), 1);
    world.contracts.clear();
    world.alliances.push(alliance(&realm, &[&leader]));
    assert_eq!(leaders_serve_no_one(&world).len(), 1);
    world.alliances.clear();
    let tick = world.tick as f64;
    live_mut(&mut world, &leader).born_at = tick;
    assert_eq!(leaders_serve_no_one(&world).len(), 1);
}

#[test]
#[ignore = "needs the game API (T86.12)"]
fn leader_handover_from_a_script_is_in_the_script_api() {}
