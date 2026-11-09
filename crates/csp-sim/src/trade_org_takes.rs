//! The Trade Organization's last step on a debt (`trade-org-takes.ts`, `CONTEXT.md`: Trade Org
//! debt; ADR 0025): its army holds the town hall of the culprit's city as anyone occupies one
//! (`occupier_of`), and the city joins it as a new trading post (`take_city`). This is what its
//! soldiers fight there and what holds true after.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use csp_shared::footprint::is_at;
use csp_shared::world::{BuildingKind, City, TradeOrgCity, WorldState};

use crate::queries::alliance::contract_of;
use crate::queries::city::town_hall_of;
use crate::queries::city_area::defends_city;
use crate::queries::names::placed;
use crate::queries::residents::is_armed;
use crate::queries::standing::TRADE_ORG;
use crate::sight::InvariantViolation;

/// Who stops the Trade Organization's army `ids` occupying the hall of `city` by standing on it
/// (`hallBlockers`, `CONTEXT.md`: Occupying a town hall): armed defenders of the city, and armed
/// residents of any realm, as nobody occupies a hall they share. Not soldiers another realm hired
/// from it, who count for nobody there, nor those it hired itself. By index.
pub fn hall_blockers(
    world: &WorldState,
    city: &City,
    ids: &HashSet<String>,
    size: i32,
) -> Vec<usize> {
    let Some(hall) = town_hall_of(world, city) else { return Vec::new() };
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.health > 0.0
                && !ids.contains(&r.id)
                && is_armed(&r.carried)
                && is_at((r.x as i32, r.y as i32), placed(hall), size)
                && contract_of(world, &r.id).is_none_or(|c| c.hirer_id != TRADE_ORG)
                && (r.owner.is_some() || defends_city(world, city, r, size))
        })
        .collect()
}

/// A city the Trade Organization took this tick, for the invariant (`CityTaken`).
#[derive(Debug, Clone, PartialEq)]
pub struct CityTaken {
    pub city_id: String,
    /// The Organization it belonged to.
    pub org: String,
    /// How many armies came to tear down workplaces for the debt.
    pub trips: f64,
    /// Whether that was enough for this step (`TRADE_ORG_DEBT_TRIPS`).
    pub enough_trips: bool,
}

thread_local! {
    /// The cities taken in the latest tick, kept beside the world (`ledger`): by the world's
    /// address, as the TypeScript keeps them by the world object.
    static LEDGER: RefCell<HashMap<usize, (u64, Vec<CityTaken>)>> = RefCell::new(HashMap::new());
}

fn key(world: &WorldState) -> usize {
    world as *const WorldState as usize
}

/// Writes down that a city was taken (`noteCityTaken`).
pub fn note_city_taken(world: &WorldState, taken: CityTaken) {
    LEDGER.with(|l| {
        let mut l = l.borrow_mut();
        match l.get_mut(&key(world)) {
            Some((tick, kept)) if *tick == world.tick => kept.push(taken),
            _ => {
                l.insert(key(world), (world.tick, vec![taken]));
            }
        }
    });
}

/// Test hook: the cities taken in the latest tick that took one (`citiesTakenOf`), and lets a test
/// tamper with them.
pub fn with_cities_taken<T>(world: &WorldState, f: impl FnOnce(&mut Vec<CityTaken>) -> T) -> T {
    LEDGER.with(|l| {
        let mut l = l.borrow_mut();
        let (_, kept) = l.entry(key(world)).or_insert((world.tick, Vec::new()));
        f(kept)
    })
}

/// A city the Trade Organization takes comes at the end of its steps and makes a working post
/// (`citiesTakenSound`, `CONTEXT.md`: Trade Org debt; ADR 0004): only after the set number of
/// trips, with no debt of that Organization left, as a post of no realm with no occupation, with a
/// warehouse and a storage to eat from.
pub fn cities_taken_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let taken = LEDGER.with(|l| match l.borrow().get(&key(world)) {
        Some((tick, kept)) if *tick == world.tick => kept.clone(),
        _ => Vec::new(),
    });
    let mut out = Vec::new();
    for t in taken {
        let mut fail = |message: String| {
            out.push(InvariantViolation {
                invariant: "cities-taken-sound".into(),
                message: format!("{}: {message}", t.city_id),
                entity_ids: vec![t.city_id.clone()],
            })
        };
        if !t.enough_trips {
            fail(format!("taken after {} trips", t.trips));
        }
        if world.debts.iter().any(|d| d.org == t.org) {
            fail(format!("{} still owes after it was taken", t.org));
        }
        let Some(city) = world.cities.iter().find(|c| c.id == t.city_id) else { continue };
        if city.trade_org != Some(TradeOrgCity::Post) {
            fail("taken, but no trading post".into());
        }
        if let Some(realm) = &city.realm_id {
            fail(format!("taken, but of realm {realm}"));
        }
        if city.occupation.is_some() {
            fail("taken, but still occupied".into());
        }
        let own = world
            .buildings
            .iter()
            .filter(|b| b.city_id.as_deref() == Some(city.id.as_str()) && b.site.is_none());
        let kinds: Vec<BuildingKind> = own.map(|b| b.kind).collect();
        if !kinds.contains(&BuildingKind::Storage) {
            fail("taken, with no storage to eat from".into());
        }
        if !kinds.contains(&BuildingKind::Warehouse) {
            fail("taken, with no warehouse".into());
        }
    }
    out
}
