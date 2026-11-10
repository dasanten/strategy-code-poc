//! `apps/server/src/transfers-caravans.test.ts`, one test per `it`, from `setup()` of
//! `transfers.fixture.ts` (`fixtures/trade/transfers.json`).

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;
mod transfers_fixture;

use csp_shared::world::{BuildingKind, Good, Realm, Stock, TransferJobStep, WorldState};
use csp_sim::queries::warehouse_trade::owed_by;
use serde_json::{json, Value};
use transfers_fixture::{assert_matches, setup, Fixture, IVO, MARA};

fn carrier(w: &WorldState) -> Option<&csp_shared::world::TransferJob> {
    w.caravans.iter().find_map(|c| c.transfer.as_ref())
}

fn any_event(w: &WorldState, kind: &str) -> bool {
    w.events.iter().any(|e| serde_json::to_value(e).unwrap()["kind"] == kind)
}

/// Every log line of a kind, whoever's log it is in (`eventsOf` without a user).
fn all_events(s: &Fixture, kind: &str) -> Vec<Value> {
    s.world
        .events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .filter(|e| e["kind"] == kind)
        .collect()
}

fn transfer(s: &mut Fixture, units: f64) -> String {
    let (city, to_city) = (s.city.clone(), s.to_city.clone());
    s.order(json!({ "kind": "transfer", "fromCityId": city, "toCityId": to_city,
        "good": "iron", "units": units }))
}

mod caravans_carrying_out_transfers {
    use super::*;

    #[test]
    #[ignore = "8.0 s alone; see #1132"]
    fn turn_back_from_a_recipient_behind_closed_gates_the_warehouse_keeping_it_for_the_next_caravan(
    ) {
        let mut s = setup();
        let storage = s.storage.clone();
        s.set(&storage, Good::Iron, Some(40.0));
        let to_city = s.to_city.clone();
        for b in &mut s.world.buildings {
            if b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(to_city.as_str()) {
                b.closed = Some(true);
            }
        }
        assert_eq!(transfer(&mut s, 12.0), "ack");
        let warehouse_id = s.world.transfers[0].warehouse_id.clone();
        s.run_until(20_000, |w| any_event(w, "transferStuck"));
        assert_matches(
            &all_events(&s, "transferStuck"),
            json!([{ "why": "turnedBack", "units": 12, "cityId": to_city }]),
        );
        assert_matches(
            &s.world.transfers,
            json!([{ "fromCityId": null, "caravanId": null, "units": 12 }]),
        );
        s.run_until(10_000, |w| carrier(w).is_none());
        assert_eq!(owed_by(&s.world, &warehouse_id, Good::Iron), 12.0);
        assert_eq!(s.held(&storage, Good::Iron), Some(28.0));
    }

    #[test]
    #[ignore = "5.6 s alone; see #1132"]
    fn bring_coins_handed_in_at_a_warehouse_to_the_recipients_storage() {
        let mut s = setup();
        let before = s.held(&s.to_storage, Good::Coins).unwrap_or(0.0);
        let to_city = s.to_city.clone();
        let o = json!({ "kind": "handIn", "good": "coins", "units": 300, "toCityId": to_city });
        assert_eq!(s.order(o), "ack");
        s.run_until(20_000, |w| w.transfers.is_empty());
        assert_eq!(s.held(&s.to_storage, Good::Coins), Some(before + 300.0));
        assert_matches(&s.events("transferred", IVO), json!([{ "good": "coins", "units": 300 }]));
    }

    #[test]
    #[ignore = "5.8 s alone; see #1132"]
    fn bring_a_transfer_back_to_the_sender_when_the_recipients_city_is_no_longer_theirs() {
        let mut s = setup();
        let storage = s.storage.clone();
        s.set(&storage, Good::Iron, Some(40.0));
        assert_eq!(transfer(&mut s, 25.0), "ack");
        s.run_until(20_000, |w| carrier(w).is_some_and(|j| j.step == TransferJobStep::Deliver));
        let to_iron = s.held(&s.to_storage, Good::Iron).unwrap_or(0.0);
        // The recipient's realm is another than the city's now, as when the city was taken.
        let realm = json!({ "id": "realm3", "userId": 9, "leaderId": "q1" });
        s.world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
        let q1 = goods_support::drawn_resident(3.0, "q1", Some("realm3"), None, 5.0, 5.0);
        s.world.residents.push(q1);
        s.world.transfers[0].to_realm_id = "realm3".into();
        s.run_until(20_000, |w| w.transfers.is_empty());
        assert_matches(&all_events(&s, "transferStuck"), json!([{ "why": "cancelled" }]));
        let city = s.city.clone();
        assert_matches(
            &s.events("transferred", MARA),
            json!([{ "back": true, "units": 25, "cityId": city }]),
        );
        // The goods are back, the fee is not.
        assert_eq!(s.held(&storage, Good::Iron), Some(40.0));
        assert_eq!(s.held(&s.to_storage, Good::Iron).unwrap_or(0.0), to_iron);
        assert_eq!(s.world.transfers, vec![]);
    }

    #[test]
    #[ignore = "10.6 s alone; see #1132"]
    fn send_again_what_robbers_took_of_a_transfer_and_all_of_it_arrives() {
        let mut s = setup();
        let storage = s.storage.clone();
        s.set(&storage, Good::Iron, Some(40.0));
        let before = s.held(&s.to_storage, Good::Iron).unwrap_or(0.0);
        assert_eq!(transfer(&mut s, 25.0), "ack");
        s.run_until(20_000, |w| {
            carrier(w).is_some_and(|j| j.step == TransferJobStep::Deliver && j.units == 25.0)
        });
        let caravan = s.world.caravans.iter().find(|c| c.transfer.is_some()).unwrap().id.clone();
        let thief = s.rob(&caravan, Stock::from([(Good::Iron, 10.0)]), "thief");
        assert_eq!(s.world.residents[thief].carried.get(&Good::Iron), Some(&10.0));
        let job = s.world.caravans.iter().find(|c| c.id == caravan).unwrap().transfer.clone();
        assert_matches(&job, json!({ "units": 15, "robbed": 10 }));
        s.run_until(20_000, |w| any_event(w, "transferStuck"));
        assert_matches(&all_events(&s, "transferStuck"), json!([{ "why": "robbed", "units": 10 }]));
        assert_matches(
            &s.world.transfers,
            json!([{ "units": 10, "fromCityId": null, "caravanId": null }]),
        );
        s.run_until(20_000, |w| w.transfers.is_empty());
        assert_eq!(s.held(&s.to_storage, Good::Iron), Some(before + 25.0));
        let units: Vec<f64> =
            s.events("transferred", IVO).iter().map(|e| e["units"].as_f64().unwrap()).collect();
        assert_eq!(units, vec![15.0, 10.0]);
        // The sender paid once.
        assert_eq!(s.held(&storage, Good::Iron), Some(15.0));
    }
}
