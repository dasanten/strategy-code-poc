//! `apps/server/src/transfers.test.ts`, one test per `it`. Each starts from `setup()` of
//! `transfers.fixture.ts` as the TypeScript wrote it (`fixtures/trade/transfers.json`), as the
//! deliveries tests do; the caravans walk with the ported `Walking` (T86.4), and the runs check
//! `transfers-sound` (`checkInvariants` comes with T86.13).

mod common;
#[path = "goods_support/mod.rs"]
mod goods_support;

use std::sync::Arc;

use csp_shared::balance::{DELIVERY_LOAD, TRANSFER_FEE_FACTOR};
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, Good, RealmEventWhat, Stock, Transfer, TransferJob, TransferJobStep,
    TransferStuckWhy, WorldState,
};
use csp_sim::queries::names::held_in;
use csp_sim::queries::residents::good_weight;
use csp_sim::queries::transfer::{
    nearest_warehouse, quote_transfer, transfer_fee, transfer_load, transfer_tiles,
};
use csp_sim::queries::warehouse::stock_floor;
use csp_sim::queries::warehouse_trade::{delivery_fee, delivery_storage, owed_by};
use csp_sim::standing::change_standing;
use csp_sim::tick::Scratch;
use csp_sim::transfers::{collects_transfer_from, transfers_sound};
use csp_sim::walking::Walking;
use csp_sim::world::step_world;
use goods_support::{open, player, step, Queue};
use serde_json::{json, Value};

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scratch: Scratch,
}

fn setup() -> Setup {
    let (world, size, _) = common::load_world("trade/transfers.json");
    Setup { world, terrain: open(size), scratch: Scratch::default() }
}

fn xy(b: &Building) -> (f64, f64) {
    (b.x, b.y)
}

fn dist(size: i32, a: (f64, f64), b: (f64, f64)) -> f64 {
    wrap_distance(size, (a.0 as i32, a.1 as i32), (b.0 as i32, b.1 as i32))
}

impl Setup {
    fn realm(&self, user: u64) -> String {
        self.world.realms.iter().find(|r| r.user_id == user).unwrap().id.clone()
    }
    fn city(&self, user: u64) -> String {
        let realm = self.realm(user);
        self.world
            .cities
            .iter()
            .find(|c| c.realm_id.as_deref() == Some(realm.as_str()))
            .unwrap()
            .id
            .clone()
    }
    fn storage_of(&self, user: u64) -> usize {
        let id = delivery_storage(&self.world, &self.city(user)).unwrap().id.clone();
        self.world.buildings.iter().position(|b| b.id == id).unwrap()
    }
    fn held(&self, b: usize, g: Good) -> f64 {
        held_in(self.world.buildings[b].stock.as_ref(), g)
    }
    fn set(&mut self, b: usize, g: Good, n: Option<f64>) {
        let s = self.world.buildings[b].stock.get_or_insert_with(Stock::new);
        match n {
            Some(n) => s.insert(g, n),
            None => s.shift_remove(&g),
        };
    }
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
                b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(post.id.as_str())
            })
            .unwrap()
    }
    fn p1(&mut self) -> &mut csp_shared::world::Resident {
        self.world.residents.iter_mut().find(|r| r.id == "p1").unwrap()
    }
    /// Sends an order from Mara (for p1, when it is a resident's), applies it and answers.
    fn order(&mut self, o: Value) -> String {
        let mut o = o;
        o["residentId"] = json!("p1");
        let mut q = Queue::new(&self.terrain);
        let answer = q.receive(&self.world, &player(7), o);
        q.apply_all(&mut self.world);
        answer.err().unwrap_or_else(|| "ack".into())
    }
    fn total(&self, g: Good) -> f64 {
        let w = &self.world;
        let b = w.buildings.iter().filter_map(|b| b.stock.as_ref());
        let k = w.carriages.iter().map(|k| &k.load);
        let r = w.residents.iter().map(|r| &r.carried);
        let p = w.piles.iter().map(|p| &p.goods);
        b.chain(k).chain(r).chain(p).map(|s| s.get(&g).copied().unwrap_or(0.0)).sum()
    }
    /// Steps the world at least once and then until `done`, at most `ticks` times (`runUntil`).
    fn run_until(&mut self, done: impl Fn(&WorldState) -> bool, ticks: usize) {
        let mut walking = Walking::new(Arc::new(self.terrain.clone()));
        for t in 0..ticks {
            if t > 0 && done(&self.world) {
                break;
            }
            step_world(&mut self.world, &self.terrain, &mut self.scratch, Some(&mut walking), None);
        }
        assert!(done(&self.world), "not done after {ticks} ticks");
        assert_eq!(transfers_sound(&self.world), vec![]);
    }
    /// What a realm's log says, for the events `pick` picks (`eventsOf`).
    fn events(
        &self,
        user: Option<u64>,
        pick: impl Fn(&RealmEventWhat) -> bool,
    ) -> Vec<RealmEventWhat> {
        self.world
            .events
            .iter()
            .filter(|e| user.is_none_or(|u| e.user_id == u) && pick(&e.what))
            .map(|e| e.what.clone())
            .collect()
    }
}

/// The caravan carrying out a transfer, if one is (`carrier`).
fn carrier(world: &WorldState) -> Option<&csp_shared::world::Caravan> {
    world.caravans.iter().find(|c| c.transfer.is_some())
}

/// `stillTradeOrgChain` of `test-terrain.ts`.
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
    let of_trade_org: std::collections::HashSet<String> =
        world.cities.iter().filter(|c| c.trade_org.is_some()).map(|c| c.id.clone()).collect();
    world.residents.retain(|r| {
        r.city_id.as_ref().is_none_or(|c| !of_trade_org.contains(c)) || crew.contains(&r.id)
    });
}

mod transfer_fees_and_quotes {
    use super::*;

    #[test]
    fn cost_a_multiple_of_a_deliverys_fee_over_the_caravans_whole_way() {
        assert_eq!(transfer_fee(100.0, 100.0), TRANSFER_FEE_FACTOR * delivery_fee(100.0, 100.0));
        const { assert!(TRANSFER_FEE_FACTOR > 1.0) };
        let w = (0.0, 0.0);
        assert_eq!(
            transfer_tiles(100, w, Some((10.0, 0.0)), (10.0, 20.0)),
            10.0 + 20.0 + dist(100, w, (10.0, 20.0))
        );
        assert_eq!(transfer_tiles(100, w, None, (0.0, 15.0)), 30.0);
    }

    #[test]
    fn take_what_is_held_up_to_one_load_and_the_coins_for_the_fee() {
        let s = |v: Value| goods_support::stock(v);
        assert_eq!(
            quote_transfer(&s(json!({ "iron": 50, "coins": 10000 })), Good::Iron, 30.0, 160.0, 0.0),
            (30.0, transfer_fee(30.0, 160.0))
        );
        assert_eq!(
            quote_transfer(&s(json!({ "iron": 12, "coins": 10000 })), Good::Iron, 30.0, 160.0, 0.0)
                .0,
            12.0
        );
        let load = quote_transfer(
            &s(json!({ "stone": 10000, "coins": 100000 })),
            Good::Stone,
            10_000.0,
            160.0,
            0.0,
        );
        assert_eq!(load.0, (DELIVERY_LOAD / good_weight(Good::Stone)).floor());
        // Short of coins for the whole fee, it takes fewer.
        let fee10 = transfer_fee(10.0, 160.0);
        let poor = quote_transfer(
            &s(json!({ "iron": 100, "coins": fee10 })),
            Good::Iron,
            100.0,
            160.0,
            0.0,
        );
        assert_eq!(poor, (10.0, fee10));
        assert_eq!(
            quote_transfer(&s(json!({ "iron": 100 })), Good::Iron, 100.0, 160.0, 0.0).0,
            0.0
        );
        // Coins pay their own fee out of the same coins.
        let coins = quote_transfer(&s(json!({ "coins": 500 })), Good::Coins, 1_000.0, 160.0, 0.0);
        assert!(coins.0 + coins.1 <= 500.0);
        assert!(coins.0 > 0.0);
    }

    #[test]
    fn come_from_the_warehouse_nearest_the_senders_city() {
        let s = setup();
        let storage = xy(&s.world.buildings[s.storage_of(7)]);
        let w = nearest_warehouse(&s.world, storage, s.terrain.size).unwrap();
        for b in s.world.buildings.iter().filter(|x| x.kind == BuildingKind::Warehouse) {
            assert!(dist(s.terrain.size, xy(w), storage) <= dist(s.terrain.size, xy(b), storage));
        }
    }
}

mod ordering_a_transfer {
    use super::*;

    #[test]
    fn needs_nobody_at_a_warehouse_and_moves_nothing_until_the_caravan_comes() {
        let mut s = setup();
        let st = s.storage_of(7);
        s.set(st, Good::Iron, Some(40.0));
        let (city, to_city) = (s.city(7), s.city(8));
        let o = json!({ "kind": "transfer", "fromCityId": city, "toCityId": to_city, "good": "iron", "units": 25 });
        assert_eq!(s.order(o), "ack");
        let near = nearest_warehouse(&s.world, xy(&s.world.buildings[st]), s.terrain.size)
            .unwrap()
            .id
            .clone();
        assert_eq!(s.world.transfers.len(), 1);
        let t = &s.world.transfers[0];
        assert_eq!(
            (
                t.to_realm_id.clone(),
                t.from_city_id.clone(),
                t.good,
                t.units,
                t.fee,
                t.warehouse_id.clone()
            ),
            (s.realm(8), Some(city.clone()), Good::Iron, 25.0, 0.0, near)
        );
        assert_eq!(s.held(st, Good::Iron), 40.0);
        let names = |id: &str| s.world.cities.iter().find(|c| c.id == id).unwrap().name.clone();
        let ordered = s.events(Some(7), |e| matches!(e, RealmEventWhat::TransferOrdered { .. }));
        assert_eq!(ordered.len(), 1);
        let RealmEventWhat::TransferOrdered { from_city, city: c, units, .. } = &ordered[0] else {
            unreachable!()
        };
        assert_eq!(
            (from_city.clone(), c.clone(), *units),
            (Some(names(&city)), names(&to_city), 25.0)
        );
    }

    #[test]
    fn refuses_one_to_its_own_city_to_no_realms_beyond_one_load_or_for_a_refused_realm() {
        let mut s = setup();
        let (city, to_city) = (s.city(7), s.city(8));
        let post = s.world.buildings[s.warehouse()].city_id.clone().unwrap();
        let from = |to: &str, units: f64, from: &str| json!({ "kind": "transfer", "fromCityId": from, "good": "iron", "units": units, "toCityId": to });
        assert_eq!(s.order(from(&city, 5.0, &city)), "that city is your own");
        assert_eq!(s.order(from(&post, 5.0, &city)), "not a city of a realm");
        assert_eq!(
            s.order(from(&to_city, transfer_load(Good::Iron) + 1.0, &city)),
            "more than one carriage load"
        );
        assert_ne!(s.order(from(&to_city, 5.0, &to_city)), "ack");
        let realm = s.realm(7);
        change_standing(&mut s.world, "trade-org", &realm, -100.0);
        assert_eq!(
            s.order(from(&to_city, 5.0, &city)),
            "the Trade Organization won’t carry for you"
        );
        assert!(s.world.transfers.is_empty());
    }

    #[test]
    fn hands_in_coins_at_a_warehouse_paying_the_fee_there_at_once() {
        let mut s = setup();
        let to = xy(&s.world.buildings[s.storage_of(8)]);
        let tiles = transfer_tiles(s.terrain.size, xy(&s.world.buildings[s.warehouse()]), None, to);
        let (units, fee) = quote_transfer(&s.p1().carried.clone(), Good::Coins, 300.0, tiles, 0.0);
        let to_city = s.city(8);
        assert_eq!(
            s.order(
                json!({ "kind": "handIn", "good": "coins", "units": 300, "toCityId": to_city })
            ),
            "ack"
        );
        let coins = s.total(Good::Coins);
        step(&mut s.world, &s.terrain, &mut s.scratch);
        assert_eq!(transfers_sound(&s.world), vec![]);
        assert_eq!(units, 300.0);
        assert_eq!(s.p1().carried[&Good::Coins], 1_000.0 - 300.0 - fee);
        assert_eq!(s.total(Good::Coins), coins);
        assert_eq!(s.world.transfers.len(), 1);
        let t = &s.world.transfers[0];
        assert_eq!(
            (t.from_city_id.clone(), t.good, t.units, t.fee),
            (None, Good::Coins, 300.0, fee)
        );
        let name = s.p1().name.clone();
        let ordered = s.events(None, |e| matches!(e, RealmEventWhat::TransferOrdered { .. }));
        let RealmEventWhat::TransferOrdered { name: n, units: u, fee: f, from_city, .. } =
            &ordered[0]
        else {
            unreachable!()
        };
        assert_eq!((n.clone(), *u, *f, from_city.clone()), (Some(name), 300.0, fee, None));
    }

    #[test]
    fn keeps_goods_handed_in_for_the_transfer_so_the_warehouse_sells_none_of_them() {
        let mut s = setup();
        s.p1().carried.insert(Good::Iron, 8.0);
        let to_city = s.city(8);
        s.order(json!({ "kind": "handIn", "good": "iron", "units": 8, "toCityId": to_city }));
        step(&mut s.world, &s.terrain, &mut s.scratch);
        let w = s.world.buildings[s.warehouse()].id.clone();
        assert_eq!(owed_by(&s.world, &w, Good::Iron), 8.0);
    }
}

mod caravans_carrying_out_transfers {
    use super::*;

    #[test]
    fn pick_a_transfer_up_at_the_senders_city_and_bring_it_to_the_recipients() {
        let mut s = setup();
        let (st, to) = (s.storage_of(7), s.storage_of(8));
        s.set(st, Good::Iron, Some(40.0));
        still_trade_org_chain(&mut s.world);
        let coins = s.held(st, Good::Coins);
        let iron = s.total(Good::Iron);
        let before = s.held(to, Good::Iron);
        let (city, to_city) = (s.city(7), s.city(8));
        s.order(json!({ "kind": "transfer", "fromCityId": city, "toCityId": to_city, "good": "iron", "units": 25 }));
        let wid = s.world.transfers[0].warehouse_id.clone();
        let warehouse = xy(s.world.buildings.iter().find(|b| b.id == wid).unwrap());
        let collecting = std::cell::Cell::new(false);
        let storage_id = s.world.buildings[st].id.clone();
        s.run_until(
            |w| {
                let driver = carrier(w)
                    .and_then(|c| c.driver_id.as_deref())
                    .and_then(|d| w.residents.iter().find(|r| r.id == d));
                if driver.is_some_and(|d| collects_transfer_from(w, d, &storage_id)) {
                    collecting.set(true);
                }
                w.transfers.is_empty()
            },
            20_000,
        );
        assert!(collecting.get());
        let (sxy, txy) = (xy(&s.world.buildings[st]), xy(&s.world.buildings[to]));
        let fee = transfer_fee(25.0, transfer_tiles(s.terrain.size, warehouse, Some(sxy), txy));
        assert_eq!(s.held(to, Good::Iron), before + 25.0);
        assert_eq!(s.held(st, Good::Iron), 15.0);
        assert_eq!(s.held(st, Good::Coins), coins - fee);
        assert_eq!(s.total(Good::Iron), iron);
        // Both realms' logs show it.
        let (realm, other) = (s.realm(7), s.realm(8));
        for user in [7, 8] {
            let arrived = s.events(Some(user), |e| matches!(e, RealmEventWhat::Transferred { .. }));
            assert_eq!(arrived.len(), 1, "user {user}");
            let RealmEventWhat::Transferred {
                good, units, fee: f, from_realm_id, to_realm_id, ..
            } = &arrived[0]
            else {
                unreachable!()
            };
            assert_eq!(
                (*good, *units, *f, from_realm_id.clone(), to_realm_id.clone()),
                (Good::Iron, 25.0, fee, realm.clone(), other.clone())
            );
        }
        // Taking what it was given to carry, and putting it into someone's storage, is no crime.
        assert!(s.world.crimes.is_empty());
    }

    #[test]
    #[ignore = "slow in the TypeScript too (`tags: ['slow']`): 20-30 s here with the HQ's default scripts every tick, for T86.14's long simulations"]
    fn take_what_the_senders_storage_holds_with_a_fee_for_what_it_takes() {
        let mut s = setup();
        let (st, to) = (s.storage_of(7), s.storage_of(8));
        s.set(st, Good::Iron, Some(6.0));
        let before = s.held(to, Good::Iron);
        let (city, to_city) = (s.city(7), s.city(8));
        s.order(json!({ "kind": "transfer", "fromCityId": city, "toCityId": to_city, "good": "iron", "units": 20 }));
        s.run_until(|w| w.transfers.is_empty(), 20_000);
        assert_eq!(s.held(to, Good::Iron), before + 6.0);
        let arrived = s.events(None, |e| matches!(e, RealmEventWhat::Transferred { .. }));
        assert!(matches!(arrived[0], RealmEventWhat::Transferred { units: 6.0, .. }));
    }

    #[test]
    #[ignore = "slow in the TypeScript too (`tags: ['slow']`): 20-30 s here with the HQ's default scripts every tick, for T86.14's long simulations"]
    fn drop_a_transfer_the_senders_storage_holds_none_of() {
        let mut s = setup();
        let st = s.storage_of(7);
        s.set(st, Good::Iron, None);
        let (city, to_city) = (s.city(7), s.city(8));
        s.order(json!({ "kind": "transfer", "fromCityId": city, "toCityId": to_city, "good": "iron", "units": 5 }));
        s.run_until(|w| w.transfers.is_empty(), 20_000);
        let stuck = s.events(None, |e| matches!(e, RealmEventWhat::TransferStuck { .. }));
        assert_eq!(stuck.len(), 1);
        assert!(matches!(
            stuck[0],
            RealmEventWhat::TransferStuck { why: TransferStuckWhy::Nothing, .. }
        ));
        s.run_until(|w| carrier(w).is_none(), 10_000);
    }
}

mod transfers_sound {
    use super::*;

    #[test]
    fn flags_a_transfer_of_no_units_to_its_sender_or_carried_by_a_caravan_whose_job_is_another() {
        let mut s = setup();
        let (realm, to_city) = (s.realm(7), s.city(8));
        let w = s.world.buildings[s.warehouse()].id.clone();
        s.world.transfers.push(Transfer {
            id: "t".into(),
            realm_id: realm.clone(),
            to_realm_id: realm,
            to_city_id: to_city,
            warehouse_id: w,
            from_city_id: None,
            good: Good::Iron,
            units: 0.0,
            fee: -1.0,
            back: false,
            caravan_id: Some("nobody".into()),
            carried_offer: None,
            debt: None,
        });
        assert_eq!(transfers_sound(&s.world).len(), 4);
    }

    #[test]
    fn flags_a_caravan_counting_more_on_board_than_its_carriage_holds() {
        let mut s = setup();
        let w = s.world.buildings[s.warehouse()].id.clone();
        s.world.caravans[0].transfer = Some(TransferJob {
            transfer_id: "gone".into(),
            warehouse_id: w,
            good: Good::Iron,
            step: TransferJobStep::Return,
            units: 5.0,
            coins: 0.0,
            target: None,
            fee: 0.0,
            misses: 0.0,
            robbed: 0.0,
            from_city_id: None,
        });
        assert_eq!(transfers_sound(&s.world).len(), 1);
    }
}
