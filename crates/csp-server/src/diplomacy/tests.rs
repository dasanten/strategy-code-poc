//! `diplomacyFor` and its parts, as `alliances.test.ts`, `persuasion.test.ts`, the deliveries'
//! and the carried offers' tests see them, on starting cities (`foundStartingCity`).

use csp_shared::balance::ALLIANCE_LEAVE_DELAY;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Delivery, DeliveryKind, Good, JoinRequest, WorldState};
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queries::alliance::realm_name;
use csp_sim::starting_city::found_starting_city;
use csp_sim::world::create_world;
use serde_json::{json, Value};

use super::*;

const MARA: u64 = 1;
const TOBIN: u64 = 2;
const WREN: u64 = 3;
const ASH: u64 = 4;

fn terrain() -> TerrainMap {
    TerrainMap { size: 256, tiles: vec![Terrain::Plains as u8; 256 * 256] }
}

/// A world where four Players have their starting cities.
fn setup() -> WorldState {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    for p in [MARA, TOBIN, WREN, ASH] {
        found_starting_city(&mut world, &terrain, p, None);
    }
    world
}

fn realm(world: &WorldState, p: u64) -> String {
    world.realms.iter().find(|r| r.user_id == p).expect("a realm").id.clone()
}

/// Sends an order and applies it as the next tick would; "ok" or the reason.
fn order(world: &mut WorldState, from: u64, o: Value) -> String {
    let mut queue = OrderQueue::new(order_kinds(), None);
    let sender = OrderSender::player(from, &format!("p{from}"));
    let answer = queue.receive(world, &sender, &json!("q"), &o);
    queue.apply_all(world);
    match answer {
        OrderReply::Rejected { reason, .. } => reason,
        _ => "ok".into(),
    }
}

/// Mara founds "North"; Tobin, then Wren, are invited and join.
fn allied_world() -> (WorldState, String) {
    let mut world = setup();
    order(&mut world, MARA, json!({ "kind": "foundAlliance", "name": "North" }));
    let id = world.alliances[0].id.clone();
    for p in [TOBIN, WREN] {
        let to = realm(&world, p);
        order(&mut world, MARA, json!({ "kind": "inviteToAlliance", "realmId": to }));
        world.tick += 1;
        order(&mut world, p, json!({ "kind": "acceptInvite", "allianceId": id }));
    }
    (world, id)
}

fn as_json(d: &Diplomacy) -> Value {
    serde_json::to_value(d).expect("serialisable")
}

#[test]
fn tells_each_player_their_alliance_matters() {
    let (mut world, id) = allied_world();
    let ash = realm(&world, ASH);
    assert_eq!(
        order(&mut world, MARA, json!({ "kind": "inviteToAlliance", "realmId": ash })),
        "ok"
    );
    assert_eq!(order(&mut world, TOBIN, json!({ "kind": "leaveAlliance" })), "ok");
    let r = |p| realm(&world, p);
    let label = |p| json!({ "realmId": r(p), "realm": realm_name(&world, &r(p)) });
    let seen = [r(ASH), r(TOBIN), r(ASH)];
    let tobin = diplomacy_for(&world, &r(TOBIN), seen.iter().map(String::as_str), Vec::new());
    let member = |p, at: f64, leaves: Value| {
        let mut m = label(p);
        m["joinedAt"] = json!(at);
        m["leavesAt"] = leaves;
        m
    };
    let none = json!([]);
    let trade_org = json!([{ "realmId": "trade-org", "realm": "the Trade Organization" }]);
    assert_eq!(
        as_json(&tobin),
        json!({
            "alliance": {
                "id": id,
                "name": "North",
                "leaderId": r(MARA),
                "members": [
                    member(MARA, 0.0, Value::Null),
                    member(TOBIN, 1.0, json!(world.tick as f64 + ALLIANCE_LEAVE_DELAY)),
                    member(WREN, 2.0, Value::Null),
                ],
                "invites": [label(ASH)],
                "army": [],
            },
            "invitations": none,
            "realmsInSight": [label(ASH)],
            "contracts": none,
            "demands": none,
            "knownRealms": [label(MARA), label(WREN), label(ASH)],
            "knownNpcOrgs": trade_org,
            "directOffers": none,
            "directOfferRealms": [label(MARA), label(WREN), label(ASH)],
            "deliveries": none,
            "standings": none,
            "joinRequests": none,
            "directives": none,
            // This test world has no Trade Org HQ.
            "noCaravans": true,
        })
    );
    let ash = diplomacy_for(&world, &r(ASH), [], Vec::new());
    assert_eq!(
        as_json(&ash),
        json!({
            "alliance": null,
            "invitations": [{
                "allianceId": id,
                "name": "North",
                "leader": realm_name(&world, &r(MARA)),
            }],
            "realmsInSight": none,
            "contracts": none,
            "demands": none,
            "knownRealms": none,
            "knownNpcOrgs": trade_org,
            "directOffers": none,
            "directOfferRealms": none,
            "deliveries": none,
            "standings": none,
            "joinRequests": none,
            "directives": none,
            "noCaravans": true,
        })
    );
}

#[test]
fn lists_a_realms_open_deliveries_with_their_warehouse() {
    let mut world = setup();
    let mara = realm(&world, MARA);
    let city = world.cities.iter().find(|c| c.realm_id.as_deref() == Some(&mara)).unwrap().clone();
    let storage = world
        .buildings
        .iter()
        .find(|b| b.city_id.as_deref() == Some(&city.id) && b.kind == BuildingKind::Storage)
        .unwrap()
        .clone();
    let delivery = |id: &str, realm_id: &str, caravan: Option<&str>| Delivery {
        id: id.into(),
        kind: DeliveryKind::Delivery,
        realm_id: realm_id.into(),
        warehouse_id: storage.id.clone(),
        city_id: city.id.clone(),
        good: Good::Food,
        units: 5.0,
        fee: 1.0,
        caravan_id: caravan.map(str::to_owned),
    };
    world.deliveries.push(delivery("d1", &mara, None));
    world.deliveries.push(delivery("d2", "realm999", None));
    world.deliveries.push(delivery("d3", &mara, Some("caravan1")));
    let seen = deliveries_for(&world, &mara);
    let ids: Vec<(&str, bool)> = seen.iter().map(|d| (d.id.as_str(), d.underway)).collect();
    assert_eq!(ids, [("d1", false), ("d3", true)]);
    assert_eq!(
        (seen[0].city.as_str(), seen[0].x, seen[0].y),
        (city.name.as_str(), storage.x, storage.y)
    );
}

#[test]
fn lists_the_npc_cities_asking_to_join_oldest_first_but_not_declined_ones() {
    let mut world = setup();
    let mara = realm(&world, MARA);
    let cities: Vec<String> = world.cities.iter().map(|c| c.id.clone()).take(3).collect();
    let ask = |city: &str, at: f64, declined: bool| JoinRequest {
        city_id: city.into(),
        realm_id: mara.clone(),
        at,
        declined,
    };
    world.join_requests.push(ask(&cities[1], 20.0, false));
    world.join_requests.push(ask(&cities[2], 10.0, false));
    world.join_requests.push(ask(&cities[0], 5.0, true));
    world.join_requests.push(ask("city999", 1.0, false));
    let asks: Vec<(String, f64)> =
        join_requests_for(&world, &mara).into_iter().map(|q| (q.city_id, q.at)).collect();
    assert_eq!(asks, [(cities[2].clone(), 10.0), (cities[1].clone(), 20.0)]);
}

#[test]
fn names_no_carried_way_without_the_trade_org_hq_nor_to_its_own_cities() {
    let world = setup();
    let mara = realm(&world, MARA);
    let theirs: Vec<Option<&str>> = world.cities.iter().map(|c| Some(c.id.as_str())).collect();
    // This test world has no Trade Org HQ: no caravans, so no carried way.
    assert_eq!(carried_ways_for(&world, 256, &mara, theirs.iter().copied()), []);
}
