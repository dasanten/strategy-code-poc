//! `apps/server/src/hauling.test.ts`, one test per `it`, the routes by the haul order. Carriages
//! drive with the goods tests' stand-in for `Walking` (`StraightWalk`, until T86.4). Left to
//! later tickets: the routes as the Haul task (the default scripts, T86.12), "breaks the
//! invariants when broken" (`drivers-on-carriages`, `haul-routes-sound`, T86.13) and the restart
//! through the database (T87); here the restart is a round trip of the world through its JSON.

mod common;
mod goods_support;

use csp_shared::balance::{AVERAGE_HORSE_STATS, CARRIAGE_CAPACITY, MAX_HEALTH, MAX_HUNGER};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{Good, HaulOrder, HaulPhase, HaulStop, ResidentOrder, Stock, WorldState};
use csp_sim::goods_deps::drop_goods;
use csp_sim::queries::goods::pile_at;
use csp_sim::tick::Scratch;
use goods_support::{building, new_resident, open, player, realm, step_walking, stock, Queue};
use serde_json::{json, Value};

/// A square map drawn as text (sides join): . plains, ^ mountain, ~ lake (`draw`).
fn draw(rows: &[String]) -> TerrainMap {
    let tiles = rows
        .concat()
        .chars()
        .map(|c| match c {
            '.' => Terrain::Plains as u8,
            '^' => Terrain::Mountain as u8,
            '~' => Terrain::Lake as u8,
            _ => panic!("no terrain {c}"),
        })
        .collect();
    TerrainMap { size: rows.len() as i32, tiles }
}

fn with_row(row: usize, c: char) -> TerrainMap {
    draw(
        &(0..16).map(|y| if y == row { c } else { '.' }.to_string().repeat(16)).collect::<Vec<_>>(),
    )
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scratch: Scratch,
}

/// A world on `map` with realm r1 (Player 7, Leader w1) and, at (2, 2), w1 carrying a little Food,
/// carriage k1 of r1 and horse h1 of r1. A storage s1 stands at (10, 2).
fn setup(terrain: TerrainMap) -> Setup {
    let mut world = goods_support::world_on(&terrain);
    world.nodes.clear();
    world.realms.push(realm("r1", 7, "w1"));
    let mut w1 = new_resident(1.0, "w1", Some("r1"), 2.0, 2.0);
    w1.carried = stock(json!({ "food": 2 }));
    world.residents.push(w1);
    let s = AVERAGE_HORSE_STATS;
    world.horses.push(
        serde_json::from_value(json!({
            "id": "h1", "realmId": "r1", "cityId": null, "x": 2, "y": 2, "hunger": MAX_HUNGER,
            "health": MAX_HEALTH, "name": "Rowan",
            "stats": { "speed": s.speed, "strength": s.strength, "endurance": s.endurance },
            "bornAt": 0,
        }))
        .unwrap(),
    );
    world.carriages.push(
        serde_json::from_value(json!({
            "id": "k1", "realmId": "r1", "cityId": null, "x": 2, "y": 2, "horseId": null, "load": {},
        }))
        .unwrap(),
    );
    // `addCity(world, { id: 'c1', name: 'Ash', realmId: 'r1', x: 13, y: 2 })`
    world.buildings.push(building(
        json!({ "id": "c1-hall", "kind": "townHall", "cityId": "c1", "x": 13, "y": 2 }),
    ));
    world.cities.push(
        serde_json::from_value(json!({
            "id": "c1", "name": "Ash", "realmId": "r1", "townHallId": "c1-hall", "occupation": null,
        }))
        .unwrap(),
    );
    world.buildings.push(building(
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 10, "y": 2, "stock": {} }),
    ));
    Setup { world, terrain, scratch: Scratch::default() }
}

impl Setup {
    fn w1(&self) -> &csp_shared::world::Resident {
        &self.world.residents[0]
    }
    fn route(&self) -> &HaulOrder {
        match &self.w1().order {
            Some(ResidentOrder::Haul(o)) => o,
            o => panic!("not a haul route: {o:?}"),
        }
    }
    fn storage(&self) -> Stock {
        let s = self.world.buildings.iter().find(|b| b.id == "s1").unwrap();
        s.stock.clone().unwrap_or_default()
    }
    fn storage_units(&self, g: Good) -> f64 {
        self.storage().get(&g).copied().unwrap_or(0.0)
    }
    fn set_storage(&mut self, s: Value) {
        let i = self.world.buildings.iter().position(|b| b.id == "s1").unwrap();
        self.world.buildings[i].stock = Some(stock(s));
    }
    fn carriage(&self) -> &csp_shared::world::Carriage {
        &self.world.carriages[0]
    }
    fn load(&self, g: Good) -> f64 {
        self.carriage().load.get(&g).copied().unwrap_or(0.0)
    }
    fn pile(&mut self, x: f64, y: f64, goods: Value) {
        drop_goods(&mut self.world, x, y, &stock(goods), self.terrain.size);
    }
    /// w1 starts hauling `goods` with carriage k1 from their tile to (10, 2) (`haul`).
    fn haul(&mut self, goods: Value, keep_food: f64, extra: Value) -> Result<(), String> {
        let mut o = json!({
            "kind": "haul", "residentId": "w1", "carriageId": "k1", "x": 10, "y": 2,
            "goods": goods, "keepFood": keep_food,
        });
        for (k, v) in extra.as_object().unwrap() {
            o[k] = v.clone();
        }
        let mut q = Queue::new(&open(16));
        let answer = q.receive(&self.world, &player(7), o);
        q.apply_all(&mut self.world);
        answer
    }
    /// Steps the world `ticks` times, or until `until` holds (`run`).
    fn run(&mut self, ticks: usize, until: impl Fn(&Setup) -> bool) {
        for _ in 0..ticks {
            if until(self) {
                break;
            }
            step_walking(&mut self.world, &self.terrain, &mut self.scratch);
        }
    }
}

fn never(_: &Setup) -> bool {
    false
}

mod the_haul_order {
    use super::*;

    #[test]
    fn needs_the_players_adult_on_their_carriage_with_a_horse_another_stop_and_goods() {
        let mut s = setup(open(16));
        let order = |s: &Setup, extra: Value| {
            let mut o = json!({
                "kind": "haul", "residentId": "w1", "carriageId": "k1", "x": 10, "y": 2,
                "goods": ["ironOre"], "keepFood": 6,
            });
            for (k, v) in extra.as_object().unwrap() {
                o[k] = v.clone();
            }
            Queue::new(&s.terrain).receive(&s.world, &player(7), o).err()
        };
        let r = |v: &str| Some(v.to_string());
        assert_eq!(order(&s, json!({})), None);
        assert_eq!(order(&s, json!({ "x": 2 })), r("the other stop must be another tile"));
        assert_eq!(order(&s, json!({ "x": 1.5 })), r("the other stop must be a tile"));
        assert_eq!(order(&s, json!({ "goods": [] })), r("pick the goods to haul"));
        assert_eq!(order(&s, json!({ "goods": ["gems"] })), r("pick the goods to haul"));
        assert_eq!(order(&s, json!({ "goods": ["wood", "wood"] })), r("pick the goods to haul"));
        let back = r("pick the goods to haul back, none of them hauled there");
        assert_eq!(order(&s, json!({ "returnGoods": ["food"] })), None);
        assert_eq!(order(&s, json!({ "returnGoods": ["ironOre"] })), back);
        assert_eq!(order(&s, json!({ "returnGoods": ["gems"] })), back);
        assert_eq!(order(&s, json!({ "returnGoods": "food" })), back);
        assert!(order(&s, json!({ "keepFood": -1 })).unwrap().contains("Food"));
        assert!(order(&s, json!({ "keepFood": CARRIAGE_CAPACITY + 1.0 }))
            .unwrap()
            .contains("Food"));
        assert_eq!(order(&s, json!({ "carriageId": "nope" })), r("not one of your carriages"));
        assert_eq!(
            Queue::new(&s.terrain)
                .receive(&s.world, &player(8), json!({ "kind": "haul", "residentId": "w1" }))
                .err(),
            r("not one of your residents")
        );
        s.world.residents[0].x = 3.0;
        assert_eq!(order(&s, json!({})), r("that carriage is not on the resident’s tile"));
    }

    #[test]
    fn refuses_a_stop_in_the_mountains() {
        let s = setup(with_row(8, '^'));
        let answer = Queue::new(&s.terrain).receive(
            &s.world,
            &player(7),
            json!({
                "kind": "haul", "residentId": "w1", "carriageId": "k1", "x": 2, "y": 8,
                "goods": ["ironOre"], "keepFood": 0,
            }),
        );
        assert_eq!(answer, Err("a carriage can’t go there".into()));
    }
}

mod a_haul_route_by_the_haul_order {
    use super::*;

    #[test]
    fn loads_at_the_first_stop_unloads_at_the_other_and_comes_back_for_more() {
        let mut s = setup(open(16));
        s.pile(2.0, 2.0, json!({ "ironOre": 50, "wood": 5 }));
        assert_eq!(s.haul(json!(["ironOre"]), 0.0, json!({})), Ok(()));
        s.run(2000, |s| s.storage_units(Good::IronOre) == 50.0);
        assert_eq!(s.storage_units(Good::IronOre), 50.0);
        // Only the route's goods go; the driver keeps their own Food.
        assert_stock!(s.world.piles[0].goods, { "wood": 5 });
        assert_eq!(s.w1().carried.get(&Good::IronOre).copied().unwrap_or(0.0), 0.0);

        // Back at the first stop, it waits for goods, then takes the new ones.
        s.run(200, never);
        assert_eq!((s.carriage().x, s.carriage().y), (2.0, 2.0));
        assert_eq!((s.route().stop, s.route().phase), (HaulStop::From, HaulPhase::Loading));
        s.pile(2.0, 2.0, json!({ "ironOre": 30 }));
        s.run(2000, |s| s.storage_units(Good::IronOre) == 80.0);
        assert_eq!(s.storage_units(Good::IronOre), 80.0);
        assert_eq!(s.carriage().horse_id.as_deref(), Some("h1"));
    }

    #[test]
    fn keeps_food_on_board_for_the_horse_topped_up_where_there_is_some() {
        let mut s = setup(open(16));
        s.set_storage(json!({ "food": 40 }));
        s.pile(2.0, 2.0, json!({ "ironOre": 20 }));
        s.haul(json!(["ironOre"]), 6.0, json!({})).unwrap();
        s.run(2000, |s| s.storage_units(Good::IronOre) == 20.0);
        s.run(50, never);
        // Topped up at the storage (the horse may have eaten a little since).
        assert!(s.load(Good::Food) > 5.0);
        assert!(s.storage_units(Good::Food) < 40.0);
        assert!(matches!(s.w1().order, Some(ResidentOrder::Haul(_))));
    }

    #[test]
    fn hauls_food_without_unloading_what_the_horse_keeps_or_the_drivers_own() {
        let mut s = setup(open(16));
        s.pile(2.0, 2.0, json!({ "food": 30 }));
        s.haul(json!(["food"]), 4.0, json!({})).unwrap();
        s.run(2000, |s| s.route().stop == HaulStop::From && s.route().phase == HaulPhase::Driving);
        assert_eq!(s.load(Good::Food), 4.0);
        assert_eq!(s.storage_units(Good::Food), 26.0);
        assert_eq!(s.w1().carried[&Good::Food], 2.0);
    }

    #[test]
    fn hauls_the_return_goods_back_from_the_other_stop_keeping_the_horses_food_on_board() {
        let mut s = setup(open(16));
        s.set_storage(json!({ "food": 60 }));
        s.pile(2.0, 2.0, json!({ "ironOre": 20 }));
        s.haul(json!(["ironOre"]), 6.0, json!({ "returnGoods": ["food"] })).unwrap();
        // Ore goes to the storage; the Food comes back and is unloaded at the first stop.
        s.run(4000, |s| {
            s.route().stop == HaulStop::To
                && s.route().phase == HaulPhase::Driving
                && s.storage_units(Good::IronOre) == 20.0
                && s.world.tick > 1000
        });
        assert_eq!(s.storage_units(Good::IronOre), 20.0);
        assert_eq!(s.storage_units(Good::Food), 0.0);
        let food = pile_at(&s.world, 2.0, 2.0)
            .map_or(0.0, |p| p.goods.get(&Good::Food).copied().unwrap_or(0.0));
        assert!(food > 40.0);
        assert!(s.load(Good::Food) > 4.0);
        assert!(s.load(Good::Food) <= 6.0);
        assert_eq!(s.route().return_goods, vec![Good::Food]);
    }

    #[test]
    fn stops_when_told_to() {
        let mut s = setup(open(16));
        s.haul(json!(["ironOre"]), 0.0, json!({})).unwrap();
        assert!(matches!(s.w1().order, Some(ResidentOrder::Haul(_))));
        let mut q = Queue::new(&s.terrain);
        assert_eq!(
            q.receive(&s.world, &player(7), json!({ "kind": "stop", "residentId": "w1" })),
            Ok(())
        );
        q.apply_all(&mut s.world);
        assert_eq!(s.w1().order, None);
        assert_eq!(s.w1().script, None);
    }

    #[test]
    fn ends_when_the_carriage_loses_its_horse() {
        let mut s = setup(open(16));
        s.pile(2.0, 2.0, json!({ "ironOre": 10 }));
        s.haul(json!(["ironOre"]), 0.0, json!({})).unwrap();
        s.run(100, |s| s.route().phase == HaulPhase::Driving);
        s.world.horses.clear();
        s.run(100, |s| s.w1().order.is_none());
        assert_eq!(s.w1().order, None);
    }

    #[test]
    fn survives_a_restart_halfway() {
        let mut s = setup(open(16));
        s.pile(2.0, 2.0, json!({ "ironOre": 50 }));
        s.haul(json!(["ironOre"]), 0.0, json!({})).unwrap();
        // The TypeScript steps 30 ticks with `Walking`; the stand-in drives faster, so this
        // runs until the carriage is on its way to the other stop, as it is after those 30.
        s.run(30, |s| s.route().stop == HaulStop::To && s.route().phase == HaulPhase::Driving);
        assert_eq!((s.route().stop, s.route().phase), (HaulStop::To, HaulPhase::Driving));
        let saved = serde_json::to_string(&s.world).unwrap();
        let restarted: WorldState = serde_json::from_str(&saved).unwrap();
        assert_eq!(restarted, s.world);
        let mut t =
            Setup { world: restarted, terrain: s.terrain.clone(), scratch: Scratch::default() };
        t.run(2000, |t| t.storage_units(Good::IronOre) == 50.0);
        assert_eq!(t.storage_units(Good::IronOre), 50.0);
        assert!(matches!(t.w1().order, Some(ResidentOrder::Haul(_))));
    }
}
