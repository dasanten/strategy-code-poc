//! Helpers the script bindings need from rule tickets not merged yet, each a minimal port of the
//! TypeScript marked with the ticket that owns it. Each is replaced by its owner's and deleted
//! once that ticket lands (T86.12's PR names them).

use csp_shared::world::{Building, Pile, Resident, ResidentOrder, Stock, WorldState};
use serde_json::{json, Value};

use crate::queries::names::placed;
use crate::queries::standing::organization_label;

/// The goods of a storage that aren't set aside for its offers (`freeStock`).
pub fn free_stock(world: &WorldState, b: &Building) -> Stock {
    crate::queries::goods::free_stock(world, &b.id, b.stock.as_ref())
}

pub use crate::queries::goods::units_that_fit;
pub use crate::queries::warehouse_trade::debt_of;

/// The pile reached from a tile (`pileAt`, on the full map's size as the TypeScript's default).
pub fn pile_at(world: &WorldState, x: f64, y: f64, _size: i32) -> Option<&Pile> {
    crate::queries::goods::pile_at(world, x, y)
}

/// The realm a building is of (`buildingRealm`).
pub fn building_realm(world: &WorldState, b: &Building) -> Option<String> {
    crate::queries::city::building_realm(world, b).map(str::to_string)
}

/// The footprint tile with the fewest of a building's crew on it (`crewTile`).
pub fn crew_tile(
    world: &WorldState,
    b: &Building,
    me: &Resident,
    of_crew: &dyn Fn(&Resident) -> bool,
    size: i32,
) -> (i32, i32) {
    crate::queries::crew::crew_tile(world, b, (&me.id, me.x as i32, me.y as i32), of_crew, size)
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
