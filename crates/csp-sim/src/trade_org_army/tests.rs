//! `apps/server/src/trade-org-army.test.ts`, ported one to one. Orders go through their kinds:
//! the contract orders (T86.11) by `realm_test_world::send`, `walkTo` (T86.4) by
//! `movement_test_world::order_from`. The world steps with the ported `Walking`.

use std::sync::Arc;

use csp_shared::balance::{TRADE_ORG_ARMY, TRADE_ORG_HQ};
use csp_shared::footprint::middle_of;
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, ContractSide, ContractWhat, Good, MercenaryContract, RealmEventWhat, Resident,
    TradeOrgCity, WorldState,
};
use serde_json::{json, Value};

use super::*;
use crate::contracts::{contract_orders, Pay};
use crate::invariants::check_all;
use crate::queries::alliance::commander_of;
use crate::queries::names::placed;
use crate::queries::trade_org::in_inner_ring;
use crate::random::Mulberry32;
use crate::realm_test_world::{plains, send};
use crate::residents::{new_resident, NewResident};
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::found_trade_org_hq;
use crate::walking::Walking;
use crate::world::{create_world, step_world};

const MID: i32 = 320;
const PLAYER: u64 = 7;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    hq: String,
    walking: Walking,
    scratch: Scratch,
}

/// The Trade Org HQ at (MID, MID) with a trading post p at (20, 20) and its warehouse w at
/// (23, 20); realm r1 (Player 7, Leader a1) with city c1 at (20, 140), its storage s1 at
/// (23, 140) and its resident b1 there.
fn setup() -> Setup {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, MID, MID, &mut || m.next());
    add_city(&mut world, "p", None, 20.0, 20.0, Some(TradeOrgCity::Post));
    world.buildings.push(building(
        json!({ "id": "w", "kind": "warehouse", "cityId": "p", "x": 23, "y": 20, "stock": {} }),
    ));
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    add_city(&mut world, "c1", Some("r1"), 20.0, 140.0, None);
    world.buildings.push(building(
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 23, "y": 140, "stock": {} }),
    ));
    resident(&mut world, "a1", 20.0, 141.0, Some("c1"));
    resident(&mut world, "b1", 23.0, 141.0, Some("c1"));
    let walking = Walking::new(Arc::new(terrain.clone()));
    Setup { world, terrain, hq, walking, scratch: Scratch::default() }
}

fn building(v: Value) -> csp_shared::world::Building {
    serde_json::from_value(v).unwrap()
}

/// A grown resident of realm r1.
fn resident(world: &mut WorldState, id: &str, x: f64, y: f64, city: Option<&str>) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner: Some("r1"), city_id: city, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

fn hq_city(s: &Setup) -> City {
    s.world.cities.iter().find(|c| c.id == s.hq).unwrap().clone()
}

/// The HQ's own residents, by index.
fn hq_people(world: &WorldState, hq: &str) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| {
            world.residents[i].owner.is_none() && world.residents[i].city_id.as_deref() == Some(hq)
        })
        .collect()
}

/// Arms the first `n` of the HQ's residents with a spear each.
fn arm(world: &mut WorldState, hq: &str, n: usize) {
    for i in hq_people(world, hq).into_iter().take(n) {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
}

fn at<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

fn at_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

/// Sends an order from the Player, applies it and answers whether it was taken.
fn order(s: &mut Setup, o: Value) -> String {
    let kind = o["kind"].as_str().unwrap().to_string();
    let answer = match kind.as_str() {
        "pay" => send(&mut s.world, &s.terrain, &Pay, PLAYER, o),
        "walkTo" => crate::movement_test_world::order_from(&mut s.world, &s.terrain, PLAYER, o),
        k => {
            let kinds = contract_orders();
            let (_, kind) = kinds.iter().find(|(n, _)| *n == k).expect("a contract order");
            send(&mut s.world, &s.terrain, kind, PLAYER, o)
        }
    };
    answer.err().unwrap_or_else(|| "ack".into())
}

/// Steps the world, keeping everyone fed, and checks every invariant now and then.
fn run(s: &mut Setup, ticks: usize, until: &dyn Fn(&WorldState) -> bool) {
    for i in 0..ticks {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
        if i % 200 == 0 {
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

fn goods_warehouse(s: &Setup) -> usize {
    s.world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(s.hq.as_str())
                && b.stock.as_ref().is_some_and(|st| st.contains_key(&Good::Wood))
        })
        .unwrap()
}

#[test]
#[ignore = "slow in the TypeScript too (`tags: ['slow']`): T86.14's long simulations"]
fn is_built_by_the_hq_from_its_own_adults_and_its_goods_warehouse() {
    let mut s = setup();
    let g = goods_warehouse(&s);
    s.world.buildings[g].stock.get_or_insert_with(Default::default).insert(Good::Spear, 20.0);
    run(&mut s, 8 * TICKS_PER_GAME_DAY as usize, &|w| {
        hq_soldiers(w).len() as f64 >= TRADE_ORG_ARMY.size
    });
    assert_eq!(hq_soldiers(&s.world).len() as f64, TRADE_ORG_ARMY.size);
    // It keeps enough at work: none of its soldiers works, and the rest still do.
    let unarmed = hq_people(&s.world, &s.hq)
        .into_iter()
        .filter(|&i| !is_armed(&s.world.residents[i].carried))
        .count();
    assert!(unarmed as f64 >= TRADE_ORG_ARMY.workers);
    for i in hq_soldiers(&s.world) {
        assert!(!matches!(s.world.residents[i].order, Some(ResidentOrder::WorkAt(_))));
    }
}

#[test]
fn arms_no_more_than_it_can_while_keeping_its_workers() {
    let mut s = setup();
    let g = goods_warehouse(&s);
    s.world.buildings[g].stock.get_or_insert_with(Default::default).insert(Good::Spear, 20.0);
    // Only a few more adults than its workers are left.
    let keep: HashSet<String> = hq_people(&s.world, &s.hq)
        .into_iter()
        .take(TRADE_ORG_ARMY.workers as usize + 3)
        .map(|i| s.world.residents[i].id.clone())
        .collect();
    let hq = s.hq.clone();
    s.world.residents.retain(|r| r.city_id.as_deref() != Some(hq.as_str()) || keep.contains(&r.id));
    run(&mut s, TICKS_PER_GAME_DAY as usize, &never);
    assert_eq!(hq_soldiers(&s.world).len(), 3);
}

/// The HQ with 12 soldiers, 4 of them more than its guard, and b1 carrying coins at w.
fn hireable() -> Setup {
    let mut s = setup();
    let hq = s.hq.clone();
    arm(&mut s.world, &hq, TRADE_ORG_ARMY.guard as usize + 4);
    let b1 = at_mut(&mut s.world, "b1");
    b1.x = 23.0;
    b1.y = 20.0;
    b1.carried.insert(Good::Coins, 200.0);
    s
}

fn ask(soldiers: f64, price_per_week: f64) -> Value {
    json!({ "kind": "offerContract", "realmId": TRADE_ORG, "soldiers": soldiers, "days": 7, "pricePerWeek": price_per_week, "storageId": "w" })
}

#[test]
fn hires_out_its_spare_soldiers_at_its_price_paid_at_a_warehouse() {
    let mut s = hireable();
    assert_eq!(spare_soldiers(&s.world).len(), 4);
    let price = 2.0 * TRADE_ORG_ARMY.price_per_soldier_week;
    assert_eq!(order(&mut s, ask(2.0, price)), "ack");
    run(&mut s, 1, &never);
    let c = s.world.contracts[0].clone();
    assert_eq!(
        (c.lender_id.as_str(), c.hirer_id.as_str(), c.price_per_week),
        (TRADE_ORG, "r1", price)
    );
    assert!(c.started_at.is_some());
    // The Player now gives its soldiers orders; the HQ leaves them be.
    for id in &c.resident_ids {
        let r = at(&s.world, id);
        assert_eq!(commander_of(&s.world, &r.id, r.owner.as_deref()).as_deref(), Some("r1"));
    }
    let first = c.resident_ids[0].clone();
    assert_eq!(
        order(&mut s, json!({ "kind": "walkTo", "residentId": first, "x": 40, "y": 40 })),
        "ack"
    );
    // b1 pays the first week into the warehouse.
    assert_eq!(
        order(&mut s, json!({ "kind": "pay", "residentId": "b1", "contractId": c.id, "weeks": 1 })),
        "ack"
    );
    run(&mut s, 1, &never);
    let w = s.world.buildings.iter().find(|b| b.id == "w").unwrap();
    assert_eq!(held_in(w.stock.as_ref(), Good::Coins), price);
    assert_eq!(s.world.contracts[0].paid_weeks, 1.0);
    assert!(matches!(at(&s.world, &first).order, Some(ResidentOrder::WalkTo(_))));
    let log: Vec<ContractWhat> = s
        .world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::Contract { what, .. } => Some(*what),
            _ => None,
        })
        .collect();
    assert_eq!(log, vec![ContractWhat::Started, ContractWhat::Paid]);
}

#[test]
fn declines_a_price_below_its_own() {
    let mut s = hireable();
    assert_eq!(order(&mut s, ask(2.0, 2.0 * TRADE_ORG_ARMY.price_per_soldier_week - 1.0)), "ack");
    run(&mut s, 1, &never);
    assert!(s.world.contracts.is_empty());
    assert!(matches!(&s.world.events.last().unwrap().what,
        RealmEventWhat::Contract { what: ContractWhat::Declined, residents, .. } if *residents == 2.0));
}

#[test]
fn never_hires_out_its_guard() {
    let mut s = hireable();
    assert_eq!(
        order(&mut s, ask(5.0, 5.0 * TRADE_ORG_ARMY.price_per_soldier_week)),
        "the Trade Organization can spare only 4 soldiers"
    );
    let mut to_storage = ask(1.0, 100.0);
    to_storage["storageId"] = json!("s1");
    assert_eq!(
        order(&mut s, to_storage),
        "the coins go into a warehouse of the Trade Organization"
    );
}

#[test]
fn takes_no_offer_of_residents_from_a_player() {
    let mut s = hireable();
    let o = json!({ "kind": "offerContract", "residentIds": ["b1"], "realmId": TRADE_ORG, "days": 7, "pricePerWeek": 50, "storageId": "s1" });
    assert_eq!(order(&mut s, o), "the Trade Organization hires only by its own offers");
}

/// The gates on or within the HQ's inner ring.
fn inner_ring_gates(s: &Setup) -> Vec<usize> {
    let hq = hq_city(s);
    let hall = town_hall_of(&s.world, &hq).unwrap();
    let mid = middle_of(placed(hall), s.terrain.size);
    (0..s.world.buildings.len())
        .filter(|&i| {
            let b = &s.world.buildings[i];
            b.kind == BuildingKind::Gate
                && b.city_id.as_deref() == Some(hq.id.as_str())
                && wrap_distance(s.terrain.size, mid, (b.x as i32, b.y as i32))
                    <= TRADE_ORG_HQ.inner_radius + 1.0
        })
        .collect()
}

#[test]
#[ignore = "a game day of the HQ's soldiers walking: T86.14's long simulations"]
fn keeps_everyone_out_of_the_hqs_inner_ring_by_force_and_without_a_crime() {
    let mut s = setup();
    let hq = s.hq.clone();
    arm(&mut s.world, &hq, 12);
    let (hx, hy) = {
        let hall = town_hall_of(&s.world, &hq_city(&s)).unwrap();
        (hall.x, hall.y)
    };
    // An unarmed resident of the Player slipped in next to the town hall.
    let b1 = at_mut(&mut s.world, "b1");
    b1.x = hx;
    b1.y = hy + 2.0;
    assert!(in_inner_ring(&s.world, (hx, hy + 2.0), s.terrain.size));
    run(&mut s, TICKS_PER_GAME_DAY as usize, &|w| !w.residents.iter().any(|r| r.id == "b1"));
    assert!(!s.world.residents.iter().any(|r| r.id == "b1"));
    assert!(s.world.crimes.iter().all(|c| c.culprit.org != hq));
    // Its inner gates stayed closed all along.
    let gates = inner_ring_gates(&s);
    assert_eq!(gates.len() as f64, TRADE_ORG_HQ.gates);
    for g in gates {
        assert_eq!(s.world.buildings[g].closed, Some(true));
    }
}

/// The HQ down to its workers and two adults to arm, and r1 with armed m1 and m2 near it.
fn weakened() -> Setup {
    let mut s = setup();
    let keep: HashSet<String> = hq_people(&s.world, &s.hq)
        .into_iter()
        .take(TRADE_ORG_ARMY.workers as usize + 2)
        .map(|i| s.world.residents[i].id.clone())
        .collect();
    let hq = s.hq.clone();
    s.world.residents.retain(|r| r.city_id.as_deref() != Some(hq.as_str()) || keep.contains(&r.id));
    let mid = f64::from(MID);
    for (id, x, y, city) in [
        ("m1", mid - 80.0, mid, None),
        ("m2", mid - 84.0, mid, None),
        ("m3", 20.0, 139.0, Some("c1")),
    ] {
        let i = resident(&mut s.world, id, x, y, city);
        s.world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    at_mut(&mut s.world, "a1").carried.insert(Good::Spear, 1.0);
    s.world.tick = TICKS_PER_GAME_DAY as u64;
    s
}

/// The first half of the TypeScript test, up to the first week paid; the mercenaries' walk to
/// their posts is a game day and a half of walking (T86.14).
#[test]
fn hires_mercenaries_itself_after_heavy_losses() {
    let mut s = weakened();
    let hq = hq_city(&s);
    assert_eq!(soldiers_lacking(&s.world, &hq), TRADE_ORG_ARMY.size - 2.0);
    run(&mut s, 1, &never);
    let c = s.world.contracts[0].clone();
    // It asks for the realm's armed residents nearest it, never its Leader.
    assert_eq!(
        (c.lender_id.as_str(), c.hirer_id.as_str(), c.offered_by),
        ("r1", TRADE_ORG, ContractSide::Hirer)
    );
    assert_eq!(c.resident_ids, vec!["m1", "m2", "m3"]);
    assert_eq!(
        (c.days, c.price_per_week, c.storage_id.as_str()),
        (TRADE_ORG_ARMY.hire_days, 3.0 * TRADE_ORG_ARMY.hire_price_per_soldier_week, "s1")
    );
    assert!(matches!(
        &s.world.events.last().unwrap().what,
        RealmEventWhat::Contract { what: ContractWhat::Offered, lender: true, .. }
    ));
    // Asked once: the next day it waits for the answer.
    run(&mut s, TICKS_PER_GAME_DAY as usize, &never);
    assert_eq!(s.world.contracts.len(), 1);
    assert_eq!(order(&mut s, json!({ "kind": "acceptContract", "contractId": c.id })), "ack");
    let bank = s
        .world
        .buildings
        .iter()
        .position(|b| {
            b.city_id.as_deref() == Some(hq.id.as_str())
                && b.stock.as_ref().is_some_and(|st| st.contains_key(&Good::Coins))
        })
        .unwrap();
    let before = held_in(s.world.buildings[bank].stock.as_ref(), Good::Coins);
    run(&mut s, 1, &never);
    // It pays the first week from its coin warehouse straight into the storage.
    let c = s.world.contracts[0].clone();
    assert_eq!(c.paid_weeks, 1.0);
    let s1 = s.world.buildings.iter().find(|b| b.id == "s1").unwrap();
    assert_eq!(held_in(s1.stock.as_ref(), Good::Coins), c.price_per_week);
    assert_eq!(
        held_in(s.world.buildings[bank].stock.as_ref(), Good::Coins),
        before - c.price_per_week
    );
    for id in &c.resident_ids {
        let r = at(&s.world, id);
        assert_eq!(commander_of(&s.world, &r.id, r.owner.as_deref()).as_deref(), Some(TRADE_ORG));
    }
}

#[test]
fn hires_nobody_while_it_is_strong_enough() {
    let mut s = setup();
    let hq = hq_city(&s);
    assert_eq!(soldiers_lacking(&s.world, &hq), 0.0);
    s.world.tick = TICKS_PER_GAME_DAY as u64;
    at_mut(&mut s.world, "b1").carried.insert(Good::Spear, 1.0);
    run(&mut s, 1, &never);
    assert!(s.world.contracts.is_empty());
}

#[test]
fn trade_org_army_sound_reports_an_open_inner_gate_and_a_hired_leader() {
    let mut s = setup();
    assert_eq!(trade_org_army_sound(&s.world, s.terrain.size), vec![]);
    let gate = inner_ring_gates(&s)[0];
    s.world.buildings[gate].closed = None;
    let gate_id = s.world.buildings[gate].id.clone();
    let k: MercenaryContract = serde_json::from_value(json!({
        "id": "k", "lenderId": "r1", "hirerId": TRADE_ORG, "offeredBy": "hirer", "residentIds": ["a1"],
        "days": 7, "pricePerWeek": 5, "storageId": "s1", "startedAt": null, "paidWeeks": 0
    }))
    .unwrap();
    s.world.contracts.push(k);
    let messages: Vec<String> =
        trade_org_army_sound(&s.world, s.terrain.size).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        vec![
            format!("inner gate {gate_id} of the Trade Org HQ is open"),
            "the Trade Organization hires Leader a1".to_string()
        ]
    );
}
