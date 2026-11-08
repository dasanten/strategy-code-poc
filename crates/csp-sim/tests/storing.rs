//! `apps/server/src/storing.test.ts`, one test per `it`. Residents walk with the goods tests'
//! stand-in for `Walking` (`StraightWalk`, until T86.4); `storeFetchOrdersSound` and
//! `checkInvariants` come with T86.13, and the part of "ends, saying why" that needs a path search
//! (`no way`) with T86.4's `Walking`.

mod common;
mod goods_support;

use csp_shared::balance::OWN_FOOD;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Good, OrderEnded, OrderEndedKind, ResidentOrder, Stock, StorePhase, WorldState,
};
use csp_sim::goods_deps::OrderSender;
use csp_sim::queries::goods::units_that_fit;
use csp_sim::tick::Scratch;
use goods_support::{building, new_resident, open, player, realm, step_walking, stock, Queue};
use serde_json::{json, Value};

const SIZE: i32 = 16;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scratch: Scratch,
    me: OrderSender,
}

/// Realm r1 (Player 7) with city c1: resident w1 at (5, 5), storage s1 at (1, 1) with plenty of
/// Food and stone, storage s2 far off at (11, 11), empty, and carriage k1 at (8, 5), empty.
/// Realm r2 (Player 8) with carriage k2 at (5, 8).
fn setup() -> Setup {
    let terrain = open(SIZE);
    let mut world = goods_support::world_on(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    world.realms.push(realm("r2", 8, "x1"));
    world.cities.push(
        serde_json::from_value(json!({
            "id": "c1", "name": "Ashford", "realmId": "r1", "townHallId": "h1", "occupation": null,
        }))
        .unwrap(),
    );
    let mut r = new_resident(1.0, "w1", Some("r1"), 5.0, 5.0);
    r.carried = stock(json!({ "wood": 10, "food": 1 }));
    world.residents.push(r);
    for (id, x, y, s) in
        [("s1", 1, 1, json!({ "food": 50, "stone": 500 })), ("s2", 11, 11, json!({}))]
    {
        world.buildings.push(building(
            json!({ "id": id, "kind": "storage", "cityId": "c1", "x": x, "y": y, "stock": s }),
        ));
    }
    for (id, realm_id, x, y) in [("k1", "r1", 8, 5), ("k2", "r2", 5, 8)] {
        world.carriages.push(
            serde_json::from_value(json!({
                "id": id, "realmId": realm_id, "cityId": null, "x": x, "y": y, "horseId": null, "load": {},
            }))
            .unwrap(),
        );
    }
    Setup { world, terrain, scratch: Scratch::default(), me: player(7) }
}

impl Setup {
    fn r(&self) -> &csp_shared::world::Resident {
        &self.world.residents[0]
    }
    fn building(&self, id: &str) -> &csp_shared::world::Building {
        self.world.buildings.iter().find(|b| b.id == id).unwrap()
    }
    fn stock_of(&self, id: &str) -> Stock {
        self.building(id).stock.clone().unwrap_or_default()
    }
    fn carriage(&self, id: &str) -> &csp_shared::world::Carriage {
        self.world.carriages.iter().find(|k| k.id == id).unwrap()
    }
    fn carriage_mut(&mut self, id: &str) -> &mut csp_shared::world::Carriage {
        self.world.carriages.iter_mut().find(|k| k.id == id).unwrap()
    }
    fn step(&mut self) {
        step_walking(&mut self.world, &self.terrain, &mut self.scratch);
    }
    /// Sends an order, then runs ticks until the resident's order is over (at most `max`).
    fn run(&mut self, o: Value, max: usize) -> Result<(), String> {
        let mut o = o;
        o["residentId"] = json!("w1");
        let mut q = Queue::new(&self.terrain);
        let answer = q.receive(&self.world, &self.me, o);
        q.apply_all(&mut self.world);
        for _ in 0..max {
            if self.r().order.is_none() {
                break;
            }
            self.step();
        }
        answer
    }
    fn reason(&self, o: Value) -> Option<String> {
        Queue::new(&self.terrain).receive(&self.world, &self.me, o).err()
    }
}

mod store_order {
    use super::*;

    #[test]
    fn walks_to_the_nearest_storage_of_my_realm_stores_the_goods_and_tops_up_own_food() {
        let mut s = setup();
        let mut q = Queue::new(&s.terrain);
        q.receive(
            &s.world,
            &s.me,
            json!({ "kind": "store", "residentId": "w1", "goods": ["wood"] }),
        )
        .unwrap();
        q.apply_all(&mut s.world);
        let Some(ResidentOrder::Store(o)) = &s.r().order else { panic!("a store order") };
        assert_eq!(
            serde_json::to_value(&o.to).unwrap(),
            json!({ "kind": "storage", "storageId": "s1" })
        );
        assert_eq!(o.phase, StorePhase::Walking);
        s.run(json!({ "kind": "store", "goods": ["wood"] }), 400).unwrap();
        assert_eq!(s.r().order, None);
        let food = 50.0 - (OWN_FOOD - 1.0);
        assert_stock!(s.stock_of("s1"), { "food": food, "stone": 500, "wood": 10 });
        assert_stock!(s.r().carried, { "food": OWN_FOOD });
        let tick = s.world.tick as f64 - 1.0;
        assert_eq!(
            s.r().order_ended,
            Some(OrderEnded { kind: OrderEndedKind::Store, tick, reason: None })
        );
    }

    #[test]
    fn stores_food_beyond_own_food_or_exact_units_when_asked() {
        let mut s = setup();
        s.world.residents[0].x = 1.0;
        s.world.residents[0].y = 1.0;
        s.world.residents[0].carried = stock(json!({ "food": OWN_FOOD + 3.0, "wood": 10 }));
        s.run(json!({ "kind": "store", "goods": { "food": null, "wood": 4 } }), 400).unwrap();
        let st = s.stock_of("s1");
        assert_eq!((st[&Good::Food], st[&Good::Wood]), (53.0, 4.0));
        assert_stock!(s.r().carried, { "food": OWN_FOOD, "wood": 6 });
    }

    #[test]
    fn unloads_onto_a_carriage_of_mine_when_to_is_one_and_tops_up_no_food_there() {
        let mut s = setup();
        s.carriage_mut("k1").load = stock(json!({ "food": 20 }));
        s.run(json!({ "kind": "store", "goods": { "wood": 4 }, "to": "k1" }), 400).unwrap();
        assert_stock!(s.carriage("k1").load, { "food": 20, "wood": 4 });
        assert_stock!(s.r().carried, { "wood": 6, "food": 1 });
        assert_eq!((s.r().x, s.r().y), (8.0, 5.0));
        let ended = s.r().order_ended.as_ref().unwrap();
        assert_eq!((ended.kind, ended.reason.as_deref()), (OrderEndedKind::Store, None));
    }

    #[test]
    fn follows_a_carriage_that_moves_on_before_they_get_there() {
        let mut s = setup();
        let mut q = Queue::new(&s.terrain);
        q.receive(
            &s.world,
            &s.me,
            json!({ "kind": "store", "residentId": "w1", "goods": ["wood"], "to": "k1" }),
        )
        .unwrap();
        q.apply_all(&mut s.world);
        s.step();
        s.carriage_mut("k1").x = 12.0;
        s.carriage_mut("k1").y = 9.0;
        for _ in 0..400 {
            if s.r().order.is_none() {
                break;
            }
            s.step();
        }
        assert_stock!(s.carriage("k1").load, { "wood": 10 });
        assert_eq!((s.r().x, s.r().y), (12.0, 9.0));
    }

    #[test]
    fn is_rejected_without_goods_to_store_a_storage_of_my_realm_or_with_anothers_carriage() {
        let mut s = setup();
        let store = |extra: Value| {
            let mut o = json!({ "kind": "store", "residentId": "w1" });
            for (k, v) in extra.as_object().unwrap() {
                o[k] = v.clone();
            }
            o
        };
        let not = Some("not carrying any of those goods".to_string());
        assert_eq!(s.reason(store(json!({ "goods": ["stone"] }))), not);
        assert_eq!(s.reason(store(json!({ "goods": ["food"] }))), not);
        assert!(s
            .reason(store(json!({ "goods": { "wood": 0 } })))
            .unwrap()
            .starts_with("goods must be"));
        assert!(s
            .reason(store(json!({ "goods": ["gold"] })))
            .unwrap()
            .starts_with("goods must be"));
        assert!(s
            .reason(store(json!({ "goods": ["wood"], "to": "k2" })))
            .unwrap()
            .starts_with("to must be"));
        assert_eq!(s.reason(store(json!({ "goods": ["wood"], "to": "s2" }))), None);
        s.world.cities[0].realm_id = Some("r2".into());
        assert_eq!(s.reason(store(json!({ "goods": ["wood"] }))), Some("no storage".into()));
    }

    #[test]
    fn ends_saying_why_when_the_storage_is_gone() {
        let mut s = setup();
        s.run(json!({ "kind": "store", "goods": ["wood"] }), 2).unwrap();
        s.world.buildings.retain(|b| b.id != "s1");
        s.step();
        assert_eq!(s.r().order, None);
        let ended = s.r().order_ended.as_ref().unwrap();
        assert_eq!(ended.kind, OrderEndedKind::Store);
        assert_eq!(ended.reason.as_deref(), Some("the storage is gone"));
        assert_eq!(s.r().carried[&Good::Wood], 10.0);
    }

    #[test]
    fn keeps_how_it_ended_until_the_next_order() {
        let mut s = setup();
        s.run(json!({ "kind": "store", "goods": ["wood"] }), 400).unwrap();
        assert!(s.r().order_ended.is_some());
        // A walk order clears it (`start` in walking.ts, T86.4); a store or fetch order does too.
        let mut q = Queue::new(&s.terrain);
        s.world.residents[0].carried.insert(Good::Wood, 1.0);
        q.receive(
            &s.world,
            &s.me,
            json!({ "kind": "store", "residentId": "w1", "goods": ["wood"] }),
        )
        .unwrap();
        q.apply_all(&mut s.world);
        assert_eq!(s.r().order_ended, None);
    }
}

mod fetch_order {
    use super::*;

    #[test]
    fn takes_as_much_as_fits_from_the_nearest_storage_or_carriage_of_mine_holding_the_goods() {
        let mut s = setup();
        s.world.residents[0].carried = stock(json!({ "food": 1 }));
        let fits = units_that_fit(s.r(), Good::Stone, s.world.tick as f64);
        s.run(json!({ "kind": "fetch", "goods": ["stone"] }), 400).unwrap();
        assert_stock!(s.r().carried, { "food": 1, "stone": fits });
        assert_eq!(s.stock_of("s1")[&Good::Stone], 500.0 - fits);
        let ended = s.r().order_ended.as_ref().unwrap();
        assert_eq!((ended.kind, ended.reason.as_deref()), (OrderEndedKind::Fetch, None));

        // The nearer carriage, once it holds some.
        let mut t = setup();
        t.carriage_mut("k1").load = stock(json!({ "stone": 3 }));
        t.run(json!({ "kind": "fetch", "goods": { "stone": 10 } }), 400).unwrap();
        assert_eq!(t.r().carried[&Good::Stone], 3.0);
        assert!(t.carriage("k1").load.is_empty());
        assert_eq!(t.stock_of("s1")[&Good::Stone], 500.0);
    }

    #[test]
    fn fetches_from_from_when_it_is_set() {
        let mut s = setup();
        s.run(json!({ "kind": "fetch", "goods": { "food": 5 }, "from": "s2" }), 400).unwrap();
        assert_eq!(s.r().carried[&Good::Food], 1.0);
        assert_eq!((s.r().x, s.r().y), (11.0, 11.0));
        assert_eq!(s.r().order_ended.as_ref().unwrap().reason, None);
        let i = s.world.buildings.iter().position(|b| b.id == "s2").unwrap();
        s.world.buildings[i].stock = Some(stock(json!({ "food": 8 })));
        s.run(json!({ "kind": "fetch", "goods": { "food": 5 }, "from": "s2" }), 400).unwrap();
        assert_eq!(s.r().carried[&Good::Food], 6.0);
        assert_stock!(s.stock_of("s2"), { "food": 3 });
    }

    #[test]
    fn is_rejected_when_nothing_of_mine_holds_the_goods() {
        let s = setup();
        assert_eq!(
            s.reason(json!({ "kind": "fetch", "residentId": "w1", "goods": ["iron"] })),
            Some("nothing of yours holds those goods".into())
        );
    }
}

mod store_and_fetch_in_a_real_city {
    use super::*;

    /// From the world `worldWithCity` wrote (`fixtures/sight/city.json`, T86.8 founds it in
    /// Rust); the invariants come with T86.13.
    #[test]
    fn move_goods_without_making_or_losing_any() {
        let (mut world, size, _) = common::load_world("sight/city.json");
        let terrain = open(size);
        let mut scratch = Scratch::default();
        let leader = world.realms[0].leader_id.clone();
        let sender = player(world.realms[0].user_id);
        let ri = world.residents.iter().position(|x| x.id == leader).unwrap();
        let wood = |w: &WorldState| -> f64 {
            w.residents
                .iter()
                .map(|x| &x.carried)
                .chain(w.buildings.iter().filter_map(|b| b.stock.as_ref()))
                .map(|s| s.get(&Good::Wood).copied().unwrap_or(0.0))
                .sum()
        };
        world.residents[ri].order = None;
        world.residents[ri].carried = stock(json!({ "wood": 7 }));
        let before = wood(&world);
        let mut ticks = |world: &mut WorldState, o: Value| {
            let mut o = o;
            o["residentId"] = json!(leader);
            let mut q = Queue::new(&terrain);
            q.receive(world, &sender, o).unwrap();
            q.apply_all(world);
            for _ in 0..600 {
                if world.residents[ri].order.is_none() {
                    break;
                }
                step_walking(world, &terrain, &mut scratch);
            }
            assert_eq!(world.residents[ri].order, None);
        };
        ticks(&mut world, json!({ "kind": "store", "goods": ["wood"] }));
        let storage = world
            .buildings
            .iter()
            .find(|b| b.kind == csp_shared::world::BuildingKind::Storage)
            .unwrap();
        assert!(storage.stock.as_ref().unwrap()[&Good::Wood] >= 7.0);
        ticks(&mut world, json!({ "kind": "fetch", "goods": { "wood": 5 } }));
        assert_eq!(world.residents[ri].carried[&Good::Wood], 5.0);
        assert_eq!(wood(&world), before);
        let ended = world.residents[ri].order_ended.as_ref().unwrap();
        assert_eq!((ended.kind, ended.reason.as_deref()), (OrderEndedKind::Fetch, None));
    }
}
