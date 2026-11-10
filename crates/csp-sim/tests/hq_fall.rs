//! `apps/server/src/hq-fall.test.ts`, one test per `it`, from `setup()` of
//! `transfers.fixture.ts` (`fixtures/trade/transfers.json`).

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Caravan, Stock, TradeSide, WorldState};
use csp_sim::queries::city_area::OCCUPATION_TICKS;
use serde_json::{json, Value};

use csp_sim::capture::{capture_city, step_captures};
use csp_sim::defence::NoAlarms;
use csp_sim::goods_made::GoodsMade;
use csp_sim::hq_fall::nothing_left_of_the_hq;
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::standing::TRADE_ORG;
use csp_sim::queries::trade_org::trade_org_hq;
use csp_sim::queries::warehouse_trade::trade_problem;
use csp_sim::stock_floor::step_stock_floor;
use transfers_fixture::{assert_matches, setup, Fixture, MARA};

fn hq_of(world: &WorldState) -> String {
    trade_org_hq(world).expect("an HQ").id.clone()
}

/// A contract in force, from tick 0, one week paid (`contract`).
fn contract(fields: Value) -> Value {
    let mut c = json!({
        "id": "k", "lenderId": TRADE_ORG, "hirerId": "nobody", "offeredBy": "hirer",
        "residentIds": [], "days": 7, "pricePerWeek": 5, "storageId": "nowhere",
        "startedAt": 0, "paidWeeks": 1,
    });
    for (k, v) in fields.as_object().unwrap() {
        c[k] = v.clone();
    }
    c
}

fn push_contract(world: &mut WorldState, fields: Value) {
    world.contracts.push(serde_json::from_value(contract(fields)).unwrap());
}

fn capture(f: &mut Fixture, city: &str, captor: &str) {
    let size = f.size();
    capture_city(&mut f.world, city, captor, size);
}

fn r_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut csp_shared::world::Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

fn r_of<'w>(world: &'w WorldState, id: &str) -> &'w csp_shared::world::Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

fn caravan(f: &Fixture) -> Caravan {
    f.world.caravans[0].clone()
}

fn warehouse_id(f: &Fixture) -> String {
    f.warehouse().id.clone()
}

// the fall of the HQ (CONTEXT.md: Fall of the HQ)

#[test]
fn turns_the_hq_into_a_plain_city_of_the_captor_its_warehouses_storages_with_all_they_hold() {
    let mut f = setup();
    let hq = hq_of(&f.world);
    let warehouses: Vec<String> = f
        .world
        .buildings
        .iter()
        .filter(|b| b.city_id.as_deref() == Some(hq.as_str()) && b.kind == BuildingKind::Warehouse)
        .map(|b| b.id.clone())
        .collect();
    let stocks: Vec<Option<Stock>> = warehouses.iter().map(|id| f.b(id).stock.clone()).collect();
    let coins: f64 =
        warehouses.iter().map(|id| f.held(id, csp_shared::world::Good::Coins).unwrap_or(0.0)).sum();
    assert!(coins > 0.0);
    let people: Vec<String> = f
        .world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(hq.as_str()))
        .map(|r| r.id.clone())
        .collect();
    // Planning is over for the tick when a city is captured, so its plan must go with it.
    let tick = f.world.tick;
    f.world.city_plans.insert(
        hq.clone(),
        serde_json::from_value(json!({ "plannedAt": tick, "jobs": {} })).unwrap(),
    );
    let realm = f.realm.clone();
    capture(&mut f, &hq, &realm);
    assert!(!f.world.city_plans.contains_key(&hq));
    let city = f.world.cities.iter().find(|c| c.id == hq).unwrap();
    assert_eq!(city.realm_id.as_deref(), Some(realm.as_str()));
    assert_eq!(city.trade_org, None);
    assert!(trade_org_hq(&f.world).is_none());
    for id in &people {
        if let Some(r) = f.world.residents.iter().find(|r| &r.id == id) {
            assert_eq!(r.owner.as_deref(), Some(realm.as_str()));
        }
    }
    for (id, stock) in warehouses.iter().zip(&stocks) {
        assert_eq!(f.b(id).kind, BuildingKind::Storage);
        assert_eq!(&f.b(id).stock, stock);
    }
    assert_eq!(f.broken(), Vec::<String>::new());
    // No stock floor any more: what they hold runs out like any storage's.
    for id in &warehouses {
        f.b_mut(id).stock = Some(Stock::new());
    }
    f.world.tick = TICKS_PER_GAME_DAY as u64 - 1;
    step_stock_floor(&mut f.world, &mut GoodsMade::default());
    for id in &warehouses {
        assert_eq!(f.b(id).stock, Some(Stock::new()));
    }
}

#[test]
fn ends_the_caravans_crew_carriage_horse_and_load_join_the_captor_where_they_stand() {
    let mut f = setup();
    let c = caravan(&f);
    let ki = f.world.carriages.iter().position(|k| k.id == c.carriage_id).unwrap();
    let horse = f.world.carriages[ki].horse_id.clone().unwrap();
    let crew: Vec<String> =
        c.driver_id.iter().cloned().chain(c.escort_ids.iter().cloned()).collect();
    // Far out on the road, away from the HQ.
    (f.world.carriages[ki].x, f.world.carriages[ki].y) = (300.0, 300.0);
    let h = f.world.horses.iter_mut().find(|h| h.id == horse).unwrap();
    (h.x, h.y) = (300.0, 300.0);
    for id in &crew {
        let r = r_mut(&mut f.world, id);
        (r.x, r.y) = (300.0, 300.0);
    }
    f.world.carriages[ki].load = [(csp_shared::world::Good::Wood, 7.0)].into_iter().collect();
    f.world.route_robberies.insert(c.post_id.clone(), 3.0);
    // Driving when it falls: they join the captor and stop, so no drive is left over.
    let kid = c.carriage_id.clone();
    r_mut(&mut f.world, &crew[0]).order = Some(
        serde_json::from_value(json!({
            "kind": "drive", "carriageId": kid, "target": { "x": 310, "y": 300 }, "path": null,
            "progress": 0,
        }))
        .unwrap(),
    );
    let (hq, realm) = (hq_of(&f.world), f.realm.clone());
    capture(&mut f, &hq, &realm);
    assert!(f.world.caravans.is_empty());
    assert!(f.world.route_robberies.is_empty());
    for id in &crew {
        assert_matches(
            r_of(&f.world, id),
            json!({ "owner": realm, "x": 300, "y": 300, "order": null }),
        );
    }
    assert_matches(
        &f.world.carriages[ki],
        json!({ "realmId": realm, "x": 300, "y": 300, "load": { "wood": 7 } }),
    );
    let h = f.world.horses.iter().find(|h| h.id == horse).unwrap();
    assert_matches(h, json!({ "realmId": realm, "x": 300, "y": 300 }));
    assert_eq!(f.broken(), Vec::<String>::new());
}

#[test]
fn happens_by_occupying_its_town_hall_the_full_time_like_any_city() {
    let mut f = setup();
    let hq = hq_of(&f.world);
    let c = f.world.cities.iter().find(|c| c.id == hq).unwrap();
    let hall = town_hall_of(&f.world, c).unwrap().clone();
    for r in &mut f.world.residents {
        if r.city_id.as_deref() == Some(hq.as_str()) {
            r.x = hall.x - 5.0;
        }
    }
    let p1 = r_mut(&mut f.world, "p1");
    (p1.x, p1.y) = (hall.x + 1.0, hall.y + 1.0);
    p1.carried = [(csp_shared::world::Good::Sword, 1.0), (csp_shared::world::Good::Food, 5.0)]
        .into_iter()
        .collect();
    let since = f.world.tick as f64 + 1.0 - OCCUPATION_TICKS;
    let realm = f.realm.clone();
    f.world.cities.iter_mut().find(|c| c.id == hq).unwrap().occupation =
        Some(serde_json::from_value(json!({ "realmId": realm, "since": since })).unwrap());
    f.world.tick += 1;
    let size = f.size();
    let terrain = f.terrain.clone();
    let captures = step_captures(&mut f.world, size, Some(&terrain), &mut NoAlarms);
    let got: Vec<(String, Option<String>, String)> =
        captures.into_iter().map(|c| (c.city_id, c.from, c.to)).collect();
    assert_eq!(got, [(hq.clone(), None, realm.clone())]);
    assert_eq!(f.world.cities.iter().find(|c| c.id == hq).unwrap().trade_org, None);
    assert!(f.world.caravans.is_empty());
    assert_eq!(f.broken(), Vec::<String>::new());
}

#[test]
fn cancels_open_deliveries_and_transfers_without_refund_each_with_a_line_in_the_log() {
    let mut f = setup();
    let warehouse = warehouse_id(&f);
    let (realm, other, city, to_city) =
        (f.realm.clone(), f.other.clone(), f.city.clone(), f.to_city.clone());
    let base = json!({ "good": "wood", "units": 5, "caravanId": null, "warehouseId": warehouse });
    let with = |extra: Value| {
        let mut v = base.clone();
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    };
    for d in [
        with(json!({ "id": "d", "kind": "delivery", "realmId": realm, "cityId": city, "fee": 10 })),
        with(json!({ "id": "p", "kind": "pickUp", "realmId": realm, "cityId": city, "fee": 0 })),
    ] {
        f.world.deliveries.push(serde_json::from_value(d).unwrap());
    }
    f.world.transfers.push(
        serde_json::from_value(with(json!({
            "id": "t", "realmId": realm, "toRealmId": other, "toCityId": to_city,
            "fromCityId": null, "fee": 10, "back": false,
        })))
        .unwrap(),
    );
    let stock = f.b(&warehouse).stock.clone();
    assert!(caravan(&f).job.is_none());
    let hq = hq_of(&f.world);
    capture(&mut f, &hq, &other);
    assert!(f.world.deliveries.is_empty());
    assert!(f.world.transfers.is_empty());
    // Goods kept at a post stay in its warehouse.
    assert_eq!(f.b(&warehouse).stock, stock);
    assert_matches(
        &f.events("orderEndedWithHq", MARA),
        json!([
            { "order": "delivery", "good": "wood", "units": 5, "cityId": city },
            { "order": "pickUp", "good": "wood", "units": 5, "cityId": city },
            { "order": "transfer", "good": "wood", "units": 5, "cityId": to_city },
        ]),
    );
    assert_eq!(f.broken(), Vec::<String>::new());
}

#[test]
fn leaves_the_trading_posts_trading_but_they_take_no_new_deliveries_or_transfers() {
    let mut f = setup();
    let (hq, other, realm, city, to_city) =
        (hq_of(&f.world), f.other.clone(), f.realm.clone(), f.city.clone(), f.to_city.clone());
    capture(&mut f, &hq, &other);
    let warehouse = warehouse_id(&f);
    let post_id = f.b(&warehouse).city_id.clone().unwrap();
    let post = f.world.cities.iter().find(|c| c.id == post_id).unwrap();
    assert_eq!(post.trade_org, Some(csp_shared::world::TradeOrgCity::Post));
    assert_eq!(f.b(&warehouse).kind, BuildingKind::Warehouse);
    let buy = |w: &WorldState, city: Option<&Value>| {
        trade_problem(
            w,
            &realm,
            r_of(w, "p1"),
            TradeSide::Buy,
            Some(&json!("wood")),
            Some(&json!(1)),
            None,
            city,
        )
    };
    assert_eq!(buy(&f.world, None), None);
    // Nothing tops it up (ADR 0023), and with the HQ gone nothing brings it more but its own hands.
    f.b_mut(&warehouse).stock = Some([(csp_shared::world::Good::Wood, 3.0)].into_iter().collect());
    f.world.tick = TICKS_PER_GAME_DAY as u64 - 1;
    step_stock_floor(&mut f.world, &mut GoodsMade::default());
    assert_eq!(
        f.b(&warehouse).stock,
        Some([(csp_shared::world::Good::Wood, 3.0)].into_iter().collect())
    );
    let refused = "no caravans run since the Trade Org HQ fell";
    assert_eq!(buy(&f.world, Some(&json!(city))).as_deref(), Some(refused));
    assert_eq!(
        f.order(json!({ "kind": "buy", "good": "wood", "units": 1, "cityId": city })),
        refused
    );
    assert_eq!(
        f.order(json!({
            "kind": "transfer", "fromCityId": city, "good": "wood", "units": 1, "toCityId": to_city,
        })),
        refused
    );
    assert_eq!(
        f.order(json!({ "kind": "handIn", "good": "coins", "units": 1, "toCityId": to_city })),
        refused
    );
    // `diplomacyFor(...).noCaravans`: the server's diplomacy says so while no HQ stands
    // (`csp-server`'s `diplomacy_for`, tested there).
    assert!(trade_org_hq(&f.world).is_none());
}

#[test]
fn lets_a_delivery_ordered_just_before_the_fall_come_to_nothing() {
    let mut f = setup();
    let (hq, other, city) = (hq_of(&f.world), f.other.clone(), f.city.clone());
    r_mut(&mut f.world, "p1").order = Some(
        serde_json::from_value(json!({
            "kind": "trade", "side": "buy", "good": "wood", "units": 1, "carriageId": null,
            "cityId": city,
        }))
        .unwrap(),
    );
    capture(&mut f, &hq, &other);
    let warehouse = warehouse_id(&f);
    let coins = r_of(&f.world, "p1").carried.get(&csp_shared::world::Good::Coins).copied();
    let stock = f.held(&warehouse, csp_shared::world::Good::Wood);
    f.run_until(5, |w| r_of(w, "p1").order.is_none());
    assert_eq!(r_of(&f.world, "p1").carried.get(&csp_shared::world::Good::Coins).copied(), coins);
    assert_eq!(f.held(&warehouse, csp_shared::world::Good::Wood), stock);
    assert!(f.world.deliveries.is_empty());
    assert!(f.events("deliveryOrdered", MARA).is_empty());
}

#[test]
fn ends_contracts_with_the_trade_organization_soldiers_join_the_captor_mercenaries_walk_home() {
    let mut f = setup();
    let (hq, realm, other, storage) =
        (hq_of(&f.world), f.realm.clone(), f.other.clone(), f.storage.clone());
    let warehouse = warehouse_id(&f);
    let c = f.world.cities.iter().find(|c| c.id == hq).unwrap();
    let hall = town_hall_of(&f.world, c).unwrap().clone();
    let soldier = f
        .world
        .residents
        .iter()
        .find(|r| r.city_id.as_deref() == Some(hq.as_str()))
        .unwrap()
        .id
        .clone();
    let s = r_mut(&mut f.world, &soldier);
    (s.x, s.y) = (400.0, 400.0);
    s.script = Some(
        serde_json::from_value(json!({ "scriptId": 0, "task": "work", "memory": {} })).unwrap(),
    );
    let home_city =
        f.world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm.as_str())).unwrap();
    let home = town_hall_of(&f.world, home_city).unwrap().clone();
    let stranger = f
        .world
        .residents
        .iter()
        .find(|r| r.owner.as_deref() == Some(realm.as_str()) && r.id != "p1")
        .unwrap()
        .id
        .clone();
    let st = r_mut(&mut f.world, &stranger);
    (st.x, st.y) = (hall.x + 1.0, hall.y + 1.0);
    f.world.armies.push(
        serde_json::from_value(json!({
            "id": "army", "realmId": realm, "name": "Hired", "memberIds": [soldier], "order": null,
        }))
        .unwrap(),
    );
    push_contract(
        &mut f.world,
        json!({ "id": "hiredOut", "hirerId": realm, "residentIds": [soldier], "storageId": warehouse }),
    );
    push_contract(
        &mut f.world,
        json!({
            "id": "mercenaries", "lenderId": realm, "hirerId": TRADE_ORG,
            "residentIds": [stranger], "storageId": storage,
        }),
    );
    push_contract(
        &mut f.world,
        json!({
            "id": "offer", "hirerId": realm, "residentIds": [], "startedAt": null,
            "storageId": warehouse,
        }),
    );
    let standing = f.world.standings.clone();
    capture(&mut f, &hq, &other);
    assert!(f.world.contracts.is_empty());
    assert!(f.world.armies.is_empty());
    assert_matches(
        r_of(&f.world, &soldier),
        json!({ "owner": other, "x": 400, "y": 400, "order": null }),
    );
    assert!(r_of(&f.world, &soldier).script.is_none());
    assert_eq!(r_of(&f.world, &stranger).owner.as_deref(), Some(realm.as_str()));
    assert_matches(
        &r_of(&f.world, &stranger).order,
        json!({ "kind": "walkTo", "target": { "x": home.x, "y": home.y } }),
    );
    assert_eq!(f.world.standings, standing);
    let what: Vec<Value> = f.events("contract", MARA).iter().map(|e| e["what"].clone()).collect();
    assert_eq!(what, [json!("ended"), json!("ended")]);
    assert_eq!(f.broken(), Vec::<String>::new());
}

#[test]
fn ends_its_punishments_and_nobody_can_hire_from_it_any_more() {
    let mut f = setup();
    let (hq, realm, other, city) =
        (hq_of(&f.world), f.realm.clone(), f.other.clone(), f.city.clone());
    let warehouse = warehouse_id(&f);
    let soldier = f
        .world
        .residents
        .iter()
        .find(|r| r.city_id.as_deref() == Some(hq.as_str()))
        .unwrap()
        .id
        .clone();
    // `startedAt` is part of a punishment in the world's format; the TypeScript test leaves it out.
    f.world.punishments.push(
        serde_json::from_value(json!({
            "id": "punish", "culpritOrg": realm, "cityId": city, "worth": 100,
            "members": [{ "residentId": soldier, "own": {} }], "heading": "out", "took": 0,
            "startedAt": 0,
        }))
        .unwrap(),
    );
    capture(&mut f, &hq, &other);
    assert!(f.world.punishments.is_empty());
    assert_eq!(r_of(&f.world, &soldier).owner.as_deref(), Some(other.as_str()));
    assert_eq!(
        f.order(json!({
            "kind": "offerContract", "realmId": TRADE_ORG, "soldiers": 1, "days": 7,
            "pricePerWeek": 100, "storageId": warehouse,
        })),
        "the Trade Organization has had no army since its HQ fell"
    );
    assert_eq!(r_of(&f.world, "p1").owner.as_deref(), Some(realm.as_str()));
    assert_eq!(f.broken(), Vec::<String>::new());
}

#[test]
fn forgets_standing_toward_the_trade_organization_only_once_its_last_post_falls_too() {
    let mut f = setup();
    let (hq, realm, other) = (hq_of(&f.world), f.realm.clone(), f.other.clone());
    f.world.standings.push(
        serde_json::from_value(json!({ "of": TRADE_ORG, "toward": realm, "value": 5 })).unwrap(),
    );
    capture(&mut f, &hq, &other);
    assert_eq!(f.broken(), Vec::<String>::new());
    assert!(f.world.standings.iter().any(|s| s.of == TRADE_ORG));
    let warehouse = warehouse_id(&f);
    let post = f.b(&warehouse).city_id.clone().unwrap();
    capture(&mut f, &post, &other);
    assert!(!f.world.cities.iter().any(|c| c.trade_org.is_some()));
    f.run_until(1, |_| true);
    assert!(!f.world.standings.iter().any(|s| s.of == TRADE_ORG));
}

#[test]
fn never_comes_back_the_world_runs_on_with_no_hq_and_no_broken_rule() {
    let mut f = setup();
    let (hq, other) = (hq_of(&f.world), f.other.clone());
    capture(&mut f, &hq, &other);
    let end = f.world.tick + 200;
    f.run_until(201, |w| w.tick >= end);
    assert!(trade_org_hq(&f.world).is_none());
    assert!(f.world.caravans.is_empty());
}

#[test]
fn reports_whatever_an_hq_that_fell_left_behind() {
    let mut f = setup();
    let (hq, other) = (hq_of(&f.world), f.other.clone());
    let c = caravan(&f);
    capture(&mut f, &hq, &other);
    assert_eq!(nothing_left_of_the_hq(&f.world), vec![]);
    f.world.caravans.push(c);
    f.world.route_robberies.insert("gone".into(), 1.0);
    push_contract(&mut f.world, json!({ "id": "left", "hirerId": other }));
    let messages: Vec<String> =
        nothing_left_of_the_hq(&f.world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        [
            "the world has no Trade Org HQ but still has caravans",
            "the world has no Trade Org HQ but still has robberies counted on routes",
            "the world has no Trade Org HQ but still has contracts with the Trade Organization",
        ]
    );
}
