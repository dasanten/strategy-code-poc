//! Worn prices of [`super`]: a worn piece sells and buys for less, a nearly broken one for much
//! less, priced in the order the units leave their holder.

use csp_shared::balance::{NEARLY_BROKEN_PRICE_SHARE, WORN_PRICE_SHARE};
use csp_shared::world::TradeSide;

use super::*;
use crate::queries::warehouse::price_for;
use crate::queries::warehouse_trade::{quote_at_prices, TradeHolder};
use crate::test_world::{empty_world, resident};

/// Resident a1 keeping `units` Swords, the used ones worn as given (most worn first).
fn keeper(units: f64, worn: &[f64]) -> WorldState {
    let mut world = empty_world();
    let i = resident(&mut world, "a1", None, 5.0, 5.0);
    world.residents[i].carried.insert(Good::Sword, units);
    if !worn.is_empty() {
        world.wear.insert("a1".into(), [(Good::Sword, worn.to_vec())].into_iter().collect());
    }
    world
}

#[test]
fn units_leave_new_first_then_the_least_worn_each_at_its_conditions_share() {
    let world = keeper(4.0, &[0.9, 0.6, 0.1]);
    let shares = leaving_shares(&world, "a1", 4.0, Good::Sword);
    assert_eq!(shares, vec![1.0, 1.0, WORN_PRICE_SHARE, NEARLY_BROKEN_PRICE_SHARE]);
    assert_eq!(leaving_shares(&keeper(3.0, &[]), "a1", 3.0, Good::Sword), Vec::<f64>::new());
    assert_eq!(leaving_shares(&world, "a1", 4.0, Good::Iron), Vec::<f64>::new());
}

#[test]
fn a_worn_price_is_whole_coins_and_at_least_one() {
    assert_eq!(worn_price(20.0, 1.0), 20.0);
    assert_eq!(worn_price(20.0, WORN_PRICE_SHARE), (20.0 * WORN_PRICE_SHARE).floor());
    assert_eq!(worn_price(2.0, NEARLY_BROKEN_PRICE_SHARE), 1.0);
}

#[test]
fn a_worn_sword_sells_for_less_and_a_nearly_broken_one_for_much_less() {
    let sell = |worn: &[f64]| {
        let world = keeper(1.0, worn);
        let shares = leaving_shares(&world, "a1", 1.0, Good::Sword);
        let carried = &world.residents[0].carried;
        let holder = TradeHolder { stock: carried, room: 1e6 };
        let q = quote_at_prices(
            10.0,
            20.0,
            1e6,
            holder,
            TradeSide::Sell,
            Good::Sword,
            1.0,
            0.0,
            f64::INFINITY,
            &shares,
        );
        assert_eq!(q.units, 1.0);
        q.coins
    };
    let new = sell(&[]);
    assert_eq!(new, price_for(Good::Sword, 11.0, 20.0).buy);
    assert_eq!(sell(&[0.3]), new, "still good");
    assert_eq!(sell(&[0.6]), worn_price(new, WORN_PRICE_SHARE));
    assert_eq!(sell(&[0.9]), worn_price(new, NEARLY_BROKEN_PRICE_SHARE));
    assert!(sell(&[0.9]) < sell(&[0.6]) && sell(&[0.6]) < new);
}

#[test]
fn a_worn_sword_buys_for_less_too() {
    // A warehouse keeping two Swords, one new and one worn: the new one goes first.
    let shares = [1.0, WORN_PRICE_SHARE];
    let coins: Stock = [(Good::Coins, 1e6)].into_iter().collect();
    let holder = TradeHolder { stock: &coins, room: 1e6 };
    let q = quote_at_prices(
        2.0,
        20.0,
        0.0,
        holder,
        TradeSide::Buy,
        Good::Sword,
        2.0,
        0.0,
        f64::INFINITY,
        &shares,
    );
    let first = price_for(Good::Sword, 2.0, 20.0).sell;
    let second = price_for(Good::Sword, 1.0, 20.0).sell;
    assert_eq!(q.coins, first + worn_price(second, WORN_PRICE_SHARE));
}

#[test]
fn only_good_pieces_count_as_good_units() {
    let world = keeper(4.0, &[0.9, 0.6, 0.1]);
    assert_eq!(good_units(&world, "a1", 4.0, Good::Sword), 2.0);
    assert_eq!(good_units(&world, "a1", 3.0, Good::Iron), 3.0);
}
