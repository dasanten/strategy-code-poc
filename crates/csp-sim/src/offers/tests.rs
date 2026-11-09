//! `offers.test.ts`: posting, set-aside goods, accepting, ending and the invariants, through the
//! order queue and the world step as the game runs them. Its cases about scripts and what can be
//! seen of an offer are left to the script and sight tests.

use std::sync::Arc;

use super::*;
use crate::events::events_for;
use crate::invariants::{check_invariants, world_invariants};
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::goods::free_stock;
use crate::queries::offers::set_aside_at;
use crate::queries::standing::standing_of;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::test_support::{add_city, building, plains};
use crate::tick::Scratch;
use crate::world::{create_world, step_world};
use csp_shared::balance::{MAX_HUNGER, OWN_FOOD, STANDING_TRADE_COINS_PER_POINT};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{BuildingKind, Carriage, Realm, Resident, Stat};
use serde_json::{json, Value};

const SIZE: i32 = 128;

fn poster() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn taker() -> OrderSender {
    OrderSender::player(8, "Bo")
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    queue: OrderQueue,
    scratch: Scratch,
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

fn add_resident(
    world: &mut WorldState,
    id: &str,
    owner: &str,
    city_id: &str,
    x: f64,
    y: f64,
) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner: Some(owner), city_id: Some(city_id), x, y, tick: 0.0 };
    let mut r: Resident = new_resident(&mut || m.next(), &fields, None);
    let stat = Stat { base: 10.0, trained: 0.0 };
    r.stats.strength = stat.clone();
    r.stats.endurance = stat.clone();
    r.stats.intellect = stat.clone();
    r.stats.agility = stat;
    r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
    r.lifespan = 60.0;
    r.carried = stock(&[(Good::Food, OWN_FOOD)]);
    world.residents.push(r);
    world.residents.len() - 1
}

/// Realm r1 (Player 7) with city c1 and its storage s1 at (6, 6) holding 100 Wood and 50 Stone,
/// and realm r2 (Player 8) with resident t1 standing on it and city c2 far off.
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 7, "a1"), ("r2", 8, "b1")] {
        let realm = json!({ "id": id, "userId": user, "leaderId": leader });
        world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    }
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    add_city(&mut world, "c2", Some("r2"), 90.0, 90.0);
    world.cities[1].name = "Brook".into();
    let mut s = building("s1", BuildingKind::Storage, Some("c1"), 6.0, 6.0);
    s.stock = Some(stock(&[(Good::Wood, 100.0), (Good::Stone, 50.0)]));
    world.buildings.push(s);
    add_resident(&mut world, "a1", "r1", "c1", 60.0, 10.0);
    add_resident(&mut world, "b1", "r2", "c2", 100.0, 100.0);
    add_resident(&mut world, "t1", "r2", "c2", 6.0, 6.0);
    let terrain = Arc::new(terrain);
    Setup {
        world,
        queue: OrderQueue::new(order_kinds(), Some(terrain.clone())),
        terrain,
        scratch: Scratch::default(),
    }
}

impl Setup {
    /// Applies the waiting orders and steps the world, checking every invariant after the tick.
    fn tick(&mut self) {
        self.queue.apply_all(&mut self.world);
        for r in &mut self.world.residents {
            r.hunger = MAX_HUNGER;
        }
        let terrain = self.terrain.clone();
        step_world(&mut self.world, &terrain, &mut self.scratch, None, None);
        assert_eq!(check_invariants(&self.world, &terrain, &world_invariants()), vec![]);
        assert_eq!(offers_keep_goods(&self.scratch.offers), vec![]);
        assert_eq!(trade_org_only_buys_food(&self.world, &self.scratch.offers), vec![]);
    }

    fn receive(&mut self, sender: &OrderSender, order: Value) -> OrderReply {
        self.queue.receive(&self.world, sender, &json!("q"), &order)
    }

    /// "gives 10 Wood, wants 5 Stone", twice over, unless the terms say otherwise.
    fn post(&mut self, terms: Value) -> OrderReply {
        let mut order = json!({
            "kind": "postOffer", "storageId": "s1", "gives": "wood", "givesUnits": 10,
            "wants": "stone", "wantsUnits": 5, "times": 2,
        });
        for (k, v) in terms.as_object().unwrap() {
            order[k] = v.clone();
        }
        self.receive(&poster(), order)
    }

    /// The id of the offer just posted.
    fn posted(&mut self, terms: Value) -> String {
        assert_eq!(self.post(terms), ack());
        self.queue.apply_all(&mut self.world);
        self.world.offers.last().unwrap().id.clone()
    }

    fn accept(&mut self, order: Value, sender: &OrderSender) -> OrderReply {
        let mut o = json!({ "kind": "acceptOffer", "residentId": "t1", "times": 1 });
        for (k, v) in order.as_object().unwrap() {
            o[k] = v.clone();
        }
        self.receive(sender, o)
    }

    fn offer(&self, id: &str) -> Option<&Offer> {
        self.world.offers.iter().find(|o| o.id == id)
    }

    fn r(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    fn storage(&mut self) -> &mut Building {
        self.world.buildings.iter_mut().find(|b| b.id == "s1").unwrap()
    }

    fn free(&self) -> Stock {
        let s = self.world.buildings.iter().find(|b| b.id == "s1").unwrap();
        free_stock(&self.world, &s.id, s.stock.as_ref())
    }

    fn events(&self, user_id: u64) -> Vec<Value> {
        events_for(&self.world, user_id, 0)
            .into_iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect()
    }

    fn kinds(&self, user_id: u64) -> Vec<String> {
        self.events(user_id).iter().map(|e| e["kind"].as_str().unwrap().to_string()).collect()
    }

    fn ended(&self, user_id: u64) -> Value {
        self.events(user_id).into_iter().find(|e| e["kind"] == "offerEnded").unwrap()
    }
}

fn ack() -> OrderReply {
    OrderReply::Ack { request_id: "q".into() }
}

fn reason(reply: OrderReply) -> String {
    match reply {
        OrderReply::Rejected { reason, .. } => reason,
        other => panic!("not rejected: {other:?}"),
    }
}

#[test]
fn posting_sets_the_goods_aside_which_stay_in_the_storage_and_leaves_the_rest_free() {
    let mut s = setup();
    let id = s.posted(json!({}));
    let o = s.offer(&id).unwrap();
    assert_eq!(
        (o.realm_id.as_str(), o.storage_id.as_str(), o.gives, o.times),
        ("r1", "s1", Good::Wood, 2.0)
    );
    assert_eq!(s.storage().stock, Some(stock(&[(Good::Wood, 100.0), (Good::Stone, 50.0)])));
    assert_eq!(set_aside_at(&s.world, "s1"), stock(&[(Good::Wood, 20.0)]));
    assert_eq!(s.free(), stock(&[(Good::Wood, 80.0), (Good::Stone, 50.0)]));
    s.tick();
    assert_eq!(s.world.offers.len(), 1);
}

#[test]
fn an_offer_is_posted_as_many_times_over_as_the_goods_not_yet_set_aside_allow() {
    let mut s = setup();
    let id = s.posted(json!({ "times": 99 }));
    assert_eq!(s.offer(&id).unwrap().times, 10.0);
    assert!(matches!(s.post(json!({})), OrderReply::Rejected { .. }));
    let id = s.posted(json!({ "gives": "stone", "wants": "wood", "times": 1 }));
    assert_eq!(s.offer(&id).unwrap().times, 1.0);
}

#[test]
fn posting_needs_a_storage_of_the_realm_a_different_good_and_whole_units() {
    let mut s = setup();
    let mut why = |terms: Value| reason(s.post(terms));
    assert_eq!(why(json!({ "storageId": "c1-hall" })), "not a finished storage of yours");
    assert!(why(json!({ "gives": "stone", "wants": "stone" })).contains("different good"));
    assert_eq!(why(json!({ "gives": "gold-ish" })), "gives and wants must be goods");
    assert_eq!(why(json!({ "wantsUnits": 0 })), "units and times must be whole numbers");
    assert_eq!(why(json!({ "givesUnits": 1.5 })), "units and times must be whole numbers");
    assert_eq!(why(json!({ "times": -1 })), "units and times must be whole numbers");
    s.storage().city_id = Some("c2".into());
    assert_eq!(reason(s.post(json!({}))), "not a finished storage of yours");
}

#[test]
fn coins_are_set_aside_just_the_same() {
    let mut s = setup();
    s.storage().stock.as_mut().unwrap().insert(Good::Coins, 30.0);
    let id = s.posted(json!({ "gives": "coins", "givesUnits": 15, "wants": "wood" }));
    assert_eq!(s.offer(&id).unwrap().times, 2.0);
    assert_eq!(s.free().get(&Good::Coins), None);
}

#[test]
fn stolen_below_one_time_over_the_offer_ends_and_what_is_left_is_ordinary() {
    let mut s = setup();
    s.posted(json!({ "times": 10 }));
    s.storage().stock.as_mut().unwrap().insert(Good::Wood, 5.0);
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(Some(s.free()), s.storage().stock.clone());
    assert_eq!(s.ended(7)["why"], "goodsGone");
}

#[test]
fn goods_gone_cut_the_newest_offer_first() {
    let mut s = setup();
    let oldest = s.posted(json!({ "times": 4 }));
    let newest = s.posted(json!({ "times": 4, "wants": "coins" }));
    s.storage().stock.as_mut().unwrap().insert(Good::Wood, 50.0);
    step_offers(&mut s.world);
    assert_eq!(s.offer(&oldest).unwrap().times, 4.0);
    assert_eq!(s.offer(&newest).unwrap().times, 1.0);
    assert!(s.kinds(7).contains(&"offerCutDown".to_string()));
}

#[test]
fn accepting_swaps_the_goods_at_the_offers_rate_in_person_and_raises_standing_both_ways() {
    let mut s = setup();
    s.r("t1").carried = stock(&[(Good::Stone, 10.0)]);
    let id = s.posted(json!({}));
    assert_eq!(s.accept(json!({ "offerId": id }), &taker()), ack());
    s.tick();
    assert!(s.r("t1").order.is_none());
    assert_eq!(s.r("t1").carried, stock(&[(Good::Stone, 5.0), (Good::Wood, 10.0)]));
    assert_eq!(s.storage().stock, Some(stock(&[(Good::Wood, 90.0), (Good::Stone, 55.0)])));
    assert_eq!(s.offer(&id).unwrap().times, 1.0);
    // Goods for goods is a sale and a purchase at once, as a swap is: both goods count.
    let price = |g: &str| WAREHOUSE_BASE_PRICE.get(g).unwrap();
    let worth = (10.0 * price("wood") + 5.0 * price("stone")) / STANDING_TRADE_COINS_PER_POINT;
    assert!((standing_of(&s.world, "r1", "r2") - worth).abs() < 0.005);
    assert!((standing_of(&s.world, "r2", "r1") - worth).abs() < 0.005);
    let last = s.events(8).pop().unwrap();
    assert_eq!((last["kind"].as_str(), last["times"].as_f64()), (Some("offerAccepted"), Some(1.0)));
    assert!(s.kinds(7).contains(&"offerTaken".to_string()));
}

#[test]
fn an_offer_goes_on_being_accepted_down_to_none_when_it_ends() {
    let mut s = setup();
    s.r("t1").carried = stock(&[(Good::Stone, 30.0)]);
    s.r("t1").stats.strength = Stat { base: 1000.0, trained: 0.0 };
    let id = s.posted(json!({ "times": 3 }));
    s.accept(json!({ "offerId": id, "times": 2 }), &taker());
    s.tick();
    assert_eq!(s.offer(&id).unwrap().times, 1.0);
    assert_eq!(set_aside_at(&s.world, "s1"), stock(&[(Good::Wood, 10.0)]));
    s.accept(json!({ "offerId": id }), &taker());
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.r("t1").carried, stock(&[(Good::Stone, 15.0), (Good::Wood, 30.0)]));
    assert_eq!(s.storage().stock, Some(stock(&[(Good::Wood, 70.0), (Good::Stone, 65.0)])));
    assert_eq!(s.ended(7)["why"], "usedUp");
    assert_eq!(reason(s.accept(json!({ "offerId": id }), &taker())), "that offer is gone");
}

#[test]
fn accepting_is_cut_down_to_what_they_can_pay_and_what_fits() {
    let mut s = setup();
    s.r("t1").carried = stock(&[(Good::Stone, 15.0)]);
    let id = s.posted(json!({ "times": 10 }));
    s.accept(json!({ "offerId": id, "times": 8 }), &taker());
    s.tick();
    assert_eq!(s.offer(&id).unwrap().times, 7.0);
    assert_eq!(s.r("t1").carried, stock(&[(Good::Wood, 30.0)]));
    let last = s.events(8).pop().unwrap();
    assert_eq!((last["times"].as_f64(), last["wanted"].as_f64()), (Some(3.0), Some(8.0)));
}

#[test]
fn coins_are_taken_for_goods_from_a_carriage_on_the_tile() {
    let mut s = setup();
    s.r("t1").carried = Stock::new();
    let k = json!({ "id": "k1", "realmId": "r2", "cityId": null, "x": 6, "y": 6, "load": { "coins": 100 }, "horseId": null });
    s.world.carriages.push(serde_json::from_value::<Carriage>(k).unwrap());
    let id = s.posted(json!({ "wants": "coins", "wantsUnits": 25, "times": 2 }));
    s.accept(json!({ "offerId": id, "times": 3, "carriageId": "k1" }), &taker());
    s.tick();
    assert_eq!(s.world.carriages[0].load, stock(&[(Good::Coins, 50.0), (Good::Wood, 20.0)]));
    assert_eq!(s.r("t1").carried, Stock::new());
    assert_eq!(s.storage().stock.as_ref().unwrap().get(&Good::Coins), Some(&50.0));
    assert_eq!(s.world.offers, vec![]);
    let expected = 50.0 / STANDING_TRADE_COINS_PER_POINT;
    assert!((standing_of(&s.world, "r1", "r2") - expected).abs() < 0.005);
}

#[test]
fn accepting_needs_someone_of_another_realm_there_with_something_to_pay() {
    let mut s = setup();
    let id = s.posted(json!({}));
    let w = add_resident(&mut s.world, "w1", "r1", "c1", 6.0, 6.0);
    s.world.residents[w].carried = stock(&[(Good::Stone, 5.0)]);
    let why = |s: &mut Setup, order: Value, sender: OrderSender| {
        let mut o = json!({ "offerId": id });
        for (k, v) in order.as_object().unwrap() {
            o[k] = v.clone();
        }
        reason(s.accept(o, &sender))
    };
    assert_eq!(why(&mut s, json!({ "residentId": "w1" }), poster()), "that offer is your own");
    assert_eq!(why(&mut s, json!({ "residentId": "w1" }), taker()), "not one of your residents");
    assert_eq!(why(&mut s, json!({ "offerId": "o9" }), taker()), "that offer is gone");
    s.r("t1").carried = Stock::new();
    assert_eq!(why(&mut s, json!({}), taker()), "not enough to pay for it even once");
    s.r("t1").carried = stock(&[(Good::Stone, 5.0)]);
    assert_eq!(why(&mut s, json!({ "times": 0 }), taker()), "times must be a whole number");
    assert_eq!(why(&mut s, json!({ "carriageId": "k9" }), taker()), "not one of your carriages");
    s.r("t1").x = 40.0;
    assert_eq!(why(&mut s, json!({}), taker()), "not at that offer’s storage");
    s.r("t1").x = 6.0;
    let tick = s.world.tick as f64;
    s.r("t1").born_at = tick;
    assert_eq!(why(&mut s, json!({}), taker()), "children can’t trade");
}

#[test]
fn accepting_does_nothing_once_they_left_the_tile_since_the_order_came() {
    let mut s = setup();
    s.r("t1").carried = stock(&[(Good::Stone, 5.0)]);
    let id = s.posted(json!({ "times": 1 }));
    s.accept(json!({ "offerId": id }), &taker());
    s.queue.apply_all(&mut s.world);
    s.r("t1").x = 40.0;
    s.tick();
    assert_eq!(s.storage().stock.as_ref().unwrap().get(&Good::Wood), Some(&100.0));
    assert!(s.r("t1").order.is_none());
    assert_eq!(s.world.offers.len(), 1);
}

#[test]
fn two_takers_at_one_offer_dont_lose_or_make_goods() {
    let mut s = setup();
    s.r("t1").carried = stock(&[(Good::Stone, 10.0)]);
    let u = add_resident(&mut s.world, "u1", "r2", "c2", 6.0, 6.0);
    s.world.residents[u].carried = stock(&[(Good::Stone, 10.0)]);
    let id = s.posted(json!({ "times": 1 }));
    s.accept(json!({ "offerId": id }), &taker());
    s.accept(json!({ "offerId": id, "residentId": "u1" }), &taker());
    s.tick();
    let of = |s: &mut Setup, r: &str, g: Good| s.r(r).carried.get(&g).copied().unwrap_or(0.0);
    assert_eq!(of(&mut s, "t1", Good::Wood) + of(&mut s, "u1", Good::Wood), 10.0);
    assert_eq!(of(&mut s, "t1", Good::Stone) + of(&mut s, "u1", Good::Stone), 15.0);
    assert_eq!(s.storage().stock, Some(stock(&[(Good::Wood, 90.0), (Good::Stone, 55.0)])));
}

#[test]
fn an_offer_ends_when_its_player_takes_it_down_and_the_goods_are_ordinary_again() {
    let mut s = setup();
    let id = s.posted(json!({}));
    let order = json!({ "kind": "takeDownOffer", "offerId": id });
    assert_eq!(reason(s.receive(&taker(), order.clone())), "not an offer of yours");
    s.receive(&poster(), order);
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.free(), stock(&[(Good::Wood, 100.0), (Good::Stone, 50.0)]));
}

#[test]
fn an_offer_ends_when_its_storage_is_torn_down() {
    let mut s = setup();
    s.posted(json!({}));
    s.world.buildings.retain(|b| b.id != "s1");
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.ended(7)["why"], "storageLost");
}

#[test]
fn an_offer_ends_when_its_storages_city_is_captured() {
    let mut s = setup();
    s.posted(json!({}));
    crate::capture::capture_city(&mut s.world, "c1", "r2", SIZE);
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.storage().stock, Some(stock(&[(Good::Wood, 100.0), (Good::Stone, 50.0)])));
    assert_eq!(s.free(), stock(&[(Good::Wood, 100.0), (Good::Stone, 50.0)]));
}

fn broken(s: &Setup) -> Vec<String> {
    offers_sound(&s.world).into_iter().map(|v| v.message).collect()
}

#[test]
fn set_aside_never_exceeds_what_the_storage_holds() {
    let mut s = setup();
    s.posted(json!({}));
    assert_eq!(broken(&s), Vec::<String>::new());
    s.storage().stock.as_mut().unwrap().insert(Good::Wood, 15.0);
    assert!(broken(&s)[0].contains("20 wood set aside where 15 are held"));
}

#[test]
fn an_offers_storage_exists_and_is_its_realms() {
    let mut s = setup();
    s.posted(json!({}));
    s.world.offers[0].realm_id = "r2".into();
    assert!(broken(&s)[0].contains("no finished storage of r2"));
    s.world.offers[0].realm_id = "r1".into();
    s.world.buildings.retain(|b| b.id != "s1");
    assert!(broken(&s)[0].contains("no finished storage of r1"));
}

#[test]
fn offer_terms_are_whole_and_positive() {
    let mut s = setup();
    s.posted(json!({}));
    s.world.offers[0].times = 0.0;
    assert!(broken(&s)[0].contains("whole and positive"));
}

#[test]
fn accepting_an_offer_moves_goods_and_makes_none() {
    let mut s = setup();
    s.r("t1").carried = stock(&[(Good::Stone, 5.0)]);
    let id = s.posted(json!({ "times": 1 }));
    s.accept(json!({ "offerId": id }), &taker());
    s.tick();
    assert_eq!(offers_keep_goods(&s.scratch.offers), vec![]);
    s.scratch.offers.records[0].after.insert(Good::Wood, 1.0);
    assert_eq!(offers_keep_goods(&s.scratch.offers).len(), 1);
}
