//! `apps/server/src/deliveries-robbed.test.ts`, one test per `it`, from `setup()` of
//! `deliveries.fixture.ts` (`fixtures/trade/deliveries.json`).

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::world::{CaravanJob, CaravanJobStep, Good, GoodsSpot, Stock, WorldState};
use csp_sim::caravans::route_robberies_sound;
use csp_sim::carrying::{resolve_carrying, resolve_carrying_default, CarryAction, CarryKind};
use csp_sim::queries::trade_org::trade_org_hq;
use csp_sim::queries::warehouse_trade::owed_by;
use serde_json::{json, Value};
use transfers_fixture::{assert_matches, deliveries, Fixture, MARA};

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

fn caravan_id(s: &Fixture) -> String {
    s.world.caravans[0].id.clone()
}

fn job(w: &WorldState) -> Option<&CaravanJob> {
    w.caravans[0].job.as_ref()
}

fn step_is(w: &WorldState, step: CaravanJobStep) -> bool {
    job(w).is_some_and(|j| j.step == step)
}

fn units_of(events: &[Value]) -> Vec<f64> {
    events.iter().map(|e| e["units"].as_f64().unwrap()).collect()
}

fn warehouse_id(s: &Fixture) -> String {
    s.warehouse().id.clone()
}

mod robbed_caravans {
    use super::*;

    #[test]
    #[ignore = "8.2 s alone; see #1132"]
    fn send_what_was_taken_of_a_delivery_again_and_all_of_it_arrives() {
        let mut s = deliveries();
        let city = s.city.clone();
        assert_eq!(
            s.order(json!({ "kind": "buy", "good": "iron", "units": 6, "cityId": city })),
            "ack"
        );
        let before = s.held(&s.storage, Good::Iron).unwrap_or(0.0);
        s.run_until(20_000, |w| step_is(w, CaravanJobStep::Deliver));
        let caravan = caravan_id(&s);
        let thief = s.rob(&caravan, stock(&[(Good::Iron, 4.0)]), "thief");
        assert_eq!(s.world.residents[thief].carried.get(&Good::Iron), Some(&4.0));
        assert_matches(&job(&s.world), json!({ "units": 2, "robbed": 4 }));
        // The warehouse keeps nothing for it until the caravan has delivered the rest.
        assert_eq!(owed_by(&s.world, &warehouse_id(&s), Good::Iron), 0.0);
        s.run_until(20_000, |w| {
            w.events.iter().any(|e| serde_json::to_value(e).unwrap()["kind"] == "deliveryRobbed")
        });
        assert_matches(
            &s.events("deliveryRobbed", MARA),
            json!([{ "good": "iron", "units": 4, "cityId": city }]),
        );
        assert_matches(&s.world.deliveries, json!([{ "units": 4, "caravanId": null }]));
        assert_eq!(s.held(&s.storage, Good::Iron), Some(before + 2.0));
        s.run_until(20_000, |w| w.deliveries.is_empty());
        assert_eq!(s.held(&s.storage, Good::Iron), Some(before + 6.0));
        assert_eq!(units_of(&s.events("delivered", MARA)), vec![2.0, 4.0]);
        let post = s.world.caravans[0].post_id.clone();
        assert_eq!(s.world.route_robberies.get(&post), Some(&1.0));
        assert_eq!(s.world.route_robberies.len(), 1);
        // Taking from the Trade Org's caravan is theft from it.
        let hq = trade_org_hq(&s.world).unwrap().id.clone();
        assert_matches(&s.world.crimes, json!([{ "kind": "theft", "victimOrg": hq }]));
    }

    #[test]
    #[ignore = "6.1 s alone; see #1132"]
    fn send_a_delivery_again_that_robbers_took_all_of() {
        let mut s = deliveries();
        let city = s.city.clone();
        s.order(json!({ "kind": "buy", "good": "iron", "units": 3, "cityId": city }));
        let before = s.held(&s.storage, Good::Iron).unwrap_or(0.0);
        s.run_until(20_000, |w| step_is(w, CaravanJobStep::Deliver));
        let caravan = caravan_id(&s);
        s.rob(&caravan, stock(&[(Good::Iron, 3.0)]), "thief");
        s.run_until(20_000, |w| w.deliveries.is_empty());
        assert_eq!(s.held(&s.storage, Good::Iron), Some(before + 3.0));
        assert_matches(&s.events("deliveryRobbed", MARA), json!([{ "units": 3 }]));
        assert_eq!(units_of(&s.events("delivered", MARA)), vec![3.0]);
    }

    #[test]
    #[ignore = "5.6 s alone; see #1132"]
    fn fetch_coins_taken_from_a_pick_up_again_so_the_seller_is_paid_for_all_of_it() {
        let mut s = deliveries();
        let (city, storage) = (s.city.clone(), s.storage.clone());
        s.set(&storage, Good::Stone, Some(40.0));
        s.order(json!({ "kind": "sell", "good": "stone", "units": 30, "cityId": city }));
        s.run_until(20_000, |w| step_is(w, CaravanJobStep::Collect));
        let caravan = caravan_id(&s);
        let coins = job(&s.world).unwrap().coins;
        s.rob(&caravan, stock(&[(Good::Coins, coins)]), "thief");
        assert_matches(&job(&s.world), json!({ "step": "load", "coins": 0 }));
        s.run_until(20_000, |w| w.deliveries.is_empty());
        let done = s.events("delivered", MARA).remove(0);
        assert_matches(&done, json!({ "delivery": "pickUp", "units": 30 }));
        let paid = done["coins"].as_f64().unwrap();
        assert!(paid > 0.0);
        assert_eq!(s.held(&storage, Good::Coins), Some(paid));
    }

    #[test]
    #[ignore = "9.1 s alone; see #1132"]
    fn fetch_coins_taken_while_a_pick_up_pays_and_pay_the_rest() {
        let mut s = deliveries();
        let (city, storage) = (s.city.clone(), s.storage.clone());
        s.set(&storage, Good::Stone, Some(40.0));
        s.order(json!({ "kind": "sell", "good": "stone", "units": 30, "cityId": city }));
        s.run_until(20_000, |w| step_is(w, CaravanJobStep::Pay));
        let to_pay = job(&s.world).unwrap().to_pay;
        let coins = job(&s.world).unwrap().coins;
        let caravan = caravan_id(&s);
        s.rob(&caravan, stock(&[(Good::Coins, coins), (Good::Stone, 5.0)]), "thief");
        assert_matches(&job(&s.world), json!({ "robbed": 5 }));
        s.run_until(20_000, |w| w.deliveries.is_empty());
        let done = s.events("delivered", MARA).remove(0);
        assert_matches(&done, json!({ "delivery": "pickUp", "units": 30, "coins": to_pay }));
        assert_eq!(s.held(&storage, Good::Coins), Some(to_pay));
    }

    #[test]
    fn count_robberies_per_route_once_a_tick_and_none_by_the_trade_organization() {
        let mut s = deliveries();
        let caravan = caravan_id(&s);
        let post = s.world.caravans[0].post_id.clone();
        let carriage_id = s.world.caravans[0].carriage_id.clone();
        let k = s.world.carriages.iter().position(|k| k.id == carriage_id).unwrap();
        s.world.carriages[k].load.insert(Good::Iron, 10.0);
        s.rob(&caravan, stock(&[(Good::Iron, 1.0)]), "thief1");
        assert_eq!(s.world.route_robberies.get(&post), Some(&1.0));
        // Two robbers in one tick are one robbery.
        let spot = GoodsSpot::Carriage { carriage_id: carriage_id.clone() };
        let mut takes = Vec::new();
        for id in ["thief1", "thief2"] {
            s.rob(&caravan, Stock::new(), id);
            takes.push(CarryAction {
                kind: CarryKind::Take,
                resident_id: id.into(),
                spot: spot.clone(),
                goods: stock(&[(Good::Iron, 1.0)]),
            });
        }
        let size = s.size();
        resolve_carrying(&mut s.world, &takes, size);
        assert_eq!(s.world.route_robberies.get(&post), Some(&2.0));
        // Its own driver unloading robs nothing.
        let driver = s.world.caravans[0].driver_id.clone().unwrap();
        let (x, y) = (s.world.carriages[k].x, s.world.carriages[k].y);
        let d = s.world.residents.iter_mut().find(|r| r.id == driver).unwrap();
        d.x = x;
        d.y = y;
        let take = CarryAction {
            kind: CarryKind::Take,
            resident_id: driver,
            spot,
            goods: stock(&[(Good::Iron, 1.0)]),
        };
        resolve_carrying_default(&mut s.world, &[take]);
        assert_eq!(s.world.route_robberies.get(&post), Some(&2.0));
        assert_eq!(s.world.route_robberies.len(), 1);
        assert_eq!(s.broken(), Vec::<String>::new());
    }

    #[test]
    fn flag_robberies_counted_for_no_trading_post_or_not_a_whole_number_of_times() {
        let mut s = deliveries();
        let post = s.world.caravans[0].post_id.clone();
        s.world.route_robberies = [(post.clone(), 2.0)].into_iter().collect();
        assert_eq!(route_robberies_sound(&s.world), vec![]);
        s.world.route_robberies = [(post, 0.0), ("nowhere".to_string(), 1.0)].into_iter().collect();
        assert_eq!(route_robberies_sound(&s.world).len(), 2);
    }
}
