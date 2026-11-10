//! `apps/server/src/horse-market-selling.test.ts`, ported (T86.17): selling a horse at an NPC
//! city's stable (`CONTEXT.md`: Horse market): what it pays, the Coins and the horse both moving,
//! and each reason it won't go.

mod build_common;

use build_common::*;
use csp_shared::balance::{
    CITY_PRICE_STANDING_SWING, HORSE_PRICE_BASE, HORSE_PRICE_PAID_SHARE, MAX_HUNGER,
    NPC_CITY_REFUSES_STANDING, STANDING_RANGE, STANDING_TRADE_COINS_PER_POINT,
};
use csp_shared::protocol::SeenEntity;
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{
    Building, BuildingKind, Carriage, City, ConstructionSite, ContractSide, Good, Horse,
    HorseStats, KeptBreeding, MercenaryContract, RealmEventWhat, Resident, ResidentOrder, Stock,
    WorldState,
};
use csp_sim::last_seen::{refresh_last_seen, LastSeenState};
use csp_sim::queries::horse_market::{
    horse_stock_factor, npc_horse_buy_price, npc_horse_price, npc_horses_of,
};
use csp_sim::queries::js_round;
use csp_sim::queries::npc_trade::npc_horses_wanted;
use csp_sim::queries::residents::{carry_capacity, good_weight};
use csp_sim::queries::standing::standing_of;
use csp_sim::sight::entities_in_sight;
use csp_sim::standing::change_standing;
use csp_sim::tick::Scratch;
use csp_sim::trading::npc_horse_purchases_wanted;
use csp_sim::world::{create_world, step_world};
use csp_sim::world_index::WorldIndex;
use serde_json::{json, Value};

const SIZE: i32 = 64;
const ADULT: f64 = -20.0 * 24.0 * 3600.0;

/// Average stats, born at the world's start, of the realm r1.
fn horse(id: &str, x: f64, y: f64) -> Horse {
    Horse {
        id: id.into(),
        name: format!("Horse {id}"),
        realm_id: Some("r1".into()),
        city_id: None,
        x,
        y,
        hunger: 100.0,
        health: 100.0,
        stats: HorseStats { speed: 10.0, strength: 10.0, endurance: 10.0 },
        born_at: 0.0,
        down_until: None,
    }
}

/// An NPC city's own horse.
fn own(id: &str, x: f64, y: f64) -> Horse {
    Horse { realm_id: None, city_id: Some("npc".into()), ..horse(id, x, y) }
}

fn add(world: &mut WorldState, id: &str, owner: Option<&str>, x: f64, y: f64, city: Option<&str>) {
    let mut r = new_resident(id, owner, x, y);
    r.city_id = city.map(str::to_string);
    r.born_at = ADULT;
    r.lifespan = 60.0;
    world.residents.push(r);
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    orders: Orders,
    scratch: Scratch,
}

/// Realm r1 (Player 7, Leader a1 far away) and the NPC city npc: its town hall at (20, 20), a
/// storage at (23, 20) with 500 Coins and a stable at (30, 20) with two horses of its own, where
/// n1 to n6 live. It wants four. r1's p1 stands in the stable with their horse mine.
fn setup() -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    world.realms.push(realm("r1", 7, "a1"));
    add_city(&mut world, "npc", None, 20.0, 20.0);
    world.cities[0].name = "Dunmere".into();
    let mut store = building("store", BuildingKind::Storage, 23.0, 20.0);
    store.city_id = Some("npc".into());
    store.stock = Some(stock(&[(Good::Coins, 500.0)]));
    let mut stable = building("stable", BuildingKind::Stable, 30.0, 20.0);
    stable.city_id = Some("npc".into());
    stable.stock = Some(stock(&[(Good::Food, 500.0)]));
    world.buildings.push(store);
    world.buildings.push(stable);
    add(&mut world, "a1", Some("r1"), 50.0, 50.0, None);
    for i in 1..=6 {
        add(&mut world, &format!("n{i}"), None, 20.0, 21.0, Some("npc"));
    }
    world.horses.push(own("h1", 31.0, 21.0));
    world.horses.push(own("h2", 31.0, 21.0));
    world.horses.push(horse("mine", 31.0, 21.0));
    add(&mut world, "p1", Some("r1"), 31.0, 21.0, None);
    Setup { world, terrain, orders: Orders::default(), scratch: Scratch::default() }
}

impl Setup {
    fn city(&self) -> City {
        self.world.cities.iter().find(|c| c.id == "npc").unwrap().clone()
    }

    fn horse(&self, id: &str) -> &Horse {
        self.world.horses.iter().find(|h| h.id == id).unwrap()
    }

    fn horse_mut(&mut self, id: &str) -> &mut Horse {
        self.world.horses.iter_mut().find(|h| h.id == id).unwrap()
    }

    fn p1(&mut self) -> &mut Resident {
        at(&mut self.world, "p1")
    }

    fn building(&mut self, id: &str) -> &mut Building {
        self.world.buildings.iter_mut().find(|b| b.id == id).unwrap()
    }

    fn coins_of(&mut self, id: &str) -> Option<f64> {
        self.building(id).stock.as_ref().and_then(|s| s.get(&Good::Coins)).copied()
    }

    fn set_coins(&mut self, id: &str, n: f64) {
        self.building(id).stock.as_mut().unwrap().insert(Good::Coins, n);
    }

    /// What the city pays for a horse of r1's.
    fn pays(&self, id: &str) -> f64 {
        npc_horse_buy_price(&self.world, &self.city(), self.horse(id), Some("r1"))
    }

    /// Sends an order from the Player, applies it and answers whether it was taken.
    fn order(&mut self, o: Value) -> Result<(), String> {
        let answer = self.orders.receive(&self.world, &player(7), o, &self.terrain);
        self.orders.apply_all(&mut self.world, &self.terrain);
        answer
    }

    fn sell(&mut self) -> Result<(), String> {
        self.sell_horse("mine")
    }

    fn sell_horse(&mut self, horse_id: &str) -> Result<(), String> {
        self.order(json!({ "kind": "sellHorse", "residentId": "p1", "horseId": horse_id }))
    }

    /// Steps the world once, keeping everyone fed, and checks every invariant.
    fn run(&mut self) {
        for r in &mut self.world.residents {
            r.hunger = MAX_HUNGER;
        }
        step_world(&mut self.world, &self.terrain, &mut self.scratch, None, None);
        assert_sound(&self.world, &self.terrain);
    }

    fn has(&self) -> f64 {
        npc_horses_of(&self.world, &self.city()).len() as f64
    }

    fn sold_events(&self) -> Vec<RealmEventWhat> {
        self.world
            .events
            .iter()
            .filter(|e| matches!(e.what, RealmEventWhat::HorseSold { .. }))
            .map(|e| e.what.clone())
            .collect()
    }

    fn seen_city_horses(&self) -> Option<Vec<csp_shared::world::horse_market::NpcHorseOffer>> {
        let index = WorldIndex::new(&self.world, SIZE);
        let seen = entities_in_sight(&self.world, &index, Some("r1"), None);
        seen.iter()
            .find_map(|e| match e {
                SeenEntity::City(c) if c.city.id == "npc" => Some(c.horses_to_sell.clone()),
                _ => None,
            })
            .expect("the city in sight")
    }
}

#[track_caller]
fn refused(answer: Result<(), String>, reason: &str) {
    assert_eq!(answer, Err(reason.to_string()));
}

mod what_an_npc_city_pays_for_a_horse {
    use super::*;

    #[test]
    fn is_its_share_of_what_it_would_ask_with_that_horse_among_its_own() {
        let s = setup();
        let stock = horse_stock_factor(s.has() + 1.0, npc_horses_wanted(&s.world, &s.city()));
        assert_eq!(s.pays("mine"), js_round(HORSE_PRICE_BASE * stock * HORSE_PRICE_PAID_SHARE));
    }

    #[test]
    fn follows_its_stats_and_age() {
        let s = setup();
        let h = s.horse("mine").clone();
        let average = npc_horse_buy_price(&s.world, &s.city(), &h, Some("r1"));
        let good = Horse { stats: HorseStats { speed: 15.0, strength: 15.0, endurance: 15.0 }, ..h.clone() };
        assert!(npc_horse_buy_price(&s.world, &s.city(), &good, Some("r1")) > average);
        let old = Horse { born_at: -10.0 * TICKS_PER_GAME_YEAR, ..h };
        assert!(npc_horse_buy_price(&s.world, &s.city(), &old, Some("r1")) < average);
    }

    #[test]
    fn is_more_with_fewer_horses_and_moved_by_its_standing_the_other_way_from_what_it_asks() {
        let mut s = setup();
        let with_two = s.pays("mine");
        s.world.horses.push(own("h3", 31.0, 21.0));
        assert!(s.pays("mine") < with_two);
        s.world.horses.retain(|x| x.id != "h3");

        change_standing(&mut s.world, "npc", "r1", 10.0);
        let swing = (CITY_PRICE_STANDING_SWING * 10.0) / STANDING_RANGE;
        let stock = horse_stock_factor(s.has() + 1.0, npc_horses_wanted(&s.world, &s.city()));
        assert_eq!(
            s.pays("mine"),
            js_round(HORSE_PRICE_BASE * stock * HORSE_PRICE_PAID_SHARE * (1.0 + swing))
        );
        change_standing(&mut s.world, "npc", "r1", -30.0);
        assert!(s.pays("mine") < with_two);
    }

    #[test]
    fn is_always_less_than_it_would_ask_for_that_horse_back_at_any_standing() {
        for standing in [-40.0, 0.0, 25.0, 50.0, 100.0] {
            let mut s = setup();
            change_standing(&mut s.world, "npc", "r1", standing);
            let pays = s.pays("mine");
            let mut h = s.horse("mine").clone();
            (h.realm_id, h.city_id) = (None, Some("npc".into()));
            assert!(npc_horse_price(&s.world, &s.city(), &h, Some("r1")) > pays, "at {standing}");
        }
    }
}

mod selling_a_horse {
    use super::*;

    #[test]
    fn moves_the_coins_into_their_hands_and_the_horse_to_the_city_and_nothing_else() {
        let mut s = setup();
        let price = s.pays("mine");
        let horses = s.world.horses.len();

        assert_eq!(s.sell(), Ok(()));
        s.run();

        let h = s.horse("mine").clone();
        assert_eq!(h.realm_id, None);
        assert_eq!(h.city_id.as_deref(), Some("npc"));
        assert_eq!((h.x, h.y), (31.0, 21.0));
        assert_eq!(s.p1().carried.get(&Good::Coins).copied(), Some(price));
        assert_eq!(s.coins_of("store"), Some(500.0 - price));
        assert_eq!(s.world.horses.len(), horses);
        assert_eq!(s.has(), 3.0);
        assert!(s.p1().order.is_none());
        close(standing_of(&s.world, "npc", "r1"), price / STANDING_TRADE_COINS_PER_POINT);
        close(standing_of(&s.world, "r1", "npc"), price / STANDING_TRADE_COINS_PER_POINT);
        let name = s.p1().name.clone();
        match s.sold_events().as_slice() {
            [RealmEventWhat::HorseSold { name: n, horse, city, coins, .. }] => {
                assert_eq!((n, horse.as_str(), city.as_str(), *coins), (&name, "Horse mine", "Dunmere", price));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn takes_the_coins_from_all_its_storages() {
        let mut s = setup();
        let price = s.pays("mine");
        s.set_coins("store", price - 1.0);
        let mut second = building("store2", BuildingKind::Storage, 26.0, 20.0);
        second.city_id = Some("npc".into());
        second.stock = Some(stock(&[(Good::Coins, 5.0)]));
        s.world.buildings.push(second);
        assert_eq!(s.sell(), Ok(()));
        s.run();
        assert_eq!(s.p1().carried.get(&Good::Coins).copied(), Some(price));
        assert_eq!(s.coins_of("store"), None);
        assert_eq!(s.coins_of("store2"), Some(4.0));
    }

    #[test]
    fn comes_after_riding_the_horse_in_and_getting_off() {
        let mut s = setup();
        s.p1().riding = Some("mine".into());
        let name = s.p1().name.clone();
        refused(s.sell(), &format!("{name} has to get off Horse mine first"));
        assert_eq!(s.order(json!({ "kind": "dismount", "residentId": "p1" })), Ok(()));
        assert_eq!(s.p1().riding, None);
        assert_eq!(s.sell(), Ok(()));
        s.run();
        assert_eq!(s.horse("mine").city_id.as_deref(), Some("npc"));
    }

    #[test]
    fn takes_a_stolen_horse_like_any_other() {
        let mut s = setup();
        s.world.realms.push(realm("r2", 8, "b1"));
        add(&mut s.world, "b1", Some("r2"), 55.0, 55.0, None);
        s.world.horses.push(Horse { realm_id: Some("r2".into()), ..horse("theirs", 31.0, 21.0) });
        assert_eq!(
            s.order(json!({ "kind": "mount", "residentId": "p1", "horseId": "theirs" })),
            Ok(())
        );
        assert_eq!(s.horse("theirs").realm_id.as_deref(), Some("r1"));
        let _ = s.order(json!({ "kind": "dismount", "residentId": "p1" }));
        let price = s.pays("theirs");
        assert_eq!(s.sell_horse("theirs"), Ok(()));
        s.run();
        assert_eq!(s.horse("theirs").city_id.as_deref(), Some("npc"));
        assert_eq!(s.p1().carried.get(&Good::Coins).copied(), Some(price));
    }

    #[test]
    fn takes_a_hired_residents_sale_for_the_hirers_horse_the_coins_in_their_hands() {
        let mut s = setup();
        s.p1().owner = None;
        s.p1().city_id = Some("npc".into());
        s.world.contracts.push(MercenaryContract {
            id: "c1".into(),
            lender_id: "npc".into(),
            hirer_id: "r1".into(),
            offered_by: ContractSide::Hirer,
            resident_ids: vec!["p1".into()],
            days: 7.0,
            price_per_week: 1.0,
            storage_id: "store".into(),
            started_at: Some(0.0),
            paid_weeks: 0.0,
        });
        let price = s.pays("mine");
        assert_eq!(s.sell(), Ok(()));
        s.run();
        assert_eq!(s.horse("mine").city_id.as_deref(), Some("npc"));
        assert_eq!(s.p1().carried.get(&Good::Coins).copied(), Some(price));
    }

    #[test]
    fn ends_the_breeding_the_horse_was_part_of() {
        let mut s = setup();
        s.world.horses.push(horse("mate", 31.0, 21.0));
        add(&mut s.world, "p2", Some("r1"), 31.0, 21.0, None);
        at(&mut s.world, "p2").order = Some(
            serde_json::from_value::<ResidentOrder>(json!({
                "kind": "breed", "stableId": "stable", "horseIds": ["mine", "mate"],
                "at": { "x": 31, "y": 21 }, "progress": 5
            }))
            .unwrap(),
        );
        s.building("stable").breedings =
            Some(vec![KeptBreeding { horse_ids: ["mine".into(), "mate".into()], progress: 5.0 }]);
        assert_eq!(s.sell(), Ok(()));
        s.run();
        assert!(!matches!(at(&mut s.world, "p2").order, Some(ResidentOrder::Breed(_))));
        assert_eq!(s.building("stable").breedings, None);
    }

    #[test]
    fn tells_why_it_didnt_go_when_something_came_in_the_way_before_the_tick() {
        let mut s = setup();
        assert_eq!(s.sell(), Ok(()));
        s.set_coins("store", 1.0);
        s.run();
        assert_eq!(s.horse("mine").realm_id.as_deref(), Some("r1"));
        assert_eq!(s.p1().carried.get(&Good::Coins), None);
        assert_eq!(s.coins_of("store"), Some(1.0));
        assert!(s.p1().order.is_none());
        match s.sold_events().as_slice() {
            [RealmEventWhat::HorseSold { coins, problem, .. }] => {
                assert_eq!(*coins, 0.0);
                assert_eq!(problem.as_deref(), Some("Dunmere hasn’t the coins for Horse mine"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_invariant_catches_a_sale_to_a_city_that_wanted_no_more() {
        let mut s = setup();
        assert_eq!(s.sell(), Ok(()));
        s.run();
        assert_eq!(npc_horse_purchases_wanted(&s.scratch.trades), vec![]);
        s.scratch.trades.records[0].wanted = Some(false);
        assert_eq!(npc_horse_purchases_wanted(&s.scratch.trades).len(), 1);
    }
}

mod refusing_to_buy_a_horse {
    use super::*;

    #[test]
    fn when_it_wants_no_more() {
        let mut s = setup();
        s.world.horses.push(own("h3", 31.0, 21.0));
        s.world.horses.push(own("h4", 31.0, 21.0));
        assert_eq!(s.has(), npc_horses_wanted(&s.world, &s.city()));
        refused(s.sell(), "Dunmere has all the horses it wants");
    }

    #[test]
    fn when_its_storages_lack_the_coins() {
        let mut s = setup();
        let price = s.pays("mine");
        s.set_coins("store", price - 1.0);
        refused(s.sell(), "Dunmere hasn’t the coins for Horse mine");
        s.set_coins("store", price);
        assert_eq!(s.sell(), Ok(()));
    }

    #[test]
    fn when_the_resident_cant_carry_the_coins_whole() {
        let mut s = setup();
        let price = s.pays("mine");
        let tick = s.world.tick as f64;
        let capacity = carry_capacity(s.p1(), tick);
        // Room for one Coin less than the price.
        let wood = (capacity - (price - 1.0) * good_weight(Good::Coins)) / good_weight(Good::Wood);
        s.p1().carried = stock(&[(Good::Wood, wood)]);
        refused(s.sell(), &format!("they can’t carry the {price} coins"));
        // Room for exactly the price.
        let wood = (capacity - price * good_weight(Good::Coins)) / good_weight(Good::Wood);
        s.p1().carried = stock(&[(Good::Wood, wood)]);
        assert_eq!(s.sell(), Ok(()));
    }

    #[test]
    fn a_hitched_horse() {
        let mut s = setup();
        s.world.carriages.push(Carriage {
            id: "k1".into(),
            realm_id: Some("r1".into()),
            city_id: None,
            x: 31.0,
            y: 21.0,
            horse_id: Some("mine".into()),
            load: Stock::new(),
        });
        refused(s.sell(), "Horse mine is hitched to a carriage");
    }

    #[test]
    fn a_down_horse() {
        let mut s = setup();
        s.horse_mut("mine").down_until = Some(1000.0);
        refused(s.sell(), "Horse mine is Down");
    }

    #[test]
    fn at_low_standing() {
        let mut s = setup();
        change_standing(&mut s.world, "npc", "r1", NPC_CITY_REFUSES_STANDING - 1.0);
        refused(s.sell(), "Dunmere won’t trade with you");
    }

    #[test]
    fn from_a_child_someone_elsewhere_or_for_a_horse_not_theirs_or_not_in_the_stable() {
        let mut s = setup();
        s.p1().born_at = s.world.tick as f64;
        refused(s.sell(), "children can’t trade");
        s.p1().born_at = ADULT;
        refused(s.sell_horse("nope"), "no such horse");
        refused(s.sell_horse("h1"), "not a horse of your realm");
        s.p1().x = 40.0;
        refused(s.sell(), "not at an NPC city’s stable with that horse");
        s.p1().x = 31.0;
        s.horse_mut("mine").x = 45.0;
        refused(s.sell(), "not at an NPC city’s stable with that horse");
    }

    #[test]
    fn at_an_unfinished_stable_or_a_players() {
        let mut s = setup();
        s.building("stable").site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
        refused(s.sell(), "not at an NPC city’s stable with that horse");
        s.building("stable").site = None;
        s.world.cities.iter_mut().find(|c| c.id == "npc").unwrap().realm_id = Some("r2".into());
        refused(s.sell(), "not at an NPC city’s stable with that horse");
    }
}

mod what_a_player_sees_of_their_horses_there {
    use super::*;

    #[test]
    fn lists_theirs_in_its_stable_with_what_it_pays() {
        let s = setup();
        let offers = s.seen_city_horses().expect("horses to sell");
        let ids: Vec<&str> = offers.iter().map(|h| h.horse_id.as_str()).collect();
        assert_eq!(ids, vec!["mine"]);
        assert_eq!(offers[0].name, "Horse mine");
        assert_eq!(offers[0].stable_id, "stable");
        assert_eq!(offers[0].price, s.pays("mine"));
        assert_eq!(offers[0].problem, None);
    }

    #[test]
    fn says_why_it_wont_buy_one_also_at_low_standing() {
        let mut s = setup();
        s.p1().riding = Some("mine".into());
        let name = s.p1().name.clone();
        assert_eq!(
            s.seen_city_horses().unwrap()[0].problem.as_deref(),
            Some(format!("{name} has to get off Horse mine first").as_str())
        );
        s.p1().riding = None;
        change_standing(&mut s.world, "npc", "r1", NPC_CITY_REFUSES_STANDING - 1.0);
        assert_eq!(
            s.seen_city_horses().unwrap()[0].problem.as_deref(),
            Some("Dunmere won’t trade with you")
        );
    }

    #[test]
    fn lists_none_once_sold_and_none_with_no_horse_of_theirs_there() {
        let mut s = setup();
        assert_eq!(s.sell(), Ok(()));
        s.run();
        assert_eq!(s.seen_city_horses(), None);
    }

    #[test]
    fn isnt_remembered_once_out_of_sight() {
        let mut s = setup();
        let mut state = LastSeenState::default();
        let mut index = None;
        refresh_last_seen(&mut s.world, SIZE, &["r1".to_string()], &mut state, &mut index, None);
        let remembered = s
            .world
            .last_seen
            .get(&7)
            .into_iter()
            .flatten()
            .map(|e| serde_json::to_value(e).unwrap())
            .find(|e| e["id"] == "npc")
            .expect("the city is remembered");
        assert!(remembered.get("horsesToSell").is_none(), "{remembered}");
    }
}
