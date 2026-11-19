//! Drifters (`CONTEXT.md`: Drifter; Epic 115): a grown resident who comes to a small Player realm
//! on their own. While a realm has fewer residents than `DRIFTER_REALM_CAP`, its Leader lives, and
//! the city the Leader lives in has free housing and a food surplus, the realm's wait counts up
//! (`world.drifter_waits`); after `DRIFTER_WAIT_DAYS` a drifter comes into being out of every
//! Player's sight, `DRIFTER_DISTANCE_MIN` to `DRIFTER_DISTANCE_MAX` tiles from the town hall, and
//! walks there (`world.drifters`). On the way they belong to no Organization: no owner, no city.
//! Stepping into the city's area they join it, idle, and the realm log names them; if the city
//! then has no room, is no longer the realm's, or the realm is at the cap, they turn round and
//! are gone once no Player sees them. One at a time: the next wait counts once they have joined,
//! turned away or died.
//!
//! Who is on the way counts: a drifter towards the cap and the city's housing, and relocating
//! residents and children on the way towards its housing, as they do for pairing.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use csp_shared::balance::{
    DRIFTER_DISTANCE_MAX, DRIFTER_DISTANCE_MIN, DRIFTER_FOOD, DRIFTER_REALM_CAP, DRIFTER_WAIT_DAYS,
};
use csp_shared::terrain::{is_passable_terrain, terrain_at, wrap, wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Drifter, Good, Realm, RealmEventWhat, Resident, ResidentOrder, Tile, WalkOrder, WorldState,
};

use crate::events::record_event;
use crate::invariants::violation;
use crate::names::{resident_names_taken, unique_name};
use crate::queries::city::{has_food_surplus, town_hall_of};
use crate::queries::city_area::{free_housing, in_city_area};
use crate::queries::people::relocating_to;
use crate::random::{hash_str, new_id, Mulberry32};
use crate::relocating::nearest_area_tile;
use crate::residents::{new_resident, NewResident, RESIDENT_NAMES};
use crate::sight::{sight_of, Eyes, InvariantViolation, Spot};
use crate::tick::Scratch;
use crate::world_index::{resident_index, world_index, WorldIndex};

/// Ticks a realm waits for each drifter.
pub const DRIFTER_WAIT_TICKS: f64 = DRIFTER_WAIT_DAYS * TICKS_PER_GAME_DAY;

/// Why no drifter sets out for a realm now (`CONTEXT.md`: Drifters on the city card).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoDrifter {
    /// The Leader is dead, or lives in no city of the realm (none that is a Player's city).
    NoLeaderCity,
    /// The realm has `DRIFTER_REALM_CAP` residents, the drifter on the way counted.
    RealmTooBig,
    /// The Leader's city has no free housing, those on their way counted.
    NoFreeHousing,
    /// The Leader's city has no food surplus.
    NoFoodSurplus,
}

/// Whether a resident is alive, Down ones too.
fn living(r: &Resident) -> bool {
    r.health > 0.0 || r.down_until.is_some()
}

/// The realm's living residents.
pub fn realm_residents(world: &WorldState, realm_id: &str) -> usize {
    world.residents.iter().filter(|r| living(r) && r.owner.as_deref() == Some(realm_id)).count()
}

/// The drifter on their way to a realm, if one is (not one turned away).
pub fn drifter_on_the_way<'w>(world: &'w WorldState, realm_id: &str) -> Option<&'w Drifter> {
    world.drifters.iter().find(|d| d.realm_id == realm_id && !d.turned_away)
}

/// A city's free housing less everyone on their way to live there: children carried by its
/// residents, residents relocating to it and drifters walking to it. Can be below 0.
pub fn drifter_room(world: &WorldState, city_id: &str) -> f64 {
    let carried = world
        .residents
        .iter()
        .filter(|r| r.carrying.is_some() && r.city_id.as_deref() == Some(city_id))
        .count();
    let relocating = relocating_to(world, city_id).len();
    let drifting = world.drifters.iter().filter(|d| d.city_id == city_id && !d.turned_away).count();
    free_housing(world, city_id) - (carried + relocating + drifting) as f64
}

/// The city of the realm's Leader, if they live and it is a Player's city of the realm (no
/// trading post or HQ), by its index.
pub fn leader_city(world: &WorldState, realm: &Realm) -> Option<usize> {
    let leader = world.residents.iter().find(|r| r.id == realm.leader_id && living(r))?;
    let city_id = leader.city_id.as_deref()?;
    world.cities.iter().position(|c| {
        c.id == city_id && c.realm_id.as_deref() == Some(realm.id.as_str()) && c.trade_org.is_none()
    })
}

/// The city a drifter would set out for now, or why none would (`CONTEXT.md`: Drifter): the
/// Leader's city while the realm, the drifter on the way counted, is below the cap and the city
/// has room and a food surplus. `residents` is the realm's living residents.
pub fn drifter_city(
    world: &WorldState,
    realm: &Realm,
    residents: usize,
) -> Result<usize, NoDrifter> {
    let ci = leader_city(world, realm).ok_or(NoDrifter::NoLeaderCity)?;
    let coming = usize::from(drifter_on_the_way(world, &realm.id).is_some());
    if (residents + coming) as f64 >= DRIFTER_REALM_CAP {
        return Err(NoDrifter::RealmTooBig);
    }
    let city = &world.cities[ci];
    if drifter_room(world, &city.id) <= 0.0 {
        return Err(NoDrifter::NoFreeHousing);
    }
    if !has_food_surplus(world, city) {
        return Err(NoDrifter::NoFoodSurplus);
    }
    Ok(ci)
}

/// What the realm's Player sees of their next drifter (`CONTEXT.md`: Drifters on the city card):
/// one on their way, the ticks left until the next sets out, or why none comes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DrifterOutlook {
    OnTheWay,
    Next { ticks: f64 },
    None(NoDrifter),
}

/// The realm's drifter outlook now.
pub fn drifter_outlook(world: &WorldState, realm: &Realm) -> DrifterOutlook {
    if drifter_on_the_way(world, &realm.id).is_some() {
        return DrifterOutlook::OnTheWay;
    }
    match drifter_city(world, realm, realm_residents(world, &realm.id)) {
        Ok(_) => {
            let waited = world.drifter_waits.get(&realm.id).copied().unwrap_or(0.0);
            DrifterOutlook::Next { ticks: (DRIFTER_WAIT_TICKS - waited).max(0.0) }
        }
        Err(why) => DrifterOutlook::None(why),
    }
}

/// Each Player's eyes, theirs and their allies' (`CONTEXT.md`: Sight).
fn players_eyes(world: &WorldState, index: &WorldIndex) -> Vec<Arc<Eyes>> {
    world.realms.iter().map(|r| sight_of(world, index, &r.id, None)).collect()
}

fn seen(eyes: &[Arc<Eyes>], x: f64, y: f64) -> bool {
    eyes.iter().any(|e| e.sees(Spot { x, y }))
}

/// Steps the drifters (`CONTEXT.md`: Drifter), late in the tick, once births, captures and ruins
/// have changed the cities: the drifters walk on, join, turn away or are gone; then each realm's
/// wait counts and a drifter sets out for each realm whose wait is over.
pub fn step_drifters(world: &mut WorldState, terrain: &TerrainMap, scratch: &mut Scratch) {
    // A realm that is gone waits no more; a drifter who died is no longer on the way.
    let realms: HashSet<String> = world.realms.iter().map(|r| r.id.clone()).collect();
    world.drifter_waits.retain(|id, _| realms.contains(id));
    let alive: HashSet<String> = world.residents.iter().map(|r| r.id.clone()).collect();
    world.drifters.retain(|d| alive.contains(&d.resident_id));
    walk_on(world, terrain, scratch);
    set_out(world, terrain, scratch);
}

/// The drifters on their way join, turn away or keep walking; those turned away are gone once no
/// Player sees them.
fn walk_on(world: &mut WorldState, terrain: &TerrainMap, scratch: &mut Scratch) {
    let size = terrain.size;
    let mut gone: Vec<String> = Vec::new();
    let mut joined: Vec<String> = Vec::new();
    let mut eyes: Option<Vec<Arc<Eyes>>> = None;
    for di in 0..world.drifters.len() {
        let d = world.drifters[di].clone();
        let Some(ri) = resident_index(world, &d.resident_id) else { continue };
        if d.turned_away {
            let eyes = eyes.get_or_insert_with(|| {
                players_eyes(world, world_index(&mut scratch.index, world, size))
            });
            let r = &world.residents[ri];
            if !seen(eyes, r.x, r.y) {
                gone.push(d.resident_id.clone());
                continue;
            }
            let home = (r.x as i32, r.y as i32) == (d.from.x as i32, d.from.y as i32);
            if !home && r.order.is_none() && r.down_until.is_none() {
                walk_to(&mut world.residents[ri], (d.from.x, d.from.y));
            }
            continue;
        }
        let city = world.cities.iter().position(|c| c.id == d.city_id);
        let realm = world.realms.iter().any(|r| r.id == d.realm_id);
        let Some(ci) = city.filter(|_| realm) else {
            turn_away(world, di, ri);
            continue;
        };
        let r = &world.residents[ri];
        if in_city_area(world, &d.city_id, r.x, r.y, size) {
            if may_join(world, &d, ci) {
                join(world, &d, ri, ci);
                joined.push(d.resident_id.clone());
            } else {
                turn_away(world, di, ri);
            }
            continue;
        }
        if r.order.is_none() && r.down_until.is_none() {
            let to = nearest_area_tile(world, ci, (r.x, r.y), Some(terrain))
                .or_else(|| town_hall_of(world, &world.cities[ci]).map(|h| (h.x, h.y)));
            match to {
                Some(to) => walk_to(&mut world.residents[ri], to),
                None => turn_away(world, di, ri),
            }
        }
    }
    world.drifters.retain(|d| !joined.contains(&d.resident_id));
    if !gone.is_empty() {
        world.residents.retain(|r| !gone.contains(&r.id));
        world.drifters.retain(|d| !gone.contains(&d.resident_id));
        for id in &gone {
            world.wear.shift_remove(id);
        }
    }
}

/// Whether a drifter at the city may join it: it is still their realm's, has room with them
/// counted no more, and the realm is below the cap.
fn may_join(world: &WorldState, d: &Drifter, ci: usize) -> bool {
    let city = &world.cities[ci];
    city.realm_id.as_deref() == Some(d.realm_id.as_str())
        && drifter_room(world, &city.id) + 1.0 > 0.0
        && (realm_residents(world, &d.realm_id) as f64) < DRIFTER_REALM_CAP
}

/// A drifter joins the city and its realm, idle, with a game-given name no living resident of
/// the realm has; the realm log names them.
fn join(world: &mut WorldState, d: &Drifter, ri: usize, ci: usize) {
    let city = &world.cities[ci];
    let (city_id, city_name) = (city.id.clone(), city.name.clone());
    let at = town_hall_of(world, city).map_or((0.0, 0.0), |h| (h.x, h.y));
    let taken = resident_names_taken(world, Some(&d.realm_id), Some(&city_id));
    let r = &mut world.residents[ri];
    if taken.contains(&r.name) {
        r.name = unique_name(&r.name, &taken, &RESIDENT_NAMES);
    }
    r.owner = Some(d.realm_id.clone());
    r.city_id = Some(city_id);
    r.order = None;
    let what = RealmEventWhat::DrifterJoined {
        resident_id: r.id.clone(),
        name: r.name.clone(),
        city: city_name,
        x: at.0,
        y: at.1,
    };
    record_event(world, Some(&d.realm_id), what);
}

/// A drifter turns round, walking back to where they came from.
fn turn_away(world: &mut WorldState, di: usize, ri: usize) {
    let d = &mut world.drifters[di];
    d.turned_away = true;
    let from = (d.from.x, d.from.y);
    let r = &mut world.residents[ri];
    if r.down_until.is_none() {
        walk_to(r, from);
    }
}

/// Gives a resident a walk order to a tile.
fn walk_to(r: &mut Resident, (x, y): (f64, f64)) {
    r.order = Some(ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: None,
    }));
}

/// Each realm's wait counts while a drifter may come; a drifter sets out for each realm whose
/// wait is over, and its next wait begins.
fn set_out(world: &mut WorldState, terrain: &TerrainMap, scratch: &mut Scratch) {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for r in world.residents.iter().filter(|r| living(r)) {
        if let Some(owner) = r.owner.as_deref() {
            *counts.entry(owner).or_insert(0) += 1;
        }
    }
    let mut due: Vec<(usize, usize)> = Vec::new();
    for (i, realm) in world.realms.iter().enumerate() {
        let residents = counts.get(realm.id.as_str()).copied().unwrap_or(0);
        // Cheapest first: a grown realm or one with a drifter on the way waits no more.
        if residents as f64 >= DRIFTER_REALM_CAP || drifter_on_the_way(world, &realm.id).is_some() {
            continue;
        }
        if let Ok(ci) = drifter_city(world, realm, residents) {
            due.push((i, ci));
        }
    }
    let mut eyes: Option<Vec<Arc<Eyes>>> = None;
    for (i, ci) in due {
        let realm_id = world.realms[i].id.clone();
        let waited = world.drifter_waits.get(&realm_id).copied().unwrap_or(0.0) + 1.0;
        if waited < DRIFTER_WAIT_TICKS {
            world.drifter_waits.insert(realm_id, waited);
            continue;
        }
        // Whether or not a tile is found, the next wait begins: a city with nowhere out of sight
        // to come from tries again after it.
        world.drifter_waits.shift_remove(&realm_id);
        let eyes = eyes.get_or_insert_with(|| {
            players_eyes(world, world_index(&mut scratch.index, world, terrain.size))
        });
        if let Some(from) = drifter_tile(world, terrain, ci, &realm_id, eyes) {
            come_into_being(world, terrain, &realm_id, ci, from);
        }
    }
}

/// Where a drifter for the city comes into being: a passable tile `DRIFTER_DISTANCE_MIN` to
/// `DRIFTER_DISTANCE_MAX` tiles from its town hall that no Player sees and that a walk over
/// passable tiles from the hall reaches within that distance, drawn from the world's seed, the
/// tick and the realm. None when there is none.
pub fn drifter_tile(
    world: &WorldState,
    terrain: &TerrainMap,
    ci: usize,
    realm_id: &str,
    eyes: &[Arc<Eyes>],
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let hall = town_hall_of(world, &world.cities[ci])?;
    let start = (hall.x as i32, hall.y as i32);
    let passable = |(x, y): (i32, i32)| is_passable_terrain(terrain_at(terrain, x, y));
    let mut queue = VecDeque::from([start]);
    let mut reached: HashSet<(i32, i32)> = HashSet::from([start]);
    let mut spots: Vec<(i32, i32)> = Vec::new();
    while let Some((x, y)) = queue.pop_front() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let t = (wrap(x + dx, size), wrap(y + dy, size));
            if reached.contains(&t) || !passable(t) {
                continue;
            }
            let d = wrap_distance(size, start, t);
            if d > DRIFTER_DISTANCE_MAX {
                continue;
            }
            reached.insert(t);
            queue.push_back(t);
            if d >= DRIFTER_DISTANCE_MIN && !seen(eyes, f64::from(t.0), f64::from(t.1)) {
                spots.push(t);
            }
        }
    }
    if spots.is_empty() {
        return None;
    }
    let mut rand =
        Mulberry32::new(f64::from(hash_str(&format!("{}:{}:{realm_id}", world.seed, world.tick))));
    Some(spots[(rand.next() * spots.len() as f64).floor() as usize % spots.len()])
}

/// A drifter comes into being on `from` and sets out for the city: drawn as a starting city's
/// resident is, with a game-given name no living resident of the realm has, carrying
/// `DRIFTER_FOOD` and nothing else, of no Organization.
fn come_into_being(
    world: &mut WorldState,
    terrain: &TerrainMap,
    realm_id: &str,
    ci: usize,
    from: (i32, i32),
) {
    let id = new_id("r", &mut world.next_id);
    let mut taken = resident_names_taken(world, Some(realm_id), None);
    let mut rand = Mulberry32::new(f64::from(hash_str(&format!("{}:{id}", world.seed))));
    let (x, y) = (f64::from(from.0), f64::from(from.1));
    let place = NewResident { id: &id, owner: None, city_id: None, x, y, tick: world.tick as f64 };
    let mut r = new_resident(&mut || rand.next(), &place, Some(&mut taken));
    r.carried = [(Good::Food, DRIFTER_FOOD)].into_iter().collect();
    let to = nearest_area_tile(world, ci, (x, y), Some(terrain))
        .or_else(|| town_hall_of(world, &world.cities[ci]).map(|h| (h.x, h.y)))
        .unwrap_or((x, y));
    walk_to(&mut r, to);
    world.residents.push(r);
    world.drifters.push(Drifter {
        resident_id: id,
        realm_id: realm_id.to_string(),
        city_id: world.cities[ci].id.clone(),
        from: Tile { x, y },
        set_out_at: world.tick as f64,
        turned_away: false,
    });
}

/// Invariant `drifters-sound` (ADR 0004; `CONTEXT.md`: Drifter): every drifter is a living
/// resident of no Organization, listed once; at most one is on the way to each realm; and one who
/// set out this tick is where they came into being, out of every Player's sight.
pub fn drifters_sound(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let name = "drifters-sound";
    let mut out = Vec::new();
    let mut listed: HashSet<&str> = HashSet::new();
    let mut coming: HashSet<&str> = HashSet::new();
    let mut fresh: Vec<&Resident> = Vec::new();
    for d in &world.drifters {
        let id = d.resident_id.as_str();
        if !listed.insert(id) {
            out.push(violation(name, format!("drifter {id} is listed twice"), &[id]));
        }
        if !d.turned_away && !coming.insert(d.realm_id.as_str()) {
            let m = format!("two drifters are on their way to realm {}", d.realm_id);
            out.push(violation(name, m, &[id]));
        }
        match world.residents.iter().find(|r| r.id == id) {
            None => out.push(violation(name, format!("drifter {id} is no resident"), &[id])),
            Some(r) if r.owner.is_some() || r.city_id.is_some() => {
                let m = format!("drifter {id} belongs to an Organization");
                out.push(violation(name, m, &[id]));
            }
            Some(r) if d.set_out_at == world.tick as f64 => fresh.push(r),
            Some(_) => {}
        }
    }
    if !fresh.is_empty() {
        let index = WorldIndex::new(world, terrain.size);
        let eyes = players_eyes(world, &index);
        for r in fresh {
            if seen(&eyes, r.x, r.y) {
                let m = format!("drifter {} came into being in a Player's sight", r.id);
                out.push(violation(name, m, &[&r.id]));
            }
        }
    }
    out
}

/// Invariant `drifters-join-with-room` (ADR 0004; `CONTEXT.md`: Drifter): a drifter who joined
/// this tick joined a city with room for them, those still on their way counted, and a realm no
/// bigger than the cap.
pub fn drifters_join_with_room(world: &WorldState, _: &TerrainMap) -> Vec<InvariantViolation> {
    let name = "drifters-join-with-room";
    let mut out = Vec::new();
    for e in world.events.iter().rev().take_while(|e| e.tick == world.tick) {
        let RealmEventWhat::DrifterJoined { resident_id, .. } = &e.what else { continue };
        let Some(r) = world.residents.iter().find(|r| &r.id == resident_id) else { continue };
        let (Some(owner), Some(city)) = (r.owner.as_deref(), r.city_id.as_deref()) else {
            continue;
        };
        if drifter_room(world, city) < 0.0 {
            let m = format!("drifter {resident_id} joined {city}, which has no room for them");
            out.push(violation(name, m, &[resident_id]));
        }
        if realm_residents(world, owner) as f64 > DRIFTER_REALM_CAP {
            let m = format!("drifter {resident_id} joined realm {owner}, past the cap");
            out.push(violation(name, m, &[resident_id]));
        }
    }
    out
}

#[cfg(test)]
mod tests;
