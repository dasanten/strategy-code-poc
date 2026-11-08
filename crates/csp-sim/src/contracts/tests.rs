//! `apps/server/src/contracts.test.ts`. Left out until their tickets land: the walking and sight
//! of hired residents (T86.4, T85.5's `entitiesInSight` over walked residents), armies of
//! mercenaries (`formArmy`, T86.7), hauling for the hirer (T86.5), `checkInvariants` after each
//! tick (T86.13) and the `diplomacyFor` view (T87.6; `contracts_for` is checked instead). A
//! Leader's death goes through `end_contracts_on_leader_death`, as `dieAll` (T86.3) calls it.

use csp_shared::balance::{STANDING_CONTRACT_BROKEN_LOSS, STANDING_PER_PAID_WEEK};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, ContractSide, ContractWhat, Good, MercenaryContract, RealmEventWhat,
    ResidentOrder, WorldState,
};
use serde_json::{json, Value};

use super::*;
use crate::alliances::HAND_OVER_TO_ALLIANCE;
use crate::queries::alliance::commander_of;
use crate::queries::contract::{
    contracts_for, ContractResident, ContractStorage, RealmLabel, TICKS_PER_GAME_WEEK,
};
use crate::queries::standing::standing_of;
use crate::realm_test_world::{add_city, building, plains, resident, send};
use crate::tick::Scratch;
use crate::world::{create_world, step_world};

const LENDER: u64 = 7;
const HIRER: u64 = 8;

fn terrain() -> TerrainMap {
    plains(256)
}

/// Realm r1 (Player 7, Leader a1) with city c1 at (40, 40) and its storage s1 at (44, 40), where
/// soldiers m1 and m2 live; realm r2 (Player 8, Leader b1) far away at (160, 160), whose b2
/// carries coins.
fn setup() -> WorldState {
    let mut world = create_world(&terrain(), 1);
    for (id, user, leader) in [("r1", 7, "a1"), ("r2", 8, "b1")] {
        world.realms.push(
            serde_json::from_value(json!({"id": id, "userId": user, "leaderId": leader}))
                .expect("a realm"),
        );
    }
    add_city(&mut world, "c1", Some("r1"), 40.0, 40.0, "Ashford");
    let mut s1 = building("s1", BuildingKind::Storage, Some("c1"), 44.0, 40.0);
    s1.stock = Some(Default::default());
    world.buildings.push(s1);
    for (id, owner, x, y, city) in [
        ("a1", "r1", 40.0, 44.0, Some("c1")),
        ("m1", "r1", 48.0, 40.0, Some("c1")),
        ("m2", "r1", 48.0, 44.0, Some("c1")),
        ("b1", "r2", 160.0, 160.0, None),
        ("b2", "r2", 160.0, 164.0, None),
    ] {
        let mut r = resident(id, Some(owner), x, y);
        r.city_id = city.map(str::to_string);
        world.residents.push(r);
    }
    at_mut(&mut world, "b2").carried.insert(Good::Coins, 30.0);
    world
}

fn at<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::Resident {
    world.residents.iter().find(|r| r.id == id).expect("a resident")
}

fn at_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut csp_shared::world::Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("a resident")
}

fn commander(world: &WorldState, id: &str) -> Option<String> {
    let r = at(world, id);
    commander_of(world, &r.id, r.owner.as_deref())
}

/// Sends an order from a Player, applies it and answers "ack" or why not.
fn order(world: &mut WorldState, from: u64, o: Value) -> String {
    let kind = o["kind"].as_str().expect("a kind").to_string();
    let result = match kind.as_str() {
        "pay" => send(world, &terrain(), &Pay, from, o),
        "handOverToAlliance" => send(world, &terrain(), &HAND_OVER_TO_ALLIANCE, from, o),
        _ => {
            let orders = contract_orders();
            let (_, k) = orders.iter().find(|(n, _)| *n == kind).expect("a contract order");
            send(world, &terrain(), k, from, o)
        }
    };
    result.map_or_else(|e| e, |()| "ack".into())
}

/// Steps the world, keeping residents fed.
fn run(world: &mut WorldState, ticks: u32) {
    let terrain = terrain();
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, &terrain, &mut scratch, None, None);
    }
}

/// The offer r1 makes r2: m1 and m2 for 10 days at 5 coins a week, paid into s1.
fn offer() -> Value {
    json!({"kind": "offerContract", "residentIds": ["m1", "m2"], "realmId": "r2", "days": 10, "pricePerWeek": 5, "storageId": "s1"})
}

fn with(mut o: Value, more: Value) -> Value {
    for (k, v) in more.as_object().expect("an object") {
        if v.is_null() {
            o.as_object_mut().expect("an object").remove(k);
        } else {
            o[k] = v.clone();
        }
    }
    o
}

/// r1 offers m1 and m2 to r2, and r2 accepts; returns the contract.
fn hire(world: &mut WorldState) -> MercenaryContract {
    assert_eq!(order(world, LENDER, offer()), "ack");
    let id = world.contracts[0].id.clone();
    assert_eq!(order(world, HIRER, json!({"kind": "acceptContract", "contractId": id})), "ack");
    world.contracts[0].clone()
}

fn contract(world: &WorldState) -> &MercenaryContract {
    &world.contracts[0]
}

/// b2 walks onto the storage and pays `weeks` weeks.
fn pay_weeks(world: &mut WorldState, c: &MercenaryContract, weeks: f64) -> String {
    let b2 = at_mut(world, "b2");
    (b2.x, b2.y) = (44.0, 40.0);
    let answer = order(
        world,
        HIRER,
        json!({"kind": "pay", "residentId": "b2", "contractId": c.id, "weeks": weeks}),
    );
    run(world, 1);
    answer
}

fn contract_events(world: &WorldState, what: ContractWhat) -> Vec<u64> {
    let mut users: Vec<u64> = world
        .events
        .iter()
        .filter(|e| matches!(&e.what, RealmEventWhat::Contract { what: w, .. } if *w == what))
        .map(|e| e.user_id)
        .collect();
    users.sort_unstable();
    users
}

#[test]
fn starts_once_the_other_side_accepts_the_offer() {
    let mut world = setup();
    assert_eq!(order(&mut world, LENDER, offer()), "ack");
    let c = contract(&world).clone();
    assert_eq!(
        (c.lender_id.as_str(), c.hirer_id.as_str(), c.offered_by, c.started_at),
        ("r1", "r2", ContractSide::Lender, None)
    );
    let last = world.events.last().expect("an event");
    assert!(
        matches!(last.what, RealmEventWhat::Contract { what: ContractWhat::Offered, .. })
            && last.user_id == 8
    );
    // The one who offered can't accept their own offer.
    assert_eq!(
        order(&mut world, LENDER, json!({"kind": "acceptContract", "contractId": c.id})),
        "the other side has to accept your offer"
    );
    // Before it is accepted the residents still take the lender's orders.
    assert_eq!(commander(&world, "m1").as_deref(), Some("r1"));
    run(&mut world, 1);
    world.tick += 100;
    assert_eq!(
        order(&mut world, HIRER, json!({"kind": "acceptContract", "contractId": c.id})),
        "ack"
    );
    assert_eq!(contract(&world).started_at, Some(world.tick as f64));
    assert_eq!(commander(&world, "m1").as_deref(), Some("r2"));
    run(&mut world, 1);
}

#[test]
fn can_be_asked_for_by_the_hirer_and_accepted_by_the_lender() {
    let mut world = setup();
    // r2 sees m1 through b1 standing nearby.
    let b1 = at_mut(&mut world, "b1");
    (b1.x, b1.y) = (56.0, 40.0);
    assert_eq!(order(&mut world, HIRER, with(offer(), json!({"realmId": null}))), "ack");
    let c = contract(&world).clone();
    assert_eq!(
        (c.lender_id.as_str(), c.hirer_id.as_str(), c.offered_by),
        ("r1", "r2", ContractSide::Hirer)
    );
    assert_eq!(
        order(&mut world, LENDER, json!({"kind": "acceptContract", "contractId": c.id})),
        "ack"
    );
    assert_eq!(commander(&world, "m2").as_deref(), Some("r2"));
    run(&mut world, 1);
}

#[test]
fn rejects_offers_that_are_not_sound() {
    let mut world = setup();
    let mut bad = |o: Value, from: u64| order(&mut world, from, with(offer(), o));
    assert_eq!(
        bad(json!({"residentIds": ["m1", "b1"]}), LENDER),
        "the residents must all be of one realm"
    );
    assert_eq!(bad(json!({"realmId": "r1"}), LENDER), "offer them to another realm");
    assert_eq!(bad(json!({"days": 0}), LENDER), "a contract runs 1 to 120 game days");
    assert_eq!(
        bad(json!({"pricePerWeek": 0}), LENDER),
        "the price is a whole number of coins a week, at least 1"
    );
    assert_eq!(
        bad(json!({"storageId": "c1-hall"}), LENDER),
        "the coins go into a storage of the realm renting them out"
    );
    // The hirer has to see the residents it asks for.
    assert_eq!(bad(json!({"realmId": null}), HIRER), "those residents are out of sight");
    assert_eq!(bad(json!({}), LENDER), "ack");
    assert_eq!(bad(json!({"residentIds": ["m1"]}), LENDER), "a resident is already in a contract");
}

#[test]
fn can_be_declined_or_withdrawn_while_only_offered() {
    let mut world = setup();
    order(&mut world, LENDER, offer());
    let id = contract(&world).id.clone();
    assert_eq!(
        order(&mut world, HIRER, json!({"kind": "cancelContract", "contractId": id})),
        "ack"
    );
    assert!(world.contracts.is_empty());
    let c = hire(&mut world);
    assert_eq!(
        order(&mut world, LENDER, json!({"kind": "cancelContract", "contractId": c.id})),
        "that contract is already in force"
    );
}

#[test]
fn takes_a_weeks_coins_into_the_lenders_storage_with_a_pay_order() {
    let mut world = setup();
    let c = hire(&mut world);
    assert_eq!(
        order(
            &mut world,
            HIRER,
            json!({"kind": "pay", "residentId": "b2", "contractId": c.id, "weeks": 1})
        ),
        "the resident must stand at the contract’s storage"
    );
    assert_eq!(pay_weeks(&mut world, &c, 3.0), "that is more weeks than are left");
    assert_eq!(pay_weeks(&mut world, &c, 1.0), "ack");
    assert_eq!(contract(&world).paid_weeks, 1.0);
    let s1 = world.buildings.iter().find(|b| b.id == "s1").expect("s1");
    assert_eq!(s1.stock.as_ref().and_then(|s| s.get(&Good::Coins)).copied(), Some(5.0));
    assert_eq!(at(&world, "b2").carried.get(&Good::Coins).copied(), Some(25.0));
    assert_eq!(at(&world, "b2").order, None);
    assert_eq!(contract_events(&world, ContractWhat::Paid), vec![7, 8]);
    // A paid week raises standing both ways.
    assert!((standing_of(&world, "r1", "r2") - STANDING_PER_PAID_WEEK).abs() < 0.005);
    assert!((standing_of(&world, "r2", "r1") - STANDING_PER_PAID_WEEK).abs() < 0.005);
    // Only the hirer pays, and only with coins in hand.
    let a1 = at_mut(&mut world, "a1");
    a1.carried.insert(Good::Coins, 50.0);
    (a1.x, a1.y) = (44.0, 40.0);
    assert_eq!(
        order(
            &mut world,
            LENDER,
            json!({"kind": "pay", "residentId": "a1", "contractId": c.id, "weeks": 1})
        ),
        "you are not the hirer of that contract"
    );
    at_mut(&mut world, "b2").carried.insert(Good::Coins, 4.0);
    assert_eq!(pay_weeks(&mut world, &c, 1.0), "the resident doesn’t carry enough coins");
}

#[test]
fn breaks_when_a_week_ends_unpaid_and_the_mercenaries_walk_home() {
    let mut world = setup();
    let c = hire(&mut world);
    pay_weeks(&mut world, &c, 1.0);
    run(&mut world, 200);
    let started = c.started_at.expect("in force");
    // The first week is paid; the second is due when it ends.
    let pay_by = crate::queries::contract::contract_pay_by(contract(&world));
    assert_eq!(pay_by, Some(started + 10.0 * TICKS_PER_GAME_DAY));
    world.tick = (started + TICKS_PER_GAME_WEEK + 5.0) as u64;
    run(&mut world, 1);
    assert_eq!(world.contracts.len(), 1);
    world.tick = (pay_by.expect("due") - 1.0) as u64;
    run(&mut world, 1);
    assert!(world.contracts.is_empty());
    assert_eq!(contract_events(&world, ContractWhat::Broken), vec![7, 8]);
    // Breaking it costs the hirer standing with the lender; the paid week still counts.
    let left = STANDING_PER_PAID_WEEK - STANDING_CONTRACT_BROKEN_LOSS;
    assert!((standing_of(&world, "r1", "r2") - left).abs() < 0.5);
    assert!((standing_of(&world, "r2", "r1") - STANDING_PER_PAID_WEEK).abs() < 0.5);
    assert_eq!(commander(&world, "m1").as_deref(), Some("r1"));
    match &at(&world, "m1").order {
        Some(ResidentOrder::WalkTo(o)) => assert_eq!((o.target.x, o.target.y), (40.0, 40.0)),
        other => panic!("walking home, not {other:?}"),
    }
}

#[test]
fn breaks_at_once_when_the_first_week_is_never_paid() {
    let mut world = setup();
    let c = hire(&mut world);
    world.tick = (c.started_at.expect("in force") + TICKS_PER_GAME_WEEK - 1.0) as u64;
    run(&mut world, 1);
    assert!(world.contracts.is_empty());
}

#[test]
fn ends_when_its_time_is_up_with_every_week_paid() {
    let mut world = setup();
    let c = hire(&mut world);
    pay_weeks(&mut world, &c, 2.0);
    assert_eq!(crate::queries::contract::contract_pay_by(contract(&world)), None);
    world.tick = (c.started_at.expect("in force") + 10.0 * TICKS_PER_GAME_DAY - 2.0) as u64;
    run(&mut world, 1);
    assert_eq!(world.contracts.len(), 1);
    run(&mut world, 1);
    assert!(world.contracts.is_empty());
    assert_eq!(contract_events(&world, ContractWhat::Ended).len(), 2);
}

#[test]
fn shows_both_sides_the_contract() {
    let mut world = setup();
    let c = hire(&mut world);
    for realm in ["r1", "r2"] {
        let views = contracts_for(&world, realm);
        assert_eq!(views.len(), 1);
        let v = &views[0];
        assert_eq!(v.id, c.id);
        assert_eq!(
            v.lender,
            RealmLabel { realm_id: "r1".into(), realm: at(&world, "a1").name.clone(), city: None }
        );
        assert_eq!(
            v.hirer,
            RealmLabel { realm_id: "r2".into(), realm: at(&world, "b1").name.clone(), city: None }
        );
        let residents = ["m1", "m2"]
            .map(|id| ContractResident { id: id.into(), name: at(&world, id).name.clone() });
        assert_eq!(v.residents, residents.to_vec());
        assert_eq!(v.storage, Some(ContractStorage { id: "s1".into(), x: 44.0, y: 40.0 }));
        assert_eq!(
            (v.weeks, v.paid_weeks, v.pay_by),
            (2.0, 0.0, Some(c.started_at.expect("in force") + TICKS_PER_GAME_WEEK))
        );
    }
}

#[test]
fn keeps_a_resident_out_of_both_a_contract_and_an_alliance_army() {
    let mut world = setup();
    let alliance = json!({
        "id": "alliance1", "name": "North", "leaderId": "r1",
        "members": [{"realmId": "r1", "joinedAt": 0, "leaving": null}], "invites": [],
        "army": [{"is": "resident", "id": "m2", "recallAt": null}]
    });
    world.alliances.push(serde_json::from_value(alliance).expect("an alliance"));
    assert_eq!(order(&mut world, LENDER, offer()), "a resident is in an alliance army");
    assert_eq!(order(&mut world, LENDER, with(offer(), json!({"residentIds": ["m1"]}))), "ack");
    at_mut(&mut world, "m1").carried.insert(Good::Spear, 1.0);
    let name = at(&world, "m1").name.clone();
    assert_eq!(
        order(
            &mut world,
            LENDER,
            json!({"kind": "handOverToAlliance", "residentIds": ["m1"], "carriageIds": []})
        ),
        format!("{name} is in a mercenary contract")
    );
}

#[test]
fn contracts_sound_catches_a_resident_in_two_contracts_and_a_week_left_unpaid() {
    let mut world = setup();
    let c = hire(&mut world);
    world.contracts.push(MercenaryContract {
        id: "contract2".into(),
        started_at: None,
        ..c.clone()
    });
    world.tick = (c.started_at.expect("in force") + TICKS_PER_GAME_WEEK) as u64;
    let found: Vec<String> = contracts_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        found,
        vec![
            format!("contract {} has a week that ended unpaid", c.id),
            "resident m1 is in two contracts".to_string(),
            "resident m2 is in two contracts".to_string(),
        ]
    );
}

#[test]
fn ends_at_once_when_the_hirers_leader_dies_and_the_mercenaries_walk_home() {
    let mut world = setup();
    let c = hire(&mut world);
    end_contracts_on_leader_death(&mut world, "r2");
    assert!(world.contracts.is_empty());
    // Ended, not broken, though no week was paid: no standing lost.
    let ended: Vec<(u64, Option<ContractSide>)> = world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::Contract {
                what: ContractWhat::Ended,
                contract_id,
                leader_died,
                ..
            } if *contract_id == c.id => Some((e.user_id, *leader_died)),
            _ => None,
        })
        .collect();
    assert_eq!(ended, vec![(7, Some(ContractSide::Hirer)), (8, Some(ContractSide::Hirer))]);
    for id in ["m1", "m2"] {
        assert_eq!(commander(&world, id).as_deref(), Some("r1"));
        match &at(&world, id).order {
            Some(ResidentOrder::WalkTo(o)) => assert_eq!((o.target.x, o.target.y), (40.0, 40.0)),
            other => panic!("walking home, not {other:?}"),
        }
    }
    assert!(world.standings.is_empty());
}

#[test]
fn lets_an_offer_lapse_without_a_word_when_a_sides_leader_dies() {
    let mut world = setup();
    assert_eq!(order(&mut world, LENDER, offer()), "ack");
    let before = world.events.len();
    end_contracts_on_leader_death(&mut world, "r2");
    assert!(world.contracts.is_empty());
    assert_eq!(world.events.len(), before);
}
