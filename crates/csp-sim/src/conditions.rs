//! Conditions (`CONTEXT.md`: Condition, ADR 0032): what a Wait until, an If block or a Repeat
//! until asks, checked by the server for one resident. A condition is about the resident themself
//! or one place of their own realm, never anything their Player couldn't know.

use csp_shared::balance::MAX_HEALTH;
use csp_shared::balance::MAX_HUNGER;
use csp_shared::time::game_time;
use csp_shared::world::{
    BuildingKind, Compare, Condition, HourSide, LoadState, NeedName, Side, Stock, WorldState,
};
use serde_json::Value;

use crate::queries::building::{building_pile, max_workers};
use crate::queries::carriages::{carriage_capacity, driven_carriage_id};
use crate::queries::city::building_realm;
use crate::queries::residents::{carry_capacity, good_weight, stock_weight};
use crate::queries::vessels::vessel_capacity;

/// The highest hour a condition names: a day's hours run 0 to 23.
const LAST_HOUR: f64 = 23.0;

/// The condition a request sends, or why it isn't one (`conditionProblem`): one of the kinds, an
/// amount a whole number from 0, a share from 0 to 1, an hour a whole number from 0 to 23.
pub fn condition_of(v: Option<&Value>) -> Result<Condition, String> {
    let Some(v) = v else { return Err("needs a condition".into()) };
    let c: Condition = serde_json::from_value(v.clone()).map_err(|_| "that is no condition")?;
    let whole = |n: f64| n.is_finite() && n.fract() == 0.0 && n >= 0.0;
    match &c {
        Condition::Carries { amount, .. } | Condition::Stock { amount, .. } if !whole(*amount) => {
            Err("a condition's amount is a whole number from 0".into())
        }
        Condition::Stock { place_id, .. } if place_id.is_empty() => {
            Err("a condition on stock needs a place".into())
        }
        Condition::Need { share, .. } if !(0.0..=1.0).contains(share) => {
            Err("a condition's share is from 0 to 1".into())
        }
        Condition::Hour { hour, .. } if !whole(*hour) || *hour > LAST_HOUR => {
            Err("a condition's hour is a whole number from 0 to 23".into())
        }
        _ => Ok(c),
    }
}

/// Why a condition can't be asked by the realm `realm_id` (`conditionPlaceProblem`): the place it
/// names must be a storage, workplace or site of the realm. Nothing about another realm can be
/// asked.
pub fn condition_place_problem(
    world: &WorldState,
    realm_id: &str,
    c: &Condition,
) -> Option<&'static str> {
    match c {
        Condition::Stock { place_id, .. } if place_stock(world, realm_id, place_id).is_none() => {
            Some("not a storage, workplace or site of your realm")
        }
        _ => None,
    }
}

/// The goods a place of the realm holds (`placeStock`): a construction site's delivered goods, a
/// storage's stock, or the pile at a workplace. `None` when the building is gone, isn't the
/// realm's or is none of these.
pub fn place_stock(world: &WorldState, realm_id: &str, place_id: &str) -> Option<Stock> {
    let b = world.buildings.iter().find(|b| b.id == place_id)?;
    if building_realm(world, b) != Some(realm_id) {
        return None;
    }
    if let Some(site) = &b.site {
        return Some(site.delivered.clone());
    }
    if b.stock.is_some() || matches!(b.kind, BuildingKind::Storage | BuildingKind::Warehouse) {
        return Some(b.stock.clone().unwrap_or_default());
    }
    if max_workers(b.kind).is_some() {
        return Some(building_pile(world, b).map(|p| p.goods.clone()).unwrap_or_default());
    }
    None
}

/// What a condition about carrying looks at: its goods and the most weight it holds.
struct Load {
    goods: Stock,
    capacity: f64,
}

/// What the resident at `ri` carries, or with `vehicle` the carriage or vessel they drive
/// (`carrierOf`): the carriage their drive or haul names; else the boat or carriage they are
/// aboard; else a carriage of their realm on their tile. `None` with no such vehicle.
fn load_of(world: &WorldState, ri: usize, realm_id: &str, vehicle: bool) -> Option<Load> {
    let r = &world.residents[ri];
    if !vehicle {
        return Some(Load { goods: r.carried.clone(), capacity: carry_capacity(r, world.tick as f64) });
    }
    let carriage = |id: &str| world.carriages.iter().find(|k| k.id == id);
    let driven = driven_carriage_id(r).and_then(carriage);
    let aboard = r.aboard.as_deref();
    if let Some(k) = driven.or_else(|| aboard.and_then(carriage)) {
        return Some(Load { goods: k.load.clone(), capacity: carriage_capacity(world, k) });
    }
    if let Some(v) = aboard.and_then(|id| world.vessels.iter().find(|v| v.id == id)) {
        return Some(Load { goods: v.load.clone(), capacity: vessel_capacity(v) });
    }
    let here = world.carriages.iter().find(|k| {
        k.x == r.x && k.y == r.y && k.realm_id.as_deref() == Some(realm_id)
    })?;
    Some(Load { goods: here.load.clone(), capacity: carriage_capacity(world, here) })
}

/// Whether a load is full: less room is left than one unit of the lightest good it holds weighs.
/// An empty load is never full.
fn is_full(load: &Load) -> bool {
    let lightest = load
        .goods
        .iter()
        .filter(|(_, n)| **n > 0.0)
        .map(|(g, _)| good_weight(*g))
        .fold(f64::INFINITY, f64::min);
    lightest.is_finite() && load.capacity - stock_weight(&load.goods) < lightest
}

fn compared(have: f64, compare: Compare, amount: f64) -> bool {
    match compare {
        Compare::AtLeast => have >= amount,
        Compare::LessThan => have < amount,
    }
}

/// What a condition asked of a resident came to (`Holds`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Holds {
    Yes,
    No,
    /// The place it names is gone or no longer the realm's: it counts as false, and the realm log
    /// notes it.
    PlaceGone(String),
}

impl Holds {
    pub fn yes(&self) -> bool {
        *self == Holds::Yes
    }
}

fn holds(b: bool) -> Holds {
    if b {
        Holds::Yes
    } else {
        Holds::No
    }
}

/// Whether a condition holds for the resident at `ri`, of the realm `realm_id`, now
/// (`conditionHolds`, `CONTEXT.md`: Condition). With no vehicle to ask about, a condition on one
/// is false.
pub fn condition_holds(world: &WorldState, ri: usize, realm_id: &str, c: &Condition) -> Holds {
    let r = &world.residents[ri];
    match c {
        Condition::Carries { vehicle, good, compare, amount } => {
            let Some(load) = load_of(world, ri, realm_id, *vehicle) else { return Holds::No };
            holds(compared(load.goods.get(good).copied().unwrap_or(0.0), *compare, *amount))
        }
        Condition::Load { vehicle, load } => {
            let Some(l) = load_of(world, ri, realm_id, *vehicle) else { return Holds::No };
            holds(match load {
                LoadState::Full => is_full(&l),
                LoadState::Empty => l.goods.values().all(|n| *n <= 0.0),
            })
        }
        Condition::Stock { place_id, good, compare, amount } => {
            match place_stock(world, realm_id, place_id) {
                None => Holds::PlaceGone(place_id.clone()),
                Some(s) => holds(compared(s.get(good).copied().unwrap_or(0.0), *compare, *amount)),
            }
        }
        Condition::Need { need, side, share } => {
            let have = match need {
                NeedName::Hunger => r.hunger / MAX_HUNGER,
                NeedName::Health => r.health / MAX_HEALTH,
            };
            holds(match side {
                Side::Above => have > *share,
                Side::Below => have < *share,
            })
        }
        Condition::Mounted { is } => holds(r.riding.is_some() == *is),
        Condition::Aboard { is } => holds(r.aboard.is_some() == *is),
        Condition::Hour { side, hour } => {
            let now = game_time(world.tick as f64).hour as f64;
            holds(match side {
                HourSide::Before => now < *hour,
                HourSide::After => now >= *hour,
            })
        }
    }
}

#[cfg(test)]
mod tests;
