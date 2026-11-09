//! Occupying a town hall and capturing a city (`CONTEXT.md`: Occupying a town hall, Capturing a
//! city, Integrating, What joins with a city), ported from `apps/server/src/capture.ts`.

use std::collections::HashSet;

use csp_shared::balance::{OCCUPATION_GAME_DAYS, TRADE_ORG_DEBT_TRIPS};
use csp_shared::footprint::is_at;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, CrimeKind, DebtWhat, RealmEventWhat, ResidentOrder, TradeOrgCity, WorldState,
};

use crate::crimes::{city_organization, commit_crime, CrimeAgainst};
use crate::defence::Alarms;
use crate::events::record_event;
use crate::names::{resident_names_taken, unique_name};
use crate::pending::{
    hq_falls, join_trade_org, leave_trade_org, rejoin_trade_org, workplaces_of_city,
};
use crate::queries::alliance::realm_name;
use crate::queries::carriages::driven_carriage_id;
use crate::queries::city::town_hall_of;
use crate::queries::city_area::{in_city_area, occupier_of, OCCUPATION_TICKS};
use crate::queries::names::placed;
use crate::queries::residents::is_armed;
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::trade_org_hq;
use crate::trade_org_takes::{note_city_taken, CityTaken};

/// A city that changed realm by capture this tick (`Capture`).
#[derive(Debug, Clone, PartialEq)]
pub struct Capture {
    pub city_id: String,
    /// The realm it belonged to; None for an NPC city.
    pub from: Option<String>,
    pub to: String,
}

fn city_index(world: &WorldState, city_id: &str) -> Option<usize> {
    world.cities.iter().position(|c| c.id == city_id)
}

/// Runs the occupations of town halls (`stepCaptures`): one starts the tick a realm occupies a
/// hall with none running; the first tick another realm or nobody does, it is broken; held
/// `OCCUPATION_TICKS`, the city is captured, or for the Trade Organization taken. Both realms'
/// logs say when one starts and when it is broken.
pub fn step_captures(world: &mut WorldState, size: i32, alarms: &mut dyn Alarms) -> Vec<Capture> {
    let mut captures = Vec::new();
    // A capture changes no city's place in the list; going by index keeps the TypeScript's order.
    for ci in 0..world.cities.len() {
        let occupier = occupier_of(world, &world.cities[ci], size);
        let running = world.cities[ci].occupation.as_ref().map(|o| o.realm_id.clone());
        if let Some(realm) = running {
            if Some(&realm) != occupier.as_ref() {
                occupation_logged(world, ci, &realm, false);
                world.cities[ci].occupation = None;
            }
        }
        let Some(occupier) = occupier else { continue };
        if world.cities[ci].occupation.is_none() {
            world.cities[ci].occupation = Some(csp_shared::world::Occupation {
                realm_id: occupier.clone(),
                since: world.tick as f64,
            });
            occupation_logged(world, ci, &occupier, true);
            let city_id = world.cities[ci].id.clone();
            alarms.raise_occupied(world, &city_id, &occupier, size);
        }
        let since = world.cities[ci].occupation.as_ref().map_or(0.0, |o| o.since);
        if (world.tick as f64) - since < OCCUPATION_TICKS {
            continue;
        }
        world.cities[ci].occupation = None;
        let city_id = world.cities[ci].id.clone();
        captures.push(Capture {
            city_id: city_id.clone(),
            from: world.cities[ci].realm_id.clone(),
            to: occupier.clone(),
        });
        if occupier == TRADE_ORG {
            take_city(world, &city_id, size);
        } else {
            capture_city(world, &city_id, &occupier, size);
        }
    }
    captures
}

/// The logs of the city's realm and of `occupier` say its town hall is occupied, or that its
/// occupation is broken (`occupationLogged`). An NPC city has no log. A city that joined the
/// occupier's realm meanwhile just ends it, unlogged.
fn occupation_logged(world: &mut WorldState, ci: usize, occupier: &str, occupied: bool) {
    let city = &world.cities[ci];
    if city.realm_id.as_deref() == Some(occupier) {
        return;
    }
    let hall = town_hall_of(world, city).map(|h| (h.x, h.y));
    let (city_id, name, owner) = (city.id.clone(), city.name.clone(), city.realm_id.clone());
    let event = |other: Option<String>, is_occupier: bool| {
        if occupied {
            // Occupying needs the hall standing, so a new occupation always has its place.
            let (x, y) = hall.expect("an occupied hall stands");
            RealmEventWhat::HallOccupied {
                city_id: city_id.clone(),
                city: name.clone(),
                other,
                occupier: is_occupier,
                days: OCCUPATION_GAME_DAYS,
                x,
                y,
            }
        } else {
            RealmEventWhat::OccupationBroken {
                city_id: city_id.clone(),
                city: name.clone(),
                other,
                occupier: is_occupier,
                x: hall.map(|h| h.0),
                y: hall.map(|h| h.1),
            }
        }
    };
    let to_occupier = event(owner.as_deref().map(|o| realm_name(world, o)), true);
    record_event(world, Some(occupier), to_occupier);
    let to_owner = event(Some(realm_name(world, occupier)), false);
    record_event(world, owner.as_deref(), to_owner);
}

/// A city joins the realm `captor` with everything in it (`captureCity`). A trading post's capture
/// is a crime against the Trade Organization, its witnesses counted once its residents have joined.
pub fn capture_city(world: &mut WorldState, city_id: &str, captor: &str, size: i32) {
    let Some(ci) = city_index(world, city_id) else { return };
    let city = &world.cities[ci];
    let from = city.realm_id.clone();
    let culprit = match (city.trade_org, town_hall_of(world, city)) {
        (Some(TradeOrgCity::Post), Some(hall)) => world
            .residents
            .iter()
            .find(|r| {
                r.owner.as_deref() == Some(captor)
                    && is_armed(&r.carried)
                    && is_at((r.x as i32, r.y as i32), placed(hall), size)
            })
            .map(|r| r.id.clone()),
        _ => None,
    };
    let residents = join_realm(world, city_id, captor, size) as f64;
    let city = &world.cities[ci];
    let (id, name) = (city.id.clone(), city.name.clone());
    let to_captor = RealmEventWhat::CityCaptured {
        city_id: id.clone(),
        city: name.clone(),
        other: from.as_deref().map(|f| realm_name(world, f)),
        captor: true,
        residents,
    };
    record_event(world, Some(captor), to_captor);
    let to_owner = RealmEventWhat::CityCaptured {
        city_id: id.clone(),
        city: name,
        other: Some(realm_name(world, captor)),
        captor: false,
        residents,
    };
    record_event(world, from.as_deref(), to_owner);
    let hq = trade_org_hq(world).map(|c| c.id.clone());
    if let (Some(culprit), Some(hq)) = (culprit, hq) {
        let against =
            CrimeAgainst { victim_org: Some(hq), post: Some(id), ..CrimeAgainst::default() };
        commit_crime(world, size, CrimeKind::Capture, &culprit, against);
    }
}

/// The Trade Organization's army held the town hall to the end (`takeCity`): the city joins it as
/// a new trading post and that settles all the debt of its Organization. No crime.
fn take_city(world: &mut WorldState, city_id: &str, size: i32) {
    let Some(ci) = city_index(world, city_id) else { return };
    let from = world.cities[ci].realm_id.clone();
    let org = city_organization(&world.cities[ci]).to_string();
    let worked = workplaces_of_city(world, city_id, size);
    let residents = change_hands(world, ci, None, size) as f64;
    let own: Vec<String> = worked
        .into_iter()
        .filter(|id| {
            world
                .buildings
                .iter()
                .find(|b| b.id == *id)
                .is_none_or(|b| b.city_id.as_deref() != Some(city_id))
        })
        .collect();
    let city = &mut world.cities[ci];
    // `[...new Set([...(workplaceIds ?? []), ...own])]`: the kept ones deduplicated too.
    let mut ids: Vec<String> = Vec::new();
    for id in city.workplace_ids.take().unwrap_or_default().into_iter().chain(own) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    city.workplace_ids = Some(ids);
    join_trade_org(world, city_id, size);
    let city = &world.cities[ci];
    let what = RealmEventWhat::CityCaptured {
        city_id: city.id.clone(),
        city: city.name.clone(),
        other: Some(realm_name(world, TRADE_ORG)),
        captor: false,
        residents,
    };
    record_event(world, from.as_deref(), what);
    let debt = world.debts.iter().position(|d| d.org == org);
    let trips = debt.and_then(|i| world.debts[i].trips).unwrap_or(0.0);
    note_city_taken(
        world,
        CityTaken {
            city_id: city_id.to_string(),
            org: org.clone(),
            trips,
            enough_trips: trips >= TRADE_ORG_DEBT_TRIPS,
        },
    );
    let Some(debt) = debt else { return };
    let debt = world.debts.remove(debt);
    record_event(
        world,
        Some(&org),
        RealmEventWhat::Debt { what: DebtWhat::CityTaken, coins: debt.coins, owed: 0.0 },
    );
}

/// A city handed over joins the realm `to` as a captured one does (`handOverCity`), the logs that
/// say so the caller's. An occupation by a third realm goes on against the new owner, whose log
/// says how long is left.
pub fn hand_over_city(world: &mut WorldState, city_id: &str, to: &str, size: i32) {
    join_realm(world, city_id, to, size);
    let Some(ci) = city_index(world, city_id) else { return };
    let city = &world.cities[ci];
    let (Some(running), Some(hall)) = (city.occupation.clone(), town_hall_of(world, city)) else {
        return;
    };
    if running.realm_id == to {
        return;
    }
    let ticks_left = running.since + OCCUPATION_TICKS - world.tick as f64;
    let what = RealmEventWhat::HallOccupied {
        city_id: city.id.clone(),
        city: city.name.clone(),
        x: hall.x,
        y: hall.y,
        days: 1f64.max((ticks_left / TICKS_PER_GAME_DAY).ceil()),
        other: Some(realm_name(world, &running.realm_id)),
        occupier: false,
    };
    record_event(world, Some(to), what);
}

/// A city joins the realm `captor` with everything in it, captured or bought (`joinRealm`); a
/// trading post leaves the Trade Organization, and so does its HQ. Returns how many of its
/// residents joined.
pub fn join_realm(world: &mut WorldState, city_id: &str, captor: &str, size: i32) -> usize {
    let Some(ci) = city_index(world, city_id) else { return 0 };
    let joined = change_hands(world, ci, Some(captor), size);
    if world.cities[ci].trade_org == Some(TradeOrgCity::Hq) {
        hq_falls(world, city_id);
    } else {
        leave_trade_org(world, city_id);
    }
    joined
}

/// A captured post goes back to the Trade Organization (`returnPost`): everything that joined a
/// realm with it goes the other way, and it is a post again.
pub fn return_post(world: &mut WorldState, city_id: &str, size: i32) {
    let Some(ci) = city_index(world, city_id) else { return };
    change_hands(world, ci, None, size);
    rejoin_trade_org(world, city_id, size);
}

/// The city and all that goes with it change hands, to the realm `to` or, for none, to the city
/// itself (`changeHands`). Returns how many of its residents went with it.
fn change_hands(world: &mut WorldState, ci: usize, to: Option<&str>, size: i32) -> usize {
    let city_id = world.cities[ci].id.clone();
    let leaders: HashSet<String> = world.realms.iter().map(|r| r.leader_id.clone()).collect();
    let joining: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.city_id.as_deref() == Some(city_id.as_str()) && !leaders.contains(&r.id)
        })
        .collect();
    let joined: HashSet<String> = joining.iter().map(|&i| world.residents[i].id.clone()).collect();
    // Asked before those who join drop their orders, a drive or haul among them.
    let comes_along = comes_with_city(world, ci, &joining, size);
    let mut names =
        resident_names_taken(world, to, if to.is_none() { Some(city_id.as_str()) } else { None });
    for r in &mut world.residents {
        if r.city_id.as_deref() != Some(city_id.as_str()) {
            continue;
        }
        if joined.contains(&r.id) {
            if r.game_name == Some(true) {
                r.name = unique_name(&r.name, &names, &[]);
            }
            names.insert(r.name.clone());
            r.owner = to.map(str::to_string);
            r.order = None;
            if r.pair.as_ref().is_some_and(|p| !joined.contains(&p.partner_id)) {
                r.pair = None;
            }
        } else {
            r.city_id = None;
            r.pair = None;
        }
    }
    let realm_id = to.map(str::to_string);
    let horse_city = if to.is_none() { Some(city_id.clone()) } else { None };
    let mut carriages = HashSet::new();
    for k in 0..world.carriages.len() {
        if !comes_along.carriages[k] {
            continue;
        }
        let carriage = &mut world.carriages[k];
        carriage.realm_id = realm_id.clone();
        carriage.city_id = horse_city.clone();
        carriages.insert(carriage.id.clone());
        let horse = carriage.horse_id.clone();
        if let Some(h) = world.horses.iter_mut().find(|h| Some(&h.id) == horse.as_ref()) {
            h.realm_id = realm_id.clone();
            h.city_id = horse_city.clone();
        }
    }
    for (h, along) in world.horses.iter_mut().zip(&comes_along.horses) {
        if *along {
            h.realm_id = realm_id.clone();
            h.city_id = horse_city.clone();
        }
    }
    let owners: std::collections::HashMap<String, Option<String>> =
        world.residents.iter().map(|r| (r.id.clone(), r.owner.clone())).collect();
    for r in &mut world.residents {
        if driven_carriage_id(r).is_some_and(|d| carriages.contains(d)) && !joined.contains(&r.id) {
            r.order = None;
        }
        if let Some(ResidentOrder::Attack(o)) = &r.order {
            if r.owner.is_some() && owners.get(&o.target_id).is_some_and(|t| *t == r.owner) {
                r.order = None;
            }
        }
    }
    let city = &mut world.cities[ci];
    city.realm_id = realm_id;
    // A Player's city has no layout (`CONTEXT.md`: City layout).
    city.layout = None;
    // Only a city of no realm has a plan, and this tick's planning is over.
    world.city_plans.shift_remove(&city_id);
    joining.len()
}

/// Which horses and carriages join with a city (`comesWithCity`), decided before anything moves:
/// an NPC city's are all its own, a Player's those in its area or at its stables; either way a
/// horse one of the `joining` residents rides and a carriage one drives. Flags by index.
struct ComesAlong {
    horses: Vec<bool>,
    carriages: Vec<bool>,
}

fn comes_with_city(world: &WorldState, ci: usize, joining: &[usize], size: i32) -> ComesAlong {
    let city = &world.cities[ci];
    let from = city.realm_id.as_deref();
    let mut along: HashSet<&str> = HashSet::new();
    for &i in joining {
        let r = &world.residents[i];
        if let Some(h) = &r.riding {
            along.insert(h);
        }
        if let Some(k) = driven_carriage_id(r) {
            along.insert(k);
        }
    }
    let stables: Vec<_> = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Stable
                && b.site.is_none()
                && b.city_id.as_deref() == Some(city.id.as_str())
        })
        .collect();
    let comes = |id: &str, realm: Option<&str>, home: Option<&str>, x: f64, y: f64| {
        if along.contains(id) {
            return true;
        }
        match from {
            None => realm.is_none() && home == Some(city.id.as_str()),
            Some(from) => {
                realm == Some(from)
                    && (in_city_area(world, &city.id, x, y, size)
                        || stables.iter().any(|s| is_at((x as i32, y as i32), placed(s), size)))
            }
        }
    };
    ComesAlong {
        horses: world
            .horses
            .iter()
            .map(|h| comes(&h.id, h.realm_id.as_deref(), h.city_id.as_deref(), h.x, h.y))
            .collect(),
        carriages: world
            .carriages
            .iter()
            .map(|k| comes(&k.id, k.realm_id.as_deref(), k.city_id.as_deref(), k.x, k.y))
            .collect(),
    }
}

#[cfg(test)]
mod tests;
