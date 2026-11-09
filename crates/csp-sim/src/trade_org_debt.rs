//! Trade Org debt (`apps/server/src/trade-org-debt.ts`, `CONTEXT.md`: Trade Org debt; ADR 0025):
//! what the Trade Organization came for and couldn't take stays owed by that Organization, and it
//! rises by what later crimes cost. A resident pays it in Coins at any Trade Org warehouse. While
//! it is owed the Trade Organization goes up its steps, the first a demand for it with a deadline.

use csp_shared::balance::TRADE_ORG_LOSS;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Debt, DebtStep, DebtWhat, DemandTerms, Good, OfferEnd, OrderRequest, PayDebtOrder,
    RealmEventWhat, ResidentOrder, WorldState,
};
use serde_json::Value;

use crate::demands::{
    debt_goes_up, is_debt_demand, is_post_demand, send_debt_demand, send_post_demand,
};
use crate::events::record_event;
use crate::invariants::InvariantViolation;
use crate::offers::end_offer;
use crate::order_sender::{commands, OrderSender};
use crate::orders::OrderKind;
use crate::queries::alliance::commander_of;
use crate::queries::standing::{standing_organization, TRADE_ORG};
use crate::queries::trade_org::trade_org_hq;
use crate::queries::warehouse_trade::{buy_off_coin_warehouse_at, debt_of, pay_debt_problem};
use crate::realm_pending::js_number;
use crate::standing::organization_exists;

/// How a debt first reads in the log (`first` of `oweTradeOrg`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FirstOwed {
    Owed,
    PostOwed,
}

/// `org` owes the Trade Organization `coins` more, rounded up to whole Coins, and reads so in its
/// log (`oweTradeOrg`). Nothing for nothing owed, or from an Organization that is gone or is the
/// Trade Organization. `city_id` is the city its army came to, or the post it wants back, where
/// the next one goes, if none is kept yet.
pub fn owe_trade_org(
    world: &mut WorldState,
    org: &str,
    coins: f64,
    city_id: Option<&str>,
    first: FirstOwed,
) {
    let more = coins.ceil();
    if more <= 0.0 {
        return;
    }
    if !organization_exists(world, org) || standing_organization(world, org) == TRADE_ORG {
        return;
    }
    let (what, owed) = match world.debts.iter_mut().find(|d| d.org == org) {
        Some(debt) => {
            debt.coins += more;
            if let Some(id) = city_id {
                debt.city_id.get_or_insert_with(|| id.to_string());
            }
            (DebtWhat::Rose, debt.coins)
        }
        None => {
            world.debts.push(Debt {
                org: org.to_string(),
                coins: more,
                step: None,
                deadline: None,
                trips: None,
                city_id: city_id.map(str::to_string),
            });
            let what = match first {
                FirstOwed::Owed => DebtWhat::Owed,
                FirstOwed::PostOwed => DebtWhat::PostOwed,
            };
            (what, more)
        }
    };
    record_event(world, Some(org), RealmEventWhat::Debt { what, coins: more, owed });
}

/// Once the Trade Organization has heard who took a post, that is a debt for its worth, once
/// (`lostPostsBecomeDebts`). While they still hold the city it demands it back.
fn lost_posts_become_debts(world: &mut WorldState) {
    for i in 0..world.crimes.len() {
        let c = &world.crimes[i];
        let Some(post) = c.post.clone() else { continue };
        if c.punished == Some(true) || !c.known_by.contains(&c.victim_org) {
            continue;
        }
        let org = c.culprit.org.clone();
        world.crimes[i].punished = Some(true);
        owe_trade_org(world, &org, TRADE_ORG_LOSS.capture, Some(&post), FirstOwed::PostOwed);
        let city = world
            .cities
            .iter()
            .find(|x| x.id == post && x.realm_id.as_deref() == Some(org.as_str()))
            .cloned();
        if let Some(city) = city.filter(|_| debt_of(world, &org) > 0.0) {
            send_post_demand(world, &org, &city);
        }
    }
}

/// Whether a caravan is still to bring in, or on the way with, what `org` handed over on its
/// demand (`beingCollected`).
fn being_collected(world: &WorldState, org: &str) -> bool {
    world.transfers.iter().any(|t| t.debt.is_some() && !t.back && t.realm_id == org)
}

/// Whatever a debt set in motion ends once it is no longer owed (`endWhatIsNoLongerOwed`): its
/// demands go without a word, caravans not yet sent for its Coins stay home, and what is set
/// aside with no caravan left to fetch it is ordinary again.
fn end_what_is_no_longer_owed(world: &mut WorldState) {
    let owed: std::collections::HashSet<String> =
        world.debts.iter().filter(|d| d.coins > 0.0).map(|d| d.org.clone()).collect();
    world.demands.retain(|d| d.from_id != TRADE_ORG || owed.contains(&d.to_id));
    world.transfers.retain(|t| {
        t.debt.is_none()
            || t.back
            || t.caravan_id.is_some()
            || t.from_city_id.is_none()
            || owed.contains(&t.realm_id)
    });
    let ending: Vec<String> = world
        .offers
        .iter()
        .filter(|o| o.direct.as_ref().is_some_and(|d| d.to_id == TRADE_ORG))
        .filter(|o| {
            !world
                .transfers
                .iter()
                .any(|t| t.debt.as_ref().and_then(|d| d.offer_id.as_ref()) == Some(&o.id))
        })
        .map(|o| o.id.clone())
        .collect();
    for id in ending {
        end_offer(world, &id, OfferEnd::Lapsed);
    }
}

/// The debts of a tick (`stepDebts`, `CONTEXT.md`: Trade Org debt). The debt of an Organization
/// that is gone goes with it. A debt with no demand yet gets one, once, unless a demand for a post
/// is the one it has. Accepted, it goes up a step past the deadline, with what is handed over
/// brought in and something still owed.
pub fn step_debts(world: &mut WorldState) {
    let debts = std::mem::take(&mut world.debts);
    world.debts = debts.into_iter().filter(|d| organization_exists(world, &d.org)).collect();
    end_what_is_no_longer_owed(world);
    if trade_org_hq(world).is_none() {
        return;
    }
    lost_posts_become_debts(world);
    for i in 0..world.debts.len() {
        let (org, coins) = (world.debts[i].org.clone(), world.debts[i].coins);
        let open = world.demands.iter_mut().find(|d| is_debt_demand(d) && d.to_id == org);
        if let Some(open) = open {
            open.terms = DemandTerms::Goods { goods: [(Good::Coins, coins)].into_iter().collect() };
        } else if world.debts[i].step.is_none() {
            if !world.demands.iter().any(|d| is_post_demand(d) && d.to_id == org) {
                send_debt_demand(world, i);
            }
        } else if world.debts[i].step == Some(DebtStep::Demanded)
            && world.debts[i].deadline.is_some_and(|at| world.tick as f64 >= at)
            && !being_collected(world, &org)
        {
            debt_goes_up(world, i);
        }
    }
}

/// The pay-debt order (`payDebt`, `CONTEXT.md`: Trade Org debt): one of the realm's residents, on
/// a Trade Org warehouse's tile, pays up to `coins` from their hands or their carriage there. It
/// happens this tick.
pub struct PayDebt;

impl OrderKind for PayDebt {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) -> Option<String> {
        let f = &order.fields;
        let realm = world.realms.iter().find(|r| r.user_id == sender.user_id);
        let id = f.get("residentId").and_then(Value::as_str);
        let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id);
        let Some(realm) = realm.filter(|realm| commands(world, &realm.id, r)) else {
            return Some("not one of your residents".into());
        };
        pay_debt_problem(
            world,
            &realm.id,
            r.expect("commanded"),
            f.get("coins"),
            f.get("carriageId"),
        )
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _: &OrderSender,
        order: &OrderRequest,
        _: Option<&TerrainMap>,
    ) {
        let f = &order.fields;
        let id = f.get("residentId").and_then(Value::as_str);
        let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else {
            return;
        };
        r.order = Some(ResidentOrder::PayDebt(PayDebtOrder {
            coins: f.get("coins").and_then(Value::as_f64).unwrap_or(0.0),
            carriage_id: f.get("carriageId").and_then(Value::as_str).map(str::to_string),
        }));
    }
}

/// One payment this tick: the coins of payer and coin warehouse and the debt, before and after
/// (`DebtPayment`).
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayment {
    pub resident_id: String,
    pub coins_before: f64,
    pub coins_after: f64,
    pub paid: f64,
    pub owed_before: f64,
    pub owed_after: f64,
}

/// The payments of the latest `resolve_debt_payments`, for its invariants (`ledger`).
#[derive(Debug, Clone, Default)]
pub struct DebtLedger {
    pub records: Vec<DebtPayment>,
}

/// Carries out pay-debt orders (`resolveDebtPayments`): where the resident's realm can still pay
/// where they stand, what they hold up to the order's `coins` and what is owed goes from their
/// hands or carriage into the coin warehouse there, and off the debt. Either way the order is
/// done. Returns how many paid.
pub fn resolve_debt_payments(world: &mut WorldState, ledger: &mut DebtLedger) -> usize {
    ledger.records.clear();
    for i in 0..world.residents.len() {
        let Some(ResidentOrder::PayDebt(o)) = world.residents[i].order.clone() else { continue };
        world.residents[i].order = None;
        let r = &world.residents[i];
        let Some(realm) = commander_of(world, &r.id, r.owner.as_deref()) else { continue };
        let coins = Value::from(o.coins);
        let carriage = o.carriage_id.as_deref().map(Value::from);
        if pay_debt_problem(
            world,
            &realm,
            r,
            Some(&coins),
            Some(carriage.as_ref().unwrap_or(&Value::Null)),
        )
        .is_some()
        {
            continue;
        }
        let (x, y, name, rid) = (r.x, r.y, r.name.clone(), r.id.clone());
        let d = world.debts.iter().position(|d| d.org == realm).expect("checked");
        let warehouse_id = buy_off_coin_warehouse_at(world, x, y).expect("checked").id.clone();
        let w = world.buildings.iter().position(|b| b.id == warehouse_id).expect("found");
        let k =
            o.carriage_id.as_ref().and_then(|id| world.carriages.iter().position(|k| &k.id == id));
        let mut payer = match k {
            Some(k) => std::mem::take(&mut world.carriages[k].load),
            None => std::mem::take(&mut world.residents[i].carried),
        };
        let mut into = world.buildings[w].stock.take().unwrap_or_default();
        let held = payer.get(&Good::Coins).copied().unwrap_or(0.0);
        let coins_before = held + into.get(&Good::Coins).copied().unwrap_or(0.0);
        let owed_before = world.debts[d].coins;
        let paid = o.coins.min(owed_before).min(held.floor());
        let left = held - paid;
        if left > 0.0 {
            payer.insert(Good::Coins, left);
        } else {
            payer.shift_remove(&Good::Coins);
        }
        *into.entry(Good::Coins).or_insert(0.0) += paid;
        let coins_after = payer.get(&Good::Coins).copied().unwrap_or(0.0) + into[&Good::Coins];
        match k {
            Some(k) => world.carriages[k].load = payer,
            None => world.residents[i].carried = payer,
        }
        world.buildings[w].stock = Some(into);
        world.debts[d].coins -= paid;
        let owed_after = world.debts[d].coins;
        if owed_after <= 0.0 {
            world.debts.remove(d);
        }
        ledger.records.push(DebtPayment {
            resident_id: rid.clone(),
            coins_before,
            coins_after,
            paid,
            owed_before,
            owed_after,
        });
        let what = RealmEventWhat::DebtPaid {
            resident_id: rid,
            name,
            coins: paid,
            owed: owed_after,
            x,
            y,
        };
        record_event(world, Some(&realm), what);
    }
    ledger.records.len()
}

fn violation(invariant: &str, message: String, id: &str) -> InvariantViolation {
    InvariantViolation { invariant: invariant.into(), message, entity_ids: vec![id.to_string()] }
}

/// Debts hold together (`debts-sound`): each is positive, owed by an Organization that exists and
/// isn't the Trade Organization, at most one for each.
pub fn debts_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for d in &world.debts {
        let mut fail = |m: String| out.push(violation("debts-sound", m, &d.org));
        if d.coins.is_nan() || d.coins <= 0.0 {
            fail(format!("the debt of {} is {}", d.org, js_number(d.coins)));
        }
        if !organization_exists(world, &d.org) {
            fail(format!("{} owes a debt but is gone", d.org));
        }
        if standing_organization(world, &d.org) == TRADE_ORG {
            fail(format!("the Trade Organization owes itself, as {}", d.org));
        }
        if !seen.insert(&d.org) {
            fail(format!("{} has two debts", d.org));
        }
    }
    out
}

/// The Trade Organization's demands for debts hold together (`debt-demands-sound`).
pub fn debt_demands_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |m: String, id: &str| out.push(violation("debt-demands-sound", m, id));
    let mut posts = std::collections::HashSet::new();
    for d in world.demands.iter().filter(|d| is_post_demand(d)) {
        let city = match &d.terms {
            DemandTerms::City { city_id, .. } => city_id.as_str(),
            DemandTerms::Goods { .. } => "",
        };
        if !posts.insert(city) {
            fail(format!("{city} was demanded back twice"), &d.id);
        }
        if debt_of(world, &d.to_id) <= 0.0 {
            fail(format!("demand {} is for a post {} owes nothing for", d.id, d.to_id), &d.id);
        }
    }
    if trade_org_hq(world).is_some() {
        for c in &world.crimes {
            let Some(post) = &c.post else { continue };
            if c.known_by.contains(&c.victim_org) && c.punished != Some(true) {
                fail(format!("it heard who took {post}, and that is on no debt"), &c.id);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    for d in world.demands.iter().filter(|d| is_debt_demand(d)) {
        let debt = world.debts.iter().find(|x| x.org == d.to_id);
        match debt {
            None => fail(format!("demand {} is for a debt {} doesn’t owe", d.id, d.to_id), &d.id),
            Some(debt) if debt.step != Some(DebtStep::Demanded) => {
                let step = match debt.step {
                    Some(DebtStep::Wrecks) => "wrecks",
                    _ => "undefined",
                };
                fail(format!("demand {} is out at step {step}", d.id), &d.id);
            }
            Some(_) => {}
        }
        if !seen.insert(&d.to_id) {
            fail(format!("{} was sent two demands for its debt", d.to_id), &d.id);
        }
        let coins = match &d.terms {
            DemandTerms::Goods { goods } => goods.get(&Good::Coins).copied(),
            DemandTerms::City { .. } => None,
        };
        if let Some(debt) = debt.filter(|debt| coins != Some(debt.coins)) {
            let coins = coins.map_or_else(|| "undefined".to_string(), js_number);
            let message = format!(
                "demand {} is for {coins} Coins, of a debt of {}",
                d.id,
                js_number(debt.coins)
            );
            fail(message, &d.id);
        }
    }
    for debt in &world.debts {
        if debt.step == Some(DebtStep::Demanded) && debt.deadline.is_none() {
            fail(format!("the debt of {} was demanded with no deadline", debt.org), &debt.org);
        }
    }
    for t in &world.transfers {
        if t.debt.is_some() && t.to_realm_id != TRADE_ORG {
            fail(format!("{} collects a debt for {}", t.id, t.to_realm_id), &t.id);
        }
    }
    out
}

/// Paying a debt moves coins (`debt-payments-sound`): payer and coin warehouse hold the same coins
/// before and after, and the debt falls by what was paid.
pub fn debt_payments_sound(ledger: &DebtLedger) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for p in &ledger.records {
        if p.coins_before != p.coins_after {
            let message = format!(
                "a payment by {} turned {} coins into {}",
                p.resident_id,
                js_number(p.coins_before),
                js_number(p.coins_after)
            );
            out.push(violation("debt-payments-sound", message, &p.resident_id));
        }
        if p.owed_after != p.owed_before - p.paid {
            let message = format!(
                "a payment of {} by {} took a debt from {} to {}",
                js_number(p.paid),
                p.resident_id,
                js_number(p.owed_before),
                js_number(p.owed_after)
            );
            out.push(violation("debt-payments-sound", message, &p.resident_id));
        }
    }
    out
}

/// Every pay-debt order is done the tick it is given (`debt-orders-done`).
pub fn debt_orders_done(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::PayDebt(_))))
        .map(|r| {
            let message = format!("resident {} still holds a pay-debt order after the tick", r.id);
            violation("debt-orders-done", message, &r.id)
        })
        .collect()
}

#[cfg(test)]
mod tests;
