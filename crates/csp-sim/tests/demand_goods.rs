//! `apps/server/src/demand-goods.test.ts`, one test per `it`, from `setup()` of
//! `transfers.fixture.ts` (`fixtures/trade/transfers.json`).

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::balance::{DIRECT_OFFERS_TO_ONE_REALM, DIRECT_OFFER_DAYS};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Demand, Good, Offer, Stock, TradeOrgCity, WorldState};
use csp_sim::demands::demands_sound;
use csp_sim::hq_fall::hq_falls;
use csp_sim::offers::{offers_keep_goods, offers_sound, step_offers};
use csp_sim::queries::demand::{transfer_loads, transfer_loads_fee};
use csp_sim::queries::direct_offer::direct_offer_problem;
use csp_sim::queries::goods::free_stock;
use csp_sim::queries::offers::quote_offer;
use csp_sim::queries::residents::good_weight;
use csp_sim::queries::transfer::{nearest_warehouse, transfer_fee, transfer_load, transfer_tiles};
use csp_sim::queries::warehouse_trade::{TradeHolder, TradeLimit};
use csp_sim::starting_city::found_starting_city;
use serde_json::{json, Value};
use transfers_fixture::{answer, assert_matches, setup, Fixture, IVO, MARA};

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

/// A grown resident of `owner` on a tile, with nothing in hand.
fn stand(world: &mut WorldState, id: &str, owner: &str, at: (f64, f64)) {
    let seed = world.residents.len() as f64 + 31.0;
    let mut r = goods_support::new_resident(seed, id, Some(owner), at.0, at.1);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.carried = Stock::new();
    world.residents.push(r);
}

/// Mara has demanded goods of Ivo, whose storage holds them, and he has someone at her storage, so
/// he sees where to send them. The demand is `d1`.
fn demanded(goods: &[(Good, f64)]) -> Fixture {
    let mut s = setup();
    let demand: Demand = serde_json::from_value(json!({
        "id": "d1", "fromId": s.realm, "toId": s.other,
        "terms": { "kind": "goods", "goods": stock(goods) }, "note": "Pay what you owe.",
        "sentAt": 0, "deadline": 10.0 * TICKS_PER_GAME_DAY,
    }))
    .unwrap();
    s.world.demands.push(demand);
    let to_storage = s.to_storage.clone();
    s.b_mut(&to_storage).stock = Some(stock(&[
        (Good::Food, 40.0),
        (Good::Iron, 40.0),
        (Good::Stone, 40.0),
        (Good::Coins, 3_000.0),
    ]));
    let (other, at) = (s.other.clone(), s.xy(&s.storage));
    stand(&mut s.world, "scout", &other, at);
    s
}

/// Ivo's answer to the demand, applied, and what it says.
fn accept(s: &mut Fixture, hand_over: Option<Value>, demand_id: &str) -> String {
    let mut o = json!({ "kind": "acceptDemand", "demandId": demand_id });
    if let Some(h) = hand_over {
        o["handOver"] = h;
    }
    s.send(IVO, o)
}

fn set_aside(s: &Fixture) -> Option<Value> {
    Some(json!({ "way": "setAside", "storageId": s.to_storage }))
}

fn by_transfer(s: &Fixture) -> Option<Value> {
    Some(json!({ "way": "transfer", "fromCityId": s.to_city, "toCityId": s.city }))
}

/// The demand's log lines of a Player.
fn told(s: &Fixture, user: u64) -> Vec<Value> {
    s.events("demand", user)
}

fn free(s: &Fixture, g: Good) -> f64 {
    free_stock(&s.world, &s.to_storage, None).get(&g).copied().unwrap_or(0.0)
}

fn refused(reason: String, part: &str) {
    assert!(reason.contains(part), "{reason:?} does not say {part:?}");
}

fn carried(s: &Fixture, id: &str, g: Good) -> Option<f64> {
    s.world.residents.iter().find(|r| r.id == id).unwrap().carried.get(&g).copied()
}

fn city_name(s: &Fixture, id: &str) -> String {
    s.world.cities.iter().find(|c| c.id == id).unwrap().name.clone()
}

mod accepting_a_demand_for_goods_set_aside {
    use super::*;

    #[test]
    fn sets_each_good_aside_at_the_storage_picked_for_the_sender_and_answers_the_demand() {
        let mut s = demanded(&[(Good::Food, 5.0), (Good::Coins, 20.0)]);
        let hand_over = set_aside(&s);
        assert_eq!(accept(&mut s, hand_over, "d1"), "ack");
        assert_eq!(s.world.demands, vec![]);
        let terms: Vec<_> =
            s.world.offers.iter().map(|o| (o.gives, o.times, o.gives_units, o.wants_units)).collect();
        assert_eq!(terms, vec![(Good::Food, 5.0, 1.0, 0.0), (Good::Coins, 20.0, 1.0, 0.0)]);
        let lapses_at = s.world.tick as f64 + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY;
        for o in &s.world.offers {
            assert_matches(
                o,
                json!({ "realmId": s.other, "storageId": s.to_storage,
                    "direct": { "toId": s.realm, "lapsesAt": lapses_at } }),
            );
        }
        // Still in the storage, but no longer free for anyone else to use.
        assert_eq!(s.held(&s.to_storage, Good::Food), Some(40.0));
        assert_eq!(free(&s, Good::Food), 35.0);
        let (x, y) = s.xy(&s.to_storage);
        let handed_over =
            json!({ "way": "setAside", "goods": { "food": 5, "coins": 20 }, "x": x, "y": y });
        let accepted = json!({ "what": "accepted", "handedOver": handed_over });
        assert_matches(told(&s, MARA).last().unwrap(), accepted.clone());
        assert_matches(told(&s, IVO).last().unwrap(), accepted);
        assert_eq!(offers_sound(&s.world), vec![]);
        assert_eq!(demands_sound(&s.world), vec![]);
    }

    #[test]
    fn is_fetched_by_the_sender_alone_wanting_nothing_back_and_changes_no_standing() {
        let mut s = demanded(&[(Good::Iron, 4.0)]);
        let hand_over = set_aside(&s);
        accept(&mut s, hand_over, "d1");
        let offer_id = s.world.offers[0].id.clone();
        let third = found_starting_city(&mut s.world, &s.terrain.clone(), 9, None);
        let third = s.world.realms[third].id.clone();
        let (at, other, realm) = (s.xy(&s.to_storage), s.other.clone(), s.realm.clone());
        stand(&mut s.world, "stranger", &third, at);
        stand(&mut s.world, "own", &other, at);
        stand(&mut s.world, "fetcher", &realm, at);
        let accepting =
            |resident: &str| json!({ "kind": "acceptOffer", "offerId": offer_id, "times": 4,
                "residentId": resident });
        let mut ask = |s: &mut Fixture, user: u64, resident: &str| {
            let sender = goods_support::player(user);
            answer(s.queue.receive(&s.world, &sender, &json!("q"), &accepting(resident)))
        };
        assert_eq!(ask(&mut s, 9, "stranger"), "that offer is for another realm");
        assert_eq!(ask(&mut s, IVO, "own"), "that offer is your own");
        let iron = s.total(Good::Iron);
        let standings = s.world.standings.clone();
        assert_eq!(s.order(accepting("fetcher")), "ack");
        s.run_until(5, |w| w.offers.is_empty());
        assert_eq!(carried(&s, "fetcher", Good::Iron), Some(4.0));
        assert_eq!(carried(&s, "fetcher", Good::Coins), None);
        assert_eq!(s.held(&s.to_storage, Good::Iron), Some(36.0));
        assert_eq!(s.total(Good::Iron), iron);
        assert_eq!(s.world.standings, standings);
        assert_matches(
            &s.events("offerAccepted", MARA)[0],
            json!({ "givesUnits": 4, "wantsUnits": 0, "times": 4 }),
        );
        assert_matches(&s.events("offerTaken", IVO)[0], json!({ "givesUnits": 4 }));
        assert_eq!(offers_keep_goods(&s.scratch.offers), vec![]);
    }

    #[test]
    fn can_be_fetched_over_several_trips_as_much_as_the_hands_hold() {
        let mut s = demanded(&[(Good::Iron, 40.0)]);
        let hand_over = set_aside(&s);
        accept(&mut s, hand_over, "d1");
        let offer_id = s.world.offers[0].id.clone();
        let (at, realm) = (s.xy(&s.to_storage), s.realm.clone());
        stand(&mut s.world, "fetcher", &realm, at);
        let o = json!({ "kind": "acceptOffer", "offerId": offer_id, "times": 40,
            "residentId": "fetcher" });
        assert_eq!(s.order(o), "ack");
        let iron_of = |w: &WorldState| {
            w.residents.iter().find(|r| r.id == "fetcher").unwrap().carried.get(&Good::Iron).copied()
        };
        s.run_until(5, |w| iron_of(w).unwrap_or(0.0) > 0.0);
        let took = iron_of(&s.world).unwrap();
        assert!(took < 40.0);
        assert_eq!(s.world.offers[0].times, 40.0 - took);
    }

    #[test]
    fn sets_aside_only_what_the_storage_holds_when_it_is_short() {
        let mut s = demanded(&[(Good::Food, 50.0), (Good::Iron, 5.0), (Good::Stone, 3.0)]);
        let to_storage = s.to_storage.clone();
        s.b_mut(&to_storage).stock = Some(stock(&[(Good::Food, 12.5), (Good::Iron, 5.0)]));
        let hand_over = set_aside(&s);
        assert_eq!(accept(&mut s, hand_over, "d1"), "ack");
        let terms: Vec<_> = s.world.offers.iter().map(|o| (o.gives, o.times)).collect();
        assert_eq!(terms, vec![(Good::Food, 12.0), (Good::Iron, 5.0)]);
        let last = told(&s, MARA).pop().unwrap();
        assert_eq!(last["handedOver"]["goods"], json!({ "food": 12.0, "iron": 5.0 }));
        assert_matches(&last["terms"], json!({ "goods": { "food": 50, "iron": 5, "stone": 3 } }));
        assert_eq!(offers_sound(&s.world), vec![]);
    }

    #[test]
    fn counts_goods_already_set_aside_as_not_there() {
        let mut s = demanded(&[(Good::Food, 50.0)]);
        let to_storage = s.to_storage.clone();
        s.b_mut(&to_storage).stock = Some(stock(&[(Good::Food, 10.0)]));
        let (x, y) = s.xy(&to_storage);
        s.world.offers.push(Offer {
            id: "held".into(),
            realm_id: s.other.clone(),
            storage_id: to_storage,
            x,
            y,
            gives: Good::Food,
            gives_units: 1.0,
            wants: Good::Coins,
            wants_units: 1.0,
            times: 10.0,
            direct: None,
        });
        let hand_over = set_aside(&s);
        refused(accept(&mut s, hand_over, "d1"), "holds none of it");
        assert_eq!(s.world.demands.len(), 1);
    }

    #[test]
    fn is_refused_with_none_of_it_there_and_the_demand_stays_to_decline() {
        let mut s = demanded(&[(Good::Food, 5.0)]);
        let to_storage = s.to_storage.clone();
        s.b_mut(&to_storage).stock = Some(stock(&[(Good::Iron, 5.0)]));
        let hand_over = set_aside(&s);
        refused(accept(&mut s, hand_over, "d1"), "holds none of it");
        assert_eq!(s.world.demands.len(), 1);
        assert_eq!(told(&s, IVO), Vec::<Value>::new());
    }

    #[test]
    fn takes_the_storages_goods_for_the_first_of_two_demands_accepted_in_one_tick() {
        let mut s = demanded(&[(Good::Food, 8.0)]);
        let to_storage = s.to_storage.clone();
        s.b_mut(&to_storage).stock = Some(stock(&[(Good::Food, 8.0)]));
        let mut d2 = s.world.demands[0].clone();
        d2.id = "d2".into();
        s.world.demands.push(d2);
        let ivo = goods_support::player(IVO);
        for (q, id) in [("a", "d1"), ("b", "d2")] {
            let o = json!({ "kind": "acceptDemand", "demandId": id, "handOver": set_aside(&s) });
            s.queue.receive(&s.world, &ivo, &json!(q), &o);
        }
        s.queue.apply_all(&mut s.world);
        assert_eq!(s.world.offers.len(), 1);
        let ids: Vec<_> = s.world.demands.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["d2"]);
        assert_eq!(offers_sound(&s.world), vec![]);
    }

    #[test]
    fn needs_a_way_at_a_finished_storage_of_their_own() {
        let mut s = demanded(&[(Good::Food, 5.0)]);
        refused(accept(&mut s, None, "d1"), "set the goods aside");
        refused(accept(&mut s, Some(json!({ "way": "throw" })), "d1"), "set the goods aside");
        let hers = json!({ "way": "setAside", "storageId": s.storage });
        refused(accept(&mut s, Some(hers), "d1"), "not a finished");
        let nowhere = json!({ "way": "setAside", "storageId": "nowhere" });
        refused(accept(&mut s, Some(nowhere), "d1"), "not a finished");
        assert_eq!(s.world.demands.len(), 1);
        assert_eq!(s.world.offers, vec![]);
    }

    #[test]
    fn takes_no_slot_of_the_direct_offers_that_can_stand_to_one_realm() {
        let goods = [(Good::Food, 1.0), (Good::Iron, 1.0), (Good::Stone, 1.0), (Good::Coins, 1.0)];
        let mut s = demanded(&goods);
        let hand_over = set_aside(&s);
        accept(&mut s, hand_over, "d1");
        for i in 0..DIRECT_OFFERS_TO_ONE_REALM as usize - 1 {
            let mut o = s.world.offers[0].clone();
            o.id = format!("sent{i}");
            o.wants_units = 1.0;
            s.world.offers.push(o);
        }
        let terms = json!({ "storageId": s.to_storage, "gives": "stone", "givesUnits": 1,
            "wants": "iron", "wantsUnits": 1, "times": 1 });
        let problem =
            direct_offer_problem(&s.world, &s.other, Some(&s.realm), terms.as_object().unwrap());
        assert_eq!(problem, None);
    }

    #[test]
    fn goes_back_to_ordinary_goods_when_the_sender_declines_it_or_it_lapses_and_both_hear() {
        let mut s = demanded(&[(Good::Food, 5.0), (Good::Iron, 2.0)]);
        let hand_over = set_aside(&s);
        accept(&mut s, hand_over, "d1");
        let food = s.world.offers[0].id.clone();
        let iron_lapses = s.world.offers[1].direct.as_ref().unwrap().lapses_at;
        assert_eq!(s.order(json!({ "kind": "declineOffer", "offerId": food })), "ack");
        assert_eq!(free(&s, Good::Food), 40.0);
        let why: Vec<_> = s.events("offerEnded", IVO).iter().map(|e| e["why"].clone()).collect();
        assert_eq!(why, vec![json!("declined")]);
        s.world.tick = iron_lapses as u64;
        step_offers(&mut s.world);
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(free(&s, Good::Iron), 40.0);
        let what: Vec<_> =
            s.events("directOffer", MARA).iter().map(|e| e["what"].clone()).collect();
        assert_eq!(what, vec![json!("declined"), json!("lapsed")]);
    }

    #[test]
    fn is_cut_down_with_what_goes_from_the_storage_as_any_offer_is() {
        let mut s = demanded(&[(Good::Iron, 10.0)]);
        let hand_over = set_aside(&s);
        accept(&mut s, hand_over, "d1");
        let to_storage = s.to_storage.clone();
        s.set(&to_storage, Good::Iron, Some(4.0));
        step_offers(&mut s.world);
        assert_eq!(s.world.offers[0].times, 4.0);
        assert_eq!(offers_sound(&s.world), vec![]);
    }
}

mod accepting_a_demand_for_goods_by_transfer {
    use super::*;

    #[test]
    fn orders_a_transfer_for_each_good_that_the_one_accepting_pays_for() {
        let mut s = demanded(&[(Good::Iron, 10.0), (Good::Food, 5.0)]);
        let hand_over = by_transfer(&s);
        assert_eq!(accept(&mut s, hand_over, "d1"), "ack");
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(s.world.offers, vec![]);
        let made: Vec<_> = s
            .world
            .transfers
            .iter()
            .map(|t| {
                let v = serde_json::to_value(t).unwrap();
                json!([v["realmId"], v["toRealmId"], v["fromCityId"], v["toCityId"], v["good"],
                    v["units"]])
            })
            .collect();
        let (o, r, tc, c) = (&s.other, &s.realm, &s.to_city, &s.city);
        assert_eq!(made, vec![json!([o, r, tc, c, "food", 5.0]), json!([o, r, tc, c, "iron", 10.0])]);
        assert_matches(
            told(&s, MARA).last().unwrap(),
            json!({ "what": "accepted", "handedOver": { "way": "transfer",
                "goods": { "food": 5, "iron": 10 }, "fromCity": city_name(&s, tc),
                "toCity": city_name(&s, c) } }),
        );
        assert_eq!(s.events("transferOrdered", IVO).len(), 2);
    }

    #[test]
    #[ignore = "slow in the TypeScript too; timed in the PR"]
    fn brings_them_to_the_senders_storage_by_caravan_the_fee_out_of_the_one_accepting() {
        let mut s = demanded(&[(Good::Iron, 10.0)]);
        let (from, to) = (s.xy(&s.to_storage), s.xy(&s.storage));
        let near = nearest_warehouse(&s.world, from, s.size()).unwrap();
        let tiles = transfer_tiles(s.size(), (near.x, near.y), Some(from), to);
        let iron = s.held(&s.storage, Good::Iron).unwrap_or(0.0);
        let coins = s.held(&s.to_storage, Good::Coins).unwrap();
        let her_coins = s.held(&s.storage, Good::Coins).unwrap();
        let hand_over = by_transfer(&s);
        assert_eq!(accept(&mut s, hand_over, "d1"), "ack");
        s.run_until(20_000, |w| w.transfers.is_empty());
        assert_eq!(s.held(&s.storage, Good::Iron), Some(iron + 10.0));
        assert!(s.held(&s.to_storage, Good::Iron).unwrap() <= 30.0);
        let fee = transfer_fee(10.0 * good_weight(Good::Iron), tiles);
        assert_eq!(transfer_loads_fee(&stock(&[(Good::Iron, 10.0)]), tiles), fee);
        assert!(s.held(&s.to_storage, Good::Coins).unwrap() <= coins - fee);
        assert!(s.held(&s.storage, Good::Coins).unwrap() >= her_coins);
        assert_matches(&s.events("transferred", MARA)[0], json!({ "units": 10, "fee": fee }));
    }

    #[test]
    fn takes_more_than_one_load_as_several_transfers() {
        let load = transfer_load(Good::Iron);
        let mut s = demanded(&[(Good::Iron, load + 3.0)]);
        let to_storage = s.to_storage.clone();
        s.set(&to_storage, Good::Iron, Some(load + 3.0));
        assert_eq!(
            transfer_loads(&stock(&[(Good::Iron, load + 3.0)])),
            vec![(Good::Iron, load), (Good::Iron, 3.0)]
        );
        let hand_over = by_transfer(&s);
        assert_eq!(accept(&mut s, hand_over, "d1"), "ack");
        let units: Vec<f64> = s.world.transfers.iter().map(|t| t.units).collect();
        assert_eq!(units, vec![load, 3.0]);
        assert_eq!(s.broken(), Vec::<String>::new());
    }

    #[test]
    fn sends_only_what_the_storage_holds_and_none_of_it_is_refused() {
        let mut s = demanded(&[(Good::Iron, 10.0), (Good::Stone, 3.0)]);
        let to_storage = s.to_storage.clone();
        s.b_mut(&to_storage).stock = Some(stock(&[(Good::Iron, 4.0), (Good::Coins, 500.0)]));
        let hand_over = by_transfer(&s);
        assert_eq!(accept(&mut s, hand_over, "d1"), "ack");
        let sent: Vec<_> = s.world.transfers.iter().map(|t| (t.good, t.units)).collect();
        assert_eq!(sent, vec![(Good::Iron, 4.0)]);
        let mut none = demanded(&[(Good::Stone, 3.0)]);
        let to_storage = none.to_storage.clone();
        none.b_mut(&to_storage).stock = Some(stock(&[(Good::Coins, 500.0)]));
        let hand_over = by_transfer(&none);
        refused(accept(&mut none, hand_over, "d1"), "holds none of it");
        assert_eq!(none.world.demands.len(), 1);
    }

    #[test]
    fn goes_only_from_a_city_of_theirs_to_a_city_of_the_senders_whose_storage_they_see() {
        let mut s = demanded(&[(Good::Iron, 1.0)]);
        let away = json!({ "way": "transfer", "toCityId": s.city, "fromCityId": s.city });
        refused(accept(&mut s, Some(away), "d1"), "not one of your cities");
        let mut theirs = by_transfer(&s).unwrap();
        theirs["toCityId"] = json!(s.to_city);
        refused(accept(&mut s, Some(theirs), "d1"), "city of theirs");
        s.world.residents.retain(|r| r.id != "scout");
        let hand_over = by_transfer(&s);
        refused(accept(&mut s, hand_over, "d1"), "don’t see");
        assert_eq!(s.world.demands.len(), 1);
        assert_eq!(s.world.transfers, vec![]);
    }

    #[test]
    fn is_out_of_the_question_once_the_hq_has_fallen() {
        let mut s = demanded(&[(Good::Iron, 1.0)]);
        let hq = s.world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq)).unwrap();
        let hq = hq.id.clone();
        hq_falls(&mut s.world, &hq);
        let hand_over = by_transfer(&s);
        let reason = accept(&mut s, hand_over, "d1");
        assert!(reason.to_lowercase().contains("caravans"), "{reason}");
        let hand_over = set_aside(&s);
        assert_eq!(accept(&mut s, hand_over, "d1"), "ack");
    }
}

mod an_offer_that_wants_nothing {
    use super::*;

    fn offer() -> Offer {
        serde_json::from_value(json!({
            "id": "o", "realmId": "r", "storageId": "s", "x": 0, "y": 0, "gives": "iron",
            "givesUnits": 1, "wants": "coins", "wantsUnits": 0, "times": 8,
        }))
        .unwrap()
    }

    #[test]
    fn asks_for_nothing_to_pay_with_and_is_cut_only_by_what_fits() {
        let empty = Stock::new();
        let q = quote_offer(&offer(), &TradeHolder { stock: &empty, room: 1_000.0 }, 8.0, 8.0);
        assert_eq!((q.times, q.gives, q.wants, q.limit), (8.0, 8.0, 0.0, None));
        let room = 3.0 * good_weight(Good::Iron);
        let q = quote_offer(&offer(), &TradeHolder { stock: &empty, room }, 8.0, 8.0);
        assert_eq!((q.times, q.limit), (3.0, Some(TradeLimit::Room)));
    }

    #[test]
    fn is_sound_only_as_a_direct_offer() {
        let mut s = demanded(&[(Good::Iron, 8.0)]);
        let hand_over = set_aside(&s);
        accept(&mut s, hand_over, "d1");
        assert_eq!(offers_sound(&s.world), vec![]);
        s.world.offers[0].direct = None;
        let found = offers_sound(&s.world);
        assert!(found[0].message.contains("aren’t whole and positive"), "{found:?}");
    }
}
