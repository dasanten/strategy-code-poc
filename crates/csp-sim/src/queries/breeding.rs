//! The breeding queries of `packages/shared/src/horses.ts` (`CONTEXT.md`: Breeding): which pair a
//! stable keeps progress for, and why two horses can't be bred.

use csp_shared::balance::{MAP_SIZE, STABLE_CAPACITY};
use csp_shared::footprint::is_at;
use csp_shared::world::{
    Building, BuildingKind, Horse, KeptBreeding, Resident, ResidentOrder, WorldState,
};

use super::horses::{horses_in, owns_horse, HorseOwner};
use super::names::placed;

/// The residents breeding at a stable (`breedersAt`).
pub fn breeders_at<'w>(residents: &'w [Resident], stable: &Building) -> Vec<&'w Resident> {
    residents
        .iter()
        .filter(|r| matches!(&r.order, Some(ResidentOrder::Breed(o)) if o.stable_id == stable.id))
        .collect()
}

/// The breeding progress the stable keeps for the two horses, in either order (`keptBreeding`).
pub fn kept_breeding<'b>(stable: &'b Building, horse_ids: &[String]) -> Option<&'b KeptBreeding> {
    stable
        .breedings
        .as_ref()?
        .iter()
        .find(|k| horse_ids.contains(&k.horse_ids[0]) && horse_ids.contains(&k.horse_ids[1]))
}

/// Why a resident standing at the stable can't breed the two horses (`breedProblem`), None when
/// they can. `breeder` is the resident who would, left out of the check for horses already bred.
pub fn breed_problem(
    world: &WorldState,
    stable: &Building,
    owner: HorseOwner,
    breeder: Option<&str>,
    horse_ids: Option<&[String]>,
) -> Option<&'static str> {
    if stable.kind != BuildingKind::Stable {
        return Some("not a stable");
    }
    if stable.site.is_some() {
        return Some("the stable isn’t finished");
    }
    let Some(ids) = horse_ids.filter(|ids| ids.len() == 2 && ids[0] != ids[1]) else {
        return Some("pick two horses");
    };
    let horses: Vec<Option<&Horse>> =
        ids.iter().map(|id| world.horses.iter().find(|h| h.id == *id)).collect();
    let at = |h: &Horse| is_at((h.x as i32, h.y as i32), placed(stable), MAP_SIZE);
    if horses.iter().any(|h| !h.is_some_and(at)) {
        return Some("both horses must stand in the stable");
    }
    let horses: Vec<&Horse> = horses.into_iter().flatten().collect();
    if horses.iter().any(|h| !owns_horse(owner, h)) {
        return Some("not horses of your realm");
    }
    if horses.iter().any(|h| h.hunger <= 0.0) {
        return Some("a hungry horse can’t breed");
    }
    if horses_in(&world.horses, stable).len() as f64 >= STABLE_CAPACITY {
        return Some("the stable has no room for a foal");
    }
    let taken = breeders_at(&world.residents, stable).iter().any(|r| {
        Some(r.id.as_str()) != breeder
            && matches!(&r.order, Some(ResidentOrder::Breed(o)) if o.horse_ids.iter().any(|id| ids.contains(id)))
    });
    if taken {
        return Some("those horses are already being bred");
    }
    None
}

/// The pair a resident breeding at the stable carries on with first (`keptPair`): of the pairs
/// it keeps progress for, the furthest along that they can breed.
pub fn kept_pair(
    world: &WorldState,
    stable: &Building,
    owner: HorseOwner,
    breeder: Option<&str>,
) -> Option<[String; 2]> {
    let mut kept: Vec<&KeptBreeding> = stable.breedings.iter().flatten().collect();
    // A stable sort by progress, furthest first, as `[...].sort((a, b) => b.progress - a.progress)`.
    kept.sort_by(|a, b| {
        (b.progress - a.progress).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    kept.into_iter()
        .find(|k| breed_problem(world, stable, owner, breeder, Some(&k.horse_ids)).is_none())
        .map(|k| k.horse_ids.clone())
}

/// Two fed horses of the owner's in a finished stable with room for a foal (`breedingPair`), the
/// pair the stable keeps progress for first.
pub fn breeding_pair<'w>(
    world: &'w WorldState,
    stable: &Building,
    owner: HorseOwner,
    breeder: Option<&str>,
) -> Option<[&'w Horse; 2]> {
    let find = |id: &str| world.horses.iter().find(|h| h.id == id);
    if let Some([a, b]) = kept_pair(world, stable, owner, breeder) {
        return Some([find(&a)?, find(&b)?]);
    }
    let fed: Vec<&Horse> = horses_in(&world.horses, stable)
        .into_iter()
        .filter(|h| owns_horse(owner, h) && h.hunger > 0.0)
        .collect();
    if fed.len() < 2 {
        return None;
    }
    let ids = [fed[0].id.clone(), fed[1].id.clone()];
    if breed_problem(world, stable, owner, breeder, Some(&ids)).is_some() {
        return None;
    }
    Some([fed[0], fed[1]])
}
