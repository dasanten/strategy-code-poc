//! `apps/server/src/carrying.test.ts`, one test per `it`.

mod common;
#[macro_use]
mod goods_support;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Building, Good, ResidentOrder, Stock, WorldState};
use csp_sim::goods_deps::OrderSender;
use csp_sim::queries::residents::carry_capacity;
use csp_sim::queries::residents::stock_weight;
use csp_sim::tick::Scratch;
use goods_support::{building, new_resident, open, order, player, realm, step, total, Queue};
use serde_json::{json, Value};

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scratch: Scratch,
    me: OrderSender,
}

/// A world on an open map: realm r1 (Player 7) with resident w1 on a storage at (1, 1).
fn setup(stock: Value) -> Setup {
    let terrain = open(16);
    let mut world = goods_support::world_on(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    let mut r = new_resident(1.0, "w1", Some("r1"), 1.0, 1.0);
    r.stats.strength.base = 10.0;
    world.residents.push(r);
    let storage: Building = building(
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 1, "y": 1, "stock": stock }),
    );
    world.buildings.push(storage);
    Setup { world, terrain, scratch: Scratch::default(), me: player(7) }
}

fn default_setup() -> Setup {
    setup(json!({ "food": 50, "stone": 50 }))
}

impl Setup {
    fn order(&mut self, o: Value) -> Result<(), String> {
        order(&mut self.world, &self.terrain, &mut self.scratch, &self.me, o)
    }
    fn r(&self) -> &csp_shared::world::Resident {
        &self.world.residents[0]
    }
    fn storage(&self) -> &Stock {
        self.world.buildings[0].stock.as_ref().unwrap()
    }
}

fn at_storage() -> Value {
    json!({ "kind": "storage", "storageId": "s1" })
}

fn ground() -> Value {
    json!({ "kind": "ground" })
}

mod pick_up_order {
    use super::*;

    #[test]
    fn takes_goods_from_the_storage_on_the_tile_in_the_next_tick() {
        let mut s = default_setup();
        let o = json!({ "kind": "pickUp", "residentId": "w1", "spot": at_storage(), "goods": { "food": 5 } });
        let mut q = Queue::new(&s.terrain);
        assert_eq!(q.receive(&s.world, &s.me, o), Ok(()));
        assert!(s.r().carried.is_empty());
        q.apply_all(&mut s.world);
        let want: ResidentOrder = serde_json::from_value(
            json!({ "kind": "pickUp", "from": at_storage(), "goods": { "food": 5 } }),
        )
        .unwrap();
        assert_eq!(s.r().order, Some(want));
        step(&mut s.world, &s.terrain, &mut s.scratch);
        assert_stock!(s.r().carried, { "food": 5 });
        assert_stock!(*s.storage(), { "food": 45, "stone": 50 });
        assert_eq!(s.r().order, None);
    }

    #[test]
    fn takes_only_what_is_there_and_whole_units_that_fit_the_carry_capacity() {
        let mut s = setup(json!({ "food": 3, "stone": 500 }));
        let capacity = carry_capacity(s.r(), s.world.tick as f64);
        s.order(json!({
            "kind": "pickUp", "residentId": "w1", "spot": at_storage(),
            "goods": { "food": 10, "stone": 500 },
        }))
        .unwrap();
        let carried = &s.r().carried;
        assert_eq!(carried[&Good::Food], 3.0);
        assert_eq!(carried[&Good::Stone], capacity.floor() - 3.0);
        assert!(stock_weight(carried) <= capacity);
        let left = 500.0 - carried[&Good::Stone];
        assert_stock!(*s.storage(), { "stone": left });
    }

    #[test]
    fn takes_from_the_pile_on_the_ground_and_an_emptied_pile_is_gone() {
        let mut s = default_setup();
        s.world.piles.push(
            serde_json::from_value(json!({ "id": "p1", "x": 1, "y": 1, "goods": { "wood": 4 } }))
                .unwrap(),
        );
        s.order(json!({ "kind": "pickUp", "residentId": "w1", "spot": ground(), "goods": { "wood": 4 } }))
            .unwrap();
        assert_stock!(s.r().carried, { "wood": 4 });
        assert!(s.world.piles.is_empty());
    }

    #[test]
    fn can_take_another_realms_goods_nothing_is_protected_yet() {
        let mut s = default_setup();
        s.world.buildings[0].city_id = Some("someone-elses-city".into());
        s.order(json!({ "kind": "pickUp", "residentId": "w1", "spot": at_storage(), "goods": { "food": 2 } }))
            .unwrap();
        assert_stock!(s.r().carried, { "food": 2 });
    }

    #[test]
    fn never_lets_two_residents_take_the_same_goods() {
        let mut s = default_setup();
        s.world.residents.push(goods_support::new_resident(2.0, "w2", Some("r1"), 1.0, 1.0));
        s.world.piles.push(
            serde_json::from_value(json!({ "id": "p1", "x": 1, "y": 1, "goods": { "food": 6 } }))
                .unwrap(),
        );
        let take = |id: &str| json!({ "kind": "pickUp", "residentId": id, "spot": ground(), "goods": { "food": 6 } });
        let mut q = Queue::new(&s.terrain);
        q.receive(&s.world, &s.me, take("w1")).unwrap();
        q.receive(&s.world, &s.me, take("w2")).unwrap();
        q.apply_all(&mut s.world);
        step(&mut s.world, &s.terrain, &mut s.scratch);
        let food = |i: usize| s.world.residents[i].carried.get(&Good::Food).copied().unwrap_or(0.0);
        assert_eq!(food(0) + food(1), 6.0);
        assert!(s.world.piles.is_empty());
    }

    #[test]
    fn replaces_a_walk_order_and_gets_nothing_if_the_resident_has_left_the_tile() {
        let mut s = default_setup();
        s.world.residents[0].order = Some(
            serde_json::from_value(json!({ "kind": "walkTo", "target": { "x": 5, "y": 1 }, "path": null, "progress": 0 }))
                .unwrap(),
        );
        let mut q = Queue::new(&s.terrain);
        q.receive(&s.world, &s.me, json!({ "kind": "pickUp", "residentId": "w1", "spot": at_storage(), "goods": { "food": 1 } }))
            .unwrap();
        q.apply_all(&mut s.world);
        assert!(matches!(s.r().order, Some(ResidentOrder::PickUp(_))));
        s.world.residents[0].x = 4.0; // moved off the storage before the tick resolves
        step(&mut s.world, &s.terrain, &mut s.scratch);
        assert!(s.r().carried.is_empty());
        assert_eq!(s.r().order, None);
    }

    #[test]
    fn rejects_what_cannot_be_done() {
        let s = setup(json!({ "food": 5 }));
        let mut q = Queue::new(&s.terrain);
        let pick = |extra: Value| {
            let mut o = json!({ "kind": "pickUp", "residentId": "w1", "spot": at_storage() });
            for (k, v) in extra.as_object().unwrap() {
                o[k] = v.clone();
            }
            o
        };
        let mut reason = |o: Value, sender: &OrderSender| q.receive(&s.world, sender, o).err();
        let stranger = player(8);
        let me = &s.me;
        let r = |v: &str| Some(v.to_string());
        assert_eq!(
            reason(pick(json!({ "goods": { "food": 1 } })), &stranger),
            r("not one of your residents")
        );
        assert_eq!(
            reason(pick(json!({ "residentId": "nobody", "goods": { "food": 1 } })), me),
            r("not one of your residents")
        );
        let bad = r("goods must be whole units of known goods");
        assert_eq!(reason(pick(json!({ "goods": { "food": 1.5 } })), me), bad);
        assert_eq!(reason(pick(json!({ "goods": { "food": 0 } })), me), bad);
        assert_eq!(reason(pick(json!({ "goods": { "gems": 1 } })), me), bad);
        assert_eq!(reason(pick(json!({ "goods": {} })), me), bad);
        assert_eq!(
            reason(pick(json!({ "spot": { "kind": "roof" }, "goods": { "food": 1 } })), me),
            r("the spot must be the ground, a storage, a construction site, a carriage, a boat or a Down resident")
        );
        assert_eq!(
            reason(
                pick(
                    json!({ "spot": { "kind": "storage", "storageId": "s9" }, "goods": { "food": 1 } })
                ),
                me
            ),
            r("the resident is not at that storage")
        );
        assert_eq!(
            reason(pick(json!({ "goods": { "stone": 1 } })), me),
            r("none of those goods here")
        );
        assert_eq!(
            reason(pick(json!({ "spot": ground(), "goods": { "food": 1 } })), me),
            r("none of those goods here")
        );
        assert_eq!(q.len(), 0);
    }
}

mod drop_order {
    use super::*;

    #[test]
    fn puts_carried_goods_on_the_ground_starting_or_adding_to_the_pile() {
        let mut s = default_setup();
        s.world.residents[0].carried = goods_support::stock(json!({ "food": 4, "wood": 2 }));
        s.order(
            json!({ "kind": "drop", "residentId": "w1", "spot": ground(), "goods": { "food": 3 } }),
        )
        .unwrap();
        assert_stock!(s.r().carried, { "food": 1, "wood": 2 });
        assert_eq!(s.world.piles.len(), 1);
        assert_eq!((s.world.piles[0].x, s.world.piles[0].y), (1.0, 1.0));
        assert_stock!(s.world.piles[0].goods, { "food": 3 });
        s.order(json!({ "kind": "drop", "residentId": "w1", "spot": ground(), "goods": { "food": 9, "wood": 2 } }))
            .unwrap();
        assert!(s.r().carried.is_empty());
        assert_eq!(s.world.piles.len(), 1);
        assert_stock!(s.world.piles[0].goods, { "food": 4, "wood": 2 });
        assert_eq!(s.r().order, None);
    }

    #[test]
    fn puts_carried_goods_in_the_storage_on_the_tile() {
        let mut s = setup(json!({}));
        s.world.residents[0].carried = goods_support::stock(json!({ "ironOre": 5 }));
        s.order(json!({ "kind": "drop", "residentId": "w1", "spot": at_storage(), "goods": { "ironOre": 5 } }))
            .unwrap();
        assert!(s.r().carried.is_empty());
        assert_stock!(*s.storage(), { "ironOre": 5 });
    }

    #[test]
    fn keeps_the_goods_if_the_storage_is_no_longer_on_the_tile() {
        let mut s = setup(json!({}));
        s.world.residents[0].carried = goods_support::stock(json!({ "wood": 3 }));
        let mut q = Queue::new(&s.terrain);
        q.receive(&s.world, &s.me, json!({ "kind": "drop", "residentId": "w1", "spot": at_storage(), "goods": { "wood": 3 } }))
            .unwrap();
        q.apply_all(&mut s.world);
        s.world.buildings.clear();
        step(&mut s.world, &s.terrain, &mut s.scratch);
        assert_stock!(s.r().carried, { "wood": 3 });
        assert!(s.world.piles.is_empty());
    }

    #[test]
    fn rejects_goods_the_resident_does_not_carry() {
        let mut s = default_setup();
        s.world.residents[0].carried = goods_support::stock(json!({ "food": 1 }));
        let mut q = Queue::new(&s.terrain);
        assert_eq!(
            q.receive(&s.world, &s.me, json!({ "kind": "drop", "residentId": "w1", "spot": ground(), "goods": { "stone": 1 } })),
            Err("not carrying any of those goods".into())
        );
    }
}

mod carrying_in_a_real_city {
    use super::*;

    /// `worldWithCity` is T86.8's (`foundStartingCity`); this starts from the world the
    /// TypeScript wrote for it (`fixtures/sight/city.json`). The invariants (`checkInvariants`)
    /// come with T86.13.
    #[test]
    fn moves_goods_without_making_or_losing_any() {
        let (mut world, size, _) = common::load_world("sight/city.json");
        let terrain = open(size);
        let mut scratch = Scratch::default();
        let si = world
            .buildings
            .iter()
            .position(|b| b.kind == csp_shared::world::BuildingKind::Storage)
            .unwrap();
        let (sx, sy, sid) =
            (world.buildings[si].x, world.buildings[si].y, world.buildings[si].id.clone());
        let leader = world.realms[0].leader_id.clone();
        let user = world.realms[0].user_id;
        let ri = world.residents.iter().position(|x| x.id == leader).unwrap();
        world.residents[ri].order = None;
        world.residents[ri].carried = Stock::new();
        world.residents[ri].x = sx;
        world.residents[ri].y = sy;
        let sender = player(user);
        let before = total(&world);
        let spot = json!({ "kind": "storage", "storageId": sid });
        order(&mut world, &terrain, &mut scratch, &sender, json!({ "kind": "pickUp", "residentId": leader, "spot": spot, "goods": { "food": 10 } }))
            .unwrap();
        assert_eq!(world.residents[ri].carried[&Good::Food], 10.0);
        world.residents[ri].x += 1.0;
        order(&mut world, &terrain, &mut scratch, &sender, json!({ "kind": "drop", "residentId": leader, "spot": ground(), "goods": { "food": 4 } }))
            .unwrap();
        assert!(goods_support::same(&total(&world), &before));
    }
}
