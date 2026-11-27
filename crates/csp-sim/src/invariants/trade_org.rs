//! The Trade Org: its cities, army, HQ, directives, debts and punishments.

use std::collections::HashSet;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{BuildingKind, WorldState};

use super::shared::{empty, Out};
use super::{invariant, ledgered, violation, Invariant};

pub(super) const INVARIANTS: &[Invariant] = &[
    ledgered("trade-org-only-buys-food", |w, l| {
        l.offers.map(|o| crate::offers::trade_org_only_buys_food(w, o)).unwrap_or_default()
    }),
    invariant("trade-org-sound", trade_org_sound),
    invariant("nothing-left-of-the-hq", |w, _| crate::hq_fall::nothing_left_of_the_hq(w)),
    invariant("trade-org-army-sound", |w, t| {
        crate::trade_org_army::trade_org_army_sound(w, t.size)
    }),
    invariant("punishments-sound", |w, _| crate::trade_org_punishment::punishments_sound(w)),
    invariant("directives-sound", |w, _| crate::directives::directives_sound(w)),
    ledgered("buy-offs-sound", |w, l| crate::directives::buy_offs_sound(w, l.buy_offs)),
    invariant("buy-off-orders-done", |w, _| crate::directives::buy_off_orders_done(w)),
    invariant("debts-sound", |w, _| crate::trade_org_debt::debts_sound(w)),
    invariant("wrecks-sound", |w, _| crate::trade_org_wrecks::wrecks_sound(w)),
    invariant("cities-taken-sound", |w, _| crate::trade_org_takes::cities_taken_sound(w)),
    invariant("debt-demands-sound", |w, _| crate::trade_org_debt::debt_demands_sound(w)),
    ledgered("debt-payments-sound", |_, l| {
        empty(l.debt_payments, crate::trade_org_debt::debt_payments_sound)
    }),
    invariant("debt-orders-done", |w, _| crate::trade_org_debt::debt_orders_done(w)),
    invariant("hq-rings-sound", crate::hq_growth::hq_rings_sound),
    invariant("trading-posts-have-no-temperament", |w, _t| {
        crate::temperament::trading_posts_have_no_temperament(w)
    }),
    invariant("trade-org-breeds-no-horses", |w, _t| {
        crate::npc_hooks::trade_org_breeds_no_horses(w)
    }),
    invariant("trade-org-sends-no-one", |w, _t| crate::npc_hooks::trade_org_sends_no_one(w)),
];

/// The Trade Organization stays apart (`tradeOrgSound`).
pub fn trade_org_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "trade-org-sound";
    let mut out = Vec::new();
    let mut fail = |id: &str, m: String| out.push(violation(name, m, &[id]));
    let mut trade_org = HashSet::new();
    for c in &world.cities {
        if c.trade_org.is_none() {
            continue;
        }
        trade_org.insert(c.id.as_str());
        if let Some(realm) = &c.realm_id {
            fail(&c.id, format!("Trade Org city {} belongs to realm {realm}", c.id));
        }
    }
    let hqs: Vec<_> = world
        .cities
        .iter()
        .filter(|c| c.trade_org.is_some_and(|t| serde_json::to_value(t).ok() == Some("hq".into())))
        .collect();
    if hqs.len() > 1 {
        fail(&hqs[1].id, format!("the world has {} Trade Org HQs", hqs.len()));
    }
    for b in &world.buildings {
        if let Some(city) = &b.city_id {
            if b.kind == BuildingKind::Warehouse && !trade_org.contains(city.as_str()) {
                fail(&b.id, format!("warehouse {} stands in {city}, not a Trade Org city", b.id));
            }
        }
    }
    out
}
