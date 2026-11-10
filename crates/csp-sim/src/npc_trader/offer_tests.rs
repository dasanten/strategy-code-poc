//! `npc-offers.test.ts`: NPC cities at an offer (`CONTEXT.md`): a city sends its trader to a
//! Player's offer in reach that gives what it is short of, for what it has spare or Coins, at a
//! rate at least as good as its own prices. The trader goes by the orders a Player could give.

use csp_shared::balance::{
    NPC_CITY_REFUSES_STANDING, NPC_OFFER_REACH, NPC_VILLAGE, STANDING_NPC_TRADE_COINS_PER_POINT,
    WAREHOUSE_BASE_PRICE,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityTrader, CityTraderOffer, DirectOfferTerms, Good, Offer, Realm,
    Resident, Stock, TraderLeg, WorldState,
};
use serde_json::json;

use crate::events::events_for;
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::{plan_city, plan_due};
use crate::npc_test_world::{plains, Runner};
use crate::offers::{offers_keep_goods, trade_org_only_buys_food, Accepted};
use crate::queries::names::held;
use crate::queries::npc_trade::{npc_city_stock, npc_price_for, npc_reserve, NPC_SMITHY_WEAPON};
use crate::queries::standing::standing_of;
use crate::queries::trade_quotes::{npc_offer_times, OfferTerms};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::test_support::add_city;
use crate::tick::Scratch;
use crate::trading_posts::found_trading_post;
use crate::world::{create_world, step_world};

/// A map too big to wrap inside the reach.
const SIZE: i32 = 2400;
const DAY: usize = TICKS_PER_GAME_DAY as usize;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: String,
    theirs: String,
}

fn find<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).expect("the building")
}

fn stock_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Stock {
    let b = world.buildings.iter_mut().find(|b| b.id == id).expect("the building");
    b.stock.get_or_insert_with(Stock::new)
}

fn held_at(world: &WorldState, id: &str, g: Good) -> f64 {
    find(world, id).stock.as_ref().map_or(0.0, |s| held(s, g))
}

fn reserve_of(world: &WorldState, city: &str) -> Stock {
    npc_reserve(world, world.cities.iter().find(|c| c.id == city).unwrap())
}

/// A village whose storage holds its reserve, 60 Wood and 10 Stone over it, and is short of Iron.
fn village(
    world: &mut WorldState,
    terrain: &TerrainMap,
    x: i32,
    y: i32,
    seed: f64,
) -> (String, String) {
    let mut m = Mulberry32::new(seed);
    let city = found_npc_city(world, terrain, &NPC_VILLAGE, x, y, &mut || m.next(), None);
    let storage = npc_home(world, &city).expect("a storage").id.clone();
    *stock_mut(world, &storage) = Stock::from([(Good::Food, 400.0)]);
    let reserve = reserve_of(world, &city);
    let stock = stock_mut(world, &storage);
    stock.insert(Good::Food, held(&reserve, Good::Food) + 5.0);
    stock.insert(Good::Wood, held(&reserve, Good::Wood) + 60.0);
    stock.insert(Good::Stone, held(&reserve, Good::Stone) + 10.0);
    stock.insert(Good::Coins, held(&reserve, Good::Coins));
    (city, storage)
}

/// Realm r1 (Player 7) with a city and a storage holding plenty of everything.
fn player_storage(world: &mut WorldState, x: f64, y: f64) -> String {
    let realm = json!({ "id": "r1", "userId": 7, "leaderId": "a1" });
    world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    add_city(world, "c1", Some("r1"), x + 8.0, y);
    let storage: Building = serde_json::from_value(json!({
        "id": "s1", "kind": "storage", "cityId": "c1", "x": x, "y": y,
        "stock": { "iron": 100, "wood": 100, "food": 100, "coins": 1000, "spear": 10 },
    }))
    .unwrap();
    world.buildings.push(storage);
    let mut m = Mulberry32::new(1.0);
    let fields =
        NewResident { id: "a1", owner: Some("r1"), city_id: None, x: x + 8.0, y, tick: 0.0 };
    let mut leader: Resident = new_resident(&mut || m.next(), &fields, None);
    leader.city_id = Some("c1".into());
    world.residents.push(leader);
    "s1".into()
}

/// Stands an offer at the storage: "gives", "wants", `times` over.
fn post(
    world: &mut WorldState,
    storage: &str,
    gives: Good,
    gives_units: f64,
    wants: Good,
    wants_units: f64,
    times: f64,
) -> String {
    let b = find(world, storage);
    let id = format!("offer-{}", world.offers.len() + 1);
    let offer = Offer {
        id: id.clone(),
        realm_id: "r1".into(),
        storage_id: storage.into(),
        x: b.x,
        y: b.y,
        gives,
        gives_units,
        wants,
        wants_units,
        times,
        direct: None,
    };
    world.offers.push(offer);
    id
}

/// A village short of Iron and a Player's storage `tiles` east of it.
fn setup_at(tiles: f64) -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    let (city, storage) = village(&mut world, &terrain, 20, 20, 7.0);
    let (x, y) = (find(&world, &storage).x, find(&world, &storage).y);
    let theirs = player_storage(&mut world, x + tiles, y);
    Setup { world, terrain, city, storage, theirs }
}

fn setup() -> Setup {
    setup_at(100.0)
}

impl Setup {
    fn plan(&mut self) -> Option<CityTrader> {
        plan_city(&mut self.world, &self.city, Some(&self.terrain), None, None);
        self.trader()
    }

    fn trader(&self) -> Option<CityTrader> {
        trader_of(&self.world, &self.city)
    }

    fn offer_mut(&mut self, id: &str) -> &mut Offer {
        self.world.offers.iter_mut().find(|o| o.id == id).unwrap()
    }

    fn held(&self, id: &str, g: Good) -> f64 {
        held_at(&self.world, id, g)
    }

    fn stock_mut(&mut self, id: &str) -> &mut Stock {
        stock_mut(&mut self.world, id)
    }

    fn reserve(&self) -> Stock {
        reserve_of(&self.world, &self.city)
    }
}

fn trader_of(world: &WorldState, city: &str) -> Option<CityTrader> {
    world.city_plans.get(city).and_then(|p| p.traders.as_ref()).and_then(|t| t.first()).cloned()
}

/// Runs the world until `done` or `days` pass, checking the invariants each game day.
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    days: usize,
    mut done: impl FnMut(&mut WorldState, &Scratch) -> bool,
) {
    let mut runner = Runner::new(terrain);
    for t in 0..days * DAY {
        runner.step(world, terrain);
        if t % DAY == 0 {
            assert_eq!(check_all(world, terrain), []);
        }
        if done(world, &runner.scratch) {
            break;
        }
    }
    assert_eq!(check_all(world, terrain), []);
}

/// Runs the world until the city has sent its trader and has them home again.
fn until_home(world: &mut WorldState, terrain: &TerrainMap, city: &str, days: usize) -> Resident {
    let mut trader_id: Option<String> = None;
    run(world, terrain, days, |w, _| {
        if trader_id.is_none() {
            trader_id = trader_of(w, city).map(|t| t.resident_id);
        }
        trader_id.is_some() && trader_of(w, city).is_none()
    });
    let id = trader_id.expect("a trader went out");
    assert_eq!(trader_of(world, city), None);
    world.residents.iter().find(|r| r.id == id).unwrap().clone()
}

/// All of a good in the world: in storages, in hands, on carriages.
fn world_holds(world: &WorldState, g: Good) -> f64 {
    let b: f64 = world.buildings.iter().filter_map(|b| b.stock.as_ref()).map(|s| held(s, g)).sum();
    let r: f64 = world.residents.iter().map(|r| held(&r.carried, g)).sum();
    let k: f64 = world.carriages.iter().map(|k| held(&k.load, g)).sum();
    b + r + k
}

fn price(g: &str) -> f64 {
    WAREHOUSE_BASE_PRICE.get(g).unwrap()
}

#[test]
fn sends_its_trader_to_a_good_offer_by_the_plan_as_far_as_it_lacks_the_good() {
    let mut s = setup();
    let offer = post(&mut s.world, &s.theirs.clone(), Good::Iron, 1.0, Good::Wood, 1.0, 50.0);
    let lacks = held(&s.reserve(), Good::Iron) - s.held(&s.storage, Good::Iron);
    assert!(lacks > 0.0);
    let t = s.plan().expect("a trader");
    assert_eq!(t.warehouse_id.as_deref(), Some(s.theirs.as_str()));
    assert_eq!(
        t.offer,
        Some(CityTraderOffer {
            offer_id: offer,
            times: lacks,
            pays: Good::Wood,
            units: lacks,
            leg: TraderLeg::Load,
        })
    );
    let jobs = &s.world.city_plans[&s.city].jobs;
    assert_eq!(serde_json::to_value(&jobs[&t.resident_id]).unwrap(), json!({ "kind": "trade" }));
}

#[test]
fn a_trader_arrives_takes_the_offer_and_brings_the_goods_home_whether_or_not_the_player_is_on() {
    let mut s = setup();
    let offer = post(&mut s.world, &s.theirs.clone(), Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    let iron_there = s.held(&s.theirs, Good::Iron);
    let wood_there = s.held(&s.theirs, Good::Wood);
    let iron_before = s.held(&s.storage, Good::Iron);
    let r = until_home(&mut s.world, &s.terrain, &s.city, 6);
    // The Player's storage has been paid in ordinary goods; the offer is used up.
    assert_eq!(s.held(&s.theirs, Good::Iron), iron_there - 5.0);
    assert_eq!(s.held(&s.theirs, Good::Wood), wood_there + 5.0);
    assert!(!s.world.offers.iter().any(|o| o.id == offer));
    // The Iron is in the city's storage, and nothing of the trade in the trader's arms.
    assert_eq!(s.held(&s.storage, Good::Iron), iron_before + 5.0);
    assert_eq!(held(&r.carried, Good::Iron), 0.0);
    assert_eq!(held(&r.carried, Good::Wood), 0.0);
    // It reads in the realm's log and moves standing like a trade.
    let log: Vec<serde_json::Value> =
        events_for(&s.world, 7, 0).iter().map(|e| serde_json::to_value(e).unwrap()).collect();
    assert!(log.iter().any(|e| e["kind"] == "offerTaken"));
    assert!(log.iter().any(|e| e["kind"] == "offerEnded"));
    // Goods for goods counts both at base prices, by an NPC city's own number.
    let raised = (5.0 * price("iron") + 5.0 * price("wood")) / STANDING_NPC_TRADE_COINS_PER_POINT;
    let standing = standing_of(&s.world, &s.city, "r1");
    assert!(standing <= raised && standing > raised / 2.0, "{standing} of {raised}");
    let taken = log.iter().find(|e| e["kind"] == "offerTaken").unwrap();
    let name = &s.world.cities.iter().find(|c| c.id == s.city).unwrap().name;
    assert_eq!(taken["standing"]["org"], json!(s.city));
    assert_eq!(taken["standing"]["name"], json!(name));
    assert_eq!(taken["standing"]["by"].as_f64(), Some(raised));
}

#[test]
fn ignores_a_rate_worse_than_its_own_prices() {
    let mut s = setup();
    // One Iron for forty Wood: its own prices make that a bad bargain.
    post(&mut s.world, &s.theirs.clone(), Good::Iron, 1.0, Good::Wood, 40.0, 1.0);
    assert_eq!(s.plan(), None);
}

#[test]
fn takes_a_rate_exactly_as_good_as_its_own_prices_not_a_coin_worse() {
    let mut s = setup();
    let buy =
        npc_price_for(Good::Iron, s.held(&s.storage, Good::Iron) + 1.0, &s.reserve(), 0.0).buy;
    let fair = post(&mut s.world, &s.theirs.clone(), Good::Iron, 1.0, Good::Coins, buy, 1.0);
    let times = |s: &Setup, wants_units: f64| {
        let city = s.world.cities.iter().find(|c| c.id == s.city).unwrap();
        let terms = OfferTerms {
            realm_id: "r1",
            gives: Good::Iron,
            gives_units: 1.0,
            wants: Good::Coins,
            wants_units,
        };
        npc_offer_times(&s.world, city, &terms, 1.0)
    };
    assert_eq!(times(&s, buy), 1.0);
    assert_eq!(times(&s, buy + 1.0), 0.0);
    s.offer_mut(&fair).wants_units = buy + 1.0;
    assert_eq!(s.plan(), None);
    s.offer_mut(&fair).wants_units = buy;
    assert_eq!(s.plan().and_then(|t| t.offer).map(|o| o.pays), Some(Good::Coins));
}

#[test]
fn ignores_an_offer_out_of_reach() {
    let mut far = setup_at(NPC_OFFER_REACH + 10.0);
    post(&mut far.world, &far.theirs.clone(), Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    assert_eq!(far.trader(), None);
    assert_eq!(far.plan(), None);
    let mut near = setup_at(NPC_OFFER_REACH - 10.0);
    post(&mut near.world, &near.theirs.clone(), Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    assert!(near.plan().is_some());
}

#[test]
fn leaves_a_direct_offer_alone_it_is_for_its_named_realm() {
    let mut s = setup();
    let offer = post(&mut s.world, &s.theirs.clone(), Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    let lapses_at = s.world.tick as f64 + 1000.0;
    s.offer_mut(&offer).direct =
        Some(DirectOfferTerms { to_id: "r2".into(), lapses_at, carried: None });
    assert_eq!(s.plan(), None);
    s.offer_mut(&offer).direct = None;
    assert_eq!(s.plan().and_then(|t| t.offer).map(|o| o.offer_id), Some(offer));
}

#[test]
fn ignores_goods_it_does_not_lack_and_what_it_has_no_spare_of_to_pay() {
    let mut lacks_nothing = setup();
    let theirs = lacks_nothing.theirs.clone();
    post(&mut lacks_nothing.world, &theirs, Good::Wood, 50.0, Good::Stone, 1.0, 1.0);
    assert_eq!(lacks_nothing.plan(), None);
    let mut no_spare = setup();
    let wood = held(&no_spare.reserve(), Good::Wood);
    let storage = no_spare.storage.clone();
    no_spare.stock_mut(&storage).insert(Good::Wood, wood);
    let theirs = no_spare.theirs.clone();
    post(&mut no_spare.world, &theirs, Good::Iron, 5.0, Good::Wood, 1.0, 1.0);
    assert_eq!(no_spare.plan(), None);
}

#[test]
fn never_goes_for_a_weapon_nor_pays_with_one() {
    let mut gives = setup();
    let storage = gives.storage.clone();
    gives.stock_mut(&storage).insert(Good::Iron, 100.0);
    let theirs = gives.theirs.clone();
    post(&mut gives.world, &theirs, NPC_SMITHY_WEAPON, 1.0, Good::Coins, 1.0, 1.0);
    let city = gives.world.cities.iter().find(|c| c.id == gives.city).unwrap();
    assert_eq!(held(&npc_city_stock(&gives.world, city), NPC_SMITHY_WEAPON), 0.0);
    assert!(held(&gives.reserve(), NPC_SMITHY_WEAPON) > 0.0);
    assert_eq!(gives.plan(), None);
    let mut pays = setup();
    let storage = pays.storage.clone();
    pays.stock_mut(&storage).insert(NPC_SMITHY_WEAPON, 50.0);
    let theirs = pays.theirs.clone();
    post(&mut pays.world, &theirs, Good::Iron, 1.0, NPC_SMITHY_WEAPON, 1.0, 1.0);
    assert_eq!(pays.plan(), None);
}

#[test]
fn pays_in_coins_from_its_war_chest_and_takes_coins_for_what_it_has_spare() {
    let mut buying = setup();
    let theirs = buying.theirs.clone();
    post(&mut buying.world, &theirs, Good::Iron, 1.0, Good::Coins, 1.0, 50.0);
    assert_eq!(buying.plan().and_then(|t| t.offer).map(|o| o.pays), Some(Good::Coins));
    let mut selling = setup();
    let storage = selling.storage.clone();
    let stock = selling.stock_mut(&storage);
    stock.insert(Good::Coins, 0.0);
    stock.insert(Good::Iron, 100.0);
    stock.insert(NPC_SMITHY_WEAPON, 20.0);
    let theirs = selling.theirs.clone();
    post(&mut selling.world, &theirs, Good::Coins, 200.0, Good::Wood, 1.0, 1.0);
    assert_eq!(selling.plan().and_then(|t| t.offer).map(|o| o.pays), Some(Good::Wood));
}

#[test]
fn refuses_a_realm_it_holds_in_low_standing() {
    let mut s = setup();
    post(&mut s.world, &s.theirs.clone(), Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    let city = s.city.clone();
    change_standing(&mut s.world, &city, "r1", NPC_CITY_REFUSES_STANDING - 1.0);
    assert_eq!(s.plan(), None);
}

#[test]
fn goes_for_the_good_it_is_shortest_of_then_the_nearest() {
    let mut s = setup();
    let mut nearer = find(&s.world, &s.theirs).clone();
    nearer.id = "s2".into();
    nearer.x -= 40.0;
    nearer.stock = Some(Stock::from([(Good::Iron, 100.0)]));
    s.world.buildings.push(nearer);
    post(&mut s.world, &s.theirs.clone(), Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    let near = post(&mut s.world, "s2", Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    assert_eq!(s.held(&s.storage, Good::Iron), 0.0);
    assert_eq!(s.plan().and_then(|t| t.offer).map(|o| o.offer_id), Some(near));
}

#[test]
fn looks_only_on_its_planning_hour() {
    let mut s = setup();
    post(&mut s.world, &s.theirs.clone(), Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    let mut runner = Runner::new(&s.terrain);
    while s.trader().is_none() {
        runner.step(&mut s.world, &s.terrain);
        if s.trader().is_some() {
            s.world.tick -= 1;
            assert!(plan_due(&s.world, &s.city));
            s.world.tick += 1;
        }
    }
}

#[test]
fn while_food_runs_short_only_an_offer_that_gives_food_sends_the_trader() {
    let mut wood = setup();
    let storage = wood.storage.clone();
    wood.stock_mut(&storage).insert(Good::Food, 0.0);
    let theirs = wood.theirs.clone();
    post(&mut wood.world, &theirs, Good::Iron, 5.0, Good::Wood, 5.0, 1.0);
    assert_eq!(wood.plan(), None);
    let mut food = setup();
    let storage = food.storage.clone();
    food.stock_mut(&storage).insert(Good::Food, 0.0);
    let theirs = food.theirs.clone();
    post(&mut food.world, &theirs, Good::Food, 10.0, Good::Wood, 5.0, 1.0);
    assert_eq!(food.plan().and_then(|t| t.offer).map(|o| o.pays), Some(Good::Wood));
}

#[test]
fn two_cities_at_one_offer_lose_no_goods_the_second_is_cut_down_and_carries_the_rest_home() {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    let (a, a_storage) = village(&mut world, &terrain, 20, 20, 7.0);
    let (b, b_storage) = village(&mut world, &terrain, 20 + 700, 20, 11.0);
    let (x, y) = (find(&world, &a_storage).x, find(&world, &a_storage).y);
    let theirs = player_storage(&mut world, x + 350.0, y);
    let lacks = held(&reserve_of(&world, &a), Good::Iron) - held_at(&world, &a_storage, Good::Iron);
    assert!(lacks > 1.0);
    // Enough for one of them and one time over for the other; paid in Coins, which nobody uses up.
    let offer = post(&mut world, &theirs, Good::Iron, 1.0, Good::Coins, 2.0, lacks + 1.0);
    let coins = world_holds(&world, Good::Coins);
    let iron_there = held_at(&world, &theirs, Good::Iron);
    let chests =
        held_at(&world, &a_storage, Good::Coins) + held_at(&world, &b_storage, Good::Coins);
    let mut out = false;
    run(&mut world, &terrain, 12, |w, scratch| {
        assert_eq!(offers_keep_goods(&scratch.offers), vec![]);
        assert_eq!(world_holds(w, Good::Coins), coins);
        let plans = [trader_of(w, &a), trader_of(w, &b)];
        out |= plans.iter().all(|t| t.as_ref().is_some_and(|t| t.offer.is_some()));
        out && plans.iter().all(Option::is_none)
    });
    assert!(out);
    // Between them they took the whole offer and no more, and paid for exactly that.
    assert!(!world.offers.iter().any(|o| o.id == offer));
    assert_eq!(held_at(&world, &theirs, Good::Iron), iron_there - (lacks + 1.0));
    assert_eq!(held_at(&world, &theirs, Good::Coins), 1000.0 + 2.0 * (lacks + 1.0));
    // What the second couldn't spend is back in its storage, and in nobody's arms.
    let home = held_at(&world, &a_storage, Good::Coins) + held_at(&world, &b_storage, Good::Coins);
    assert_eq!(home, chests - 2.0 * (lacks + 1.0));
}

#[test]
fn with_the_offer_gone_the_trader_comes_home_with_what_they_took_along() {
    let mut s = setup();
    let offer = post(&mut s.world, &s.theirs.clone(), Good::Iron, 5.0, Good::Coins, 10.0, 1.0);
    let coins = s.held(&s.storage, Good::Coins);
    let city = s.city.clone();
    run(&mut s.world, &s.terrain, 2, |w, _| {
        let walking =
            trader_of(w, &city).and_then(|t| t.offer).is_some_and(|o| o.leg == TraderLeg::Walking);
        if walking {
            w.offers.retain(|o| o.id != offer);
        }
        w.offers.is_empty()
    });
    let r = until_home(&mut s.world, &s.terrain, &s.city, 6);
    assert_eq!(s.held(&s.storage, Good::Coins), coins);
    assert_eq!(held(&r.carried, Good::Coins), 0.0);
    assert_eq!(s.held(&s.theirs, Good::Coins), 1000.0);
}

#[test]
fn with_no_way_to_the_storage_they_carry_the_load_straight_home() {
    let mut s = setup();
    let (x, y) = (find(&s.world, &s.theirs).x as i32, find(&s.world, &s.theirs).y as i32);
    for dx in -2i32..=2 {
        for dy in -2i32..=2 {
            if dx.abs().max(dy.abs()) != 2 {
                continue;
            }
            s.terrain.tiles[((y + dy) * s.terrain.size + x + dx) as usize] = Terrain::Lake as u8;
        }
    }
    post(&mut s.world, &s.theirs.clone(), Good::Iron, 5.0, Good::Coins, 10.0, 1.0);
    let coins = s.held(&s.storage, Good::Coins);
    let r = until_home(&mut s.world, &s.terrain, &s.city, 6);
    assert_eq!(s.held(&s.storage, Good::Coins), coins);
    assert_eq!(held(&r.carried, Good::Coins), 0.0);
    assert_eq!(s.world.offers.len(), 1);
}

#[test]
fn the_trade_organization_sends_nobody_to_an_offer_but_its_army() {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(3.0);
    let post_id = found_trading_post(&mut world, &terrain, 200, 200, None, &mut || m.next());
    let theirs = player_storage(&mut world, 220.0, 200.0);
    let warehouse = world
        .buildings
        .iter_mut()
        .find(|b| {
            b.city_id.as_deref() == Some(post_id.as_str()) && b.kind == BuildingKind::Warehouse
        })
        .unwrap();
    warehouse.stock = Some(Stock::new());
    post(&mut world, &theirs, Good::Wood, 100.0, Good::Coins, 1.0, 1.0);
    plan_city(&mut world, &post_id, Some(&terrain), None, None);
    assert_eq!(trader_of(&world, &post_id), None);
    // And the invariant would say so if one of its residents ever did.
    let mut scratch = Scratch::default();
    step_world(&mut world, &terrain, &mut scratch, None, None);
    assert_eq!(trade_org_only_buys_food(&world, &scratch.offers), vec![]);
    let one =
        world.residents.iter().find(|r| r.city_id.as_deref() == Some(post_id.as_str())).unwrap();
    scratch.offers.records.push(Accepted {
        resident_id: one.id.clone(),
        before: Stock::new(),
        after: Stock::new(),
        food_for_coins: true,
    });
    assert_eq!(trade_org_only_buys_food(&world, &scratch.offers).len(), 1);
}
