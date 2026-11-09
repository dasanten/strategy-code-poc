//! `apps/server/src/deliveries.test.ts`, one test per `it`. Each starts from `setup()` of
//! `deliveries.fixture.ts` as the TypeScript wrote it (`fixtures/trade/deliveries.json`): the
//! trading post is an NPC village (`foundTradingPost`, T86.10) and Mara's city a starting city
//! (`foundStartingCity`, T86.8), neither of which Rust lays out yet. The caravans walk with the
//! ported `Walking` (T86.4); `checkInvariants` comes with T86.13, so the runs check
//! `deliveries-sound`.

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;

use csp_shared::balance::{DELIVERY_FEE_BASE, DELIVERY_LOAD};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Building, DeliveryKind, Good, RealmEventWhat, Stock, TradeSide, WorldState,
};
use csp_sim::deliveries::deliveries_sound;
use csp_sim::queries::names::held_in;
use csp_sim::queries::residents::good_weight;
use csp_sim::queries::warehouse::{price_for, stock_floor};
use csp_sim::queries::warehouse_trade::{
    delivery_fee, delivery_storage, owed_by, quote_delivery, quote_pick_up, quote_trade,
    TradeHolder,
};
use csp_sim::tick::Scratch;
use goods_support::{open, player, step, Queue};
use serde_json::{json, Value};

struct Setup {
    world: WorldState,
    terrain: csp_shared::terrain::TerrainMap,
    scratch: Scratch,
}

/// `setup()`: the HQ, a trading post with its caravan, Mara's starting city and her p1 on the
/// post's warehouse with 1,000 coins.
fn setup() -> Setup {
    let (world, size, _) = common::load_world("trade/deliveries.json");
    Setup { world, terrain: open(size), scratch: Scratch::default() }
}

impl Setup {
    fn warehouse(&self) -> usize {
        let post = self
            .world
            .cities
            .iter()
            .find(|c| c.trade_org == Some(csp_shared::world::TradeOrgCity::Post))
            .unwrap();
        self.world
            .buildings
            .iter()
            .position(|b| {
                b.kind == csp_shared::world::BuildingKind::Warehouse
                    && b.city_id.as_deref() == Some(post.id.as_str())
            })
            .unwrap()
    }
    fn w(&self) -> &Building {
        &self.world.buildings[self.warehouse()]
    }
    fn set(&mut self, g: Good, n: f64) {
        let i = self.warehouse();
        self.world.buildings[i].stock.get_or_insert_with(Stock::new).insert(g, n);
    }
    fn city_id(&self) -> String {
        self.world.cities.iter().find(|c| c.realm_id.is_some()).unwrap().id.clone()
    }
    fn storage(&self) -> &Building {
        delivery_storage(&self.world, &self.city_id()).unwrap()
    }
    fn p1(&self) -> &csp_shared::world::Resident {
        self.world.residents.iter().find(|r| r.id == "p1").unwrap()
    }
    /// Sends an order from p1, applies it and answers whether it was taken (`order`).
    fn order(&mut self, o: Value) -> String {
        let mut o = o;
        o["residentId"] = json!("p1");
        let mut q = Queue::new(&self.terrain);
        let answer = q.receive(&self.world, &player(7), o);
        q.apply_all(&mut self.world);
        answer.err().unwrap_or_else(|| "ack".into())
    }
}

mod delivery_fees_and_quotes {
    use super::*;

    #[test]
    fn charge_a_base_fee_and_more_for_weight_and_distance() {
        assert_eq!(delivery_fee(0.0, 400.0), DELIVERY_FEE_BASE);
        assert_eq!(delivery_fee(100.0, 400.0), DELIVERY_FEE_BASE + 50.0);
        assert!(delivery_fee(100.0, 800.0) > delivery_fee(100.0, 400.0));
        assert!(delivery_fee(200.0, 400.0) > delivery_fee(100.0, 400.0));
    }

    #[test]
    fn price_a_delivery_like_a_purchase_plus_the_fee_cut_down_to_the_coins_and_one_load() {
        let mut s = setup();
        s.set(Good::Stone, 5_000.0);
        let floor = stock_floor(&s.world, s.w())[&Good::Stone];
        let rich = Stock::from([(Good::Coins, 100_000.0)]);
        let q = quote_delivery(&s.world, s.w(), &rich, Good::Stone, 1_000.0, 160.0, 0.0);
        assert_eq!(q.units, (DELIVERY_LOAD / good_weight(Good::Stone)).floor());
        let price: f64 = (0..q.units as i32)
            .map(|n| price_for(Good::Stone, 5_000.0 - f64::from(n), floor).sell)
            .sum();
        assert_eq!(q.coins, price);
        assert_eq!(q.fee, delivery_fee(q.units * good_weight(Good::Stone), 160.0));
        let poor = quote_delivery(
            &s.world,
            s.w(),
            &Stock::from([(Good::Coins, 30.0)]),
            Good::Stone,
            1_000.0,
            160.0,
            0.0,
        );
        assert!(poor.coins + poor.fee <= 30.0);
        assert!(poor.units > 0.0);
    }

    #[test]
    fn never_sell_what_a_warehouse_keeps_for_deliveries() {
        let mut s = setup();
        s.set(Good::Iron, 30.0);
        let coins = Stock::from([(Good::Coins, 100_000.0)]);
        let hands = TradeHolder { stock: &coins, room: 1_000.0 };
        assert_eq!(
            quote_trade(&s.world, s.w(), hands, TradeSide::Buy, Good::Iron, 100.0, 25.0).units,
            5.0
        );
        assert_eq!(
            quote_delivery(&s.world, s.w(), &coins, Good::Iron, 100.0, 40.0, 25.0).units,
            5.0
        );
    }

    #[test]
    fn pay_for_a_pick_up_what_the_warehouse_would_pay_less_the_fee_within_the_budget() {
        let s = setup();
        let stock = held_in(s.w().stock.as_ref(), Good::Iron);
        let floor = stock_floor(&s.world, s.w())[&Good::Iron];
        let q = quote_pick_up(&s.world, s.w(), Good::Iron, 20.0, 15.0, 120.0, f64::INFINITY);
        assert_eq!(q.units, 15.0);
        let price: f64 =
            (1..=15).map(|n| price_for(Good::Iron, stock + f64::from(n), floor).buy).sum();
        assert_eq!(q.fee, delivery_fee(15.0, 120.0));
        assert_eq!(q.coins, price - q.fee);
        assert!(quote_pick_up(&s.world, s.w(), Good::Iron, 20.0, 15.0, 120.0, 10.0).coins <= 10.0);
        // Cheap goods far away: the fee eats the price, so there is nothing to pick up.
        assert_eq!(
            quote_pick_up(&s.world, s.w(), Good::Food, 1.0, 1.0, 2800.0, f64::INFINITY).units,
            0.0
        );
    }
}

mod ordering_a_delivery {
    use super::*;

    #[test]
    fn pays_for_the_goods_and_the_fee_now_and_the_warehouse_keeps_the_goods_for_it() {
        let mut s = setup();
        let iron = held_in(s.w().stock.as_ref(), Good::Iron);
        let coins = held_in(s.w().stock.as_ref(), Good::Coins);
        let (w, st) =
            ((s.w().x as i32, s.w().y as i32), (s.storage().x as i32, s.storage().y as i32));
        let tiles = wrap_distance(s.terrain.size, w, st);
        let q = quote_delivery(&s.world, s.w(), &s.p1().carried, Good::Iron, 4.0, tiles, 0.0);
        let city = s.city_id();
        assert_eq!(
            s.order(json!({ "kind": "buy", "good": "iron", "units": 4, "cityId": city })),
            "ack"
        );
        step(&mut s.world, &s.terrain, &mut s.scratch);
        assert_eq!(deliveries_sound(&s.world), vec![]);
        assert_eq!(q.units, 4.0);
        assert_stock!(s.p1().carried, { "coins": 1_000.0 - q.coins - q.fee });
        assert_eq!(held_in(s.w().stock.as_ref(), Good::Coins), coins + q.coins + q.fee);
        assert_eq!(held_in(s.w().stock.as_ref(), Good::Iron), iron);
        assert_eq!(s.world.deliveries.len(), 1);
        let d = &s.world.deliveries[0];
        assert_eq!(
            (d.kind, d.good, d.units, d.fee),
            (DeliveryKind::Delivery, Good::Iron, 4.0, q.fee)
        );
        assert_eq!(owed_by(&s.world, &s.w().id, Good::Iron), 4.0);
        let ordered: Vec<_> = s
            .world
            .events
            .iter()
            .filter_map(|e| match &e.what {
                RealmEventWhat::DeliveryOrdered { side, units, coins, fee, .. } => {
                    Some((*side, *units, *coins, *fee))
                }
                _ => None,
            })
            .collect();
        assert_eq!(ordered, vec![(TradeSide::Buy, 4.0, q.coins, q.fee)]);
    }

    #[test]
    fn refuses_a_city_that_is_not_theirs_and_a_pick_up_from_a_carriage() {
        let mut s = setup();
        let post = s.w().city_id.clone().unwrap();
        assert_eq!(
            s.order(json!({ "kind": "buy", "good": "iron", "units": 1, "cityId": post })),
            "not one of your cities"
        );
        let city = s.city_id();
        let pick_up = json!({ "kind": "sell", "good": "food", "units": 1, "cityId": city, "carriageId": "k" });
        assert_ne!(s.order(pick_up), "ack");
    }

    #[test]
    fn refuses_a_pick_up_of_a_good_the_citys_storage_has_none_of() {
        let mut s = setup();
        let city = s.city_id();
        assert_eq!(
            s.order(json!({ "kind": "sell", "good": "iron", "units": 1, "cityId": city })),
            "none of that good to sell"
        );
    }
}

mod caravans_carrying_out_deliveries {
    use super::*;
    use csp_shared::world::{BuildingKind, CrimeKind};
    use csp_sim::queries::warehouse::stock_floor;
    use csp_sim::walking::Walking;
    use csp_sim::world::step_world;
    use std::sync::Arc;

    /// `stillTradeOrgChain` of `test-terrain.ts`: warehouses at least at their floor, and the
    /// Trade Org's cities emptied of all but the caravans' and traders' crews.
    fn still_trade_org_chain(world: &mut WorldState) {
        for i in 0..world.buildings.len() {
            if world.buildings[i].kind != BuildingKind::Warehouse {
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
        for t in &world.traders {
            crew.extend(t.driver_id.clone());
            crew.extend(t.escort_ids.clone());
        }
        let of_trade_org: std::collections::HashSet<String> =
            world.cities.iter().filter(|c| c.trade_org.is_some()).map(|c| c.id.clone()).collect();
        world.residents.retain(|r| {
            r.city_id.as_ref().is_none_or(|c| !of_trade_org.contains(c)) || crew.contains(&r.id)
        });
    }

    /// Steps the world at least once and then until `done`, at most `ticks` times (`runUntil`).
    fn run_until(s: &mut Setup, done: impl Fn(&WorldState) -> bool, ticks: usize) {
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        for t in 0..ticks {
            if t > 0 && done(&s.world) {
                break;
            }
            step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut walking), None);
        }
        assert!(done(&s.world), "not done after {ticks} ticks");
        assert_eq!(deliveries_sound(&s.world), vec![]);
    }

    fn total(world: &WorldState, g: Good) -> f64 {
        let b = world.buildings.iter().filter_map(|b| b.stock.as_ref());
        let k = world.carriages.iter().map(|k| &k.load);
        let r = world.residents.iter().map(|r| &r.carried);
        let p = world.piles.iter().map(|p| &p.goods);
        b.chain(k).chain(r).chain(p).map(|s| s.get(&g).copied().unwrap_or(0.0)).sum()
    }

    #[test]
    fn bring_a_delivery_from_the_trading_post_to_the_citys_storage() {
        let mut s = setup();
        still_trade_org_chain(&mut s.world);
        let city = s.city_id();
        s.order(json!({ "kind": "buy", "good": "iron", "units": 6, "cityId": city }));
        let iron = total(&s.world, Good::Iron);
        let before = held_in(s.storage().stock.as_ref(), Good::Iron);
        run_until(&mut s, |w| w.deliveries.is_empty(), 20_000);
        assert_eq!(held_in(s.storage().stock.as_ref(), Good::Iron), before + 6.0);
        let delivered: Vec<_> = s
            .world
            .events
            .iter()
            .filter_map(|e| match &e.what {
                RealmEventWhat::Delivered { delivery, good, units, city_id, .. } => {
                    Some((*delivery, *good, *units, city_id.clone()))
                }
                _ => None,
            })
            .collect();
        assert_eq!(delivered, vec![(DeliveryKind::Delivery, Good::Iron, 6.0, city.clone())]);
        // Then it goes back to its route, at the post's end.
        run_until(&mut s, |w| w.caravans[0].job.is_none(), 5_000);
        assert_eq!(owed_by(&s.world, &s.w().id, Good::Iron), 0.0);
        assert_eq!(total(&s.world, Good::Iron), iron);
        // Bringing what was bought into someone's storage is no crime.
        assert!(s.world.crimes.iter().all(|c| c.kind != CrimeKind::Theft), "{:?}", s.world.crimes);
        assert!(s.world.crimes.is_empty());
    }

    fn events<'w>(
        w: &'w WorldState,
        pick: impl Fn(&'w RealmEventWhat) -> bool,
    ) -> Vec<&'w RealmEventWhat> {
        w.events.iter().map(|e| &e.what).filter(|e| pick(e)).collect()
    }

    #[test]
    #[ignore = "slow in the TypeScript too (`tags: ['slow']`): 20-30 s here with the HQ's default scripts every tick, for T86.14's long simulations"]
    fn pick_up_goods_sold_from_the_citys_storage_pay_there_and_bring_them_to_the_warehouse() {
        let mut s = setup();
        let si = s.world.buildings.iter().position(|b| b.id == s.storage().id).unwrap();
        s.world.buildings[si].stock.get_or_insert_with(Stock::new).insert(Good::Stone, 40.0);
        let stone = held_in(s.w().stock.as_ref(), Good::Stone);
        let city = s.city_id();
        assert_eq!(
            s.order(json!({ "kind": "sell", "good": "stone", "units": 30, "cityId": city })),
            "ack"
        );
        let collecting = std::cell::Cell::new(false);
        let storage_id = s.world.buildings[si].id.clone();
        run_until(
            &mut s,
            |w| {
                let driver = w.caravans[0]
                    .driver_id
                    .as_deref()
                    .and_then(|d| w.residents.iter().find(|r| r.id == d));
                if driver.is_some_and(|d| csp_sim::deliveries::collects_from(w, d, &storage_id)) {
                    collecting.set(true);
                }
                w.deliveries.is_empty()
            },
            20_000,
        );
        assert!(collecting.get());
        let done = events(&s.world, |e| matches!(e, RealmEventWhat::Delivered { .. }));
        let RealmEventWhat::Delivered { delivery, good, units, coins, .. } = done[0] else {
            unreachable!()
        };
        assert_eq!((*delivery, *good, *units), (DeliveryKind::PickUp, Good::Stone, 30.0));
        assert!(*coins > 0.0);
        let st = s.world.buildings[si].stock.as_ref();
        assert_eq!(held_in(st, Good::Stone), 10.0);
        assert_eq!(held_in(st, Good::Coins), *coins);
        // Taking what was sold to it is no theft.
        assert!(s.world.crimes.is_empty());
        run_until(&mut s, |w| w.caravans[0].job.is_none(), 10_000);
        assert!(held_in(s.w().stock.as_ref(), Good::Stone) >= stone + 30.0 - 1.0);
    }

    #[test]
    fn turn_back_from_a_city_behind_closed_gates_and_the_delivery_waits_for_the_next_caravan() {
        let mut s = setup();
        let city = s.city_id();
        for b in &mut s.world.buildings {
            if b.kind == BuildingKind::Gate && b.city_id.as_deref() == Some(city.as_str()) {
                b.closed = Some(true);
            }
        }
        s.order(json!({ "kind": "buy", "good": "iron", "units": 3, "cityId": city }));
        let stuck = |w: &WorldState| {
            w.events.iter().any(|e| matches!(e.what, RealmEventWhat::DeliveryStuck { .. }))
        };
        run_until(&mut s, stuck, 20_000);
        let first = events(&s.world, |e| matches!(e, RealmEventWhat::DeliveryStuck { .. }));
        let RealmEventWhat::DeliveryStuck { cancelled, units, .. } = first[0] else {
            unreachable!()
        };
        assert_eq!((*cancelled, *units), (false, 3.0));
        assert_eq!(s.world.deliveries.len(), 1);
        assert_eq!(
            (s.world.deliveries[0].caravan_id.clone(), s.world.deliveries[0].units),
            (None, 3.0)
        );
        run_until(&mut s, |w| w.caravans[0].job.is_none(), 10_000);
        assert_eq!(owed_by(&s.world, &s.w().id, Good::Iron), 3.0);
    }

    #[test]
    fn drop_a_delivery_to_a_city_that_is_no_longer_the_realms() {
        let mut s = setup();
        let city = s.city_id();
        s.order(json!({ "kind": "buy", "good": "iron", "units": 3, "cityId": city }));
        let delivering = |w: &WorldState| {
            w.caravans[0]
                .job
                .as_ref()
                .is_some_and(|j| j.step == csp_shared::world::CaravanJobStep::Deliver)
        };
        run_until(&mut s, delivering, 20_000);
        // The delivery's realm is another than the city's now, as when the city was taken.
        s.world.realms.push(goods_support::realm("realm2", 8, "q1"));
        s.world.residents.push(goods_support::new_resident(3.0, "q1", Some("realm2"), 5.0, 5.0));
        s.world.deliveries[0].realm_id = "realm2".into();
        let stuck = |w: &WorldState| {
            w.events.iter().any(|e| matches!(e.what, RealmEventWhat::DeliveryStuck { .. }))
        };
        run_until(&mut s, stuck, 100);
        let first = events(&s.world, |e| matches!(e, RealmEventWhat::DeliveryStuck { .. }));
        assert!(matches!(first[0], RealmEventWhat::DeliveryStuck { cancelled: true, .. }));
        assert!(s.world.deliveries.is_empty());
    }

    #[test]
    fn let_go_of_a_delivery_when_the_caravan_breaks_up() {
        let mut s = setup();
        let city = s.city_id();
        s.order(json!({ "kind": "buy", "good": "iron", "units": 3, "cityId": city }));
        run_until(&mut s, |w| w.caravans[0].job.is_some(), 20_000);
        let k = s.world.caravans[0].carriage_id.clone();
        s.world.carriages.retain(|x| x.id != k);
        step(&mut s.world, &s.terrain, &mut s.scratch);
        assert!(s.world.caravans.is_empty());
        assert_eq!(s.world.deliveries.len(), 1);
        assert_eq!(s.world.deliveries[0].caravan_id, None);
        assert_eq!(deliveries_sound(&s.world), vec![]);
    }
}

mod deliveries_sound {
    use super::*;
    use csp_shared::world::{CaravanJob, CaravanJobStep, Delivery};

    #[test]
    fn flags_a_delivery_whose_caravan_carries_out_another() {
        let mut s = setup();
        let w = s.w().id.clone();
        let city = s.world.cities.iter().find(|c| c.realm_id.is_some()).unwrap().clone();
        s.world.deliveries.push(Delivery {
            id: "delivery1".into(),
            kind: DeliveryKind::Delivery,
            realm_id: city.realm_id.clone().unwrap(),
            warehouse_id: w,
            city_id: city.id.clone(),
            good: Good::Iron,
            units: 2.0,
            fee: 5.0,
            caravan_id: Some(s.world.caravans[0].id.clone()),
        });
        assert_eq!(deliveries_sound(&s.world).len(), 1);
        s.world.deliveries[0].units = 0.0;
        s.world.deliveries[0].caravan_id = None;
        assert_eq!(deliveries_sound(&s.world).len(), 1);
    }

    #[test]
    fn flags_a_caravan_counting_more_on_board_than_its_carriage_holds() {
        let mut s = setup();
        let w = s.w().id.clone();
        s.world.caravans[0].job = Some(CaravanJob {
            delivery_id: "gone".into(),
            kind: DeliveryKind::Delivery,
            warehouse_id: w,
            good: Good::Iron,
            step: CaravanJobStep::Return,
            units: 5.0,
            coins: 0.0,
            target: None,
            to_pay: 0.0,
            paid: 0.0,
            fee: 0.0,
            misses: 0.0,
            robbed: 0.0,
        });
        assert_eq!(deliveries_sound(&s.world).len(), 1);
    }
}
