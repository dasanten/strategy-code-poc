//! Armies, contracts and the Trade Organization's army.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeOrgArmy {
    /// Soldiers the HQ arms from its own adults: half of the residents it starts with.
    pub size: f64,
    /// Adults the HQ keeps at work and never arms: its farms, workplaces and some spare.
    pub workers: f64,
    /// Soldiers that always stay at the HQ: it never hires out more than the rest.
    pub guard: f64,
    /// What it asks for each soldier and game week, in coins: about a spear's price each seven real hours.
    pub price_per_soldier_week: f64,
    /// It has lost too many once its soldiers, the adults it could still arm and its mercenaries
    /// are fewer than this share of `size`.
    pub hire_below: f64,
    /// What it offers for each mercenary and game week, in coins: less than it asks itself.
    pub hire_price_per_soldier_week: f64,
    /// How long it hires mercenaries for, in game days: 14 real hours.
    pub hire_days: f64,
    /// The HQ keeps at least this many times the strongest Organization's armed residents as
    /// soldiers (`CONTEXT.md`: Trade Org HQ), and `size` at the least: a little more than any
    /// Player can bring.
    pub strongest_multiple: f64,
    /// The HQ closes its outer gates while more armed outsiders than this share of its soldiers at
    /// home stand near it (`CONTEXT.md`: Trade Org HQ): half, so it can still drive them off.
    pub gate_share: f64,
    /// How near to one of the HQ's outer gates, in tiles, an armed outsider counts as near it, as
    /// well as anywhere in its area: as for an NPC city (`NPC_GATE_WATCH_RANGE`).
    pub gate_watch_range: f64,
}

balance! {
/// How many tiles further along an army's way a member may get than the one furthest behind
/// (`CONTEXT.md`: Army): one ahead waits, so the army keeps together at the pace of the slowest.
pub const ARMY_SPREAD: f64 = 4.0;

/// The longest a mercenary contract may run, in game days (`CONTEXT.md`: Mercenary contract): two
/// real days, so a contract is a campaign, not a permanent transfer of residents.
pub const CONTRACT_MAX_DAYS: f64 = 120.0;

/// The Trade Org army (`CONTEXT.md`: Trade Org army).
pub const TRADE_ORG_ARMY: TradeOrgArmy = TradeOrgArmy {
    size: 16.0,
    workers: 12.0,
    guard: 8.0,
    price_per_soldier_week: 8.0,
    hire_below: 0.6,
    hire_price_per_soldier_week: 5.0,
    hire_days: 35.0,
    strongest_multiple: 1.5,
    gate_share: 0.5,
    gate_watch_range: 32.0,
};
}
