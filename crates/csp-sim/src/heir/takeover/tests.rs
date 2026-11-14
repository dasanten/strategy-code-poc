//! The heir takes over when the Leader dies (T103.2, `CONTEXT.md`: Leader death with an heir):
//! what stays with the realm, what goes self-managed, the realm log, the invariant, and that
//! without an heir, or with one dying with the Leader, the realm ends as before.

use csp_shared::balance::FORMER_PLAYER_STANDING;
use csp_shared::world::{
    Alliance, DeathCause, MercenaryContract, RealmEventWhat, ResidentOrder, Standing, WorldState,
};
use serde_json::json;

use super::*;
use crate::invariants::check_all;
use crate::queries::residents::can_work;
use crate::starting_city::found_starting_city;
use crate::survival::self_managed_tests::{hall_of, two_cities, Two};
use crate::survival::{die_all, go_down};
use crate::test_world::{live, live_mut};
use crate::tick::Scratch;
use crate::world::step_world;

const TOBIN: u64 = 2;

/// Mara's two cities, `first` with her Leader and `second` far from it, and an NPC city that
/// hires from her. `heir` lives in `second`; `away` does too but is out in the field on an
/// errand; `lent_first` and `lent_second`, of each city, are rented out to the NPC city.
struct Setup {
    two: Two,
    heir: String,
    away: String,
    lent_first: String,
    lent_second: String,
    stay_first: Vec<String>,
}

fn setup() -> Setup {
    let mut two = two_cities();
    let world = &mut two.world;
    found_starting_city(world, two.terrain, TOBIN, None);
    let tobin = world.realms.iter().find(|r| r.user_id == TOBIN).unwrap().id.clone();
    let tobin_hall = {
        let c = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(&tobin)).unwrap();
        hall_of(world, &c.id.clone())
    };
    let grown: Vec<String> = world
        .residents
        .iter()
        .filter(|r| r.owner.as_deref() == Some(two.realm.as_str()) && r.id != two.leader)
        .filter(|r| can_work(r.born_at, world.tick as f64))
        .map(|r| r.id.clone())
        .collect();
    let [heir, away, lent_second, lent_first, ..] = &grown[..] else { panic!("too few adults") };
    let hall = hall_of(world, &two.second);
    for (id, dx) in [(heir, 1.0), (away, 30.0), (lent_second, 2.0)] {
        let r = live_mut(world, id);
        (r.city_id, r.x, r.y, r.order) = (Some(two.second.clone()), hall.0 + dx, hall.1, None);
    }
    live_mut(world, away).order = Some(walk_to(hall.0 + 31.0, hall.1));
    // The soldier lent from the first city serves at Tobin's.
    let r = live_mut(world, lent_first);
    (r.x, r.y, r.order) = (tobin_hall.0 + 1.0, tobin_hall.1, None);
    world.realms[0].heir_id = Some(heir.clone());
    world.realms[0].name = Some("Ironvale".into());
    for (id, lent) in [("contract-first", lent_first), ("contract-second", lent_second)] {
        let c = contract(world, id, lent, &two.realm, &tobin);
        world.contracts.push(c);
    }
    world.alliances.push(alliance(&two.realm));
    let stay_first: Vec<String> = world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(two.first.as_str()) && r.id != two.leader)
        .map(|r| r.id.clone())
        .collect();
    let (heir, away) = (heir.clone(), away.clone());
    let (lent_first, lent_second) = (lent_first.clone(), lent_second.clone());
    Setup { two, heir, away, lent_first, lent_second, stay_first }
}

fn walk_to(x: f64, y: f64) -> ResidentOrder {
    serde_json::from_value(json!({
        "kind": "walkTo", "target": { "x": x, "y": y }, "path": null, "progress": 0,
    }))
    .unwrap()
}

fn contract(world: &WorldState, id: &str, r: &str, lender: &str, hirer: &str) -> MercenaryContract {
    let storage = world
        .buildings
        .iter()
        .find(|b| b.kind == csp_shared::world::BuildingKind::Storage)
        .unwrap()
        .id
        .clone();
    serde_json::from_value(json!({
        "id": id, "lenderId": lender, "hirerId": hirer, "offeredBy": "lender",
        "residentIds": [r], "days": 5, "pricePerWeek": 3, "storageId": storage,
        "startedAt": world.tick, "paidWeeks": 0
    }))
    .unwrap()
}

fn alliance(realm: &str) -> Alliance {
    serde_json::from_value(json!({
        "id": "alliance1", "name": "North", "leaderId": realm,
        "members": [{ "realmId": realm, "joinedAt": 0, "leaving": null }], "invites": [],
        "army": []
    }))
    .unwrap()
}

fn kill(world: &mut WorldState, ids: &[&str], size: i32) -> Vec<String> {
    let ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
    let (_, ended) = die_all(world, &ids, DeathCause::Killed, size, None);
    ended.into_iter().map(|r| r.id).collect()
}

fn realm_of_city(world: &WorldState, city: &str) -> Option<String> {
    world.cities.iter().find(|c| c.id == city).unwrap().realm_id.clone()
}

fn messages(world: &WorldState) -> Vec<String> {
    check_all(world, crate::test_world::city_terrain()).into_iter().map(|v| v.message).collect()
}

fn standing(world: &WorldState, of: &str, toward: &str) -> f64 {
    world.standings.iter().find(|s| s.of == of && s.toward == toward).map_or(0.0, |s| s.value)
}

fn kinds(world: &WorldState) -> Vec<RealmEventWhat> {
    world.events.iter().filter(|e| e.user_id == 1).map(|e| e.what.clone()).collect()
}

#[test]
fn the_heir_leads_the_realm_on_with_only_the_city_they_live_in() {
    let Setup { mut two, heir, away, lent_first, lent_second, stay_first } = setup();
    let size = two.terrain.size;
    let (realm, first, second) = (two.realm.clone(), two.first.clone(), two.second.clone());
    let leader = two.leader.clone();
    let leader_name = live(&two.world, &leader).unwrap().name.clone();
    let heir_name = live(&two.world, &heir).unwrap().name.clone();
    let away_order = live(&two.world, &away).unwrap().order.clone();
    let world = &mut two.world;
    let tobin = world.realms[1].id.clone();
    world.standings.push(Standing { of: tobin.clone(), toward: realm.clone(), value: 20.0 });

    let ended = kill(world, &[&leader], size);

    assert!(ended.is_empty());
    let r = world.realms.iter().find(|r| r.id == realm).expect("the realm goes on");
    assert_eq!((r.leader_id.as_str(), r.heir_id.as_deref()), (heir.as_str(), None));
    assert_eq!(r.name.as_deref(), Some("Ironvale"));
    assert_eq!(realm_of_city(world, &second), Some(realm.clone()));
    assert_eq!(realm_of_city(world, &first), None);
    // Its standing, alliance and the contract of the heir's city carry on.
    assert_eq!(standing(world, &tobin, &realm), 20.0);
    assert!(world.alliances[0].members.iter().any(|m| m.realm_id == realm));
    let ids: Vec<&str> = world.contracts.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["contract-second"]);
    assert_eq!(live(world, &lent_second).unwrap().owner.as_deref(), Some(realm.as_str()));
    // The first city is self-managed with its residents, holding the Player in good standing.
    assert_eq!(standing(world, &first, &realm), FORMER_PLAYER_STANDING);
    assert_eq!(world.cities.iter().find(|c| c.id == first).unwrap().former_player, None);
    for id in stay_first.iter().chain([&lent_first]) {
        let r = live(world, id).unwrap();
        assert_eq!((r.owner.as_deref(), r.city_id.as_deref()), (None, Some(first.as_str())));
    }
    // The soldier lent from it walks home.
    let Some(ResidentOrder::WalkTo(o)) = &live(world, &lent_first).unwrap().order else {
        panic!("the lent soldier doesn't walk home");
    };
    let hall = hall_of(world, &first);
    assert!((o.target.x - hall.0).abs() < 10.0 && (o.target.y - hall.1).abs() < 10.0);
    // A resident of the heir's city out in the field stays the realm's and keeps their order.
    let a = live(world, &away).unwrap();
    assert_eq!((a.owner.as_deref(), &a.order), (Some(realm.as_str()), &away_order));
    // The realm log tells it.
    let events = kinds(world);
    assert!(events.iter().any(|e| matches!(e,
        RealmEventWhat::Died { name, leader: true, heir: Some(h), .. }
            if *name == leader_name && *h == heir_name)));
    let took = events.iter().find_map(|e| match e {
        RealmEventWhat::HeirTookOver { heir_id, city_id, cities, .. } => {
            Some((heir_id.clone(), city_id.clone(), cities.clone()))
        }
        _ => None,
    });
    let (took_heir, took_city, others) = took.expect("no heirTookOver line");
    assert_eq!((took_heir, took_city), (heir.clone(), second.clone()));
    let names: Vec<&str> = others.iter().map(|c| c.city_id.as_str()).collect();
    assert_eq!(names, [first.as_str()]);
    assert!(!events.iter().any(|e| matches!(e, RealmEventWhat::SelfManaged { .. })));
    assert_eq!(messages(world), Vec::<String>::new());

    // The game plays on from there: the realm keeps its city and its Leader, nothing unsound.
    let mut scratch = Scratch::default();
    for _ in 0..5 {
        step_world(world, two.terrain, &mut scratch, None, None);
        assert_eq!(messages(world), Vec::<String>::new());
    }
    assert_eq!(world.realms.iter().find(|r| r.id == realm).unwrap().leader_id, heir);
    assert_eq!(realm_of_city(world, &second), Some(realm.clone()));
    assert!(world.alliances[0].members.iter().any(|m| m.realm_id == realm));
}

#[test]
fn horses_and_carriages_go_with_the_city_nearest_them_or_with_who_rides_and_drives_them() {
    let Setup { mut two, heir, away, .. } = setup();
    let size = two.terrain.size;
    let (first, second, realm) = (two.first.clone(), two.second.clone(), two.realm.clone());
    let leader = two.leader.clone();
    let world = &mut two.world;
    let far = hall_of(world, &second);
    // One horse is out by the heir's city, the other stays home but `away` rides it.
    (world.horses[0].x, world.horses[0].y) = (far.0 - 1.0, far.1);
    let ridden = world.horses[1].id.clone();
    let a = live_mut(world, &away);
    a.riding = Some(ridden);
    let at = (a.x, a.y);
    (world.horses[1].x, world.horses[1].y) = at;
    let k = &mut world.carriages[0];
    k.horse_id = None;

    kill(world, &[&leader], size);

    let fate = |realm: &Option<String>, city: &Option<String>| (realm.clone(), city.clone());
    let (near, rode) = (&world.horses[0], &world.horses[1]);
    assert_eq!(fate(&near.realm_id, &near.city_id).0, Some(realm.clone()));
    assert_eq!(fate(&rode.realm_id, &rode.city_id).0, Some(realm.clone()));
    let k = &world.carriages[0];
    assert_eq!(fate(&k.realm_id, &k.city_id), (None, Some(first.clone())));
    assert_eq!(world.realms[0].leader_id, heir);
    assert_eq!(messages(world), Vec::<String>::new());
}

#[test]
fn a_down_heir_takes_over() {
    let Setup { mut two, heir, .. } = setup();
    let size = two.terrain.size;
    let leader = two.leader.clone();
    let world = &mut two.world;
    let i = world.residents.iter().position(|r| r.id == heir).unwrap();
    go_down(world, i);

    assert!(kill(world, &[&leader], size).is_empty());

    assert_eq!(world.realms[0].leader_id, heir);
    assert!(live(world, &heir).unwrap().down_until.is_some());
    assert_eq!(messages(world), Vec::<String>::new());
}

#[test]
fn without_an_heir_the_leaders_death_ends_the_realm_as_before() {
    let Setup { mut two, .. } = setup();
    let size = two.terrain.size;
    let (realm, first, second) = (two.realm.clone(), two.first.clone(), two.second.clone());
    let leader = two.leader.clone();
    let world = &mut two.world;
    world.realms[0].heir_id = None;

    assert_eq!(kill(world, &[&leader], size), std::slice::from_ref(&realm));

    assert!(!world.realms.iter().any(|r| r.id == realm));
    assert_eq!((realm_of_city(world, &first), realm_of_city(world, &second)), (None, None));
    assert!(!world.residents.iter().any(|r| r.owner.as_deref() == Some(realm.as_str())));
    assert!(world.contracts.is_empty() && world.alliances.is_empty());
    let events = kinds(world);
    assert!(events
        .iter()
        .any(|e| matches!(e, RealmEventWhat::Died { leader: true, heir: None, .. })));
    let Some(RealmEventWhat::SelfManaged { cities }) = events.last() else {
        panic!("the realm log doesn't end with its cities");
    };
    assert_eq!(cities.len(), 2);
    assert!(!events.iter().any(|e| matches!(e, RealmEventWhat::HeirTookOver { .. })));
    assert_eq!(messages(world), Vec::<String>::new());
}

#[test]
fn the_leader_and_the_heir_dying_in_the_same_tick_end_the_realm_as_with_no_heir() {
    for heir_first in [false, true] {
        let Setup { mut two, heir, .. } = setup();
        let size = two.terrain.size;
        let (realm, leader) = (two.realm.clone(), two.leader.clone());
        let world = &mut two.world;
        let ids = if heir_first { [heir.as_str(), &leader] } else { [leader.as_str(), &heir] };

        assert_eq!(
            kill(world, &ids, size),
            std::slice::from_ref(&realm),
            "heir first: {heir_first}"
        );

        assert!(!world.realms.iter().any(|r| r.id == realm));
        assert!(!world.cities.iter().any(|c| c.realm_id.as_deref() == Some(realm.as_str())));
        assert!(!kinds(world).iter().any(|e| matches!(
            e,
            RealmEventWhat::HeirTookOver { .. } | RealmEventWhat::Died { heir: Some(_), .. }
        )));
        assert_eq!(messages(world), Vec::<String>::new());
    }
}

#[test]
fn the_invariant_catches_a_realm_still_holding_a_city_that_became_self_managed() {
    let Setup { mut two, .. } = setup();
    let size = two.terrain.size;
    let (realm, first, leader) = (two.realm.clone(), two.first.clone(), two.leader.clone());
    let world = &mut two.world;
    kill(world, &[&leader], size);
    assert!(heirs_took_over(world).is_empty());

    world.cities.iter_mut().find(|c| c.id == first).unwrap().realm_id = Some(realm.clone());

    let found: Vec<String> = heirs_took_over(world).into_iter().map(|v| v.message).collect();
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains(&first), "{found:?}");
}
