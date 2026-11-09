//! Demands (`apps/server/src/demands.ts`, `CONTEXT.md`: Demand; ADR 0024): so far only what the
//! Trade Organization's debts need (T86.9): its demands for a debt and for a captured post, and its
//! next step on a debt. The rest of `demands.ts` (sending, answering, stepping demands and their
//! invariant) is named by no ticket yet; `world.rs` keeps its stand-ins.

use csp_shared::balance::TRADE_ORG_DEBT_DEMAND_DAYS;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    City, DebtStep, DebtWhat, Demand, DemandOtherIs, DemandTerms, DemandWhat, RealmEventWhat,
    Stock, WorldState,
};

use crate::events::record_event;
use crate::goods_deps::new_id;
use crate::queries::alliance::realm_name;
use crate::queries::names::good_of;
use crate::queries::standing::{organization_label, TRADE_ORG};

/// Who answers a demand to `id` in the game's stead (`answeredByGame`): the Trade Organization, or
/// an NPC city.
fn answered_by_game(world: &WorldState, id: &str) -> Option<DemandOtherIs> {
    if id == TRADE_ORG {
        return Some(DemandOtherIs::TradeOrg);
    }
    world.cities.iter().any(|c| c.id == id).then_some(DemandOtherIs::City)
}

/// An event about the demand for both its sides (`tellBoth`). Call it while both realms still
/// stand.
fn tell_both(world: &mut WorldState, d: &Demand, sender: DemandWhat, receiver: DemandWhat) {
    let other_is = answered_by_game(world, &d.to_id);
    let sender_is = (d.from_id == TRADE_ORG).then_some(DemandOtherIs::TradeOrg);
    let to_sender = RealmEventWhat::Demand {
        demand_id: d.id.clone(),
        what: sender,
        mine: true,
        other: organization_label(world, &d.to_id),
        other_is,
        terms: d.terms.clone(),
        leader_died: None,
        handed_over: None,
    };
    record_event(world, Some(&d.from_id), to_sender);
    let to_receiver = RealmEventWhat::Demand {
        demand_id: d.id.clone(),
        what: receiver,
        mine: false,
        other: realm_name(world, &d.from_id),
        other_is: sender_is,
        terms: d.terms.clone(),
        leader_died: None,
        handed_over: None,
    };
    record_event(world, Some(&d.to_id), to_receiver);
}

/// What the Trade Organization writes in its demand for a debt (`DEBT_DEMAND_NOTE`).
const DEBT_DEMAND_NOTE: &str = "Pay what you owe at any of our warehouses, or hand it over here. Past the deadline our army comes for your workplaces.";

/// What the Trade Organization writes in its demand for a captured post (`POST_DEMAND_NOTE`).
const POST_DEMAND_NOTE: &str = "You took our trading post. Give it back and that settles what it is worth, or pay that at any of our warehouses. Past the deadline our army comes for your workplaces.";

/// Stock of `coins` Coins.
pub fn coins_stock(coins: f64) -> Stock {
    let mut s = Stock::new();
    s.insert(good_of("coins").expect("Coins are a good"), coins);
    s
}

fn deadline(world: &WorldState) -> f64 {
    world.tick as f64 + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY
}

/// The Trade Organization demands the debt `di` of who owes it (`sendDebtDemand`, `CONTEXT.md`:
/// Trade Org debt), for all that is owed, the first of its steps (ADR 0025). It goes out once for
/// each debt (`step_debts`).
pub fn send_debt_demand(world: &mut WorldState, di: usize) {
    let debt = &world.debts[di];
    let (org, coins) = (debt.org.clone(), debt.coins);
    let demand = Demand {
        id: new_id(world, "demand"),
        from_id: TRADE_ORG.into(),
        to_id: org,
        terms: DemandTerms::Goods { goods: coins_stock(coins) },
        note: DEBT_DEMAND_NOTE.into(),
        sent_at: world.tick as f64,
        deadline: deadline(world),
    };
    world.demands.push(demand.clone());
    let debt = &mut world.debts[di];
    debt.step = Some(DebtStep::Demanded);
    debt.deadline = Some(demand.deadline);
    tell_both(world, &demand, DemandWhat::Sent, DemandWhat::Received);
}

/// The Trade Organization demands of `org` the post it took and still holds (`sendPostDemand`,
/// `CONTEXT.md`: Trade Org debt), once it has heard of it. The debt for its worth stands already
/// (`lost_posts_become_debts`).
pub fn send_post_demand(world: &mut WorldState, org: &str, city: &City) {
    let demand = Demand {
        id: new_id(world, "demand"),
        from_id: TRADE_ORG.into(),
        to_id: org.into(),
        terms: DemandTerms::City { city_id: city.id.clone(), city_name: city.name.clone() },
        note: POST_DEMAND_NOTE.into(),
        sent_at: world.tick as f64,
        deadline: deadline(world),
    };
    world.demands.push(demand.clone());
    tell_both(world, &demand, DemandWhat::Sent, DemandWhat::Received);
}

/// The Trade Organization goes up to the next of its steps on the debt `di`, as its log says
/// (`debtGoesUp`, ADR 0025).
pub fn debt_goes_up(world: &mut WorldState, di: usize) {
    let debt = &mut world.debts[di];
    debt.step = Some(DebtStep::Wrecks);
    debt.deadline = None;
    let (org, owed) = (debt.org.clone(), debt.coins);
    let what = RealmEventWhat::Debt { what: DebtWhat::Overdue, coins: 0.0, owed };
    record_event(world, Some(&org), what);
}

/// Whether a demand is the Trade Organization's for a debt (`isDebtDemand`).
pub fn is_debt_demand(d: &Demand) -> bool {
    d.from_id == TRADE_ORG && matches!(d.terms, DemandTerms::Goods { .. })
}

/// Whether a demand is the Trade Organization's for a captured post (`isPostDemand`).
pub fn is_post_demand(d: &Demand) -> bool {
    d.from_id == TRADE_ORG && matches!(d.terms, DemandTerms::City { .. })
}
