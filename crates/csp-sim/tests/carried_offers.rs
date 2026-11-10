//! `apps/server/src/carried-offers.test.ts`, one test per `it`, from `setup()` of
//! `transfers.fixture.ts` as the TypeScript wrote it (`fixtures/trade/transfers.json`). The ways
//! a realm can name (`carriedWaysFor`) are a client view and come with the server.

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;

use std::sync::Arc;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, CarriedFeeBy, CarriedOfferTerms, CarriedTransfer, Good, Realm, Standing, Stock,
    TradeOrgCity, TransferJobStep, WorldState,
};
use csp_sim::hq_fall::hq_falls;
use csp_sim::invariants::{check_invariants, world_invariants};
use csp_sim::offers::{offers_sound, step_offers};
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queries::direct_offer::{carried_offer_fees, carried_unload_shares, OfferGoods};
use csp_sim::queries::goods::free_stock;
use csp_sim::queries::offers::{offer_open_to, offers_at};
use csp_sim::queries::residents::good_weight;
use csp_sim::queries::transfer::{
    fee_at_pick_up, nearest_warehouse, quote_transfer, transfer_fee, transfer_load, transfer_tiles,
};
use csp_sim::queries::warehouse::stock_floor;
use csp_sim::queries::warehouse_trade::delivery_storage;
use csp_sim::standing::change_standing;
use csp_sim::tick::Scratch;
use csp_sim::transfers::{collects_transfer_from, transfers_sound};
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use goods_support::{open, player};
use serde_json::{json, Value};

const MARA: u64 = 7;
const IVO: u64 = 8;

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    scratch: Scratch,
    queue: OrderQueue,
    realm: String,
    other: String,
    city: String,
    to_city: String,
    storage: String,
    to_storage: String,
}

fn realm_of(world: &WorldState, user: u64) -> String {
    world.realms.iter().find(|r| r.user_id == user).unwrap().id.clone()
}

fn city_of(world: &WorldState, realm: &str) -> String {
    world.cities.iter().find(|c| c.realm_id.as_deref() == Some(realm)).unwrap().id.clone()
}

/// `carriedSetup`: Mara's resident stands on Ivo's storage, so she sees it and knows of his realm.
fn carried_setup() -> Setup {
    let (mut world, size, _) = common::load_world("trade/transfers.json");
    let terrain = Arc::new(open(size));
    let realm = realm_of(&world, MARA);
    let other = realm_of(&world, IVO);
    let city = city_of(&world, &realm);
    let to_city = city_of(&world, &other);
    let storage = delivery_storage(&world, &city).unwrap().id.clone();
    let to_storage = delivery_storage(&world, &to_city).unwrap().id.clone();
    let at = world.buildings.iter().find(|b| b.id == to_storage).map(|b| (b.x, b.y)).unwrap();
    let mut watcher = goods_support::drawn_resident(23.0, "watcher", Some(&realm), None, at.0, at.1);
    watcher.city_id = Some(city.clone());
    watcher.born_at = -20.0 * 24.0 * 3600.0;
    world.residents.push(watcher);
    let mut s = Setup {
        queue: OrderQueue::new(order_kinds(), Some(terrain.clone())),
        world,
        terrain,
        scratch: Scratch::default(),
        realm,
        other,
        city,
        to_city,
        storage,
        to_storage,
    };
    s.set(&s.storage.clone(), Good::Iron, Some(40.0));
    s.set(&s.to_storage.clone(), Good::Stone, Some(40.0));
    s.set(&s.to_storage.clone(), Good::Coins, Some(2_000.0));
    s
}

const TERMS: (Good, f64, Good, f64, f64) = (Good::Iron, 25.0, Good::Stone, 10.0, 1.0);

fn goods() -> OfferGoods {
    let (gives, gives_units, wants, wants_units, times) = TERMS;
    OfferGoods { gives, gives_units, wants, wants_units, times }
}

fn answer(reply: OrderReply) -> String {
    match reply {
        OrderReply::Rejected { reason, .. } => reason,
        _ => "ack".into(),
    }
}

impl Setup {
    fn size(&self) -> i32 {
        self.terrain.size
    }

    fn b(&self, id: &str) -> &Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap()
    }

    fn held(&self, id: &str, g: Good) -> Option<f64> {
        self.b(id).stock.as_ref().and_then(|s| s.get(&g)).copied()
    }

    fn set(&mut self, id: &str, g: Good, n: Option<f64>) {
        let b = self.world.buildings.iter_mut().find(|b| b.id == id).unwrap();
        let s = b.stock.get_or_insert_with(Stock::new);
        match n {
            Some(n) => s.insert(g, n),
            None => s.shift_remove(&g),
        };
    }

    fn xy(&self, id: &str) -> (f64, f64) {
        let b = self.b(id);
        (b.x, b.y)
    }

    /// Mara's order (for p1), applied, and what it answers (`order`).
    fn order(&mut self, mut o: Value) -> String {
        o["residentId"] = json!("p1");
        let reply = self.queue.receive(&self.world, &player(MARA), &json!("q"), &o);
        self.queue.apply_all(&mut self.world);
        answer(reply)
    }

    /// Ivo's order, applied, and what it answers (`asIvo`).
    fn as_ivo(&mut self, o: Value) -> String {
        let reply = self.queue.receive(&self.world, &player(IVO), &json!("q"), &o);
        self.queue.apply_all(&mut self.world);
        answer(reply)
    }

    /// What Mara's send order says, with the terms overridden by `over`.
    fn send(&mut self, fee_by: &str, over: Value) -> String {
        let mut o = json!({
            "kind": "sendCarriedOffer", "toId": self.other, "gives": "iron", "givesUnits": 25,
            "wants": "stone", "wantsUnits": 10, "times": 1, "fromCityId": self.city,
            "toCityId": self.to_city, "feeBy": fee_by,
        });
        for (k, v) in over.as_object().unwrap() {
            o[k] = v.clone();
        }
        self.order(o)
    }

    /// Mara's carried offer, sent and accepted by Ivo.
    fn accepted(&mut self, fee_by: &str) {
        assert_eq!(self.send(fee_by, json!({})), "ack");
        let offer_id = self.world.offers[0].id.clone();
        assert_eq!(self.as_ivo(json!({ "kind": "acceptCarriedOffer", "offerId": offer_id })), "ack");
    }

    /// What each Transfer's fee comes to, both from the warehouse nearest its pick-up (`fullFees`).
    fn full_fees(&self) -> (f64, f64) {
        let size = self.size();
        let (from, to) = (self.xy(&self.storage), self.xy(&self.to_storage));
        let near = nearest_warehouse(&self.world, from, size).unwrap();
        let to_near = nearest_warehouse(&self.world, to, size).unwrap();
        let iron = transfer_fee(
            25.0 * good_weight(Good::Iron),
            transfer_tiles(size, (near.x, near.y), Some(from), to),
        );
        let stone = transfer_fee(
            10.0 * good_weight(Good::Stone),
            transfer_tiles(size, (to_near.x, to_near.y), Some(to), from),
        );
        (iron, stone)
    }

    /// The events of `kind` in a Player's log, as JSON (`eventsOf`).
    fn events(&self, kind: &str, user: u64) -> Vec<Value> {
        self.world
            .events
            .iter()
            .filter(|e| e.user_id == user)
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|e| e["kind"] == kind)
            .collect()
    }

    fn hq_falls(&mut self) {
        let hq = self.world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq)).unwrap();
        let id = hq.id.clone();
        hq_falls(&mut self.world, &id);
    }

    fn sound(&self) -> Vec<String> {
        offers_sound(&self.world).into_iter().map(|v| v.message).collect()
    }

    /// Steps until `done`, at least once, at most 20,000 ticks, checking every invariant now and
    /// then (`runUntil`).
    fn run_until(&mut self, mut done: impl FnMut(&WorldState) -> bool) {
        let mut walking = Walking::new(self.terrain.clone());
        let terrain = self.terrain.clone();
        let mut t = 0;
        while t < 20_000 && (t == 0 || !done(&self.world)) {
            step_world(&mut self.world, &terrain, &mut self.scratch, Some(&mut walking), None);
            if t % 500 == 0 {
                assert_eq!(check_invariants(&self.world, &terrain, &world_invariants()), vec![]);
            }
            t += 1;
        }
        assert!(done(&self.world), "not done after {t} ticks");
        assert_eq!(check_invariants(&self.world, &terrain, &world_invariants()), vec![]);
    }

    /// Every unit of a good in the world (`total`).
    fn total(&self, g: Good) -> f64 {
        goods_support::total(&self.world).get(&g).copied().unwrap_or(0.0)
    }
}

/// `stillTradeOrgChain` of `test-terrain.ts`.
fn still_trade_org_chain(world: &mut WorldState) {
    for i in 0..world.buildings.len() {
        if world.buildings[i].kind != csp_shared::world::BuildingKind::Warehouse {
            continue;
        }
        let mut stock = stock_floor(world, &world.buildings[i]);
        for (g, n) in world.buildings[i].stock.clone().unwrap_or_default() {
            stock.insert(g, n);
        }
        world.buildings[i].stock = Some(stock);
    }
    let mut crew = std::collections::HashSet::new();
    for c in &world.caravans {
        crew.extend(c.driver_id.clone());
        crew.extend(c.escort_ids.clone());
    }
    let of_trade_org: std::collections::HashSet<String> =
        world.cities.iter().filter(|c| c.trade_org.is_some()).map(|c| c.id.clone()).collect();
    world.residents.retain(|r| {
        r.city_id.as_ref().is_none_or(|c| !of_trade_org.contains(c)) || crew.contains(&r.id)
    });
}

mod a_carried_direct_offers_fee {
    use super::*;

    #[test]
    fn takes_the_pick_ups_part_at_the_pick_up_and_rounds_what_is_due_on_unloading_up() {
        assert_eq!(fee_at_pick_up(101.0, 0.0), 101.0);
        assert_eq!(fee_at_pick_up(101.0, 0.5), 50.0);
        assert_eq!(fee_at_pick_up(101.0, 1.0), 0.0);
        assert_eq!(carried_unload_shares(CarriedFeeBy::Sender), (0.0, 1.0));
        assert_eq!(carried_unload_shares(CarriedFeeBy::Split), (0.5, 0.5));
    }

    #[test]
    fn counts_only_what_is_taken_at_the_pick_up_against_the_coins_held() {
        let whole = transfer_fee(25.0, 160.0);
        let iron: Stock = [(Good::Iron, 25.0)].into_iter().collect();
        assert_eq!(quote_transfer(&iron, Good::Iron, 25.0, 160.0, 1.0), (25.0, whole));
        let half: Stock =
            [(Good::Iron, 25.0), (Good::Coins, fee_at_pick_up(whole, 0.5))].into_iter().collect();
        assert_eq!(quote_transfer(&half, Good::Iron, 25.0, 160.0, 0.5), (25.0, whole));
        assert!(quote_transfer(&half, Good::Iron, 25.0, 160.0, 0.0).0 < 25.0);
    }

    #[test]
    fn is_all_the_senders_when_they_pay_and_half_of_both_each_when_split() {
        let s = carried_setup();
        let (iron, stone) = s.full_fees();
        let fees = |by| carried_offer_fees(&s.world, s.size(), &s.city, &s.to_city, by, goods());
        assert_eq!(fees(CarriedFeeBy::Sender), Some((iron + stone, 0.0)));
        let (sender, other) = fees(CarriedFeeBy::Split).unwrap();
        assert_eq!(sender + other, iron + stone);
        assert!((sender - other).abs() <= 1.0);
    }
}

mod sending_a_carried_direct_offer {
    use super::*;

    #[test]
    fn sets_nothing_aside_and_stands_at_no_storage_with_the_fee_told_to_the_other_side() {
        let mut s = carried_setup();
        let (iron, stone) = s.full_fees();
        assert_eq!(s.send("sender", json!({})), "ack");
        let offer = s.world.offers[0].clone();
        assert_eq!(
            offer.direct.as_ref().unwrap().carried,
            Some(CarriedOfferTerms {
                from_city_id: s.city.clone(),
                to_city_id: s.to_city.clone(),
                fee_by: CarriedFeeBy::Sender,
                sender_fee: iron + stone,
                other_fee: 0.0,
            })
        );
        let storage = s.b(&s.storage);
        assert_eq!(free_stock(&s.world, &storage.id, storage.stock.as_ref()).get(&Good::Iron), Some(&40.0));
        assert!(offers_at(&s.world, &s.storage).is_empty());
        assert!(!offer_open_to(&offer, &s.other));
        let told = s.events("directOffer", IVO);
        assert_eq!(told.len(), 1);
        let name = |id: &str| s.world.cities.iter().find(|c| c.id == id).unwrap().name.clone();
        assert_eq!(told[0]["what"], "received");
        assert_eq!(told[0]["carried"], json!({ "fromCity": name(&s.city), "toCity": name(&s.to_city), "fee": 0.0 }));
    }

    #[test]
    fn needs_no_goods_there_yet() {
        let mut s = carried_setup();
        s.set(&s.storage.clone(), Good::Iron, None);
        assert_eq!(s.send("sender", json!({})), "ack");
    }

    #[test]
    fn refuses_a_fee_nobody_pays_too_much_for_a_load_or_a_city_that_isnt_the_sides() {
        let mut s = carried_setup();
        assert_eq!(s.send("other", json!({})), "the fee is paid by the sender or split");
        let too_many = json!({ "givesUnits": transfer_load(Good::Iron) + 1.0 });
        assert_eq!(s.send("sender", too_many), "more than one carriage load");
        assert_eq!(s.send("sender", json!({ "times": 1_000 })), "more than one carriage load");
        let own = json!({ "toCityId": s.city });
        assert_eq!(s.send("sender", own), "the goods go to a city of the realm it is sent to");
        let theirs = json!({ "fromCityId": s.to_city });
        assert_eq!(s.send("sender", theirs), "the goods are picked up at a city of the sender");
        assert_eq!(
            s.send("sender", json!({ "gives": "stone" })),
            "an offer wants a different good than it gives"
        );
        assert_eq!(s.world.offers, vec![]);
    }

    #[test]
    fn refuses_a_city_whose_storage_the_sender_doesnt_see() {
        let mut s = carried_setup();
        // Known by a standing alone, the watcher gone.
        s.world.residents.retain(|r| r.id != "watcher");
        let standing = Standing { of: s.realm.clone(), toward: s.other.clone(), value: 1.0 };
        s.world.standings.push(standing);
        assert_eq!(s.send("sender", json!({})), "you don’t see that city’s storage");
    }

    #[test]
    fn isnt_offered_once_the_hq_has_fallen_or_by_a_realm_the_trade_org_refuses() {
        let mut refused = carried_setup();
        let realm = refused.realm.clone();
        change_standing(&mut refused.world, "trade-org", &realm, -100.0);
        assert_eq!(refused.send("sender", json!({})), "the Trade Organization won’t carry for you");
        let mut them = carried_setup();
        let other = them.other.clone();
        change_standing(&mut them.world, "trade-org", &other, -100.0);
        assert_eq!(them.send("sender", json!({})), "the Trade Organization won’t carry for them");
        let mut fallen = carried_setup();
        fallen.hq_falls();
        assert!(fallen.send("sender", json!({})).to_lowercase().contains("no caravans"));
    }
}

mod answering_a_carried_direct_offer {
    use super::*;

    #[test]
    fn becomes_two_transfers_on_accepting_from_anywhere_with_no_change_in_standing() {
        let mut s = carried_setup();
        let standings = s.world.standings.clone();
        s.accepted("sender");
        let size = s.size();
        let near = nearest_warehouse(&s.world, s.xy(&s.storage), size).unwrap().id.clone();
        let to_near = nearest_warehouse(&s.world, s.xy(&s.to_storage), size).unwrap().id.clone();
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(s.world.transfers.len(), 2);
        let (a, b) = (&s.world.transfers[0], &s.world.transfers[1]);
        assert_eq!(
            (a.realm_id.as_str(), a.to_realm_id.as_str(), a.from_city_id.as_deref(), a.to_city_id.as_str()),
            (s.realm.as_str(), s.other.as_str(), Some(s.city.as_str()), s.to_city.as_str())
        );
        assert_eq!((a.warehouse_id.as_str(), a.good, a.units), (near.as_str(), Good::Iron, 25.0));
        assert_eq!(a.carried_offer, Some(CarriedTransfer { unload_share: 0.0, due: 0.0 }));
        assert_eq!(
            (b.realm_id.as_str(), b.to_realm_id.as_str(), b.from_city_id.as_deref(), b.to_city_id.as_str()),
            (s.other.as_str(), s.realm.as_str(), Some(s.to_city.as_str()), s.city.as_str())
        );
        assert_eq!((b.warehouse_id.as_str(), b.good, b.units), (to_near.as_str(), Good::Stone, 10.0));
        assert_eq!(b.carried_offer, Some(CarriedTransfer { unload_share: 1.0, due: 0.0 }));
        assert_eq!(s.world.standings, standings);
        assert_eq!(s.events("directOffer", MARA).last().unwrap()["what"], "carriedAccepted");
        let to_ivo = s.events("directOffer", IVO).pop().unwrap();
        assert_eq!((to_ivo["what"].as_str(), to_ivo["carried"]["fee"].as_f64()), (Some("youAccepted"), Some(0.0)));
        assert_eq!(check_invariants(&s.world, &s.terrain, &world_invariants()), vec![]);
    }

    #[test]
    fn takes_it_whole_times_over() {
        let mut s = carried_setup();
        assert_eq!(s.send("split", json!({ "givesUnits": 5, "wantsUnits": 2, "times": 5 })), "ack");
        let offer_id = s.world.offers[0].id.clone();
        assert_eq!(s.as_ivo(json!({ "kind": "acceptCarriedOffer", "offerId": offer_id })), "ack");
        let units: Vec<f64> = s.world.transfers.iter().map(|t| t.units).collect();
        assert_eq!(units, vec![25.0, 10.0]);
        let shares: Vec<f64> =
            s.world.transfers.iter().map(|t| t.carried_offer.as_ref().unwrap().unload_share).collect();
        assert_eq!(shares, vec![0.5, 0.5]);
    }

    #[test]
    fn takes_only_the_realm_it_was_sent_to_and_only_this_way() {
        let mut s = carried_setup();
        s.send("sender", json!({}));
        let offer_id = s.world.offers[0].id.clone();
        assert_eq!(
            s.order(json!({ "kind": "acceptCarriedOffer", "offerId": offer_id })),
            "that offer wasn’t sent to you"
        );
        let at = s.xy(&s.storage);
        let mut trader = goods_support::drawn_resident(29.0, "trader", Some(&s.other), None, at.0, at.1);
        trader.city_id = Some(s.to_city.clone());
        trader.born_at = -20.0 * 24.0 * 3600.0;
        trader.carried = [(Good::Stone, 10.0)].into_iter().collect();
        s.world.residents.push(trader);
        let accept = json!({ "kind": "acceptOffer", "residentId": "trader", "offerId": offer_id, "times": 1 });
        assert_eq!(s.as_ivo(accept), "a carried offer is accepted from anywhere");
        assert_eq!(
            s.as_ivo(json!({ "kind": "acceptCarriedOffer", "offerId": "nope" })),
            "that offer is gone"
        );
    }

    #[test]
    fn declined_it_ends_and_both_are_told_nothing_having_been_set_aside() {
        let mut s = carried_setup();
        s.send("sender", json!({}));
        let offer_id = s.world.offers[0].id.clone();
        assert_eq!(s.as_ivo(json!({ "kind": "declineOffer", "offerId": offer_id })), "ack");
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(s.world.transfers, vec![]);
        let ended = s.events("offerEnded", MARA);
        assert_eq!(ended.len(), 1);
        assert_eq!((ended[0]["why"].as_str(), ended[0]["carried"].as_bool()), (Some("declined"), Some(true)));
    }
}

mod a_carried_direct_offer_standing {
    use super::*;

    #[test]
    fn isnt_cut_down_by_goods_leaving_the_storage() {
        let mut s = carried_setup();
        s.send("sender", json!({}));
        s.set(&s.storage.clone(), Good::Iron, None);
        step_offers(&mut s.world);
        assert_eq!(s.world.offers.len(), 1);
        assert_eq!(s.sound(), Vec::<String>::new());
    }

    #[test]
    fn lapses_at_its_time() {
        let mut s = carried_setup();
        s.send("sender", json!({}));
        s.world.tick = s.world.offers[0].direct.as_ref().unwrap().lapses_at as u64;
        step_offers(&mut s.world);
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(s.events("offerEnded", MARA)[0]["why"], "lapsed");
    }

    #[test]
    fn ends_when_either_city_is_no_longer_its_sides() {
        for lost in ["city", "toCity"] {
            let mut s = carried_setup();
            s.send("sender", json!({}));
            s.world.residents.push(goods_support::new_resident(3.0, "q1", Some("realm3"), 5.0, 5.0));
            let realm = json!({ "id": "realm3", "userId": 9, "leaderId": "q1" });
            s.world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
            let id = if lost == "city" { s.city.clone() } else { s.to_city.clone() };
            s.world.cities.iter_mut().find(|c| c.id == id).unwrap().realm_id = Some("realm3".into());
            step_offers(&mut s.world);
            assert_eq!(s.world.offers, vec![], "{lost}");
            assert_eq!(s.events("offerEnded", MARA)[0]["why"], "storageLost");
        }
    }

    #[test]
    fn is_cancelled_when_the_hq_falls_and_its_accepted_transfers_with_it() {
        let mut s = carried_setup();
        s.send("sender", json!({}));
        s.send("split", json!({}));
        let offer_id = s.world.offers[0].id.clone();
        s.as_ivo(json!({ "kind": "acceptCarriedOffer", "offerId": offer_id }));
        assert_eq!(s.world.transfers.len(), 2);
        s.hq_falls();
        step_offers(&mut s.world);
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(s.world.transfers, vec![]);
        let ended = s.events("offerEnded", MARA);
        assert_eq!(ended.len(), 1);
        assert_eq!(ended[0]["why"], "noCaravans");
        assert_eq!(s.events("directOffer", IVO).last().unwrap()["what"], "noCaravans");
        assert_eq!(s.events("orderEndedWithHq", MARA).len(), 1);
        assert_eq!(s.events("orderEndedWithHq", IVO).len(), 1);
    }
}

mod invariants_of_a_carried_direct_offer {
    use super::*;

    /// An offer that stands, to spoil.
    fn standing() -> Setup {
        let mut s = carried_setup();
        s.send("sender", json!({}));
        s
    }

    #[test]
    fn hold_for_one_sent() {
        assert_eq!(standing().sound(), Vec::<String>::new());
    }

    #[test]
    fn catch_more_than_one_load_or_a_fee_that_isnt_whole() {
        let mut s = standing();
        let offer = &mut s.world.offers[0];
        offer.times = 10_000.0;
        offer.direct.as_mut().unwrap().carried.as_mut().unwrap().sender_fee = 1.5;
        let m = s.sound();
        assert_eq!(m.len(), 3, "{m:?}");
        assert!(m[0].contains("gives more than one load"));
        assert!(m[1].contains("wants more than one load"));
        assert!(m[2].contains("fees that aren’t whole"));
    }

    #[test]
    fn catch_one_with_the_hq_fallen_or_between_cities_not_its_sides() {
        let mut s = standing();
        let (to_city, realm) = (s.to_city.clone(), s.realm.clone());
        s.world.cities.iter_mut().find(|c| c.id == to_city).unwrap().realm_id = Some(realm);
        s.hq_falls();
        let m = s.sound();
        assert_eq!(m.len(), 2, "{m:?}");
        assert!(m[0].contains("the HQ fallen"));
        assert!(m[1].contains("cities not its sides’"));
    }

    #[test]
    fn catch_coins_due_that_arent_whole_or_due_on_the_way_back() {
        let mut s = carried_setup();
        s.accepted("split");
        s.world.transfers[0].carried_offer.as_mut().unwrap().due = 1.5;
        assert_eq!(transfers_sound(&s.world).len(), 1);
        s.world.transfers[0].carried_offer.as_mut().unwrap().due = 3.0;
        s.world.transfers[0].back = true;
        assert_eq!(transfers_sound(&s.world).len(), 1);
    }
}

mod the_caravans_of_a_carried_direct_offer {
    use super::*;

    /// Accepts Mara's offer and runs both Transfers out; what each storage paid in coins
    /// (`runOut`).
    fn run_out(s: &mut Setup, fee_by: &str) -> (f64, f64) {
        still_trade_org_chain(&mut s.world);
        let coins = s.held(&s.storage, Good::Coins).unwrap_or(0.0);
        let to_coins = s.held(&s.to_storage, Good::Coins).unwrap_or(0.0);
        s.accepted(fee_by);
        s.run_until(|w| w.transfers.is_empty());
        (
            coins - s.held(&s.storage, Good::Coins).unwrap_or(0.0),
            to_coins - s.held(&s.to_storage, Good::Coins).unwrap_or(0.0),
        )
    }

    #[test]
    #[ignore = "6.7 s alone; see #1092"]
    fn carry_both_ways_with_the_sender_paying_both_fees_and_no_crime() {
        let mut s = carried_setup();
        let (iron, stone) = s.full_fees();
        let before_iron = s.held(&s.to_storage, Good::Iron).unwrap_or(0.0);
        let before_stone = s.held(&s.storage, Good::Stone).unwrap_or(0.0);
        let all_iron = s.total(Good::Iron);
        let paid = run_out(&mut s, "sender");
        assert_eq!(s.held(&s.to_storage, Good::Iron), Some(before_iron + 25.0));
        assert_eq!(s.held(&s.storage, Good::Stone), Some(before_stone + 10.0));
        assert_eq!(s.held(&s.storage, Good::Iron), Some(15.0));
        assert_eq!(s.held(&s.to_storage, Good::Stone), Some(30.0));
        assert_eq!(paid, (iron + stone, 0.0));
        assert_eq!(s.total(Good::Iron), all_iron);
        assert_eq!(s.world.crimes, vec![]);
        let mut fees: Vec<f64> =
            s.events("transferred", MARA).iter().map(|e| e["fee"].as_f64().unwrap()).collect();
        fees.sort_by(f64::total_cmp);
        let mut want = vec![iron, stone];
        want.sort_by(f64::total_cmp);
        assert_eq!(fees, want);
    }

    #[test]
    #[ignore = "6.9 s alone; see #1092"]
    fn carry_both_ways_with_the_fee_split() {
        let mut s = carried_setup();
        let (iron, stone) = s.full_fees();
        let (sender, other) = run_out(&mut s, "split");
        assert_eq!(sender + other, iron + stone);
        assert_eq!(sender, fee_at_pick_up(iron, 0.5) + (stone * 0.5).ceil());
        assert_eq!(other, fee_at_pick_up(stone, 0.5) + (iron * 0.5).ceil());
        assert_eq!(s.world.crimes, vec![]);
    }

    #[test]
    #[ignore = "6.0 s alone; see #1092"]
    fn take_what_is_there_of_goods_short_with_a_fee_for_what_they_take() {
        let mut s = carried_setup();
        s.set(&s.storage.clone(), Good::Iron, Some(6.0));
        s.set(&s.to_storage.clone(), Good::Stone, None);
        let size = s.size();
        let (from, to) = (s.xy(&s.storage), s.xy(&s.to_storage));
        let near = nearest_warehouse(&s.world, from, size).unwrap();
        let fee = transfer_fee(
            6.0 * good_weight(Good::Iron),
            transfer_tiles(size, (near.x, near.y), Some(from), to),
        );
        let before = s.held(&s.to_storage, Good::Iron).unwrap_or(0.0);
        let (sender, other) = run_out(&mut s, "split");
        assert_eq!(s.held(&s.to_storage, Good::Iron), Some(before + 6.0));
        assert_eq!(sender + other, fee);
        let stuck = s.events("transferStuck", IVO);
        assert_eq!(stuck.len(), 1);
        assert_eq!((stuck[0]["why"].as_str(), stuck[0]["good"].as_str()), (Some("nothing"), Some("stone")));
        let stuck = s.events("transferStuck", MARA);
        assert_eq!(stuck.len(), 1);
        assert_eq!((stuck[0]["why"].as_str(), stuck[0]["good"].as_str()), (Some("nothingCame"), Some("stone")));
    }

    #[test]
    #[ignore = "5.8 s alone; see #1092"]
    fn leave_the_goods_delivered_when_the_storage_they_unload_at_is_short_of_coins() {
        let mut s = carried_setup();
        s.set(&s.to_storage.clone(), Good::Coins, None);
        let before = s.held(&s.to_storage, Good::Iron).unwrap_or(0.0);
        let (iron, _) = s.full_fees();
        still_trade_org_chain(&mut s.world);
        s.accepted("split");
        let mut collecting = false;
        let to_storage = s.to_storage.clone();
        s.run_until(|w| {
            let c = w.caravans.iter().find(|x| {
                x.transfer.as_ref().is_some_and(|t| t.step == TransferJobStep::UnloadFee)
            });
            let driver = c.and_then(|c| c.driver_id.as_ref()).and_then(|id| w.residents.iter().find(|r| &r.id == id));
            collecting |= driver.is_some_and(|d| collects_transfer_from(w, d, &to_storage));
            w.transfers.is_empty()
        });
        assert!(collecting);
        // Ivo's own Transfer found no coins for its half, so took fewer goods or none; Mara's
        // arrived.
        assert_eq!(s.held(&s.to_storage, Good::Iron), Some(before + 25.0));
        assert_eq!(s.held(&s.to_storage, Good::Coins).unwrap_or(0.0), 0.0);
        let mine = s.events("transferred", MARA).into_iter().find(|e| e["good"] == "iron").unwrap();
        assert_eq!(mine["fee"].as_f64(), Some(fee_at_pick_up(iron, 0.5)));
        assert_eq!(s.world.crimes, vec![]);
    }
}

#[test]
fn a_carried_offer_tells_its_place_by_its_delivery_storage() {
    let mut s = carried_setup();
    s.send("sender", json!({}));
    let offer = &s.world.offers[0];
    let storage = delivery_storage(&s.world, &s.city).unwrap();
    assert_eq!((offer.storage_id.as_str(), offer.x, offer.y), (storage.id.as_str(), storage.x, storage.y));
}
