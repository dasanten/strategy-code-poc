//! Trade: prices, offers, deliveries, transfers, caravans and traders.

use super::shared::empty;
use super::{invariant, ledgered, Invariant};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("buy-orders-done", |w, _| crate::buying::buy_orders_done(w)),
    invariant("city-prices-sound", |w, _| crate::buying::city_prices_sound(w)),
    invariant("trade-orders-done", |w, _| crate::trading::trade_orders_done(w)),
    ledgered("trades-keep-goods", |_, l| empty(l.trades, crate::trading::trades_keep_goods)),
    ledgered("refused-trade-nothing", |_, l| {
        empty(l.trades, crate::trading::refused_trade_nothing)
    }),
    ledgered("npc-horse-sales-keep-pair", |_, l| {
        empty(l.trades, crate::trading::npc_horse_sales_keep_pair)
    }),
    ledgered("npc-horse-purchases-wanted", |_, l| {
        empty(l.trades, crate::trading::npc_horse_purchases_wanted)
    }),
    ledgered("npc-trades-keep-reserve", |_, l| {
        empty(l.trades, crate::trading::npc_trades_keep_reserve)
    }),
    invariant("offers-sound", |w, _| crate::offers::offers_sound(w)),
    ledgered("offers-keep-goods", |_, l| empty(l.offers, crate::offers::offers_keep_goods)),
    invariant("accept-orders-done", |w, _| crate::offers::accept_orders_done(w)),
    invariant("deliveries-sound", |w, _| crate::deliveries::deliveries_sound(w)),
    invariant("transfers-sound", |w, _| crate::transfers::transfers_sound(w)),
    invariant("caravans-sound", |w, t| crate::caravans::caravans_sound(w, t.size)),
    invariant("traders-sound", crate::traders::traders_sound),
    invariant("trader-stops-sound", |w, _| crate::trader_stops::trader_stops_sound(w)),
    ledgered("trader-trades-keep-food", |_, l| {
        empty(l.trades, crate::trading::trader_trades_keep_food)
    }),
    invariant("route-robberies-sound", |w, _| crate::caravans::route_robberies_sound(w)),
];
