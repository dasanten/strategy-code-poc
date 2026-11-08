//! Helpers the script bindings need from rule tickets not merged yet, each a minimal port of the
//! TypeScript marked with the ticket that owns it. Each is replaced by its owner's and deleted
//! once that ticket lands (T86.12's PR names them).

use csp_shared::footprint::{covers, footprint_tiles};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{Building, Good, Pile, Resident, ResidentOrder, Stock, WorldState};
use serde_json::{json, Value};

use crate::queries::balance::carry_capacity;
use crate::queries::building::building_at;
use crate::queries::names::placed;
use crate::queries::offers::offers_at;
use crate::queries::residents::{good_weight, stock_weight};
use crate::queries::standing::organization_label;

/// What a storage's offers set aside (`setAsideAt`).
// TODO(T86.5): `queries::goods::set_aside_at`.
fn set_aside_at(world: &WorldState, storage_id: &str) -> Stock {
    let mut aside = Stock::new();
    for o in offers_at(world, storage_id) {
        *aside.entry(o.gives).or_insert(0.0) += o.times * o.gives_units;
    }
    aside
}

/// The goods of a storage that aren't set aside for its offers (`freeStock`).
// TODO(T86.5): `queries::goods::free_stock`.
pub fn free_stock(world: &WorldState, b: &Building) -> Stock {
    let stock = b.stock.clone().unwrap_or_default();
    if world.offers.is_empty() {
        return stock;
    }
    let aside = set_aside_at(world, &b.id);
    let mut free = stock.clone();
    for (good, n) in aside {
        let left = stock.get(&good).copied().unwrap_or(0.0) - n;
        if left > 0.0 {
            free.insert(good, left);
        } else {
            free.shift_remove(&good);
        }
    }
    free
}

/// How many units of a good a resident can still carry (`unitsThatFit`).
// TODO(T86.5): `queries::goods::units_that_fit`.
pub fn units_that_fit(r: &Resident, good: Good, tick: f64) -> f64 {
    let room = carry_capacity(r, tick) - stock_weight(&r.carried);
    0f64.max((room / good_weight(good) + 1e-9).floor())
}

/// The pile reached from a tile (`pileAt`): on a building's footprint, the one at its corner.
// TODO(T86.5): `queries::goods::pile_at`.
pub fn pile_at(world: &WorldState, x: f64, y: f64, size: i32) -> Option<&Pile> {
    let at = match building_at(world, x as i32, y as i32, size) {
        Some(b) => (b.x, b.y),
        None => (x, y),
    };
    world.piles.iter().find(|p| p.x == at.0 && p.y == at.1)
}

/// The Coins an Organization owes the Trade Organization (`debtOf`).
// TODO(T86.5): `queries::warehouse::debt_of`.
pub fn debt_of(world: &WorldState, org: &str) -> f64 {
    world.debts.iter().find(|d| d.org == org).map_or(0.0, |d| d.coins)
}

/// The realm a building is of (`buildingRealm`).
// TODO(T86.8): `queries::city::building_realm`.
pub fn building_realm(world: &WorldState, b: &Building) -> Option<String> {
    if b.site.is_some() && b.realm_id.is_some() {
        return b.realm_id.clone();
    }
    match &b.city_id {
        Some(city_id) => {
            world.cities.iter().find(|c| &c.id == city_id).and_then(|c| c.realm_id.clone())
        }
        None => b.realm_id.clone(),
    }
}

/// The footprint tile a resident counts on as one of a building's crew (`standsAt`).
fn stands_at(r: &Resident, b: &Building, size: i32) -> Option<(i32, i32)> {
    let at = r.script.as_ref().and_then(|s| s.memory.get("at"));
    if let Some(Value::Object(at)) = at {
        if let (Some(x), Some(y)) =
            (at.get("x").and_then(Value::as_f64), at.get("y").and_then(Value::as_f64))
        {
            if covers(placed(b), x as i32, y as i32, size) {
                return Some((x as i32, y as i32));
            }
        }
    }
    let there = match &r.order {
        Some(ResidentOrder::WorkAt(o)) => o.building_id == b.id,
        Some(ResidentOrder::Build(o)) => o.site_id.as_deref() == Some(b.id.as_str()),
        Some(ResidentOrder::Breed(o)) => o.stable_id == b.id,
        _ => false,
    };
    let (x, y) = (r.x as i32, r.y as i32);
    (there && covers(placed(b), x, y, size)).then_some((x, y))
}

/// The footprint tile with the fewest of a building's crew on it, the nearest first
/// (`crewTile`).
// TODO(T86.5): `queries::crew::crew_tile`.
pub fn crew_tile(
    world: &WorldState,
    b: &Building,
    me: &Resident,
    of_crew: &dyn Fn(&Resident) -> bool,
    size: i32,
) -> (i32, i32) {
    let tiles = footprint_tiles(placed(b), size);
    let mut counts: Vec<usize> = vec![0; tiles.len()];
    for r in &world.residents {
        if r.id == me.id || !of_crew(r) {
            continue;
        }
        if let Some(at) = stands_at(r, b, size) {
            if let Some(i) = tiles.iter().position(|t| *t == at) {
                counts[i] += 1;
            }
        }
    }
    let mut best = tiles[0];
    let (mut best_count, mut best_distance) = (usize::MAX, f64::INFINITY);
    for (i, &t) in tiles.iter().enumerate() {
        let distance = wrap_distance(size, (me.x as i32, me.y as i32), t);
        if counts[i] < best_count || (counts[i] == best_count && distance < best_distance) {
            best = t;
            best_count = counts[i];
            best_distance = distance;
        }
    }
    best
}

/// The demands a realm sent or was sent, as its scripts see them (`demandsFor`, flattened as the
/// bindings give them: `fromId`, `from`, `toId`, `to`).
// TODO(T86.11): `demands::demands_for`.
pub fn demands_for(world: &WorldState, realm_id: &str) -> Vec<Value> {
    world
        .demands
        .iter()
        .filter(|d| d.from_id == realm_id || d.to_id == realm_id)
        .map(|d| {
            json!({
                "id": d.id,
                "terms": d.terms,
                "note": d.note,
                "sentAt": d.sent_at,
                "deadline": d.deadline,
                "fromId": d.from_id,
                "from": organization_label(world, &d.from_id),
                "toId": d.to_id,
                "to": organization_label(world, &d.to_id),
            })
        })
        .collect()
}

/// Ticks of an occupation of a city's town hall still to run (`occupationTicksLeft`).
// TODO(T86.8): `queries::city_area::occupation_ticks_left`.
pub fn occupation_ticks_left(
    world: &csp_shared::world::WorldState,
    city: &csp_shared::world::City,
) -> Option<f64> {
    city.occupation.as_ref().map(|o| {
        0f64.max(o.since + crate::queries::city_area::OCCUPATION_TICKS - world.tick as f64)
    })
}

/// What a Player remembers that is out of their sight now (`lastSeenOutOfSight`).
// TODO(T86.13): `last_seen::last_seen_out_of_sight`.
pub fn last_seen_out_of_sight(
    world: &csp_shared::world::WorldState,
    index: &crate::world_index::WorldIndex,
    user_id: u64,
) -> Vec<csp_shared::world::Remembered> {
    use csp_shared::footprint::Placed;
    use csp_shared::world::Remembered;
    let memory = world.last_seen.get(&user_id).cloned().unwrap_or_default();
    let Some(realm) = world.realms.iter().find(|r| r.user_id == user_id) else { return memory };
    if memory.is_empty() {
        return memory;
    }
    let places = crate::sight::places_in_sight(world, index, &realm.id, None, None);
    if !places.looking {
        return memory;
    }
    let in_sight: std::collections::HashSet<String> = places
        .seen
        .iter()
        .filter_map(|e| serde_json::to_value(e).ok())
        .filter_map(|v| v.get("id").and_then(|i| i.as_str()).map(str::to_owned))
        .collect();
    let id_of = |e: &Remembered| match e {
        Remembered::Building(b) => b.id.clone(),
        Remembered::City(c) => c.id.clone(),
    };
    let placed_of = |e: &Remembered| match e {
        Remembered::Building(b) => Some(Placed {
            kind: crate::queries::names::kind_name(b.kind),
            x: b.x as i32,
            y: b.y as i32,
        }),
        Remembered::City(_) => None,
    };
    memory
        .into_iter()
        .filter(|e| !in_sight.contains(&id_of(e)) && !placed_of(e).is_some_and(|p| places.sees(p)))
        .collect()
}

/// Why a resident standing at the stable can't breed the two horses (`breedProblem`).
// TODO(T86.8): `queries::breeding::breed_problem`.
fn breed_problem(
    world: &WorldState,
    stable: &Building,
    owner: crate::queries::horses::HorseOwner,
    breeder: Option<&str>,
    ids: &[String],
) -> bool {
    use crate::queries::horses::{horses_in, owns_horse};
    use csp_shared::balance::{MAP_SIZE, STABLE_CAPACITY};
    use csp_shared::world::BuildingKind;
    if stable.kind != BuildingKind::Stable
        || stable.site.is_some()
        || ids.len() != 2
        || ids[0] == ids[1]
    {
        return true;
    }
    let horses: Vec<Option<&csp_shared::world::Horse>> =
        ids.iter().map(|id| world.horses.iter().find(|h| h.id == *id)).collect();
    let at = |h: &csp_shared::world::Horse| {
        csp_shared::footprint::is_at((h.x as i32, h.y as i32), placed(stable), MAP_SIZE)
    };
    if horses.iter().any(|h| !h.is_some_and(at)) {
        return true;
    }
    let horses: Vec<&csp_shared::world::Horse> = horses.into_iter().flatten().collect();
    if horses.iter().any(|h| !owns_horse(owner, h) || h.hunger <= 0.0) {
        return true;
    }
    if horses_in(&world.horses, stable).len() as f64 >= STABLE_CAPACITY {
        return true;
    }
    world.residents.iter().any(|r| {
        Some(r.id.as_str()) != breeder
            && matches!(&r.order, Some(ResidentOrder::Breed(o)) if o.stable_id == stable.id && o.horse_ids.iter().any(|id| ids.contains(id)))
    })
}

/// The pair a resident breeding at the stable carries on with first (`keptPair`).
// TODO(T86.8): `queries::breeding::kept_pair`.
pub fn kept_pair(
    world: &WorldState,
    stable: &Building,
    owner: crate::queries::horses::HorseOwner,
    breeder: Option<&str>,
) -> Option<[String; 2]> {
    let mut kept: Vec<&csp_shared::world::KeptBreeding> =
        stable.breedings.iter().flatten().collect();
    // A stable sort by progress, furthest first.
    kept.sort_by(|a, b| b.progress.total_cmp(&a.progress));
    kept.into_iter()
        .find(|k| !breed_problem(world, stable, owner, breeder, &k.horse_ids))
        .map(|k| k.horse_ids.clone())
}

/// Two fed horses of the owner's in a finished stable with room for a foal (`breedingPair`).
// TODO(T86.8): `queries::breeding::breeding_pair`.
pub fn breeding_pair<'w>(
    world: &'w WorldState,
    stable: &Building,
    owner: crate::queries::horses::HorseOwner,
    breeder: Option<&str>,
) -> Option<[&'w csp_shared::world::Horse; 2]> {
    use crate::queries::horses::{horses_in, owns_horse};
    let find = |id: &str| world.horses.iter().find(|h| h.id == id);
    if let Some([a, b]) = kept_pair(world, stable, owner, breeder) {
        return Some([find(&a)?, find(&b)?]);
    }
    let fed: Vec<&csp_shared::world::Horse> = horses_in(&world.horses, stable)
        .into_iter()
        .filter(|h| owns_horse(owner, h) && h.hunger > 0.0)
        .collect();
    if fed.len() < 2 {
        return None;
    }
    let ids = [fed[0].id.clone(), fed[1].id.clone()];
    if breed_problem(world, stable, owner, breeder, &ids) {
        return None;
    }
    Some([fed[0], fed[1]])
}
