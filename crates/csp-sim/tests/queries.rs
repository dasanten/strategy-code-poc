//! The TypeScript tests of the read-only queries sight calls, ported: the `it` blocks of
//! `npc-reaction.test.ts`, `npc-trade.test.ts`, `horse-market.test.ts` and `stock-floor.test.ts`
//! that ask a query (or `entitiesInSight`) about a world built by hand. Those that give orders or
//! step the world are the rules' to port (Epic 1003).

mod common;

use common::load_world;
use csp_shared::balance::{
    BUILD_MATERIALS, CITY_PRICE_BY_BUILDING, CITY_PRICE_PER_RESIDENT, CITY_PRICE_STANDING_SWING,
    HORSE_PRICE_AGE_FLOOR, HORSE_PRICE_AGE_PER_YEAR, HORSE_PRICE_BASE, HORSE_PRICE_GLUT,
    HORSE_PRICE_PER_STAT, HORSE_PRICE_SCARCITY, HORSE_PRICE_STATS_FLOOR, HORSE_STAT_AVERAGE,
    HQ_FLOOR_FACTOR, NPC_CITY_REFUSES_STANDING, NPC_CITY_WONT_SELL_STANDING, NPC_HORSES_KEPT,
    NPC_TRADE, NPC_WAR_CHEST_PER_RESIDENT, STANDING_RANGE, WAREHOUSE_BASE_PRICE, WAREHOUSE_FLOOR,
};
use csp_shared::protocol::SeenEntity;
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{
    Building, BuildingKind, City, CityLayout, ConstructionSite, Good, Horse, HorseStats, Realm,
    Resident, Standing, Stock, TradeOrgCity, WorldState,
};
use csp_sim::npc_hire::{npc_lending_keeps_reserve, step_npc_hire, LentGear};
use csp_sim::queries::building::recipe_for;
use csp_sim::queries::city::{city_price, npc_city_refuses, sells_to, town_hall_of};
use csp_sim::queries::horse_market::{
    horse_stock_factor, horse_worth, npc_horse_price, npc_horse_sale_problem, npc_horses_of,
};
use csp_sim::queries::js_round;
use csp_sim::queries::names::{good_name, held, ALL_GOODS, PRICED_GOODS};
use csp_sim::queries::npc_trade::{
    hire_spare, npc_city_prices, npc_hire_threat, npc_horses_wanted, npc_reserve,
    npc_soldier_target, spare_residents, NPC_SMITHY_WEAPON,
};
use csp_sim::queries::residents::{can_work, is_armed};
use csp_sim::queries::standing::standing_organization;
use csp_sim::queries::warehouse::{
    price_for, stock_floor, warehouse_keeps, warehouse_prices, HQ_COIN_WAREHOUSE,
};
use csp_sim::sight::entities_in_sight;
use csp_sim::world_index::WorldIndex;
use serde_json::{json, Value};

const SIZE: i32 = 64;

/// `createWorld(terrain)`: a world with nothing in it.
fn create_world() -> WorldState {
    let (mut w, _, _) = load_world("worlds/hq-0.json");
    w.residents.clear();
    w.nodes.clear();
    w.realms.clear();
    w.cities.clear();
    w.buildings.clear();
    w.horses.clear();
    w.carriages.clear();
    w.piles.clear();
    w.events.clear();
    w.caravans.clear();
    w.traders.clear();
    w.standings.clear();
    w.contracts.clear();
    w.tick = 0;
    w
}

fn realm(id: &str, user_id: u64, leader: &str) -> Realm {
    Realm { id: id.into(), user_id, leader_id: leader.into(), name: None, demands_sent_at: None }
}

fn building(
    id: &str,
    kind: BuildingKind,
    city: &str,
    x: f64,
    y: f64,
    stock: Option<Stock>,
) -> Building {
    serde_json::from_value(json!({ "id": id, "kind": kind, "cityId": city, "x": x, "y": y }))
        .map(|b: Building| Building { stock, ..b })
        .unwrap()
}

/// `addCity` of `test-terrain.ts`: a city with its town hall `${id}-hall` at (x, y).
fn add_city(
    world: &mut WorldState,
    id: &str,
    realm_id: Option<&str>,
    x: f64,
    y: f64,
    name: &str,
) -> City {
    let hall = building(&format!("{id}-hall"), BuildingKind::TownHall, id, x, y, None);
    let city: City = serde_json::from_value(json!({
        "id": id, "name": name, "realmId": realm_id, "townHallId": hall.id, "occupation": null,
    }))
    .unwrap();
    let city = City { layout: realm_id.is_none().then_some(CityLayout::Grid), ..city };
    world.buildings.push(hall);
    world.cities.push(city.clone());
    city
}

/// A resident as `newResident` makes them, with average stats, grown up long ago.
fn resident(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    x: f64,
    y: f64,
    city: Option<&str>,
) {
    let stat = json!({ "base": 10, "trained": 0 });
    let r: Resident = serde_json::from_value(json!({
        "id": id, "name": format!("Resident {id}"), "owner": owner, "cityId": city, "x": x, "y": y,
        "stats": { "strength": stat, "endurance": stat, "agility": stat, "intellect": stat },
        "skills": {}, "health": 100, "hunger": 100, "bornAt": -20.0 * 24.0 * 3600.0,
        "lifespan": 60, "carried": {}, "order": null,
    }))
    .unwrap();
    world.residents.push(r);
}

fn at<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).unwrap()
}

/// `changeStanding` of `standing.ts`: moves how `of` regards `toward` by `delta`, within range.
fn change_standing(world: &mut WorldState, of: &str, toward: &str, delta: f64) {
    let a = standing_organization(world, of).to_string();
    let b = standing_organization(world, toward).to_string();
    if a == b || delta == 0.0 {
        return;
    }
    let i = world.standings.iter().position(|s| s.of == a && s.toward == b);
    let old = i.map_or(0.0, |i| world.standings[i].value);
    let value = (-STANDING_RANGE).max(STANDING_RANGE.min(old + delta));
    match i {
        Some(i) => world.standings[i].value = value,
        None => world.standings.push(Standing { of: a, toward: b, value }),
    }
    if value == 0.0 {
        world.standings.retain(|s| s.value != 0.0);
    }
}

fn seen_city(world: &WorldState, realm: &str, id: &str) -> Option<serde_json::Value> {
    let index = WorldIndex::new(world, SIZE);
    entities_in_sight(world, &index, Some(realm), None)
        .iter()
        .find(|e| e.id() == id && matches!(e, SeenEntity::City(_)))
        .map(|e| serde_json::to_value(e).unwrap())
}

mod npc_reaction {
    use super::*;

    /// Realm r1 (Leader a1 far away), realm r2, and the NPC city npc, its town hall at (20, 20),
    /// a house at (23, 20) and an open gate at (20, 17), where n1 and n2 live. r1's p1 stands on
    /// the town hall carrying plenty of coins.
    fn setup() -> (WorldState, City) {
        let mut world = create_world();
        world.realms.push(realm("r1", 7, "a1"));
        world.realms.push(realm("r2", 8, "b1"));
        let npc = add_city(&mut world, "npc", None, 20.0, 20.0, "Dunmere");
        world.buildings.push(building("house", BuildingKind::House, "npc", 23.0, 20.0, None));
        world.buildings.push(building("gate", BuildingKind::Gate, "npc", 20.0, 17.0, None));
        resident(&mut world, "a1", Some("r1"), 50.0, 50.0, None);
        resident(&mut world, "b1", Some("r2"), 52.0, 50.0, None);
        resident(&mut world, "n1", None, 23.0, 20.0, Some("npc"));
        resident(&mut world, "n2", None, 20.0, 19.0, Some("npc"));
        resident(&mut world, "p1", Some("r1"), 20.0, 20.0, None);
        at(&mut world, "p1").carried.insert(Good::Coins, 10.0 * worth());
        (world, npc)
    }

    /// What the NPC city of `setup` is worth: two residents, its town hall, a house and a gate.
    fn worth() -> f64 {
        let by = |k: &str| CITY_PRICE_BY_BUILDING.get(k).unwrap_or(0.0);
        js_round(2.0 * CITY_PRICE_PER_RESIDENT + by("townHall") + by("house") + by("gate"))
    }

    #[test]
    fn refuses_an_organization_only_below_the_threshold_and_only_as_an_npc_city() {
        let (mut world, npc) = setup();
        change_standing(&mut world, "npc", "r1", NPC_CITY_REFUSES_STANDING);
        assert!(!npc_city_refuses(&world, &npc, "r1"));
        change_standing(&mut world, "npc", "r1", -1.0);
        assert!(npc_city_refuses(&world, &npc, "r1"));
        assert!(!npc_city_refuses(&world, &npc, "r2"));
        // A realm's city, or one of the Trade Organization, never refuses here.
        let mine = add_city(&mut world, "mine", Some("r2"), 40.0, 40.0, "Ashford");
        change_standing(&mut world, "r2", "r1", -STANDING_RANGE);
        assert!(!npc_city_refuses(&world, &mine, "r1"));
    }

    #[test]
    fn says_in_sight_that_it_refuses_the_player() {
        let (mut world, _) = setup();
        assert!(seen_city(&world, "r1", "npc").unwrap().get("refuses").is_none());
        change_standing(&mut world, "npc", "r1", NPC_CITY_REFUSES_STANDING - 1.0);
        assert_eq!(seen_city(&world, "r1", "npc").unwrap()["refuses"], true);
    }

    #[test]
    fn asks_more_the_lower_its_standing_toward_the_buyer_less_the_higher() {
        let (mut world, npc) = setup();
        assert_eq!(city_price(&world, &npc, Some("r1")), worth());
        change_standing(&mut world, "npc", "r1", 50.0);
        let good = js_round(worth() * (1.0 - CITY_PRICE_STANDING_SWING / 2.0));
        assert_eq!(city_price(&world, &npc, Some("r1")), good);
        assert!(good < worth());
        assert_eq!(seen_city(&world, "r1", "npc").unwrap()["price"], good);
        change_standing(&mut world, "npc", "r1", -100.0);
        let bad = js_round(worth() * (1.0 + CITY_PRICE_STANDING_SWING / 2.0));
        assert_eq!(city_price(&world, &npc, Some("r1")), bad);
        assert!(bad > worth());
        // Another realm still pays what it is worth.
        assert_eq!(city_price(&world, &npc, Some("r2")), worth());
    }

    #[test]
    fn wont_sell_at_all_below_the_lower_threshold() {
        let (mut world, npc) = setup();
        change_standing(&mut world, "npc", "r1", NPC_CITY_WONT_SELL_STANDING);
        assert!(sells_to(&world, &npc, "r1"));
        change_standing(&mut world, "npc", "r1", -1.0);
        assert!(!sells_to(&world, &npc, "r1"));
        assert!(sells_to(&world, &npc, "r2"));
        let seen = seen_city(&world, "r1", "npc").unwrap();
        assert_eq!((&seen["wontSell"], &seen["refuses"]), (&json!(true), &json!(true)));
        assert!(seen.get("price").is_none());
    }

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn the_thresholds_are_in_order_it_refuses_before_it_stops_selling() {
        assert!(NPC_CITY_WONT_SELL_STANDING < NPC_CITY_REFUSES_STANDING);
        assert!(NPC_CITY_REFUSES_STANDING < 0.0);
        assert!(NPC_CITY_WONT_SELL_STANDING > -STANDING_RANGE);
        assert!(CITY_PRICE_STANDING_SWING > 0.0 && CITY_PRICE_STANDING_SWING < 1.0);
    }
}

mod npc_trade {
    use super::*;

    /// Realm r1 (Player 7, Leader a1 far away) and the NPC city npc: its town hall at (20, 20),
    /// a storage at (23, 20) and a farm at (25, 20), where n1 to n6 live. r1's p1 stands on the
    /// storage.
    fn setup() -> (WorldState, City) {
        let mut world = create_world();
        world.realms.push(realm("r1", 7, "a1"));
        let npc = add_city(&mut world, "npc", None, 20.0, 20.0, "Dunmere");
        world.buildings.push(building(
            "store",
            BuildingKind::Storage,
            "npc",
            23.0,
            20.0,
            Some(Stock::new()),
        ));
        world.buildings.push(building("farm", BuildingKind::Farm, "npc", 25.0, 20.0, None));
        resident(&mut world, "a1", Some("r1"), 50.0, 50.0, None);
        for i in 1..=6 {
            resident(&mut world, &format!("n{i}"), None, 20.0, 21.0, Some("npc"));
        }
        resident(&mut world, "p1", Some("r1"), 23.0, 20.0, None);
        (world, npc)
    }

    fn storage(world: &mut WorldState) -> &mut Building {
        world.buildings.iter_mut().find(|b| b.id == "store").unwrap()
    }

    fn material(kind: &str, good: &str) -> f64 {
        BUILD_MATERIALS.get(kind).unwrap().get(good).unwrap_or(0.0)
    }

    #[test]
    fn keeps_a_reserve_of_food_materials_for_a_house_and_some_wall_weapons_and_a_war_chest() {
        let (mut world, npc) = setup();
        let reserve = npc_reserve(&world, &npc);
        assert!(held(&reserve, Good::Food) > 0.0);
        let residents: Vec<&Resident> =
            world.residents.iter().filter(|r| r.city_id.as_deref() == Some("npc")).collect();
        let adults: Vec<&&Resident> =
            residents.iter().filter(|r| can_work(r.born_at, world.tick as f64)).collect();
        let unarmed = npc_soldier_target(adults.len() as f64)
            - adults.iter().filter(|r| is_armed(&r.carried)).count() as f64;
        let spear =
            recipe_for(BuildingKind::Smithy, Some(good_name(NPC_SMITHY_WEAPON))).unwrap().input;
        assert_eq!(reserve.get(&NPC_SMITHY_WEAPON), Some(&unarmed));
        assert_eq!(
            reserve.get(&Good::Wood),
            Some(
                &(material("house", "wood")
                    + material("wall", "wood") * NPC_TRADE.reserve_wall_stretches
                    + spear.get("wood").unwrap() * unarmed)
            )
        );
        assert_eq!(reserve.get(&Good::Iron), Some(&(spear.get("iron").unwrap() * unarmed)));
        assert_eq!(reserve.get(&Good::Stone), None);
        assert_eq!(
            reserve.get(&Good::Coins),
            Some(&(residents.len() as f64 * NPC_WAR_CHEST_PER_RESIDENT))
        );
        // Armed soldiers want no more weapons, nor Iron to forge them.
        for r in world.residents.iter_mut().filter(|r| r.city_id.as_deref() == Some("npc")) {
            r.carried.insert(Good::Spear, 1.0);
        }
        assert_eq!(npc_reserve(&world, &npc).get(&Good::Iron), None);
        assert_eq!(npc_reserve(&world, &npc).get(&NPC_SMITHY_WEAPON), None);
    }

    #[test]
    fn prices_from_its_stock_cheaper_to_an_organization_it_holds_in_good_standing() {
        let (mut world, npc) = setup();
        let armour = |world: &WorldState| {
            npc_city_prices(world, &npc, Some("r1"))
                .into_iter()
                .find(|p| p.good == Good::Armour)
                .unwrap()
        };
        storage(&mut world).stock = Some([(Good::Armour, 20.0)].into_iter().collect());
        let neutral = armour(&world);
        storage(&mut world).stock = Some([(Good::Armour, 1.0)].into_iter().collect());
        let scarce = armour(&world);
        assert!(scarce.sell > neutral.sell);
        assert!(neutral.buy < neutral.sell);
        change_standing(&mut world, "npc", "r1", 60.0);
        let liked = armour(&world);
        assert!(liked.sell < scarce.sell);
        assert!(liked.buy > scarce.buy);
        assert!(liked.buy < liked.sell);
    }

    #[test]
    fn names_a_refused_player_no_prices_and_no_residents_to_hire() {
        let (mut world, _) = setup();
        storage(&mut world).stock = Some([(Good::Food, 1000.0)].into_iter().collect());
        change_standing(&mut world, "npc", "r1", NPC_CITY_REFUSES_STANDING - 1.0);
        let seen = seen_city(&world, "r1", "npc").unwrap();
        assert_eq!(seen["refuses"], true);
        assert!(seen.get("trade").is_none() && seen.get("hire").is_none());
    }

    #[test]
    fn names_a_player_in_sight_its_prices_and_what_it_would_lend() {
        let (world, npc) = setup();
        let seen = seen_city(&world, "r1", "npc").unwrap();
        let spare = spare_residents(&world, &npc, None).len() as f64;
        assert_eq!(seen["hire"]["spare"], spare);
        assert_eq!(seen["hire"]["pricePerResidentWeek"], 5.0);
        assert!(!seen["trade"].as_array().unwrap().is_empty());
    }

    /// Plans `jobs` for npc's residents, as its planning pass would (`city_plans`).
    fn plan(world: &mut WorldState, jobs: Value) {
        let plan = json!({ "plannedAt": 0, "jobs": jobs });
        world.city_plans.insert("npc".into(), serde_json::from_value(plan).unwrap());
    }

    fn spare_ids(world: &WorldState, npc: &City) -> Vec<String> {
        spare_residents(world, npc, None).iter().map(|r| r.id.clone()).collect()
    }

    #[test]
    fn lends_only_spare_hands_keeping_its_farmers_builders_and_a_share_at_home() {
        let (mut world, npc) = setup();
        // n1 farms, n2 builds its project, n3 is a soldier (carries a spear), n4 to n6 are idle,
        // on a road crew and scouting.
        plan(
            &mut world,
            json!({ "n1": { "kind": "farm", "buildingId": "farm" }, "n2": { "kind": "build" },
                "n3": { "kind": "soldier" }, "n4": { "kind": "idle" }, "n5": { "kind": "road" },
                "n6": { "kind": "scout" } }),
        );
        at(&mut world, "n3").carried.insert(Good::Spear, 1.0);
        // Six adults: two kept busy, a quarter (two) stay at home with the soldier among them.
        assert_eq!(spare_ids(&world, &npc), ["n4", "n5"]);
        resident(&mut world, "kid", None, 20.0, 21.0, Some("npc"));
        at(&mut world, "kid").born_at = 0.0;
        assert!(!spare_residents(&world, &npc, None).iter().any(|r| r.id == "kid"));
    }

    #[test]
    fn lends_nobody_with_everyone_working_for_a_short_good_and_its_surplus_workers_once_it_isnt() {
        let (mut world, npc) = setup();
        let jobs: serde_json::Map<String, Value> = (1..=6)
            .map(|i| (format!("n{i}"), json!({ "kind": "work", "buildingId": "farm" })))
            .collect();
        plan(&mut world, Value::Object(jobs));
        assert_eq!(spare_ids(&world, &npc), Vec::<String>::new(), "Food is short");
        storage(&mut world).stock = Some([(Good::Food, 10_000.0)].into_iter().collect());
        // Working for surplus now: all but the quarter at home.
        assert_eq!(spare_ids(&world, &npc), ["n1", "n2", "n3", "n4"]);
    }

    #[test]
    fn lends_nobody_while_it_feels_threatened_by_the_hirer() {
        let (mut world, npc) = setup();
        plan(&mut world, json!({}));
        assert!(npc_hire_threat(&world, &npc, "r1", SIZE).is_none());
        assert!(hire_spare(&world, &npc, "r1", SIZE) > 0.0);
        // Armed residents of the hirer near it.
        at(&mut world, "p1").carried.insert(Good::Spear, 1.0);
        assert!(npc_hire_threat(&world, &npc, "r1", SIZE).unwrap().contains("armed residents"));
        assert_eq!(hire_spare(&world, &npc, "r1", SIZE), 0.0);
        at(&mut world, "p1").carried = Stock::new();
        // Its town hall occupied.
        let mut occupied = world.clone();
        occupied.cities.iter_mut().find(|c| c.id == "npc").unwrap().occupation =
            Some(serde_json::from_value(json!({ "realmId": "r2", "since": 0 })).unwrap());
        let city = occupied.cities.iter().find(|c| c.id == "npc").unwrap().clone();
        assert!(npc_hire_threat(&occupied, &city, "r1", SIZE).unwrap().contains("occupied"));
        // Weighing a demand.
        world.demands.push(
            serde_json::from_value(json!({ "id": "d1", "fromId": "r9", "toId": "npc",
                "terms": { "kind": "city", "cityId": "npc", "cityName": "Dunmere" },
                "note": "Yield.", "sentAt": 0, "deadline": 9000 }))
            .unwrap(),
        );
        assert!(npc_hire_threat(&world, &npc, "r1", SIZE).unwrap().contains("demand"));
        assert_eq!(hire_spare(&world, &npc, "r1", SIZE), 0.0);
    }

    /// r1 asks npc for n4, idle, at a good price.
    fn ask_for_n4(world: &mut WorldState) {
        plan(world, json!({ "n4": { "kind": "idle" } }));
        let contract = json!({ "id": "k1", "lenderId": "npc", "hirerId": "r1",
            "offeredBy": "hirer", "residentIds": ["n4"], "days": 7, "pricePerWeek": 100,
            "storageId": "store", "startedAt": null, "paidWeeks": 0 });
        world.contracts.push(serde_json::from_value(contract).unwrap());
    }

    #[test]
    fn arms_lent_residents_only_from_weapons_and_armour_above_its_reserve() {
        let (mut world, npc) = setup();
        let reserve = npc_reserve(&world, &npc);
        let kept = held(&reserve, NPC_SMITHY_WEAPON);
        let stock: Stock =
            [(NPC_SMITHY_WEAPON, kept), (Good::Food, 10_000.0)].into_iter().collect();
        storage(&mut world).stock = Some(stock);
        ask_for_n4(&mut world);
        let took = step_npc_hire(&mut world, SIZE);
        assert!(world.contracts[0].started_at.is_some(), "lent");
        assert!(!is_armed(&at(&mut world, "n4").carried), "nothing spare: unarmed");
        assert_eq!(held(storage(&mut world).stock.as_ref().unwrap(), NPC_SMITHY_WEAPON), kept);
        assert_eq!(took, vec![]);

        let (mut world, npc) = setup();
        let reserve = npc_reserve(&world, &npc);
        let kept = held(&reserve, NPC_SMITHY_WEAPON);
        let stock: Stock =
            [(NPC_SMITHY_WEAPON, kept + 1.0), (Good::Shield, 1.0), (Good::Food, 10_000.0)]
                .into_iter()
                .collect();
        storage(&mut world).stock = Some(stock);
        ask_for_n4(&mut world);
        let took = step_npc_hire(&mut world, SIZE);
        assert!(is_armed(&at(&mut world, "n4").carried), "one spare weapon");
        assert!(held(storage(&mut world).stock.as_ref().unwrap(), NPC_SMITHY_WEAPON) >= kept);
        assert_eq!(took.len(), 1 + usize::from(held(&reserve, Good::Shield) < 1.0));
        assert_eq!(npc_lending_keeps_reserve(&took), vec![]);
        let _ = npc;
    }

    #[test]
    fn lending_under_the_reserve_is_caught_by_its_invariant() {
        let gear = LentGear {
            contract_id: "k1".into(),
            city_id: "npc".into(),
            resident_id: "n4".into(),
            good: Good::Spear,
            left: 1.0,
            reserve: 2.0,
        };
        assert_eq!(npc_lending_keeps_reserve(&[gear])[0].invariant, "npc-lending-keeps-reserve");
    }
}

mod horse_market {
    use super::*;

    fn horse(id: &str, x: f64, y: f64) -> Horse {
        Horse {
            id: id.into(),
            name: format!("Horse {id}"),
            realm_id: None,
            city_id: Some("npc".into()),
            x,
            y,
            hunger: 100.0,
            health: 100.0,
            stats: HorseStats { speed: 10.0, strength: 10.0, endurance: 10.0 },
            born_at: 0.0,
            down_until: None,
        }
    }

    fn stats(s: f64) -> HorseStats {
        HorseStats { speed: s, strength: s, endurance: s }
    }

    fn with_stats(stats: HorseStats) -> Horse {
        Horse { stats, ..horse("x", 0.0, 0.0) }
    }

    /// Realm r1 (Player 7, Leader a1 far away) and the NPC city npc: its town hall at (20, 20), a
    /// storage at (23, 20) and a stable at (30, 20) with three horses, h1 to h3, where n1 to n6
    /// live. It wants four. r1's p1 stands in the stable with 500 Coins.
    fn setup() -> (WorldState, City) {
        let mut world = create_world();
        world.realms.push(realm("r1", 7, "a1"));
        let city = add_city(&mut world, "npc", None, 20.0, 20.0, "Dunmere");
        world.buildings.push(building(
            "store",
            BuildingKind::Storage,
            "npc",
            23.0,
            20.0,
            Some(Stock::new()),
        ));
        let food = [(Good::Food, 500.0)].into_iter().collect();
        world.buildings.push(building(
            "stable",
            BuildingKind::Stable,
            "npc",
            30.0,
            20.0,
            Some(food),
        ));
        resident(&mut world, "a1", Some("r1"), 50.0, 50.0, None);
        for i in 1..=6 {
            resident(&mut world, &format!("n{i}"), None, 20.0, 21.0, Some("npc"));
        }
        world.horses.extend(["h1", "h2", "h3"].map(|id| horse(id, 31.0, 21.0)));
        resident(&mut world, "p1", Some("r1"), 31.0, 21.0, None);
        at(&mut world, "p1").carried.insert(Good::Coins, 500.0);
        (world, city)
    }

    fn horse_of<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Horse {
        world.horses.iter_mut().find(|h| h.id == id).unwrap()
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.005
    }

    #[test]
    fn follows_its_stats_an_average_new_horse_at_the_base() {
        assert!(close(horse_worth(&with_stats(stats(HORSE_STAT_AVERAGE)), 0.0), 1.0));
        let up = horse_worth(&with_stats(stats(HORSE_STAT_AVERAGE + 5.0)), 0.0);
        assert!(close(up, 1.0 + 5.0 * HORSE_PRICE_PER_STAT));
        let down = horse_worth(&with_stats(stats(HORSE_STAT_AVERAGE - 5.0)), 0.0);
        assert!(close(down, 1.0 - 5.0 * HORSE_PRICE_PER_STAT));
        // The mean counts: one stat up and another down cancel out.
        let mixed = HorseStats { speed: 12.0, strength: 8.0, endurance: 10.0 };
        assert!(close(horse_worth(&with_stats(mixed), 0.0), 1.0));
        assert!(close(horse_worth(&with_stats(stats(1.0)), 0.0), HORSE_PRICE_STATS_FLOOR));
    }

    #[test]
    fn falls_with_age_down_to_a_floor() {
        let h = with_stats(stats(10.0));
        assert!(close(
            horse_worth(&h, 4.0 * TICKS_PER_GAME_YEAR),
            1.0 - 4.0 * HORSE_PRICE_AGE_PER_YEAR
        ));
        assert!(close(horse_worth(&h, 100.0 * TICKS_PER_GAME_YEAR), HORSE_PRICE_AGE_FLOOR));
    }

    #[test]
    fn rises_as_the_city_nears_the_pair_it_keeps_and_falls_with_more_than_it_wants() {
        let wanted = 6.0;
        assert!(close(horse_stock_factor(wanted, wanted), 1.0));
        let dearer: Vec<f64> =
            [6.0, 5.0, 4.0, 3.0].iter().map(|&has| horse_stock_factor(has, wanted)).collect();
        assert!(dearer.windows(2).all(|w| w[1] > w[0]));
        assert!(close(horse_stock_factor(NPC_HORSES_KEPT, wanted), 1.0 + HORSE_PRICE_SCARCITY));
        // However small the number it wants, the most it takes off is the same.
        let most_off = 1.0 - HORSE_PRICE_SCARCITY * HORSE_PRICE_GLUT;
        assert!(close(horse_stock_factor(3.0, NPC_HORSES_KEPT), most_off));
        assert!(close(horse_stock_factor(50.0, wanted), most_off));
    }

    #[test]
    fn is_moved_by_its_standing_like_its_trade_prices() {
        let (mut world, city) = setup();
        let h = horse_of(&mut world, "h1").clone();
        let has = npc_horses_of(&world, &city).len() as f64;
        let at = horse_stock_factor(has, npc_horses_wanted(&world, &city));
        assert_eq!(npc_horse_price(&world, &city, &h, Some("r1")), js_round(HORSE_PRICE_BASE * at));
        change_standing(&mut world, "npc", "r1", 20.0);
        let swing = (CITY_PRICE_STANDING_SWING * 20.0) / STANDING_RANGE;
        assert_eq!(
            npc_horse_price(&world, &city, &h, Some("r1")),
            js_round(HORSE_PRICE_BASE * at * (1.0 - swing))
        );
        change_standing(&mut world, "npc", "r1", -40.0);
        assert!(npc_horse_price(&world, &city, &h, Some("r1")) > js_round(HORSE_PRICE_BASE * at));
    }

    /// `refusing to sell a horse`: the city's reasons, as `buyHorseProblem` gives them from
    /// `npcHorseSaleProblem` (the order's own checks are the orders' port).
    #[test]
    fn refuses_to_sell_a_hitched_ridden_or_down_horse_none_to_spare_at_low_standing_or_with_no_storage(
    ) {
        let problem = |world: &WorldState, city: &City| {
            let h = world.horses.iter().find(|h| h.id == "h1").unwrap();
            npc_horse_sale_problem(world, city, h, "r1")
        };
        let (world, city) = setup();
        assert_eq!(problem(&world, &city), None);

        let (mut world, city) = setup();
        world.carriages.push(serde_json::from_value(json!({
            "id": "k1", "realmId": null, "cityId": null, "x": 31, "y": 21, "horseId": "h1", "load": {}
        })).unwrap());
        assert_eq!(problem(&world, &city).as_deref(), Some("Horse h1 is hitched to a carriage"));

        let (mut world, city) = setup();
        at(&mut world, "n1").riding = Some("h1".into());
        assert_eq!(problem(&world, &city).as_deref(), Some("someone rides Horse h1"));

        let (mut world, city) = setup();
        horse_of(&mut world, "h1").down_until = Some(1000.0);
        assert_eq!(problem(&world, &city).as_deref(), Some("Horse h1 is Down"));

        let (mut world, city) = setup();
        world.horses.retain(|h| h.id != "h3");
        assert_eq!(
            problem(&world, &city).as_deref(),
            Some("Dunmere keeps its last 2 horses to breed")
        );

        let (mut world, city) = setup();
        change_standing(&mut world, "npc", "r1", NPC_CITY_REFUSES_STANDING - 1.0);
        assert_eq!(problem(&world, &city).as_deref(), Some("Dunmere won’t trade with you"));

        let (mut world, city) = setup();
        world.buildings.retain(|b| b.id != "store");
        assert_eq!(problem(&world, &city).as_deref(), Some("Dunmere has no storage for the Coins"));
    }

    #[test]
    fn lists_the_horses_in_its_stable_with_name_stats_and_price() {
        let (mut world, city) = setup();
        let seen = seen_city(&world, "r1", "npc").unwrap();
        let horses = seen["horses"].as_array().unwrap();
        let ids: Vec<&str> = horses.iter().map(|h| h["horseId"].as_str().unwrap()).collect();
        assert_eq!(ids, ["h1", "h2", "h3"]);
        let h1 = horse_of(&mut world, "h1").clone();
        assert_eq!(horses[0]["name"], "Horse h1");
        assert_eq!(horses[0]["stableId"], "stable");
        assert_eq!(
            horses[0]["stats"],
            json!({ "speed": 10.0, "strength": 10.0, "endurance": 10.0 })
        );
        assert_eq!(horses[0]["price"], npc_horse_price(&world, &city, &h1, Some("r1")));
        assert!(horses[0].get("problem").is_none());
    }

    #[test]
    fn says_why_it_wont_sell_one_also_at_low_standing() {
        let (mut world, _) = setup();
        horse_of(&mut world, "h2").down_until = Some(1000.0);
        assert_eq!(
            seen_city(&world, "r1", "npc").unwrap()["horses"][1]["problem"],
            "Horse h2 is Down"
        );
        change_standing(&mut world, "npc", "r1", NPC_CITY_REFUSES_STANDING - 1.0);
        assert_eq!(
            seen_city(&world, "r1", "npc").unwrap()["horses"][0]["problem"],
            "Dunmere won’t trade with you"
        );
    }

    #[test]
    fn lists_nothing_with_its_stable_out_of_sight_its_city_in_sight_through_its_town_hall() {
        let (mut world, _) = setup();
        for r in world.residents.iter_mut().filter(|r| r.owner.as_deref() == Some("r1")) {
            (r.x, r.y) = (230.0, 20.0);
        }
        // On a map 256 tiles across.
        let index = WorldIndex::new(&world, 256);
        let seen = entities_in_sight(&world, &index, Some("r1"), None);
        let city = seen.iter().find(|e| e.id() == "npc").expect("the city in sight");
        assert!(serde_json::to_value(city).unwrap().get("horses").is_none());
    }
}

mod stock_floor {
    use super::*;

    /// A trading post and its warehouse: the generated world's.
    fn post() -> (WorldState, Building) {
        let (world, _, _) = load_world("worlds/generated-1-1024.json");
        let city = world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Post)).unwrap();
        let warehouse = world
            .buildings
            .iter()
            .find(|b| b.kind == BuildingKind::Warehouse && b.city_id.as_ref() == Some(&city.id))
            .unwrap()
            .clone();
        (world, warehouse)
    }

    /// The Trade Org HQ alone on a map, and its coin and goods warehouses (`hq()`).
    fn hq() -> (WorldState, Building, Building) {
        let (world, _, _) = load_world("worlds/hq-0.json");
        let hall = town_hall_of(&world, &world.cities[0]).unwrap().clone();
        let is_coins = |b: &Building| {
            b.x == hall.x + HQ_COIN_WAREHOUSE.0 && b.y == hall.y + HQ_COIN_WAREHOUSE.1
        };
        let warehouses: Vec<Building> =
            world.buildings.iter().filter(|b| b.kind == BuildingKind::Warehouse).cloned().collect();
        let coins = warehouses.iter().find(|b| is_coins(b)).unwrap().clone();
        let goods = warehouses.iter().find(|b| !is_coins(b)).unwrap().clone();
        (world, coins, goods)
    }

    fn floor(g: Good) -> f64 {
        WAREHOUSE_FLOOR.get(good_name(g)).unwrap()
    }

    #[test]
    fn is_every_good_at_a_trading_post_coins_in_the_hq_coin_warehouse_and_the_rest_in_the_other() {
        let (world, warehouse) = post();
        assert_eq!(warehouse_keeps(&world, &warehouse), ALL_GOODS);
        let all: Stock = ALL_GOODS.iter().map(|&g| (g, floor(g))).collect();
        assert_eq!(stock_floor(&world, &warehouse), all);
        let (world, coins, goods) = hq();
        let want: Stock =
            [(Good::Coins, floor(Good::Coins) * HQ_FLOOR_FACTOR)].into_iter().collect();
        assert_eq!(stock_floor(&world, &coins), want);
        let keys: Vec<Good> = stock_floor(&world, &goods).keys().copied().collect();
        assert_eq!(keys, PRICED_GOODS);
        assert_eq!(stock_floor(&world, &goods)[&Good::Wood], floor(Good::Wood) * HQ_FLOOR_FACTOR);
    }

    #[test]
    fn applies_to_trade_org_warehouses_only() {
        let (world, warehouse) = post();
        let storage = world.buildings.iter().find(|b| b.kind == BuildingKind::Storage).unwrap();
        assert!(stock_floor(&world, storage).is_empty());
        // A warehouse whose city is gone belongs to nobody, and nobody else gets a floor.
        assert!(stock_floor(&world, &Building { city_id: None, ..warehouse.clone() }).is_empty());
        let site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
        assert!(stock_floor(&world, &Building { site, ..warehouse }).is_empty());
    }

    fn base(g: Good) -> f64 {
        WAREHOUSE_BASE_PRICE.get(good_name(g)).unwrap()
    }

    #[test]
    fn sell_at_the_base_price_at_the_reference_stock_and_buy_lower() {
        let p = price_for(Good::Iron, 40.0, 10.0);
        assert_eq!(p.sell, base(Good::Iron));
        assert!(p.buy < p.sell);
    }

    #[test]
    fn rise_as_stock_falls_and_fall_as_it_grows_within_their_range() {
        let sells: Vec<f64> = [0.0, 5.0, 10.0, 40.0, 160.0, 10_000.0]
            .iter()
            .map(|&n| price_for(Good::Iron, n, 10.0).sell)
            .collect();
        assert!(sells.windows(2).all(|w| w[1] <= w[0]));
        assert_eq!(sells[0], 4.0 * base(Good::Iron));
        assert_eq!(*sells.last().unwrap(), base(Good::Iron) / 2.0);
    }

    #[test]
    fn always_buy_lower_than_they_sell_in_whole_coins() {
        for good in PRICED_GOODS {
            for stock in [0.0, 1.0, 7.0, 50.0, 999.0, 100_000.0] {
                let p = price_for(good, stock, floor(good));
                assert!(p.buy.fract() == 0.0 && p.sell.fract() == 0.0);
                assert!(p.buy >= 1.0 && p.buy < p.sell);
            }
        }
    }

    #[test]
    fn come_from_each_warehouses_own_stock() {
        let (world, warehouse) = post();
        let iron = |stock: f64| {
            let b = Building {
                stock: Some([(Good::Iron, stock)].into_iter().collect()),
                ..warehouse.clone()
            };
            warehouse_prices(&world, &b).into_iter().find(|x| x.good == Good::Iron).unwrap()
        };
        assert_eq!(iron(1.0).stock, 1.0);
        assert!(iron(1.0).sell > iron(1000.0).sell);
    }

    #[test]
    fn cover_every_good_but_coins_and_none_at_the_hq_coin_warehouse() {
        let goods_of = |world: &WorldState, b: &Building| -> Vec<Good> {
            warehouse_prices(world, b).iter().map(|x| x.good).collect()
        };
        let (world, warehouse) = post();
        assert_eq!(goods_of(&world, &warehouse), PRICED_GOODS);
        let (world, coins, goods) = hq();
        assert!(warehouse_prices(&world, &coins).is_empty());
        assert_eq!(goods_of(&world, &goods), PRICED_GOODS);
    }
}
