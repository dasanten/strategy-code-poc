//! What the Trade Organization came for and couldn't take stays owed by that Organization
//! (`trade-org-debt.ts`, `CONTEXT.md`: Trade Org debt; ADR 0025), and it rises by what later crimes
//! cost. A resident pays it in Coins at any Trade Org warehouse, in part or in full. While it is
//! owed the Trade Organization goes up its steps, the first a demand for it with a deadline
//! (`step_debts`, ADR 0025).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use csp_shared::balance::TRADE_ORG_LOSS;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Debt, DebtStep, DebtWhat, DemandTerms, Good, OrderRequest, PayDebtOrder, RealmEventWhat,
    ResidentOrder, WorldState,
};
use serde_json::{json, Value};

use crate::demands::{
    coins_stock, debt_goes_up, is_debt_demand, is_post_demand, send_debt_demand, send_post_demand,
};
use crate::events::record_event;
use crate::goods_deps::end_offer;
use crate::order_sender::OrderSender;
use crate::orders::OrderKind;
use crate::queries::alliance::commander_of;
use crate::queries::names::held;
use crate::queries::standing::{standing_organization, TRADE_ORG};
use crate::queries::trade_org::trade_org_hq;
use crate::queries::warehouse_trade::{buy_off_coin_warehouse_at, debt_of, pay_debt_problem};
use crate::realm_pending::{realm_of, str_field};
use crate::sight::InvariantViolation;
use crate::standing::organization_exists;

/// What the first line of a new debt says (`first` of `oweTradeOrg`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FirstOwed {
    Owed,
    PostOwed,
}

/// `org` owes the Trade Organization `coins` more, rounded up to whole Coins (`oweTradeOrg`), and
/// reads so in its log, as `first` says when it owed nothing before. Nothing for nothing owed, or
/// from an Organization that is gone or is the Trade Organization. `city_id` is the city its army
/// came to, or the post it wants back, where the next one goes, if none is kept yet.
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
            if debt.city_id.is_none() {
                debt.city_id = city_id.map(str::to_string);
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

/// Once the Trade Organization has heard who took a post (`lostPostsBecomeDebts`, `CONTEXT.md`:
/// Lost post found out), that is a debt for its worth, once, and it sends no army of its own. While
/// they still hold the city it demands it back. One they no longer hold they can't give back, so
/// that debt goes like any other.
fn lost_posts_become_debts(world: &mut WorldState) {
    for ci in 0..world.crimes.len() {
        let c = &world.crimes[ci];
        let Some(post) = c.post.clone() else { continue };
        if c.punished == Some(true) || !c.known_by.contains(&c.victim_org) {
            continue;
        }
        let culprit = c.culprit.org.clone();
        world.crimes[ci].punished = Some(true);
        owe_trade_org(world, &culprit, TRADE_ORG_LOSS.capture, Some(&post), FirstOwed::PostOwed);
        let city = world
            .cities
            .iter()
            .find(|x| x.id == post && x.realm_id.as_deref() == Some(culprit.as_str()))
            .cloned();
        if let Some(city) = city {
            if debt_of(world, &culprit) > 0.0 {
                send_post_demand(world, &culprit, &city);
            }
        }
    }
}

/// Whether a caravan is still to bring in, or on the way with, what `org` handed over on its
/// demand (`beingCollected`).
fn being_collected(world: &WorldState, org: &str) -> bool {
    world.transfers.iter().any(|t| t.debt.is_some() && !t.back && t.realm_id == org)
}

/// Whatever a debt set in motion ends once it is no longer owed (`endWhatIsNoLongerOwed`), however
/// that came about: its demands, for a post too, go without a word, as the log has said what became
/// of the debt; caravans not yet sent for its Coins stay home; and what is set aside with no caravan
/// left to fetch it is ordinary again.
fn end_what_is_no_longer_owed(world: &mut WorldState) {
    let mut demands = std::mem::take(&mut world.demands);
    demands.retain(|d| d.from_id != TRADE_ORG || debt_of(world, &d.to_id) > 0.0);
    world.demands = demands;
    let mut transfers = std::mem::take(&mut world.transfers);
    transfers.retain(|t| {
        t.debt.is_none()
            || t.back
            || t.caravan_id.is_some()
            || t.from_city_id.is_none()
            || debt_of(world, &t.realm_id) > 0.0
    });
    world.transfers = transfers;
    let lapsed: Vec<String> = world
        .offers
        .iter()
        .filter(|o| o.direct.as_ref().is_some_and(|d| d.to_id == TRADE_ORG))
        .filter(|o| {
            !world
                .transfers
                .iter()
                .any(|t| t.debt.as_ref().and_then(|d| d.offer_id.as_deref()) == Some(o.id.as_str()))
        })
        .map(|o| o.id.clone())
        .collect();
    for id in lapsed {
        // TODO(offers): `endOffer(world, o, 'lapsed')` writes the lines in the realm logs; the
        // stand-in only takes the offer out.
        end_offer(world, &id);
    }
}

/// The debts of a tick (`stepDebts`, `CONTEXT.md`: Trade Org debt). The debt of an Organization
/// that is gone goes with it, so run this after whatever ends Organizations in a tick, after what
/// changes a debt, which its demand's amount follows, and after news of crimes, as a captured post
/// it has heard of becomes a debt. A debt with no demand yet gets one, once, unless a demand for a
/// post is the one it has. Accepted, the next step starts past the deadline, with what is handed
/// over brought in and something still owed.
pub fn step_debts(world: &mut WorldState) {
    let gone: Vec<String> = world
        .debts
        .iter()
        .filter(|d| !organization_exists(world, &d.org))
        .map(|d| d.org.clone())
        .collect();
    world.debts.retain(|d| !gone.contains(&d.org));
    end_what_is_no_longer_owed(world);
    if trade_org_hq(world).is_none() {
        return;
    }
    lost_posts_become_debts(world);
    for di in 0..world.debts.len() {
        let debt = &world.debts[di];
        let (org, coins, step, deadline) = (debt.org.clone(), debt.coins, debt.step, debt.deadline);
        let open = world.demands.iter().position(|d| is_debt_demand(d) && d.to_id == org);
        if let Some(open) = open {
            world.demands[open].terms = DemandTerms::Goods { goods: coins_stock(coins) };
        } else if step.is_none() {
            if !world.demands.iter().any(|d| is_post_demand(d) && d.to_id == org) {
                send_debt_demand(world, di);
            }
        } else if step == Some(DebtStep::Demanded)
            && world.tick as f64 >= deadline.unwrap_or(f64::NAN)
            && !being_collected(world, &org)
        {
            debt_goes_up(world, di);
        }
    }
}

/// The pay-debt order (`payDebt`, `CONTEXT.md`: Trade Org debt): one of the realm's residents, on a
/// Trade Org warehouse's tile, pays up to `coins` from their hands or their carriage `carriageId`
/// there (`pay_debt_problem`). It happens this tick.
pub struct PayDebt;

impl OrderKind for PayDebt {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let r =
            world.residents.iter().find(|x| Some(x.id.as_str()) == str_field(order, "residentId"));
        let (Some(realm), Some(r)) = (realm, r) else {
            return Some("not one of your residents".into());
        };
        if commander_of(world, &r.id, r.owner.as_deref()).as_deref() != Some(realm.id.as_str()) {
            return Some("not one of your residents".into());
        }
        pay_debt_problem(
            world,
            &realm.id,
            r,
            order.fields.get("coins"),
            order.fields.get("carriageId"),
        )
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let id = str_field(order, "residentId");
        let coins = order.fields.get("coins").and_then(Value::as_f64).unwrap_or(0.0);
        let carriage_id = str_field(order, "carriageId").map(str::to_string);
        if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
            r.order = Some(ResidentOrder::PayDebt(PayDebtOrder { coins, carriage_id }));
        }
    }
}

/// One payment this tick (`DebtPayment`): the coins of payer and coin warehouse and the debt,
/// before and after.
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayment {
    pub resident_id: String,
    pub coins_before: f64,
    pub coins_after: f64,
    pub paid: f64,
    pub owed_before: f64,
    pub owed_after: f64,
}

thread_local! {
    /// The payments of the latest `resolve_debt_payments`, kept beside the world for its
    /// invariants (`ledger`): by the world's address, as the TypeScript keeps them by the world.
    static LEDGER: RefCell<HashMap<usize, Vec<DebtPayment>>> = RefCell::new(HashMap::new());
}

fn key(world: &WorldState) -> usize {
    world as *const WorldState as usize
}

/// Carries out pay-debt orders (`resolveDebtPayments`, `CONTEXT.md`: Trade Org debt). Where the
/// resident's realm can still pay where they stand (`pay_debt_problem`), what they hold up to the
/// order's `coins` and what is owed goes from their hands or carriage into the coin warehouse
/// there, and off the debt. The realm log tells the payer. Either way the order is done. Returns
/// how many paid.
pub fn resolve_debt_payments(world: &mut WorldState) -> usize {
    let mut records = Vec::new();
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::PayDebt(o)) = world.residents[ri].order.clone() else { continue };
        world.residents[ri].order = None;
        let r = &world.residents[ri];
        let Some(realm) = commander_of(world, &r.id, r.owner.as_deref()) else { continue };
        let carriage = o.carriage_id.as_ref().map_or(Value::Null, |id| json!(id));
        if pay_debt_problem(world, &realm, r, Some(&json!(o.coins)), Some(&carriage)).is_some() {
            continue;
        }
        let (rid, name, rx, ry) = (r.id.clone(), r.name.clone(), r.x, r.y);
        let di = world.debts.iter().position(|d| d.org == realm).expect("checked");
        let wid = buy_off_coin_warehouse_at(world, rx, ry).expect("checked").id.clone();
        let wi = world.buildings.iter().position(|b| b.id == wid).expect("just found");
        let k =
            o.carriage_id.as_ref().and_then(|id| world.carriages.iter().position(|k| k.id == *id));
        let payer_coins = match k {
            Some(k) => held(&world.carriages[k].load, Good::Coins),
            None => held(&world.residents[ri].carried, Good::Coins),
        };
        let into = world.buildings[wi].stock.get_or_insert_with(Default::default);
        let coins_before = payer_coins + held(into, Good::Coins);
        let owed_before = world.debts[di].coins;
        let paid = o.coins.min(owed_before).min(payer_coins.floor());
        let into_coins = held(into, Good::Coins) + paid;
        into.insert(Good::Coins, into_coins);
        let payer = match k {
            Some(k) => &mut world.carriages[k].load,
            None => &mut world.residents[ri].carried,
        };
        let left = payer_coins - paid;
        if left > 0.0 {
            payer.insert(Good::Coins, left);
        } else {
            payer.shift_remove(&Good::Coins);
        }
        let coins_after = held(payer, Good::Coins) + into_coins;
        world.debts[di].coins -= paid;
        let owed_after = world.debts[di].coins;
        if owed_after <= 0.0 {
            world.debts.remove(di);
        }
        records.push(DebtPayment {
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
            x: rx,
            y: ry,
        };
        record_event(world, Some(&realm), what);
    }
    let n = records.len();
    LEDGER.with(|l| l.borrow_mut().insert(key(world), records));
    n
}

/// Test hook: the payments of the latest `resolve_debt_payments` (`debtPaymentsOf`), and lets a
/// test tamper with one.
pub fn with_debt_payments<T>(world: &WorldState, f: impl FnOnce(&mut Vec<DebtPayment>) -> T) -> T {
    LEDGER.with(|l| f(l.borrow_mut().entry(key(world)).or_default()))
}

/// Debts hold together (`debtsSound`, `CONTEXT.md`: Trade Org debt; ADR 0004): each is positive,
/// owed by an Organization that exists and isn't the Trade Organization, at most one for each.
#[allow(clippy::neg_cmp_op_on_partial_ord)] // NaN fails it, as in the TypeScript.
pub fn debts_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |message: String, org: &str| {
        out.push(InvariantViolation {
            invariant: "debts-sound".into(),
            message,
            entity_ids: vec![org.to_string()],
        })
    };
    let mut seen = HashSet::new();
    for d in &world.debts {
        if !(d.coins > 0.0) {
            fail(
                format!("the debt of {} is {}", d.org, crate::invariants::js_number(d.coins)),
                &d.org,
            );
        }
        if !organization_exists(world, &d.org) {
            fail(format!("{} owes a debt but is gone", d.org), &d.org);
        }
        if standing_organization(world, &d.org) == TRADE_ORG {
            fail(format!("the Trade Organization owes itself, as {}", d.org), &d.org);
        }
        if !seen.insert(d.org.as_str()) {
            fail(format!("{} has two debts", d.org), &d.org);
        }
    }
    out
}

fn step_name(step: Option<DebtStep>) -> &'static str {
    match step {
        None => "undefined",
        Some(DebtStep::Demanded) => "demanded",
        Some(DebtStep::Wrecks) => "wrecks",
    }
}

/// The Trade Organization's demands for debts hold together (`debtDemandsSound`, `CONTEXT.md`:
/// Trade Org debt; ADR 0004): each is for all the Coins of a debt that is at its step `demanded`,
/// at most one for each debt, and a debt at that step has a deadline. What caravans collect of a
/// debt goes to the Trade Organization. Its demand for a captured post goes with a debt, once for
/// each city, and a post it has heard of has been made a debt by the end of the tick.
pub fn debt_demands_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |message: String, id: &str| {
        out.push(InvariantViolation {
            invariant: "debt-demands-sound".into(),
            message,
            entity_ids: vec![id.to_string()],
        })
    };
    let mut posts = HashSet::new();
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
            if let Some(post) = &c.post {
                if c.known_by.contains(&c.victim_org) && c.punished != Some(true) {
                    fail(format!("it heard who took {post}, and that is on no debt"), &c.id);
                }
            }
        }
    }
    let mut seen = HashSet::new();
    for d in world.demands.iter().filter(|d| is_debt_demand(d)) {
        let debt = world.debts.iter().find(|x| x.org == d.to_id);
        match debt {
            None => fail(format!("demand {} is for a debt {} doesn’t owe", d.id, d.to_id), &d.id),
            Some(debt) if debt.step != Some(DebtStep::Demanded) => {
                fail(format!("demand {} is out at step {}", d.id, step_name(debt.step)), &d.id)
            }
            _ => {}
        }
        if !seen.insert(d.to_id.as_str()) {
            fail(format!("{} was sent two demands for its debt", d.to_id), &d.id);
        }
        let coins = match &d.terms {
            DemandTerms::Goods { goods } => goods.get(&Good::Coins).copied(),
            DemandTerms::City { .. } => None,
        };
        if let Some(debt) = debt {
            if coins != Some(debt.coins) {
                let shown = coins.map_or("undefined".to_string(), crate::invariants::js_number);
                fail(
                    format!(
                        "demand {} is for {shown} Coins, of a debt of {}",
                        d.id,
                        crate::invariants::js_number(debt.coins)
                    ),
                    &d.id,
                );
            }
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

/// Paying a debt moves coins (`debtPaymentsSound`, `CONTEXT.md`: Trade Org debt; ADR 0004): across
/// each payment of the latest tick, payer and coin warehouse hold the same coins before and after,
/// and the debt falls by what was paid.
pub fn debt_payments_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let n = crate::invariants::js_number;
    let payments = LEDGER.with(|l| l.borrow().get(&key(world)).cloned().unwrap_or_default());
    let mut out = Vec::new();
    for p in payments {
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "debt-payments-sound".into(),
                message,
                entity_ids: vec![p.resident_id.clone()],
            })
        };
        if p.coins_before != p.coins_after {
            fail(format!(
                "a payment by {} turned {} coins into {}",
                p.resident_id,
                n(p.coins_before),
                n(p.coins_after)
            ));
        }
        if p.owed_after != p.owed_before - p.paid {
            fail(format!(
                "a payment of {} by {} took a debt from {} to {}",
                n(p.paid),
                p.resident_id,
                n(p.owed_before),
                n(p.owed_after)
            ));
        }
    }
    out
}

/// Every pay-debt order is done the tick it is given (`debtOrdersDone`): none outlasts a tick.
pub fn debt_orders_done(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::PayDebt(_))))
        .map(|r| InvariantViolation {
            invariant: "debt-orders-done".into(),
            message: format!("resident {} still holds a pay-debt order after the tick", r.id),
            entity_ids: vec![r.id.clone()],
        })
        .collect()
}

#[cfg(test)]
mod tests;
