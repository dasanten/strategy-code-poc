//! `apps/server/src/buying.test.ts`, one test per `it`. The invariants (`checkInvariants`) come
//! with T86.13.

mod common;
mod goods_support;

use csp_shared::balance::{CITY_PRICE_BY_BUILDING, CITY_PRICE_PER_RESIDENT};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Good, RealmEventWhat, Resident, ResidentOrder, WorldState};
use csp_sim::buying::buy_orders_done;
use csp_sim::queries::city::city_price;
use csp_sim::sight::entities_in_sight;
use csp_sim::tick::Scratch;
use goods_support::{building, new_resident, open, player, realm, step, Queue};
use serde_json::{json, Value};

/// What the NPC city of `setup` asks: two residents, its town hall, a house and a farm.
fn price() -> f64 {
    2.0 * CITY_PRICE_PER_RESIDENT
        + CITY_PRICE_BY_BUILDING.get("townHall").unwrap()
        + CITY_PRICE_BY_BUILDING.get("house").unwrap()
        + CITY_PRICE_BY_BUILDING.get("farm").unwrap()
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scratch: Scratch,
}

/// `addCity`: a city with its town hall at (x, y).
fn add_city(
    world: &mut WorldState,
    id: &str,
    realm_id: Option<&str>,
    x: f64,
    y: f64,
    name: &str,
    trade_org: Option<&str>,
) {
    let hall = format!("{id}-hall");
    world
        .buildings
        .push(building(json!({ "id": hall, "kind": "townHall", "cityId": id, "x": x, "y": y })));
    let mut c = json!({ "id": id, "name": name, "realmId": realm_id, "townHallId": hall, "occupation": null });
    if let Some(t) = trade_org {
        c["tradeOrg"] = json!(t);
    } else if realm_id.is_none() {
        c["layout"] = json!("grid");
    }
    world.cities.push(serde_json::from_value(c).unwrap());
}

/// Realm r1 (Player 7, Leader a1 far away) and the NPC city npc, its town hall at (20, 20), with
/// a house and a farm, where n1 and n2 live. r1's p1 and p2 stand on the town hall carrying
/// `coins`.
fn setup(coins: [f64; 2]) -> Setup {
    let terrain = open(64);
    let mut world = goods_support::world_on(&terrain);
    world.realms.push(realm("r1", 7, "a1"));
    add_city(&mut world, "npc", None, 20.0, 20.0, "Dunmere", None);
    world.buildings.push(building(
        json!({ "id": "house", "kind": "house", "cityId": "npc", "x": 24, "y": 20 }),
    ));
    world
        .buildings
        .push(building(json!({ "id": "farm", "kind": "farm", "cityId": "npc", "x": 23, "y": 23 })));
    let mut add = |id: &str, owner: Option<&str>, x: f64, y: f64, city: Option<&str>| {
        let seed = world.residents.len() as f64 + 1.0;
        let mut r: Resident = new_resident(seed, id, owner, x, y);
        r.city_id = city.map(str::to_string);
        r.born_at = -20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
        world.residents.push(r);
    };
    add("a1", Some("r1"), 50.0, 50.0, None);
    add("n1", None, 24.0, 20.0, Some("npc"));
    add("n2", None, 23.0, 23.0, Some("npc"));
    add("p1", Some("r1"), 20.0, 20.0, None);
    add("p2", Some("r1"), 20.0, 20.0, None);
    world.residents[3].carried.insert(Good::Coins, coins[0]);
    world.residents[4].carried.insert(Good::Coins, coins[1]);
    Setup { world, terrain, scratch: Scratch::default() }
}

fn default_setup() -> Setup {
    setup([price() - 100.0, 300.0])
}

fn buy() -> Value {
    json!({ "kind": "buyCity", "residentId": "p1", "cityId": "npc" })
}

impl Setup {
    /// Sends an order from the buyer, applies it and answers whether it was taken (`order`).
    fn order(&mut self, o: Value) -> String {
        let mut q = Queue::new(&self.terrain);
        let answer = q.receive(&self.world, &player(7), o);
        q.apply_all(&mut self.world);
        answer.err().unwrap_or_else(|| "ack".into())
    }
    /// Steps the world once, keeping residents fed (`run`).
    fn run(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = 100.0;
        }
        step(&mut self.world, &self.terrain, &mut self.scratch);
    }
    fn at(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).unwrap()
    }
    fn at_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }
    fn coins(&self, id: &str) -> Option<f64> {
        self.at(id).carried.get(&Good::Coins).copied()
    }
    fn npc_realm(&self) -> Option<String> {
        self.world.cities.iter().find(|c| c.id == "npc").unwrap().realm_id.clone()
    }
    /// The seen entity `id` as plain data, from r1's sight (`entitiesInSight`).
    fn seen(&mut self, id: &str) -> Option<Value> {
        let index = self.scratch.index(&self.world, self.terrain.size);
        let seen = entities_in_sight(&self.world, index, Some("r1"), None);
        seen.iter().map(|e| serde_json::to_value(e).unwrap()).find(|e| e["id"] == id)
    }
}

#[test]
fn names_a_price_from_its_residents_and_buildings_which_its_seen_city_carries() {
    let mut s = default_setup();
    let npc = s.world.cities[0].clone();
    assert_eq!(city_price(&s.world, &npc, None), price());
    // A construction site adds nothing.
    s.world.buildings.push(building(json!({
        "id": "site", "kind": "house", "cityId": "npc", "x": 22, "y": 20,
        "site": { "delivered": {}, "work": 0 },
    })));
    assert_eq!(city_price(&s.world, &npc, None), price());
    let seen = s.seen("npc").unwrap();
    assert_eq!((seen["is"].clone(), seen["price"].as_f64()), (json!("city"), Some(price())));
}

#[test]
fn only_npc_cities_name_a_price() {
    let mut s = default_setup();
    add_city(&mut s.world, "mine", Some("r1"), 24.0, 18.0, "Ashford", None);
    add_city(&mut s.world, "post", None, 18.0, 24.0, "Ashford", Some("post"));
    assert!(s.seen("mine").unwrap().get("price").is_none());
    assert!(s.seen("post").unwrap().get("price").is_none());
}

#[test]
fn fails_with_too_few_coins_at_the_town_hall() {
    let mut s = setup([100.0, 100.0]);
    assert_eq!(
        s.order(buy()),
        format!("it costs {} coins; your residents at its town hall carry 200", price())
    );
    assert_eq!(s.npc_realm(), None);
    assert_eq!(s.coins("p1"), Some(100.0));
}

#[test]
fn counts_only_coins_carried_on_the_town_hall_itself() {
    let mut s = default_setup();
    s.at_mut("p2").x = 23.0;
    assert!(s.order(buy()).starts_with("it costs"));
    s.at_mut("p2").x = 20.0;
    assert_eq!(s.order(buy()), "ack");
    s.run();
    assert_eq!(s.npc_realm().as_deref(), Some("r1"));
}

#[test]
fn with_enough_coins_the_coins_are_gone_and_the_city_joins_the_realm_with_everything_in_it() {
    let mut s = default_setup();
    assert_eq!(s.order(buy()), "ack");
    s.run();
    assert_eq!(s.npc_realm().as_deref(), Some("r1"));
    assert_eq!(
        (s.at("n1").owner.as_deref(), s.at("n2").owner.as_deref()),
        (Some("r1"), Some("r1"))
    );
    // Its buildings stay its own, so they are the realm's now.
    for id in ["npc-hall", "house", "farm"] {
        let b = s.world.buildings.iter().find(|b| b.id == id).unwrap();
        assert_eq!(b.city_id.as_deref(), Some("npc"));
    }
    // The buyer's coins go first, the rest from p2; the price is used up, not kept by anyone.
    assert_eq!(s.coins("p1"), None);
    assert_eq!(s.coins("p2"), Some(200.0));
    let coins = |st: Option<&csp_shared::world::Stock>| {
        st.and_then(|x| x.get(&Good::Coins).copied()).unwrap_or(0.0)
    };
    let total: f64 = s.world.residents.iter().map(|r| coins(Some(&r.carried))).sum::<f64>()
        + s.world.buildings.iter().map(|b| coins(b.stock.as_ref())).sum::<f64>()
        + s.world.piles.iter().map(|p| coins(Some(&p.goods))).sum::<f64>();
    assert_eq!(total, 200.0);
    assert_eq!(s.at("p1").order, None);
    let bought: Vec<_> = s
        .world
        .events
        .iter()
        .filter(|e| matches!(e.what, RealmEventWhat::CityBought { .. }))
        .collect();
    assert_eq!(bought.len(), 1);
    assert_eq!(bought[0].user_id, 7);
    assert_eq!(
        bought[0].what,
        RealmEventWhat::CityBought {
            city_id: "npc".into(),
            city: "Dunmere".into(),
            price: price(),
            residents: 2.0,
            x: 20.0,
            y: 20.0
        }
    );
    // It is no longer for sale.
    assert!(s.seen("npc").unwrap().get("price").is_none());
    assert_eq!(s.order(buy()), "only NPC cities are for sale");
}

#[test]
fn falls_through_when_the_coins_are_gone_by_the_time_it_is_carried_out() {
    let mut s = default_setup();
    assert_eq!(s.order(buy()), "ack");
    s.at_mut("p2").carried.insert(Good::Coins, 0.0);
    s.run();
    assert_eq!(s.npc_realm(), None);
    assert_eq!(s.coins("p1"), Some(price() - 100.0));
    assert_eq!(s.at("p1").order, None);
    let not: Vec<_> = s
        .world
        .events
        .iter()
        .filter(|e| matches!(e.what, RealmEventWhat::CityNotBought { .. }))
        .collect();
    assert_eq!(not.len(), 1);
    assert_eq!(
        not[0].what,
        RealmEventWhat::CityNotBought {
            city_id: "npc".into(),
            city: "Dunmere".into(),
            price: price(),
            coins: price() - 100.0
        }
    );
}

#[test]
fn needs_the_resident_on_its_town_hall_and_an_npc_city() {
    let mut s = default_setup();
    s.at_mut("p1").x = 23.0;
    assert_eq!(s.order(buy()), "the resident must stand at its town hall");
    let mut o = buy();
    o["residentId"] = json!("n1");
    assert_eq!(s.order(o), "not one of your residents");
    add_city(&mut s.world, "post", None, 18.0, 24.0, "Ashford", Some("post"));
    let mut o = buy();
    o["cityId"] = json!("post");
    assert_eq!(s.order(o), "the Trade Organization doesn’t sell its cities");
    let mut o = buy();
    o["cityId"] = json!("nowhere");
    assert_eq!(s.order(o), "no such city");
}

#[test]
fn invariant_no_buy_order_outlasts_its_tick() {
    let mut s = default_setup();
    s.at_mut("p1").order = Some(
        serde_json::from_value::<ResidentOrder>(json!({ "kind": "buyCity", "cityId": "npc" }))
            .unwrap(),
    );
    let v = buy_orders_done(&s.world);
    assert_eq!(v.len(), 1);
    assert_eq!(
        (v[0].invariant.as_str(), v[0].entity_ids.clone()),
        ("buy-orders-done", vec!["p1".to_string()])
    );
}
