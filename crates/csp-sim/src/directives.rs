//! Admin directives (`apps/server/src/directives.ts`, `CONTEXT.md`: Admin directive): an admin
//! orders the Trade Organization to weaken an Organization. The game forbids nothing: the Trade
//! Organization refuses it trade and sends its army through its normal rules until the goals are
//! met, an admin lifts it, or the target buys it off where the admin allows it.

use std::collections::HashSet;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuyOffOrder, City, Directive, DirectiveGoal, Good, OrderRequest, RealmEventWhat, Resident,
    ResidentOrder, WorldState,
};
use serde::Serialize;
use serde_json::Value;

use crate::directive::{directive_soldiers, directive_targets, goals_met};
use crate::events::record_event;
use crate::order_sender::{realm_of, OrderSender};
use crate::orders::{str_field, OrderKind};
use crate::queries::alliance::{allied_realms, commander_of};
use crate::queries::alliance_rules::is_alliance_city;
use crate::queries::names::held;
use crate::queries::npc_trade::locale_compare;
use crate::queries::residents::is_armed;
use crate::queries::standing::organization_label;
use crate::queries::standing::{standing_organization, TRADE_ORG};
use crate::queries::warehouse_trade::{buy_off_coin_warehouse_at, buy_off_problem, js_number};
use crate::random::new_id;
use crate::sight::InvariantViolation;

/// The longest reason an admin can give, in characters (`MAX_DIRECTIVE_REASON`).
pub const MAX_DIRECTIVE_REASON: usize = 500;
/// The most goals one directive can have (`MAX_DIRECTIVE_GOALS`).
pub const MAX_DIRECTIVE_GOALS: usize = 8;
/// The most soldiers a `soldiers` goal can ask to be killed (`MAX_DIRECTIVE_SOLDIERS`).
pub const MAX_DIRECTIVE_SOLDIERS: f64 = 10_000.0;

/// Whether an id names an Organization a directive can name: a realm, or an NPC city
/// (`canBeNamed`).
pub fn can_be_named(world: &WorldState, org: &str) -> bool {
    world.realms.iter().any(|r| r.id == org) || is_alliance_city(world, org)
}

/// The Organization a city belongs to: its realm, or the NPC city itself (`cityOrg`).
fn city_org(c: &City) -> &str {
    c.realm_id.as_deref().unwrap_or(&c.id)
}

/// A city by id and name, in a `DirectiveTarget`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NamedCity {
    pub id: String,
    pub name: String,
}

/// Whether a directive target is a realm or an NPC city.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetIs {
    Realm,
    City,
}

/// An Organization an admin can name (`DirectiveTarget` of `api.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DirectiveTarget {
    pub org: String,
    pub name: String,
    pub is: TargetIs,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    pub cities: Vec<NamedCity>,
    pub allies: Vec<String>,
}

/// Every Organization an admin can name, realms first, each by name, with its cities and allies
/// for goals (`directiveTargetChoices`); `account_of` gives a realm's Player's account name.
pub fn directive_target_choices(
    world: &WorldState,
    account_of: &dyn Fn(u64) -> Option<String>,
) -> Vec<DirectiveTarget> {
    let cities_of = |org: &str| -> Vec<NamedCity> {
        world
            .cities
            .iter()
            .filter(|c| city_org(c) == org)
            .map(|c| NamedCity { id: c.id.clone(), name: c.name.clone() })
            .collect()
    };
    let allies_of = |org: &str| -> Vec<String> {
        allied_realms(world, org).into_iter().filter(|m| m != org).collect()
    };
    let mut realms: Vec<DirectiveTarget> = world
        .realms
        .iter()
        .map(|r| DirectiveTarget {
            org: r.id.clone(),
            name: organization_label(world, &r.id),
            is: TargetIs::Realm,
            account: account_of(r.user_id),
            cities: cities_of(&r.id),
            allies: allies_of(&r.id),
        })
        .collect();
    let mut cities: Vec<DirectiveTarget> = world
        .cities
        .iter()
        .filter(|c| is_alliance_city(world, &c.id))
        .map(|c| DirectiveTarget {
            org: c.id.clone(),
            name: c.name.clone(),
            is: TargetIs::City,
            account: None,
            cities: vec![NamedCity { id: c.id.clone(), name: c.name.clone() }],
            allies: allies_of(&c.id),
        })
        .collect();
    realms.sort_by(|a, b| locale_compare(&a.name, &b.name));
    cities.sort_by(|a, b| locale_compare(&a.name, &b.name));
    realms.extend(cities);
    realms
}

/// A directive as admins see it (`AdminDirectiveView`), with who gave it and how far its goals
/// have come.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminDirectiveView {
    pub id: String,
    pub target: String,
    pub target_name: String,
    pub with_alliance: bool,
    pub reason: String,
    pub given_at: f64,
    pub price: Option<f64>,
    pub given_by: String,
    pub goals: Vec<DirectiveGoal>,
    pub soldiers_killed: f64,
}

/// Every directive in force as admins see it (`adminDirectives`).
pub fn admin_directives(world: &WorldState) -> Vec<AdminDirectiveView> {
    world
        .directives
        .iter()
        .map(|d| AdminDirectiveView {
            id: d.id.clone(),
            target: d.target.clone(),
            target_name: organization_label(world, &d.target),
            with_alliance: d.with_alliance,
            reason: d.reason.clone(),
            given_at: d.given_at,
            price: d.price,
            given_by: d.given_by.clone(),
            goals: d.goals.clone(),
            soldiers_killed: d.soldiers_killed,
        })
        .collect()
}

/// `Number.isInteger(n) && min <= n <= max` (`isWhole`).
fn is_whole(n: Option<&Value>, min: f64, max: f64) -> Option<f64> {
    let n = n?.as_f64()?;
    (n.is_finite() && n.fract() == 0.0 && n >= min && n <= max).then_some(n)
}

/// Why a price to buy a directive off can't be set (`priceProblem`): null, or whole Coins.
fn price_problem(price: &Value) -> Option<String> {
    if price.is_null() || is_whole(Some(price), 1.0, f64::INFINITY).is_some() {
        return None;
    }
    Some("A price to buy it off is a whole number of Coins, at least one, or none.".into())
}

/// The goals an admin set, or why they can't be (`readGoals`).
fn read_goals(
    world: &WorldState,
    target: &str,
    with_alliance: bool,
    input: Option<&Value>,
) -> Result<Vec<DirectiveGoal>, String> {
    let Some(input) = input.and_then(Value::as_array).filter(|a| !a.is_empty()) else {
        return Err("Set at least one goal.".into());
    };
    if input.len() > MAX_DIRECTIVE_GOALS {
        return Err(format!("Set at most {MAX_DIRECTIVE_GOALS} goals."));
    }
    let orgs = directive_targets(world, target, with_alliance);
    let mut goals = Vec::new();
    for g in input {
        let kind = g.get("kind").and_then(Value::as_str);
        match kind {
            Some("city") if g.is_object() => {
                let city = world
                    .cities
                    .iter()
                    .find(|c| Some(c.id.as_str()) == g.get("cityId").and_then(Value::as_str));
                let Some(city) = city.filter(|c| orgs.iter().any(|o| o == city_org(c))) else {
                    return Err(
                        "A city goal names a city of the target (or of its alliance).".into()
                    );
                };
                if goals.iter().any(
                    |x| matches!(x, DirectiveGoal::City { city_id, .. } if *city_id == city.id),
                ) {
                    return Err(format!("{} is a goal twice.", city.name));
                }
                goals.push(DirectiveGoal::City {
                    city_id: city.id.clone(),
                    city: city.name.clone(),
                    met: false,
                });
            }
            Some("soldiers") if g.is_object() => {
                let Some(count) = is_whole(g.get("count"), 1.0, MAX_DIRECTIVE_SOLDIERS) else {
                    return Err(format!(
                        "Ask for 1 to {} soldiers killed.",
                        js_number(MAX_DIRECTIVE_SOLDIERS)
                    ));
                };
                goals.push(DirectiveGoal::Soldiers { count, percent: None });
            }
            Some("soldierShare") if g.is_object() => {
                let Some(percent) = is_whole(g.get("percent"), 1.0, 100.0) else {
                    return Err("Ask for 1 to 100 percent of its soldiers killed.".into());
                };
                let have = directive_soldiers(world, target, with_alliance).len() as f64;
                let count = MAX_DIRECTIVE_SOLDIERS.min(1.0f64.max((have * percent / 100.0).ceil()));
                goals.push(DirectiveGoal::Soldiers { count, percent: Some(percent) });
            }
            _ => return Err("A goal is a city destroyed or soldiers killed.".into()),
        }
    }
    Ok(goals)
}

/// An admin gives a directive (`giveDirective`). `input` holds `target`, `withAlliance`, `reason`,
/// `goals` and `price` as the admin panel sends them. Returns it, or why it can't be given.
pub fn give_directive(
    world: &mut WorldState,
    input: &Value,
    given_by: &str,
) -> Result<Directive, String> {
    let price = input.get("price").cloned().unwrap_or(Value::Null);
    let reason =
        input.get("reason").and_then(Value::as_str).map(str::trim).unwrap_or("").to_string();
    let Some(target) =
        input.get("target").and_then(Value::as_str).filter(|t| can_be_named(world, t))
    else {
        return Err("Name a realm or an NPC city.".into());
    };
    let target = target.to_string();
    let Some(with_alliance) = input.get("withAlliance").and_then(Value::as_bool) else {
        return Err("Say whether it names the alliance too.".into());
    };
    // `reason.length` counts UTF-16 code units.
    let length = reason.encode_utf16().count();
    if length == 0 {
        return Err("Give a reason; every Player sees it.".into());
    }
    if length > MAX_DIRECTIVE_REASON {
        return Err(format!("Keep the reason to {MAX_DIRECTIVE_REASON} characters."));
    }
    if let Some(p) = price_problem(&price) {
        return Err(p);
    }
    if world.directives.iter().any(|d| d.target == target) {
        return Err(format!("A directive already names {}.", organization_label(world, &target)));
    }
    let goals = read_goals(world, &target, with_alliance, input.get("goals"))?;
    let directive = Directive {
        id: new_id("directive", &mut world.next_id),
        target,
        with_alliance,
        reason,
        given_by: given_by.to_string(),
        given_at: world.tick as f64,
        goals,
        soldiers_killed: 0.0,
        price: price.as_f64(),
    };
    world.directives.push(directive.clone());
    Ok(directive)
}

/// An admin allows buying a directive off at a price, changes it, or stops allowing it (null)
/// (`setDirectivePrice`).
pub fn set_directive_price(
    world: &mut WorldState,
    id: &str,
    price: &Value,
) -> Result<Directive, String> {
    let Some(i) = world.directives.iter().position(|x| x.id == id) else {
        return Err("No such directive.".into());
    };
    if let Some(p) = price_problem(price) {
        return Err(p);
    }
    world.directives[i].price = price.as_f64();
    Ok(world.directives[i].clone())
}

/// An admin lifts a directive (`liftDirective`). Returns whether there was one by that id.
pub fn lift_directive(world: &mut WorldState, id: &str) -> bool {
    let before = world.directives.len();
    world.directives.retain(|d| d.id != id);
    world.directives.len() < before
}

/// The buy-off order (`buyOff`): one of the target realm's residents, on a Trade Org warehouse's
/// tile, pays the directive's price from their hands or their carriage there. It happens this tick.
pub struct BuyOff;

impl OrderKind for BuyOff {
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
        buy_off_problem(
            world,
            &realm.id,
            r,
            order.fields.get("directiveId"),
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
        let directive_id = str_field(order, "directiveId").unwrap_or_default().to_string();
        let carriage_id = str_field(order, "carriageId").map(str::to_string);
        if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
            r.order = Some(ResidentOrder::BuyOff(BuyOffOrder { directive_id, carriage_id }));
        }
    }
}

/// One buy-off of a tick (`BuyOffRecord`): the coins of payer and coin warehouse before and
/// after, and the directive.
#[derive(Debug, Clone, PartialEq)]
pub struct BuyOffRecord {
    pub resident_id: String,
    pub directive_id: String,
    pub before: f64,
    pub after: f64,
}

/// Carries out buy-off orders (`resolveBuyOffs`): where the realm can still buy the directive off,
/// the price goes into the coin warehouse there and the directive ends as if lifted; the realm log
/// tells the payer. Either way the order is done. Returns how many were bought off, and the
/// records for `buy_offs_sound` (the TypeScript keeps them beside the world in a `WeakMap`).
pub fn resolve_buy_offs(world: &mut WorldState) -> (usize, Vec<BuyOffRecord>) {
    let mut records = Vec::new();
    let mut bought = 0;
    for ri in 0..world.residents.len() {
        let Some(ResidentOrder::BuyOff(o)) = world.residents[ri].order.clone() else { continue };
        world.residents[ri].order = None;
        let r = &world.residents[ri];
        let Some(realm) = commander_of(world, &r.id, r.owner.as_deref()) else { continue };
        let directive_id = Value::String(o.directive_id.clone());
        let carriage_id = o.carriage_id.clone().map(Value::String);
        if buy_off_problem(world, &realm, r, Some(&directive_id), carriage_id.as_ref()).is_some() {
            continue;
        }
        let (rid, name, rx, ry) = (r.id.clone(), r.name.clone(), r.x, r.y);
        let d = world.directives.iter().find(|x| x.id == o.directive_id).expect("checked").clone();
        let w = buy_off_coin_warehouse_at(world, rx, ry).expect("checked").id.clone();
        let wi = world.buildings.iter().position(|b| b.id == w).expect("checked");
        let price = d.price.expect("checked");
        let k =
            o.carriage_id.as_ref().and_then(|id| world.carriages.iter().position(|k| k.id == *id));
        let payer_coins = match k {
            Some(k) => held(&world.carriages[k].load, Good::Coins),
            None => held(&world.residents[ri].carried, Good::Coins),
        };
        let into = world.buildings[wi].stock.get_or_insert_with(Default::default);
        let before = payer_coins + held(into, Good::Coins);
        let into_coins = held(into, Good::Coins) + price;
        into.insert(Good::Coins, into_coins);
        let (wx, wy) = (world.buildings[wi].x, world.buildings[wi].y);
        let payer = match k {
            Some(k) => &mut world.carriages[k].load,
            None => &mut world.residents[ri].carried,
        };
        let left = payer_coins - price;
        if left > 0.0 {
            payer.insert(Good::Coins, left);
        } else {
            payer.shift_remove(&Good::Coins);
        }
        let after = held(payer, Good::Coins) + into_coins;
        records.push(BuyOffRecord {
            resident_id: rid.clone(),
            directive_id: d.id.clone(),
            before,
            after,
        });
        lift_directive(world, &d.id);
        bought += 1;
        let what = RealmEventWhat::BoughtOff {
            resident_id: rid,
            name,
            reason: d.reason.clone(),
            coins: price,
            x: wx,
            y: wy,
        };
        record_event(world, Some(&realm), what);
    }
    (bought, records)
}

/// The invariant `buy-offs-sound` (`buyOffsSound`): across each buy-off of the latest tick, payer
/// and coin warehouse hold the same coins before and after, and the directive is gone.
pub fn buy_offs_sound(world: &WorldState, records: &[BuyOffRecord]) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for b in records {
        if b.before != b.after {
            out.push(InvariantViolation {
                invariant: "buy-offs-sound".into(),
                message: format!(
                    "a buy-off by {} turned {} coins into {}",
                    b.resident_id,
                    js_number(b.before),
                    js_number(b.after)
                ),
                entity_ids: vec![b.resident_id.clone()],
            });
        }
        if world.directives.iter().any(|d| d.id == b.directive_id) {
            out.push(InvariantViolation {
                invariant: "buy-offs-sound".into(),
                message: format!(
                    "directive {} still holds after it was bought off",
                    b.directive_id
                ),
                entity_ids: vec![b.directive_id.clone()],
            });
        }
    }
    out
}

/// The invariant `buy-off-orders-done` (`buyOffOrdersDone`): no buy-off order outlasts a tick.
pub fn buy_off_orders_done(world: &WorldState) -> Vec<InvariantViolation> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::BuyOff(_))))
        .map(|r| InvariantViolation {
            invariant: "buy-off-orders-done".into(),
            message: format!("resident {} still holds a buy-off order after the tick", r.id),
            entity_ids: vec![r.id.clone()],
        })
        .collect()
}

/// Residents were killed (`countSoldiersKilled`, before they are removed): each soldier among them
/// counts for every directive naming their Organization as it stands now.
pub fn count_soldiers_killed(world: &mut WorldState, killed: &[Resident]) {
    let counts: Vec<f64> = world
        .directives
        .iter()
        .map(|d| {
            let orgs = directive_targets(world, &d.target, d.with_alliance);
            killed
                .iter()
                .filter(|r| {
                    let org = r.owner.as_deref().or(r.city_id.as_deref()).unwrap_or("");
                    is_armed(&r.carried) && orgs.iter().any(|o| o == org)
                })
                .count() as f64
        })
        .collect();
    for (d, n) in world.directives.iter_mut().zip(counts) {
        d.soldiers_killed += n;
    }
}

/// Directive goals (`stepDirectives`): a city goal is met once its city is gone or belongs to none
/// of the Organizations named; each directive whose goals are all met ends, and every realm it
/// names reads so in its log. Run after captures.
pub fn step_directives(world: &mut WorldState) {
    for i in 0..world.directives.len() {
        let d = &world.directives[i];
        let orgs = directive_targets(world, &d.target, d.with_alliance);
        let gone: Vec<bool> = d
            .goals
            .iter()
            .map(|g| match g {
                DirectiveGoal::City { city_id, met: false, .. } => world
                    .cities
                    .iter()
                    .find(|c| c.id == *city_id)
                    .is_none_or(|c| !orgs.iter().any(|o| o == city_org(c))),
                _ => false,
            })
            .collect();
        for (g, gone) in world.directives[i].goals.iter_mut().zip(gone) {
            if let DirectiveGoal::City { met, .. } = g {
                if gone {
                    *met = true;
                }
            }
        }
    }
    let done: Vec<Directive> = world.directives.iter().filter(|d| goals_met(d)).cloned().collect();
    for d in done {
        for org in directive_targets(world, &d.target, d.with_alliance) {
            record_event(
                world,
                Some(&org),
                RealmEventWhat::DirectiveEnded { reason: d.reason.clone() },
            );
        }
        lift_directive(world, &d.id);
    }
}

/// The invariant `directives-sound` (`directivesSound`).
pub fn directives_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let mut fail = |message: String, id: &str| {
        out.push(InvariantViolation {
            invariant: "directives-sound".into(),
            message,
            entity_ids: vec![id.to_string()],
        });
    };
    let mut ids = HashSet::new();
    let mut targets = HashSet::new();
    for d in &world.directives {
        let id = d.id.as_str();
        if !ids.insert(id) {
            fail(format!("directive id {id} is used twice"), id);
        }
        if d.target == TRADE_ORG || standing_organization(world, &d.target) == TRADE_ORG {
            fail(format!("directive {id} names the Trade Organization"), id);
        }
        if !targets.insert(d.target.as_str()) {
            fail(format!("{} is named by two directives", d.target), id);
        }
        let length = d.reason.encode_utf16().count();
        if d.reason.trim().is_empty() || length > MAX_DIRECTIVE_REASON {
            fail(format!("directive {id} has a reason of {length} characters"), id);
        }
        if d.given_by.is_empty() {
            fail(format!("directive {id} says no admin gave it"), id);
        }
        if d.given_at > world.tick as f64 {
            fail(format!("directive {id} was given in the future"), id);
        }
        if !(d.soldiers_killed >= 0.0 && d.soldiers_killed.fract() == 0.0) {
            fail(
                format!("directive {id} counts {} soldiers killed", js_number(d.soldiers_killed)),
                id,
            );
        }
        if d.goals.len() > MAX_DIRECTIVE_GOALS {
            fail(format!("directive {id} has {} goals", d.goals.len()), id);
        }
        for g in &d.goals {
            let DirectiveGoal::Soldiers { count, percent } = g else { continue };
            if !(count.fract() == 0.0 && (1.0..=MAX_DIRECTIVE_SOLDIERS).contains(count)) {
                fail(format!("directive {id} asks for {} soldiers killed", js_number(*count)), id);
            }
            if let Some(p) = percent {
                if !(p.fract() == 0.0 && (1.0..=100.0).contains(p)) {
                    fail(
                        format!(
                            "directive {id} asks for {}% of its soldiers killed",
                            js_number(*p)
                        ),
                        id,
                    );
                }
            }
        }
        if goals_met(d) {
            fail(format!("directive {id} met all its goals but is still in force"), id);
        }
        if let Some(p) = d.price {
            if !(p.fract() == 0.0 && p >= 1.0) {
                fail(format!("directive {id} asks {} coins to buy it off", js_number(p)), id);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
