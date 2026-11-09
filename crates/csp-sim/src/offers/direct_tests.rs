//! `direct-offers.test.ts`: sending, accepting and ending Direct offers. The client view of them
//! (`diplomacyFor`) comes with the server.

use std::sync::Arc;

use super::*;
use crate::events::events_for;
use crate::invariants::{check_invariants, world_invariants};
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::goods::free_stock;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::test_support::{add_city, building, plains};
use crate::tick::Scratch;
use crate::world::{create_world, step_world};
use csp_shared::balance::{DIRECT_OFFERS_TO_ONE_REALM, MAX_HUNGER, OWN_FOOD};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{BuildingKind, Realm, Resident, Stat, Standing};
use serde_json::json;

const SIZE: i32 = 128;

fn sender() -> OrderSender {
    OrderSender::player(7, "Mara")
}
fn named() -> OrderSender {
    OrderSender::player(8, "Bo")
}
fn other() -> OrderSender {
    OrderSender::player(9, "Wren")
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

fn add_resident(world: &mut WorldState, id: &str, owner: &str, city: Option<&str>, x: f64, y: f64) {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner: Some(owner), city_id: city, x, y, tick: 0.0 };
    let mut r: Resident = new_resident(&mut || m.next(), &fields, None);
    let stat = Stat { base: 10.0, trained: 0.0 };
    r.stats.strength = stat.clone();
    r.stats.endurance = stat.clone();
    r.stats.intellect = stat.clone();
    r.stats.agility = stat;
    r.born_at = -20.0 * TICKS_PER_GAME_YEAR;
    r.lifespan = 60.0;
    r.carried = stock(&[(Good::Food, OWN_FOOD), (Good::Stone, 20.0)]);
    world.residents.push(r);
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    queue: OrderQueue,
    scratch: Scratch,
}

/// Realm r1 with storage s1 at (6, 6) holding 100 Wood. Realm r2, which r1 has a standing with,
/// has resident t2 on the storage and its city far off. Realm r3 has t3 on the storage too, and
/// r1 sees it there.
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 7, "a1"), ("r2", 8, "b1"), ("r3", 9, "c1")] {
        let realm = json!({ "id": id, "userId": user, "leaderId": leader });
        world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    }
    add_city(&mut world, "c1", Some("r1"), 10.0, 10.0);
    add_city(&mut world, "c2", Some("r2"), 90.0, 90.0);
    world.cities[0].name = "Oakford".into();
    world.cities[1].name = "Brook".into();
    let mut s = building("s1", BuildingKind::Storage, Some("c1"), 6.0, 6.0);
    s.stock = Some(stock(&[(Good::Wood, 100.0)]));
    world.buildings.push(s);
    world.standings.push(Standing { of: "r1".into(), toward: "r2".into(), value: 1.0 });
    add_resident(&mut world, "a1", "r1", Some("c1"), 8.0, 8.0);
    add_resident(&mut world, "b1", "r2", Some("c2"), 100.0, 100.0);
    add_resident(&mut world, "c1", "r3", None, 110.0, 110.0);
    add_resident(&mut world, "t2", "r2", Some("c2"), 6.0, 6.0);
    add_resident(&mut world, "t3", "r3", None, 6.0, 6.0);
    let terrain = Arc::new(terrain);
    Setup {
        world,
        queue: OrderQueue::new(order_kinds(), Some(terrain.clone())),
        terrain,
        scratch: Scratch::default(),
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

impl Setup {
    fn receive(&mut self, from: &OrderSender, order: Value) -> OrderReply {
        self.queue.receive(&self.world, from, &json!("q"), &order)
    }

    /// The answer to sending r2 a Direct offer, unless the terms say otherwise.
    fn send(&mut self, terms: Value, from: &OrderSender) -> OrderReply {
        let mut order = json!({
            "kind": "sendDirectOffer", "toId": "r2", "storageId": "s1", "gives": "wood",
            "givesUnits": 10, "wants": "stone", "wantsUnits": 5, "times": 2,
        });
        for (k, v) in terms.as_object().unwrap() {
            order[k] = v.clone();
        }
        self.receive(from, order)
    }

    /// The id of the offer once sent to r2.
    fn sent(&mut self) -> String {
        assert_eq!(self.send(json!({}), &sender()), ack());
        self.queue.apply_all(&mut self.world);
        self.world.offers.last().unwrap().id.clone()
    }

    fn offer(&mut self, id: &str) -> &mut Offer {
        self.world.offers.iter_mut().find(|o| o.id == id).unwrap()
    }

    fn last(&self, user_id: u64) -> Value {
        serde_json::to_value(events_for(&self.world, user_id, 0).pop().unwrap()).unwrap()
    }

    fn free(&self) -> Stock {
        let s = self.world.buildings.iter().find(|b| b.id == "s1").unwrap();
        free_stock(&self.world, &s.id, s.stock.as_ref())
    }

    fn storage(&mut self) -> &mut Building {
        self.world.buildings.iter_mut().find(|b| b.id == "s1").unwrap()
    }

    /// Steps the world, every invariant holding after the tick.
    fn tick(&mut self) {
        self.queue.apply_all(&mut self.world);
        for r in &mut self.world.residents {
            r.hunger = MAX_HUNGER;
        }
        let terrain = self.terrain.clone();
        step_world(&mut self.world, &terrain, &mut self.scratch, None, None);
        assert_eq!(check_invariants(&self.world, &terrain, &world_invariants()), vec![]);
    }

    fn accept(&mut self, resident_id: &str, offer_id: &str) -> OrderReply {
        let from = if resident_id == "t2" { named() } else { other() };
        let order = json!({ "kind": "acceptOffer", "residentId": resident_id, "offerId": offer_id, "times": 1 });
        self.receive(&from, order)
    }
}

#[test]
fn a_direct_offer_sets_the_goods_aside_and_the_other_side_hears_at_once() {
    let mut s = setup();
    let id = s.sent();
    let tick = s.world.tick as f64;
    let o = s.offer(&id).clone();
    assert_eq!((o.realm_id.as_str(), o.storage_id.as_str(), o.times), ("r1", "s1", 2.0));
    let direct = o.direct.unwrap();
    assert_eq!(direct.to_id, "r2");
    assert_eq!(direct.lapses_at, tick + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY);
    assert_eq!(s.free(), stock(&[(Good::Wood, 80.0)]));
    let last = s.last(8);
    assert_eq!(
        (last["kind"].as_str(), last["what"].as_str(), last["times"].as_f64()),
        (Some("directOffer"), Some("received"), Some(2.0))
    );
    s.tick();
    assert_eq!(s.world.offers.len(), 1);
}

#[test]
fn a_direct_offer_goes_only_to_another_realm_its_sender_knows_of() {
    let mut s = setup();
    assert!(reason(s.send(json!({ "toId": "r1" }), &sender())).contains("another realm"));
    assert!(reason(s.send(json!({ "toId": "nobody" }), &sender())).contains("to a realm"));
    assert!(reason(s.send(json!({ "toId": "n1" }), &sender())).contains("to a realm"));
    // r3's t3 stands on r1's storage, in r1's sight, though r1 knows of it no other way.
    assert_eq!(realms_to_offer_to(&s.world, "r1", []), vec!["r2"]);
    assert_eq!(s.send(json!({ "toId": "r3" }), &sender()), ack());
    s.world.residents.retain(|r| r.owner.as_deref() != Some("r3"));
    assert_eq!(reason(s.send(json!({ "toId": "r3" }), &sender())), "you don’t know of that realm");
}

#[test]
fn a_direct_offer_needs_an_offer_that_could_be_posted_at_a_storage_of_the_sender() {
    let mut s = setup();
    assert!(reason(s.send(json!({ "storageId": "c1-hall" }), &sender())).contains("storage of yours"));
    assert!(reason(s.send(json!({ "gives": "stone" }), &sender())).contains("different good"));
    assert!(reason(s.send(json!({ "times": 0 }), &sender())).contains("whole numbers"));
    assert!(reason(s.send(json!({ "givesUnits": 500 }), &sender())).contains("not enough"));
    let r = reason(s.send(json!({}), &named()));
    assert!(r.contains("another realm") || r.contains("storage of yours"), "{r}");
}

#[test]
fn direct_offers_can_stand_only_so_many_times_to_one_realm() {
    let mut s = setup();
    for _ in 0..DIRECT_OFFERS_TO_ONE_REALM as usize {
        assert_eq!(s.send(json!({ "givesUnits": 1, "times": 1 }), &sender()), ack());
        s.queue.apply_all(&mut s.world);
    }
    assert!(reason(s.send(json!({ "givesUnits": 1, "times": 1 }), &sender())).contains("at most"));
}

#[test]
fn accepting_takes_the_named_realms_resident_on_the_storage_and_the_sender_hears() {
    let mut s = setup();
    let id = s.sent();
    assert_eq!(s.accept("t2", &id), ack());
    s.tick();
    let t2 = s.world.residents.iter().find(|r| r.id == "t2").unwrap();
    assert_eq!((t2.carried.get(&Good::Wood), t2.carried.get(&Good::Stone)), (Some(&10.0), Some(&15.0)));
    assert_eq!(s.storage().stock, Some(stock(&[(Good::Wood, 90.0), (Good::Stone, 5.0)])));
    assert_eq!(s.offer(&id).times, 1.0);
    let kinds: Vec<Value> = events_for(&s.world, 7, 0).iter().map(|e| serde_json::to_value(e).unwrap()["kind"].clone()).collect();
    assert!(kinds.contains(&json!("offerTaken")));
}

#[test]
fn a_used_up_direct_offer_tells_only_the_sender() {
    let mut s = setup();
    let id = s.sent();
    s.offer(&id).times = 1.0;
    s.accept("t2", &id);
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    let last = s.last(7);
    assert_eq!((last["kind"].as_str(), last["why"].as_str()), (Some("offerEnded"), Some("usedUp")));
    assert!(last["to"].is_string());
    let direct = events_for(&s.world, 8, 0)
        .iter()
        .filter(|e| serde_json::to_value(e).unwrap()["kind"] == "directOffer")
        .count();
    assert_eq!(direct, 1);
}

#[test]
fn a_direct_offer_refuses_anyone_else_even_on_the_storage_with_the_goods() {
    let mut s = setup();
    let id = s.sent();
    assert_eq!(reason(s.accept("t3", &id)), "that offer is for another realm");
    let o = s.offer(&id).clone();
    assert!(!crate::queries::offers::offer_open_to(&o, "r3"));
    assert!(crate::queries::offers::offer_open_to(&o, "r2"));
    // An order given before the check can't get round it either.
    let t3 = s.world.residents.iter_mut().find(|r| r.id == "t3").unwrap();
    t3.order = Some(ResidentOrder::AcceptOffer(AcceptOfferOrder {
        offer_id: id.clone(),
        times: 1.0,
        carriage_id: None,
    }));
    assert_eq!(resolve_offers(&mut s.world, &mut OfferLedger::default()), 0);
    assert_eq!(s.storage().stock, Some(stock(&[(Good::Wood, 100.0)])));
    assert_eq!(s.offer(&id).times, 2.0);
}

#[test]
fn a_direct_offer_ends_when_declined_and_the_sender_hears() {
    let mut s = setup();
    let id = s.sent();
    let decline = json!({ "kind": "declineOffer", "offerId": id });
    assert!(reason(s.receive(&other(), decline.clone())).contains("wasn’t sent to you"));
    assert!(reason(s.receive(&sender(), decline.clone())).contains("wasn’t sent to you"));
    assert_eq!(s.receive(&named(), decline.clone()), ack());
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.free(), stock(&[(Good::Wood, 100.0)]));
    let to_sender = s.last(7);
    assert_eq!((to_sender["kind"].as_str(), to_sender["why"].as_str()), (Some("offerEnded"), Some("declined")));
    let to_named = s.last(8);
    assert_eq!((to_named["kind"].as_str(), to_named["what"].as_str()), (Some("directOffer"), Some("declined")));
    assert_eq!(reason(s.receive(&named(), decline)), "that offer is gone");
}

#[test]
fn an_offer_to_anyone_cant_be_declined() {
    let mut s = setup();
    let post = json!({ "kind": "postOffer", "storageId": "s1", "gives": "wood", "givesUnits": 10, "wants": "stone", "wantsUnits": 5, "times": 2 });
    s.receive(&sender(), post);
    s.queue.apply_all(&mut s.world);
    let decline = json!({ "kind": "declineOffer", "offerId": s.world.offers[0].id });
    assert!(reason(s.receive(&named(), decline)).contains("wasn’t sent to you"));
}

#[test]
fn a_direct_offer_lapses_its_goods_ordinary_again_and_both_sides_told() {
    let mut s = setup();
    let id = s.sent();
    let at = s.world.tick as f64 + 2.0;
    s.offer(&id).direct.as_mut().unwrap().lapses_at = at;
    s.tick();
    assert_eq!(s.world.offers.len(), 1);
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.free(), stock(&[(Good::Wood, 100.0)]));
    assert_eq!(s.last(7)["why"], "lapsed");
    assert_eq!(s.last(8)["what"], "lapsed");
}

#[test]
fn a_direct_offer_taken_down_tells_the_other_side() {
    let mut s = setup();
    let id = s.sent();
    s.receive(&sender(), json!({ "kind": "takeDownOffer", "offerId": id }));
    s.tick();
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.last(8)["what"], "takenDown");
}

#[test]
fn a_direct_offer_ends_with_its_storage_or_its_goods_and_the_other_side_hears() {
    let mut s = setup();
    s.sent();
    s.storage().stock = None;
    step_offers(&mut s.world);
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.last(8)["what"], "goodsGone");
    s.storage().stock = Some(stock(&[(Good::Wood, 100.0)]));
    s.sent();
    s.world.buildings.retain(|b| b.id != "s1");
    step_offers(&mut s.world);
    assert_eq!(s.world.offers, vec![]);
    assert_eq!(s.last(8)["what"], "storageLost");
}

#[test]
fn a_direct_offer_lapses_when_the_realm_it_was_sent_to_is_gone() {
    let mut s = setup();
    s.sent();
    s.world.realms.retain(|r| r.id != "r2");
    step_offers(&mut s.world);
    assert_eq!(s.world.offers, vec![]);
    let last = s.last(7);
    assert_eq!((last["kind"].as_str(), last["why"].as_str()), (Some("offerEnded"), Some("lapsed")));
}

#[test]
fn offers_sound_flags_a_direct_offer_to_its_own_realm_or_outliving_its_time() {
    let mut s = setup();
    let id = s.sent();
    assert_eq!(offers_sound(&s.world), vec![]);
    s.offer(&id).direct.as_mut().unwrap().to_id = "r1".into();
    let broken = offers_sound(&s.world);
    assert_eq!(broken.len(), 1);
    assert!(broken[0].message.contains("own realm"));
    let tick = s.world.tick as f64;
    s.offer(&id).direct = Some(DirectOfferTerms { to_id: "r2".into(), lapses_at: tick, carried: None });
    let broken = offers_sound(&s.world);
    assert_eq!(broken.len(), 1);
    assert!(broken[0].message.contains("outlived"));
}
