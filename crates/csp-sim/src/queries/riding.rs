//! The riding and horse-food queries of `packages/shared/src/horses.ts` (`CONTEXT.md`: Riding,
//! Horses have no inventory): which horse a resident rides, whose horse it is to ride, why a
//! resident can't mount one, and where a horse finds Food.

use csp_shared::balance::{HORSE_REACH, MAP_SIZE, OWN_FOOD};
use csp_shared::footprint::covers;
use csp_shared::terrain::{wrap, TerrainMap};
use csp_shared::world::{BuildingKind, Good, Horse, Resident, Stock, WorldState};

use super::carriages::{carriage_pulled_by, driven_carriage_id};
use super::driving::{carriage_can_go_to, take_problem};
use super::horses::rider_of;
use super::names::{held, placed};
use super::residents::is_down;

/// The horse a resident rides, if they ride one (`horseRidden`).
pub fn horse_ridden<'w>(world: &'w WorldState, r: &Resident) -> Option<&'w Horse> {
    let id = r.riding.as_deref()?;
    world.horses.iter().find(|h| h.id == id)
}

/// Where in `world.horses` the horse a resident rides stands, if they ride one.
pub fn horse_ridden_index(world: &WorldState, r: &Resident) -> Option<usize> {
    let id = r.riding.as_deref()?;
    world.horses.iter().position(|h| h.id == id)
}

/// Whether a horse is the resident's to ride (`horseOfResident`): one of their realm, or for a
/// resident of an NPC city one of that city.
pub fn horse_of_resident(horse: &Horse, r: &Resident) -> bool {
    if r.owner.is_some() {
        return horse.realm_id == r.owner;
    }
    horse.realm_id.is_none() && r.city_id.is_some() && horse.city_id == r.city_id
}

/// Why a resident can't get on a horse, whoever's it is (`mountingProblem`).
fn mounting_problem(world: &WorldState, r: &Resident, horse: &Horse) -> Option<String> {
    let problem = if r.riding.as_deref() == Some(horse.id.as_str()) {
        "already riding that horse"
    } else if r.riding.is_some() {
        "already riding another horse"
    } else if horse.x != r.x || horse.y != r.y {
        "that horse is not on the resident’s tile"
    } else if carriage_pulled_by(world, &horse.id).is_some() {
        "that horse is hitched to a carriage"
    } else if is_down(horse.down_until) {
        "that horse is Down"
    } else if rider_of(world, &horse.id).is_some() {
        "someone else rides that horse"
    } else if driven_carriage_id(r).is_some() {
        "a driver can’t ride"
    } else {
        return None;
    };
    Some(problem.to_string())
}

/// Why a resident can't steal another organization's horse for the realm `realm_id` by mounting
/// it now (`mountOffProblem`).
pub fn mount_off_problem(
    world: &WorldState,
    thief: &Resident,
    horse: &Horse,
    realm_id: &str,
) -> Option<String> {
    if thief.owner.as_deref() != Some(realm_id) {
        return Some("not a horse of your realm".to_string());
    }
    mounting_problem(world, thief, horse).or_else(|| {
        take_problem(
            world,
            thief,
            (horse.x, horse.y),
            &horse.realm_id,
            &horse.city_id,
            realm_id,
            "horse",
        )
    })
}

/// Why a resident can't mount a horse now (`mountProblem`, `CONTEXT.md`: Riding). With
/// `commander`, the realm whose order it is, another organization's horse may be stolen
/// (`mount_off_problem`); without one it is refused.
pub fn mount_problem(
    world: &WorldState,
    r: &Resident,
    horse: Option<&Horse>,
    terrain: Option<&TerrainMap>,
    commander: Option<&str>,
) -> Option<String> {
    let Some(horse) = horse else { return Some("no such horse".to_string()) };
    let steals = !horse_of_resident(horse, r);
    if steals && commander.is_none_or(str::is_empty) {
        return Some("not a horse of your realm".to_string());
    }
    let problem = match (steals, commander) {
        (true, Some(c)) => mount_off_problem(world, r, horse, c),
        _ => mounting_problem(world, r, horse),
    };
    if problem.is_some() {
        return problem;
    }
    if let Some(terrain) = terrain {
        if !carriage_can_go_to(world, terrain, horse.x as i32, horse.y as i32) {
            return Some("a horse can’t be ridden on Mountain without a road".to_string());
        }
    }
    None
}

/// The Food a rider carries beyond their own food (`riderSpareFood`).
pub fn rider_spare_food(carried: &Stock) -> f64 {
    0.0f64.max(held(carried, Good::Food) - OWN_FOOD)
}

/// Where in `world.buildings` the finished stable covering a tile stands (`stableAt`), on a map
/// of `size` tiles.
pub fn stable_index_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<usize> {
    world.buildings.iter().position(|b| {
        b.kind == BuildingKind::Stable && b.site.is_none() && covers(placed(b), x, y, size)
    })
}

/// A place a horse eats Food from (`horseFood`'s stocks), by where it is in the world.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoodPlace {
    /// The load of `world.carriages[i]`.
    Carriage(usize),
    /// The storage of `world.buildings[i]`.
    Building(usize),
    /// The goods of `world.piles[i]`.
    Pile(usize),
    /// What `world.residents[i]` carries.
    Rider(usize),
}

impl FoodPlace {
    /// The stock at this place.
    pub fn stock(self, world: &WorldState) -> &Stock {
        match self {
            FoodPlace::Carriage(i) => &world.carriages[i].load,
            FoodPlace::Building(i) => {
                world.buildings[i].stock.as_ref().expect("a stable's storage")
            }
            FoodPlace::Pile(i) => &world.piles[i].goods,
            FoodPlace::Rider(i) => &world.residents[i].carried,
        }
    }

    /// The stock at this place, to change.
    pub fn stock_mut(self, world: &mut WorldState) -> &mut Stock {
        match self {
            FoodPlace::Carriage(i) => &mut world.carriages[i].load,
            FoodPlace::Building(i) => {
                world.buildings[i].stock.as_mut().expect("a stable's storage")
            }
            FoodPlace::Pile(i) => &mut world.piles[i].goods,
            FoodPlace::Rider(i) => &mut world.residents[i].carried,
        }
    }
}

/// Where the pile reached from a tile lies (`pileTile`): on a building's footprint its
/// north-west tile, elsewhere the tile itself.
// TODO(T86.5): `queries::goods::pile_index_at` once it lands.
fn pile_index_at(world: &WorldState, x: i32, y: i32, size: i32) -> Option<usize> {
    let (px, py) = match super::building::building_at(world, x, y, size) {
        Some(b) => (b.x as i32, b.y as i32),
        None => (x, y),
    };
    world.piles.iter().position(|p| p.x as i32 == px && p.y as i32 == py)
}

/// Where a horse finds Food it can eat, in the order it eats from them (`horseFood`): the load of
/// the carriage it pulls, the storage of the stable it stands in, the Food on the ground within
/// `HORSE_REACH`, then its rider's spare Food. `rider` is the index of who rides it, if anyone.
///
/// As in the TypeScript, the stable and the piles are looked up on a map of `MAP_SIZE` tiles
/// (`stableAt` and `pileAt` called without a size); only the reach wraps on `map_size`.
pub fn horse_food(
    world: &WorldState,
    horse: &Horse,
    map_size: i32,
    rider: Option<usize>,
) -> Vec<FoodPlace> {
    let mut out = Vec::new();
    if let Some(i) =
        world.carriages.iter().position(|k| k.horse_id.as_deref() == Some(horse.id.as_str()))
    {
        if held(&world.carriages[i].load, Good::Food) > 0.0 {
            out.push(FoodPlace::Carriage(i));
        }
    }
    let (hx, hy) = (horse.x as i32, horse.y as i32);
    if let Some(i) = stable_index_at(world, hx, hy, MAP_SIZE) {
        if world.buildings[i].stock.as_ref().is_some_and(|s| held(s, Good::Food) > 0.0) {
            out.push(FoodPlace::Building(i));
        }
    }
    let reach = HORSE_REACH as i32;
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            let (x, y) = (wrap(hx + dx, map_size), wrap(hy + dy, map_size));
            if let Some(i) = pile_index_at(world, x, y, MAP_SIZE) {
                let place = FoodPlace::Pile(i);
                if held(&world.piles[i].goods, Good::Food) > 0.0 && !out.contains(&place) {
                    out.push(place);
                }
            }
        }
    }
    if let Some(i) = rider {
        if rider_spare_food(&world.residents[i].carried) >= 1.0 {
            out.push(FoodPlace::Rider(i));
        }
    }
    out
}
