//! `coin-sums.test.ts`: the sums behind Coins (`CONTEXT.md`: Coins, Mint, Buying a city, Price
//! anchor), for one full gold mine and the mint that strikes all it digs, with average workers of
//! no skill. Balance numbers only, so no game time.

use csp_shared::balance::Recipe;
use csp_shared::balance::{
    NpcCitySize, BATCHES_PER_DAY, BUY_SHARE, CARRY_BASE, CARRY_PER_STRENGTH,
    CITY_PRICE_PER_RESIDENT, DIRECTIVE_BUY_OFF_PRICE, DIRECTIVE_PUNISH_WORTH, GOOD_WEIGHT,
    NPC_TOWN, NPC_VILLAGE, RECIPES, TRADE_ORG_LOSS, TRADE_ORG_PUNISH, WAREHOUSE_BASE_PRICE,
    WORKPLACE_MAX_WORKERS, WORKPLACE_WRECK_WORTH, WORK_OUTPUT_PER_DAY, WORK_STRENGTH_AVERAGE,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_sim::npc_cities::found_npc_city;
use csp_sim::queries::city::city_price;
use csp_sim::random::Mulberry32;
use csp_sim::world::create_world;

fn miners() -> f64 {
    WORKPLACE_MAX_WORKERS.get("mine").unwrap()
}

fn minters() -> f64 {
    WORKPLACE_MAX_WORKERS.get("mint").unwrap()
}

fn recipe() -> &'static Recipe {
    &RECIPES.get("mint").unwrap()[0]
}

fn ore_per_day() -> f64 {
    miners() * WORK_OUTPUT_PER_DAY.get("goldOre").unwrap()
}

fn coins_per_day() -> f64 {
    ore_per_day() * recipe().output.get("coins").unwrap()
}

fn coins_per_worker_day() -> f64 {
    coins_per_day() / (miners() + minters())
}

/// What a resident of average Strength can carry, in kg.
fn average_hands() -> f64 {
    CARRY_BASE + WORK_STRENGTH_AVERAGE * CARRY_PER_STRENGTH
}

/// What one worker's output of a good fetches in a game day, sold to a warehouse at its base
/// price.
fn sold_per_worker_day(good: &str) -> f64 {
    WORK_OUTPUT_PER_DAY.get(good).unwrap() * WAREHOUSE_BASE_PRICE.get(good).unwrap() * BUY_SHARE
}

/// A newly founded NPC city's price, in Coins.
fn price_of(kind: &NpcCitySize) -> f64 {
    let terrain = TerrainMap { size: 200, tiles: vec![Terrain::Plains as u8; 200 * 200] };
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let id = found_npc_city(&mut world, &terrain, kind, 60, 60, &mut || m.next(), None);
    let city = world.cities.iter().find(|c| c.id == id).unwrap();
    city_price(&world, city, None)
}

fn close_to(a: f64, b: f64, digits: i32) -> bool {
    (a - b).abs() < 10f64.powi(-digits) / 2.0
}

// what a gold mine makes

#[test]
fn has_its_mint_strike_all_its_ore_80_coins_a_game_day() {
    let input = recipe().input.get("goldOre").unwrap();
    assert_eq!(minters() * BATCHES_PER_DAY.get("mint").unwrap() * input, ore_per_day());
    assert_eq!(coins_per_day(), 80.0);
}

#[test]
fn pays_each_worker_a_little_better_than_wood_or_iron_ore_sold() {
    assert!(close_to(coins_per_worker_day(), 6.67, 2));
    assert!(close_to(sold_per_worker_day("wood"), 4.8, 2));
    assert!(close_to(sold_per_worker_day("ironOre"), 4.8, 2));
    assert!(coins_per_worker_day() / sold_per_worker_day("wood") > 1.0);
    assert!(coins_per_worker_day() / sold_per_worker_day("wood") < 1.5);
}

#[test]
fn makes_gold_ore_worth_less_at_a_warehouse_than_what_the_mint_strikes_from_it() {
    let struck = recipe().output.get("coins").unwrap() / recipe().input.get("goldOre").unwrap();
    assert!(WAREHOUSE_BASE_PRICE.get("goldOre").unwrap() < struck);
    assert!(close_to(sold_per_worker_day("goldOre"), sold_per_worker_day("wood"), 2));
}

// what a city costs in days of one full gold mine

#[test]
fn asks_five_days_for_a_resident() {
    assert_eq!(CITY_PRICE_PER_RESIDENT / coins_per_day(), 5.0);
}

#[test]
fn asks_about_35_days_for_a_village_and_three_of_its_residents_can_carry_the_coins() {
    let price = price_of(&NPC_VILLAGE);
    assert!(price / coins_per_day() > 33.0);
    assert!(price / coins_per_day() < 37.0);
    assert!(price * GOOD_WEIGHT.get("coins").unwrap() < 3.0 * average_hands());
}

#[test]
fn asks_about_90_days_for_a_town() {
    let days = price_of(&NPC_TOWN) / coins_per_day();
    assert!(days > 85.0 && days < 95.0, "{days}");
}

// what is reckoned from a resident in a city's price

#[test]
fn counts_a_killing_as_one() {
    assert_eq!(TRADE_ORG_LOSS.killing, CITY_PRICE_PER_RESIDENT);
}

#[test]
fn takes_as_much_for_an_admin_directive_as_for_a_killing() {
    assert_eq!(DIRECTIVE_PUNISH_WORTH, TRADE_ORG_PUNISH.times * TRADE_ORG_LOSS.killing);
}

#[test]
fn offers_to_be_bought_off_for_what_an_average_residents_hands_can_bring() {
    assert!(DIRECTIVE_BUY_OFF_PRICE * GOOD_WEIGHT.get("coins").unwrap() <= average_hands());
    const { assert!(DIRECTIVE_BUY_OFF_PRICE > DIRECTIVE_PUNISH_WORTH) };
}

#[test]
fn has_a_debt_for_a_killing_take_at_most_four_workplaces() {
    let debt = TRADE_ORG_PUNISH.times * TRADE_ORG_LOSS.killing;
    for (_, worth) in WORKPLACE_WRECK_WORTH.0 {
        assert!(debt / worth <= 4.0);
    }
}
