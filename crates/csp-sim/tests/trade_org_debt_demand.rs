//! `apps/server/src/trade-org-debt-demand.test.ts`, one test per `it`, from `setup()` of
//! `transfers.fixture.ts` (`fixtures/trade/transfers.json`). How a realm's Demands read to its
//! client (`demandsFor`) is a client view and comes with the server.

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::balance::{
    DEMAND_DECLINED_STANDING_LOSS, DEMAND_NOTE_MAX_LENGTH, NPC_PLAN_TICKS,
    TRADE_ORG_DEBT_DEMAND_DAYS, TRADE_ORG_REFUSES_TRADE_BELOW,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Debt, DebtStep, Demand, Good, WorldState};
use csp_sim::demands::{
    answer_demands, demands_sound, lapse_demands_on_leader_death, step_demands,
};
use csp_sim::hq_fall::{hq_falls, nothing_left_of_the_hq};
use csp_sim::offers::{offers_sound, step_offers};
use csp_sim::queries::goods::free_stock;
use csp_sim::queries::standing::{standing_of, TRADE_ORG};
use csp_sim::queries::trade_org::trade_org_hq;
use csp_sim::queries::transfer::transfer_load;
use csp_sim::queries::warehouse_trade::debt_of;
use csp_sim::standing::change_standing;
use csp_sim::trade_org_debt::{debt_demands_sound, owe_trade_org, step_debts, FirstOwed};
use csp_sim::transfers::{collects_transfer_from, transfers_sound};
use serde_json::{json, Value};
use transfers_fixture::{add_city, assert_matches, setup, Fixture, MARA};

const OWED: f64 = 300.0;

/// Mara's realm owes the Trade Organization `coins`, and has its demand for them.
fn owing(coins: f64) -> Fixture {
    let mut s = setup();
    let realm = s.realm.clone();
    owe_trade_org(&mut s.world, &realm, coins, None, FirstOwed::Owed);
    step_debts(&mut s.world);
    s
}

fn debt(s: &Fixture) -> Option<&Debt> {
    s.world.debts.iter().find(|d| d.org == s.realm)
}

fn debt_mut(s: &mut Fixture) -> &mut Debt {
    let realm = s.realm.clone();
    s.world.debts.iter_mut().find(|d| d.org == realm).unwrap()
}

fn demand(s: &Fixture) -> Option<&Demand> {
    s.world.demands.iter().find(|d| d.from_id == TRADE_ORG)
}

/// Mara's answer to the demand, applied, and what it says.
fn answer(s: &mut Fixture, kind: &str, hand_over: Option<Value>) -> String {
    let mut o = json!({ "kind": kind, "demandId": demand(s).unwrap().id });
    if let Some(h) = hand_over {
        o["handOver"] = h;
    }
    s.send(MARA, o)
}

fn set_aside(s: &Fixture) -> Option<Value> {
    Some(json!({ "way": "setAside", "storageId": s.storage }))
}

fn by_transfer(s: &Fixture) -> Option<Value> {
    Some(json!({ "way": "transfer", "fromCityId": s.city, "toCityId": "" }))
}

/// The Coins the Trade Organization's warehouses hold.
fn trade_org_coins(world: &WorldState) -> f64 {
    world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Warehouse)
        .map(|b| b.stock.as_ref().and_then(|s| s.get(&Good::Coins)).copied().unwrap_or(0.0))
        .sum()
}

fn overdue(s: &Fixture) -> Vec<Value> {
    s.events("debt", MARA).into_iter().filter(|e| e["what"] == "overdue").collect()
}

fn last_demand_line(s: &Fixture) -> Value {
    s.events("demand", MARA).pop().unwrap()
}

fn coins(s: &Fixture) -> f64 {
    s.held(&s.storage, Good::Coins).unwrap_or(0.0)
}

fn free_coins(s: &Fixture) -> f64 {
    free_stock(&s.world, &s.storage, s.b(&s.storage).stock.as_ref())
        .get(&Good::Coins)
        .copied()
        .unwrap_or(0.0)
}

fn owes(s: &Fixture) -> f64 {
    debt_of(&s.world, &s.realm)
}

fn plain_debt(org: &str, coins: f64, step: DebtStep) -> Debt {
    serde_json::from_value(json!({ "org": org, "coins": coins, "step": step })).unwrap()
}

mod the_trade_organization_demands_a_debt {
    use super::*;

    #[test]
    fn sends_a_demand_for_what_is_owed_with_a_deadline_and_a_note_at_once() {
        let s = owing(OWED);
        assert_eq!(s.world.demands.len(), 1);
        let d = demand(&s).unwrap();
        let tick = s.world.tick as f64;
        assert_matches(
            d,
            json!({ "fromId": TRADE_ORG, "toId": s.realm,
                "terms": { "kind": "goods", "goods": { "coins": OWED } }, "sentAt": tick,
                "deadline": tick + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY }),
        );
        let len = d.note.chars().count() as f64;
        assert!(len > 0.0 && len <= DEMAND_NOTE_MAX_LENGTH);
        assert_matches(debt(&s).unwrap(), json!({ "step": "demanded", "deadline": d.deadline }));
        assert_matches(
            &last_demand_line(&s),
            json!({ "what": "received", "mine": false, "other": "the Trade Organization",
                "otherIs": "tradeOrg", "terms": { "kind": "goods", "goods": { "coins": OWED } } }),
        );
        assert_eq!(s.broken(), Vec::<String>::new());
    }

    #[test]
    fn is_sent_once_per_debt_also_through_a_rise_and_once_answered() {
        let mut s = owing(OWED);
        let realm = s.realm.clone();
        step_debts(&mut s.world);
        owe_trade_org(&mut s.world, &realm, 50.0, None, FirstOwed::Owed);
        step_debts(&mut s.world);
        assert_eq!(s.world.demands.len(), 1);
        assert_eq!(answer(&mut s, "declineDemand", None), "ack");
        owe_trade_org(&mut s.world, &realm, 50.0, None, FirstOwed::Owed);
        step_debts(&mut s.world);
        assert_eq!(s.world.demands, vec![]);
        let sent = s.events("demand", MARA).into_iter().filter(|e| e["what"] == "received");
        assert_eq!(sent.count(), 1);
    }

    #[test]
    fn sends_a_new_one_for_a_new_debt_after_the_old_one_is_settled() {
        let mut s = owing(OWED);
        let realm = s.realm.clone();
        assert_eq!(answer(&mut s, "declineDemand", None), "ack");
        s.world.debts = vec![];
        step_debts(&mut s.world);
        assert_eq!(s.world.demands, vec![]);
        owe_trade_org(&mut s.world, &realm, 40.0, None, FirstOwed::Owed);
        step_debts(&mut s.world);
        assert_matches(
            &demand(&s).unwrap().terms,
            json!({ "kind": "goods", "goods": { "coins": 40 } }),
        );
        assert_eq!(debt(&s).unwrap().step, Some(DebtStep::Demanded));
    }

    #[test]
    fn asks_for_what_is_owed_now_as_it_rises_or_is_paid_in_part() {
        let mut s = owing(OWED);
        let realm = s.realm.clone();
        owe_trade_org(&mut s.world, &realm, 50.0, None, FirstOwed::Owed);
        step_debts(&mut s.world);
        assert_matches(
            &demand(&s).unwrap().terms,
            json!({ "kind": "goods", "goods": { "coins": OWED + 50.0 } }),
        );
        assert_eq!(s.order(json!({ "kind": "payDebt", "coins": 100 })), "ack");
        s.run_until(1, |w| debt_of(w, &realm) == OWED - 50.0);
        assert_matches(
            &demand(&s).unwrap().terms,
            json!({ "kind": "goods", "goods": { "coins": OWED - 50.0 } }),
        );
    }

    #[test]
    fn sends_none_with_the_hq_fallen() {
        let mut s = setup();
        let hq = trade_org_hq(&s.world).unwrap().id.clone();
        hq_falls(&mut s.world, &hq);
        s.world.debts =
            vec![serde_json::from_value(json!({ "org": s.realm, "coins": 10 })).unwrap()];
        step_debts(&mut s.world);
        assert_eq!(s.world.demands, vec![]);
    }
}

mod paying_at_a_warehouse {
    use super::*;

    #[test]
    fn settles_it_the_demand_goes_and_no_next_step_starts() {
        let mut s = owing(OWED);
        let realm = s.realm.clone();
        assert_eq!(s.order(json!({ "kind": "payDebt", "coins": OWED })), "ack");
        s.run_until(1, |w| !w.debts.iter().any(|d| d.org == realm));
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(overdue(&s), Vec::<Value>::new());
        assert_matches(&s.events("debtPaid", MARA).pop().unwrap(), json!({ "owed": 0 }));
        assert_eq!(s.broken(), Vec::<String>::new());
    }

    #[test]
    fn in_part_leaves_the_demand_and_its_deadline_as_they_were() {
        let mut s = owing(OWED);
        let realm = s.realm.clone();
        let deadline = demand(&s).unwrap().deadline;
        assert_eq!(s.order(json!({ "kind": "payDebt", "coins": 100 })), "ack");
        s.run_until(1, |w| debt_of(w, &realm) == OWED - 100.0);
        assert_eq!(demand(&s).unwrap().deadline, deadline);
        assert_eq!(debt(&s).unwrap().step, Some(DebtStep::Demanded));
    }

    #[test]
    fn in_full_ends_what_was_set_aside_for_a_caravan_not_yet_on_its_way() {
        let mut s = owing(OWED);
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        assert_eq!(s.world.transfers.len(), 1);
        s.world.debts = vec![];
        step_debts(&mut s.world);
        assert_eq!(s.world.transfers, vec![]);
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(free_coins(&s), coins(&s));
        assert_eq!(s.broken(), Vec::<String>::new());
    }
}

mod declining_or_letting_it_lapse {
    use super::*;

    #[test]
    fn starts_the_next_step_when_it_lapses() {
        let mut s = owing(OWED);
        let tick = s.world.tick as f64;
        s.world.demands.iter_mut().find(|d| d.from_id == TRADE_ORG).unwrap().deadline = tick;
        step_demands(&mut s.world);
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(debt(&s), Some(&plain_debt(&s.realm, OWED, DebtStep::Wrecks)));
        assert_matches(&last_demand_line(&s), json!({ "what": "lapsed", "otherIs": "tradeOrg" }));
        assert_matches(&overdue(&s), json!([{ "owed": OWED }]));
        step_debts(&mut s.world);
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(s.broken(), Vec::<String>::new());
    }

    #[test]
    fn starts_the_next_step_when_it_is_declined_without_waiting_for_the_deadline() {
        let mut s = owing(OWED);
        assert_eq!(answer(&mut s, "declineDemand", None), "ack");
        assert_eq!(debt(&s), Some(&plain_debt(&s.realm, OWED, DebtStep::Wrecks)));
        assert_eq!(overdue(&s).len(), 1);
        assert_matches(&last_demand_line(&s), json!({ "what": "declined", "mine": false }));
        assert_eq!(s.broken(), Vec::<String>::new());
    }

    #[test]
    fn is_the_trade_organizations_doing_alone_a_realms_demand_that_lapses_starts_no_step() {
        let mut s = owing(OWED);
        let mut other = demand(&s).unwrap().clone();
        other.id = "other".into();
        other.from_id = s.other.clone();
        other.deadline = s.world.tick as f64;
        s.world.demands.push(other);
        step_demands(&mut s.world);
        assert_eq!(debt(&s).unwrap().step, Some(DebtStep::Demanded));
    }

    #[test]
    fn goes_with_the_debt_when_the_leader_dies_it_just_ends() {
        let mut s = owing(OWED);
        let realm = s.realm.clone();
        lapse_demands_on_leader_death(&mut s.world, &realm);
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(overdue(&s), Vec::<Value>::new());
    }
}

mod accepting {
    use super::*;

    #[test]
    #[ignore = "7.1 s alone; see #1132"]
    fn sets_the_coins_aside_for_a_caravan_which_fetches_them_for_no_fee_and_settles_the_debt() {
        let mut s = owing(OWED);
        let before = coins(&s);
        let held = trade_org_coins(&s.world);
        let all = s.total(Good::Coins);
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        assert_eq!(s.world.demands, vec![]);
        assert_matches(
            &s.world.offers,
            json!([{ "realmId": s.realm, "storageId": s.storage, "gives": "coins",
                "times": OWED }]),
        );
        let offer = &s.world.offers[0];
        assert_eq!(offer.direct.as_ref().unwrap().to_id, TRADE_ORG);
        assert_eq!(free_coins(&s), before - OWED);
        assert_matches(
            &s.world.transfers,
            json!([{ "realmId": s.realm, "toRealmId": TRADE_ORG, "units": OWED,
                "debt": { "storageId": s.storage, "offerId": offer.id } }]),
        );
        assert_matches(
            &last_demand_line(&s),
            json!({ "what": "accepted",
                "handedOver": { "way": "setAside", "goods": { "coins": OWED } } }),
        );
        // It still owes until the caravan has brought them in.
        assert_eq!(owes(&s), OWED);
        let realm = s.realm.clone();
        s.run_until(20_000, |w| !w.debts.iter().any(|d| d.org == realm));
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(s.world.transfers, vec![]);
        assert_eq!(coins(&s), before - OWED);
        assert!(trade_org_coins(&s.world) - held >= OWED - 1.0);
        assert_eq!(s.total(Good::Coins), all);
        assert_matches(
            &s.events("debt", MARA).pop().unwrap(),
            json!({ "what": "collected", "coins": OWED, "owed": 0 }),
        );
        assert_eq!(overdue(&s), Vec::<Value>::new());
    }

    #[test]
    #[ignore = "7.0 s alone; see #1132"]
    fn sends_them_by_a_transfer_to_its_nearest_warehouse_for_the_fee_whoever_it_refuses() {
        let mut s = owing(OWED);
        let realm = s.realm.clone();
        change_standing(&mut s.world, TRADE_ORG, &realm, TRADE_ORG_REFUSES_TRADE_BELOW - 1.0);
        let before = coins(&s);
        let hand_over = by_transfer(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        assert_eq!(s.world.offers, vec![]);
        let t = &s.world.transfers[0];
        assert_matches(
            t,
            json!({ "toRealmId": TRADE_ORG, "units": OWED, "debt": { "storageId": s.storage } }),
        );
        assert_eq!(t.debt.as_ref().unwrap().offer_id, None);
        assert_matches(
            &last_demand_line(&s),
            json!({ "what": "accepted",
                "handedOver": { "way": "transfer", "goods": { "coins": OWED } } }),
        );
        let mut collecting = false;
        let storage = s.storage.clone();
        s.run_until(20_000, |w| {
            let c = w.caravans.iter().find(|c| c.transfer.is_some());
            let driver =
                c.and_then(|c| w.residents.iter().find(|r| Some(&r.id) == c.driver_id.as_ref()));
            collecting |= driver.is_some_and(|d| collects_transfer_from(w, d, &storage));
            !w.debts.iter().any(|d| d.org == realm)
        });
        assert!(collecting);
        assert!(coins(&s) < before - OWED);
        assert_eq!(transfers_sound(&s.world), vec![]);
        assert_eq!(debt_demands_sound(&s.world), vec![]);
    }

    #[test]
    fn splits_what_is_more_than_a_load_into_several_trips() {
        let load = transfer_load(Good::Coins);
        let mut s = owing(load + 5.0);
        let storage = s.storage.clone();
        s.set(&storage, Good::Coins, Some(2.0 * load));
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        let units: Vec<f64> = s.world.transfers.iter().map(|t| t.units).collect();
        assert_eq!(units, vec![load, 5.0]);
        assert_eq!(transfers_sound(&s.world), vec![]);
    }

    #[test]
    #[ignore = "7.1 s alone; see #1132"]
    fn leaves_what_a_short_storage_doesnt_cover_owed_and_starts_the_next_step_at_the_deadline() {
        let mut s = owing(OWED);
        let storage = s.storage.clone();
        s.set(&storage, Good::Coins, Some(100.0));
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        let realm = s.realm.clone();
        s.run_until(20_000, |w| debt_of(w, &realm) == OWED - 100.0);
        assert_eq!(s.world.transfers, vec![]);
        assert_eq!(debt(&s).unwrap().step, Some(DebtStep::Demanded));
        assert_eq!(overdue(&s), Vec::<Value>::new());
        step_debts(&mut s.world);
        assert_eq!(debt(&s).unwrap().step, Some(DebtStep::Demanded));
        let tick = s.world.tick as f64;
        debt_mut(&mut s).deadline = Some(tick);
        step_debts(&mut s.world);
        assert_eq!(debt(&s), Some(&plain_debt(&realm, OWED - 100.0, DebtStep::Wrecks)));
        assert_matches(&overdue(&s), json!([{ "owed": OWED - 100.0 }]));
    }

    #[test]
    fn waits_at_the_deadline_for_a_caravan_still_bringing_them_in() {
        let mut s = owing(OWED);
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        let tick = s.world.tick as f64;
        debt_mut(&mut s).deadline = Some(tick);
        step_debts(&mut s.world);
        assert_eq!(debt(&s).unwrap().step, Some(DebtStep::Demanded));
        assert_eq!(overdue(&s), Vec::<Value>::new());
    }

    #[test]
    #[ignore = "7.1 s alone; see #1132"]
    fn takes_only_what_is_still_owed_when_the_caravan_gets_there() {
        let mut s = owing(OWED);
        let before = coins(&s);
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        s.world.debts[0].coins = 100.0;
        let realm = s.realm.clone();
        s.run_until(20_000, |w| !w.debts.iter().any(|d| d.org == realm));
        assert_eq!(coins(&s), before - 100.0);
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(free_coins(&s), before - 100.0);
    }

    #[test]
    fn refuses_a_storage_outside_a_city_for_its_caravans_fetch_from_cities() {
        let mut s = owing(OWED);
        let (storage, realm) = (s.storage.clone(), s.realm.clone());
        let b = s.b_mut(&storage);
        b.city_id = None;
        b.realm_id = Some(realm);
        let hand_over = set_aside(&s);
        assert_eq!(
            answer(&mut s, "acceptDemand", hand_over),
            "its caravans fetch only from a storage in a city"
        );
        assert!(demand(&s).is_some());
    }

    #[test]
    fn refuses_a_transfer_from_a_city_not_theirs() {
        let mut s = owing(OWED);
        let hand_over = json!({ "way": "transfer", "fromCityId": s.to_city, "toCityId": "" });
        assert_eq!(answer(&mut s, "acceptDemand", Some(hand_over)), "not one of your cities");
    }

    #[test]
    #[ignore = "5.4 s alone; see #1132"]
    fn leaves_it_owed_when_what_was_set_aside_is_taken_back() {
        let mut s = owing(OWED);
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        s.world.offers = vec![];
        s.run_until(20_000, |w| w.transfers.is_empty());
        assert_eq!(owes(&s), OWED);
        assert_eq!(debt(&s).unwrap().step, Some(DebtStep::Demanded));
    }
}

mod the_fall_of_the_hq {
    use super::*;

    #[test]
    fn ends_its_demands_and_what_was_set_aside_for_it_is_ordinary_again() {
        let mut s = owing(OWED);
        let hand_over = set_aside(&s);
        assert_eq!(answer(&mut s, "acceptDemand", hand_over), "ack");
        let other = s.other.clone();
        owe_trade_org(&mut s.world, &other, 20.0, None, FirstOwed::Owed);
        step_debts(&mut s.world);
        assert_eq!(s.world.demands.len(), 1);
        let hq = trade_org_hq(&s.world).unwrap().id.clone();
        hq_falls(&mut s.world, &hq);
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(nothing_left_of_the_hq(&s.world), vec![]);
        step_debts(&mut s.world);
        step_offers(&mut s.world);
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(free_coins(&s), coins(&s));
        assert_eq!(offers_sound(&s.world), vec![]);
        assert_eq!(demands_sound(&s.world), vec![]);
    }
}

mod an_npc_city_that_owes {
    use super::*;

    #[test]
    fn answers_like_any_demand_it_declines_thinks_less_of_it_and_the_next_step_starts() {
        let mut s = setup();
        add_city(&mut s.world, "n1", "Oakford", 400.0, 100.0);
        owe_trade_org(&mut s.world, "n1", 30.0, None, FirstOwed::Owed);
        step_debts(&mut s.world);
        assert_matches(&s.world.demands, json!([{ "fromId": TRADE_ORG, "toId": "n1" }]));
        assert_eq!(demands_sound(&s.world), vec![]);
        assert_eq!(debt_demands_sound(&s.world), vec![]);
        let mut t = 0.0;
        while t < NPC_PLAN_TICKS && !s.world.demands.is_empty() {
            s.world.tick += 1;
            answer_demands(&mut s.world, 512);
            t += 1.0;
        }
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(standing_of(&s.world, "n1", TRADE_ORG), -DEMAND_DECLINED_STANDING_LOSS);
        assert_eq!(s.world.debts, vec![plain_debt("n1", 30.0, DebtStep::Wrecks)]);
    }

    #[test]
    fn goes_with_a_city_that_joined_a_realm() {
        let mut s = setup();
        add_city(&mut s.world, "n1", "Oakford", 400.0, 100.0);
        owe_trade_org(&mut s.world, "n1", 30.0, None, FirstOwed::Owed);
        step_debts(&mut s.world);
        s.world.cities.last_mut().unwrap().realm_id = Some(s.realm.clone());
        step_debts(&mut s.world);
        assert_eq!(s.world.debts, vec![]);
        assert_eq!(s.world.demands, vec![]);
    }
}

mod the_invariant {
    use super::*;

    #[test]
    fn sees_a_demand_for_no_debt() {
        let mut s = owing(OWED);
        s.world.debts = vec![];
        assert_eq!(debt_demands_sound(&s.world).len(), 1);
    }

    #[test]
    fn sees_a_demand_for_less_than_is_owed() {
        let mut s = owing(OWED);
        debt_mut(&mut s).coins += 1.0;
        assert_eq!(debt_demands_sound(&s.world).len(), 1);
    }

    #[test]
    fn sees_two_demands_for_one_debt() {
        let mut s = owing(OWED);
        let mut twice = demand(&s).unwrap().clone();
        twice.id = "twice".into();
        s.world.demands.push(twice);
        assert_eq!(debt_demands_sound(&s.world).len(), 1);
    }

    #[test]
    fn sees_a_demand_out_past_its_step() {
        let mut s = owing(OWED);
        debt_mut(&mut s).step = Some(DebtStep::Wrecks);
        assert_eq!(debt_demands_sound(&s.world).len(), 1);
    }

    #[test]
    fn sees_a_debt_demanded_with_no_deadline() {
        let mut s = owing(OWED);
        debt_mut(&mut s).deadline = None;
        assert_eq!(debt_demands_sound(&s.world).len(), 1);
    }

    #[test]
    fn sees_a_caravan_collecting_a_debt_for_someone_else() {
        let mut s = owing(OWED);
        let hand_over = set_aside(&s);
        answer(&mut s, "acceptDemand", hand_over);
        s.world.transfers[0].to_realm_id = s.other.clone();
        assert_eq!(debt_demands_sound(&s.world).len(), 1);
    }
}
