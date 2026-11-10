//! Outsiders in a City area (`apps/server/src/outsiders.ts`; `CONTEXT.md`: Alarm, outsider;
//! ADR 0028). Who is inside is plain data on the city (`City::outsiders`), brought up to date once
//! a tick: one who wasn't on it last tick just came in, which raises the alarm once, and one who
//! left drops off it, so coming back raises it again. This runs for every city each tick, so the
//! areas are indexed once and each resident looks only at those near them (ADR 0016).
//!
//! The TypeScript keeps its area index between ticks and checks with one walk over the buildings
//! that it still stands; building it is that same walk, so it is built afresh each call here.

use std::collections::{HashMap, HashSet};

use csp_shared::balance::CITY_AREA_MARGIN;
use csp_shared::footprint::{near_footprint, FOOTPRINT};
use csp_shared::world::{City, Resident, WorldState};

use crate::alarms::raise_outsider;
use crate::caravans::caravan_crew;
use crate::queries::alliance::{allied, commander_of};
use crate::queries::city_area::is_city_building;
use crate::queries::names::{kind_name, placed};
use crate::queries::residents::is_armed;
use crate::sight::InvariantViolation;

/// Tiles along a side of a square of the index, at least (`SQUARE_TILES`). An area is far narrower
/// than this, so it lies in at most two squares along each direction.
const SQUARE_TILES: i32 = 32;

/// The margin round a city building that its area reaches, in tiles.
const MARGIN: i32 = CITY_AREA_MARGIN as i32;

/// Whether the city keeps track of outsiders: trading posts and the HQ keep their own rules
/// (`watches`).
fn watches(city: &City) -> bool {
    city.trade_org.is_none()
}

/// The buildings that make up each city's area, by square, a building under every square its
/// area reaches into (`AreaIndex`): per square, the cities in the order their first building
/// came, each with its buildings by index. Scratch, never saved (ADR 0006).
struct AreaIndex {
    across: i32,
    side: f64,
    size: i32,
    squares: HashMap<i32, Vec<(usize, Vec<usize>)>>,
}

impl AreaIndex {
    /// The square a coordinate falls in along one direction (`square`).
    fn square(&self, v: f64) -> i32 {
        let size = f64::from(self.size);
        let wrapped = ((v % size) + size) % size;
        ((wrapped / self.side).floor() as i32).min(self.across - 1)
    }

    /// The square a resident stands in (`key`).
    fn key(&self, r: &Resident) -> i32 {
        self.square(r.y) * self.across + self.square(r.x)
    }

    fn add(&mut self, key: i32, city: usize, b: usize) {
        let near = self.squares.entry(key).or_default();
        match near.iter_mut().find(|(c, _)| *c == city) {
            Some((_, list)) => list.push(b),
            None => near.push((city, vec![b])),
        }
    }
}

/// The world's area index (`areasBySquare`).
fn areas_by_square(world: &WorldState, size: i32) -> AreaIndex {
    let across = (size / SQUARE_TILES).max(1);
    let mut index =
        AreaIndex { across, side: f64::from(size) / f64::from(across), size, squares: HashMap::new() };
    let cities: HashMap<&str, usize> =
        world.cities.iter().enumerate().map(|(i, c)| (c.id.as_str(), i)).collect();
    for (bi, b) in world.buildings.iter().enumerate() {
        let Some(city_id) = b.city_id.as_deref() else { continue };
        if !is_city_building(b) {
            continue;
        }
        let Some(&city) = cities.get(city_id) else { continue };
        let side = FOOTPRINT.get(kind_name(b.kind)).expect("every kind has a footprint");
        let far = f64::from(side - 1 + MARGIN);
        let margin = f64::from(MARGIN);
        let (x0, x1) = (index.square(b.x - margin), index.square(b.x + far));
        let (y0, y1) = (index.square(b.y - margin), index.square(b.y + far));
        index.add(y0 * across + x0, city, bi);
        if x1 != x0 {
            index.add(y0 * across + x1, city, bi);
        }
        if y1 != y0 {
            index.add(y1 * across + x0, city, bi);
        }
        if x1 != x0 && y1 != y0 {
            index.add(y1 * across + x1, city, bi);
        }
    }
    index
}

/// The side a resident is on: their realm, else their NPC city (`r.owner ?? r.cityId`).
fn side_of(r: &Resident) -> Option<&str> {
    r.owner.as_deref().or(r.city_id.as_deref())
}

/// The side a city is on: its realm, else itself (`city.realmId ?? city.id`).
fn city_side(city: &City) -> &str {
    city.realm_id.as_deref().unwrap_or(&city.id)
}

/// Whether `r` counts as an outsider for `city`, wherever they stand (`outsiderTo`, `CONTEXT.md`:
/// Alarm): of another realm, or of another NPC city, and not allied; someone hired by the city's
/// realm or an ally of it is on its side. Crews of caravans and wandering traders are left out by
/// the caller.
fn outsider_to(world: &WorldState, city: &City, r: &Resident) -> bool {
    let Some(theirs) = side_of(r) else { return false };
    let side = city_side(city);
    if allied(world, side, theirs) {
        return false;
    }
    match commander_of(world, &r.id, r.owner.as_deref()) {
        None => true,
        Some(by) => by == theirs || !allied(world, side, &by),
    }
}

/// Whether `r` stands within the area of one of `buildings`.
fn in_area(world: &WorldState, buildings: &[usize], r: &Resident, size: i32) -> bool {
    buildings.iter().any(|&b| {
        near_footprint(placed(&world.buildings[b]), (r.x as i32, r.y as i32), MARGIN, size)
    })
}

/// The outsiders standing in each watching city's area, by city index, each list in the order of
/// `world.residents` (`outsidersByCity`).
fn outsiders_by_city(world: &WorldState, size: i32) -> HashMap<usize, Vec<String>> {
    let index = areas_by_square(world, size);
    let mut inside: HashMap<usize, Vec<String>> = HashMap::new();
    let mut crew: Option<HashSet<String>> = None;
    for r in &world.residents {
        let Some(near) = index.squares.get(&index.key(r)) else { continue };
        let theirs = side_of(r);
        for (ci, buildings) in near {
            let city = &world.cities[*ci];
            // Nearly everyone stands at home, and is done with here.
            if Some(city_side(city)) == theirs || !watches(city) {
                continue;
            }
            if !in_area(world, buildings, r, size) || !outsider_to(world, city, r) {
                continue;
            }
            if crew.get_or_insert_with(|| caravan_crew(world)).contains(&r.id) {
                continue;
            }
            inside.entry(*ci).or_default().push(r.id.clone());
        }
    }
    inside
}

/// Brings every city's `outsiders` up to date, and raises the alarm for each one who just came in
/// (`stepOutsiders`, `raise_outsider`). The armed go first: one alarm doesn't interrupt another,
/// so someone armed among those coming in together isn't missed for an unarmed one, who is only
/// logged.
pub fn step_outsiders(world: &mut WorldState, size: i32) {
    let mut inside = outsiders_by_city(world, size);
    for ci in 0..world.cities.len() {
        let now = inside.remove(&ci);
        let city = &mut world.cities[ci];
        if now.is_none() && city.outsiders.is_none() {
            continue;
        }
        let before = std::mem::replace(&mut city.outsiders, now.clone());
        let Some(now) = now else { continue };
        let known: HashSet<String> = before.unwrap_or_default().into_iter().collect();
        let came: Vec<String> = now.into_iter().filter(|id| !known.contains(id)).collect();
        let city_id = world.cities[ci].id.clone();
        for armed in [true, false] {
            for id in &came {
                let is = world.residents.iter().find(|r| &r.id == id).is_some_and(|r| is_armed(&r.carried));
                if is == armed {
                    raise_outsider(world, &city_id, id, size);
                }
            }
        }
    }
}

/// Those standing in each city's area right now, as if they had always been there
/// (`noteOutsidersInside`): for a world from before cities kept track, so nobody rings for having
/// come in before there were alarms.
pub fn note_outsiders_inside(world: &mut WorldState, size: i32) {
    for (ci, list) in outsiders_by_city(world, size) {
        world.cities[ci].outsiders = Some(list);
    }
}

/// Invariant `outsiders-sound` (`outsidersSound`, ADR 0004; `CONTEXT.md`: Alarm): a city's
/// outsiders are there as of the tick that just ended: each one once, alive, of no side of the
/// city's and standing in its area. A list is never left empty, and trading posts and the HQ keep
/// none.
pub fn outsiders_sound(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let crew = caravan_crew(world);
    let by_id: HashMap<&str, &Resident> = world.residents.iter().map(|r| (r.id.as_str(), r)).collect();
    let mut out = Vec::new();
    for city in &world.cities {
        let Some(list) = &city.outsiders else { continue };
        let mut problem = |message: String, ids: &[&str]| {
            let mut entity_ids = vec![city.id.clone()];
            entity_ids.extend(ids.iter().map(|id| id.to_string()));
            out.push(InvariantViolation {
                invariant: "outsiders-sound".into(),
                message: format!("{} {message}", city.id),
                entity_ids,
            });
        };
        if list.is_empty() {
            problem("keeps an empty list of outsiders".into(), &[]);
        }
        if !watches(city) {
            problem("keeps outsiders, but keeps its own rules".into(), &[]);
        }
        if list.iter().collect::<HashSet<_>>().len() != list.len() {
            problem("lists an outsider twice".into(), &[]);
        }
        let area: Vec<usize> = (0..world.buildings.len())
            .filter(|&i| {
                let b = &world.buildings[i];
                b.city_id.as_deref() == Some(city.id.as_str()) && is_city_building(b)
            })
            .collect();
        for id in list {
            match by_id.get(id.as_str()) {
                None => problem(format!("lists {id}, who is gone"), &[id]),
                Some(r) if !outsider_to(world, city, r) || crew.contains(id) => {
                    problem(format!("lists {id}, who is no outsider"), &[id]);
                }
                Some(r) if !in_area(world, &area, r, size) => {
                    problem(format!("lists {id}, who stands outside its area"), &[id]);
                }
                Some(_) => {}
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;
