//! The driving, hitching, stealing and boarding checks of `packages/shared/src/carriages.ts` and
//! `building.ts`' `carriageCanGoTo` (`CONTEXT.md`: Carriage, Hitched horse, Passenger, Stealing a
//! carriage or horse). Each `*_problem` says why something can't be done now, or `None` when it
//! can, in the TypeScript's words.

use csp_shared::balance::{carriage_can_enter, CARAVAN_GUARD_RANGE, PASSENGER_WEIGHT};
use csp_shared::terrain::{terrain_at, wrap_distance, Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, Carriage, Horse, Resident, WorldState};

use super::carriages::{driver_of, hitch_horse_problem, horse_for, passengers_of};
use super::goods::carriage_room;
use super::guard::guarded_by;
use super::residents::{can_work, is_armed, is_down};

/// Whether a carriage can go onto a tile (`carriageCanGoTo`): its terrain, or a finished road.
pub fn carriage_can_go_to(world: &WorldState, map: &TerrainMap, x: i32, y: i32) -> bool {
    // `roadAt`: the road or road construction site on the tile.
    let road = world
        .buildings
        .iter()
        .find(|b| b.x as i32 == x && b.y as i32 == y && b.kind == BuildingKind::Road);
    let ground = match road {
        Some(r) if r.site.is_none() => Terrain::Road as u8,
        _ => terrain_at(map, x, y),
    };
    carriage_can_enter(ground)
}

/// Whether a carriage (by its realm and city) is the resident's to board (`carriageOfResident`).
pub fn carriage_of_resident(
    realm_id: &Option<String>,
    city_id: &Option<String>,
    r: &Resident,
) -> bool {
    if r.owner.is_some() {
        return *realm_id == r.owner;
    }
    realm_id.is_none() && r.city_id.is_some() && *city_id == r.city_id
}

/// Why a resident can't take another organization's carriage or horse — standing at `at`, owned
/// by `owner_realm`/`owner_city` — for the realm `realm_id` now (`takeProblem`). `what` names
/// the thing in the reason.
pub fn take_problem(
    world: &WorldState,
    thief: &Resident,
    at: (f64, f64),
    owner_realm: &Option<String>,
    owner_city: &Option<String>,
    realm_id: &str,
    what: &str,
) -> Option<String> {
    if !can_work(thief.born_at, world.tick as f64) {
        return Some("children can’t steal".to_string());
    }
    if at.0 != thief.x || at.1 != thief.y {
        return Some(format!("that {what} is not on the resident’s tile"));
    }
    let guarded = guarded_by(
        &world.residents,
        |r| r.x == at.0 && r.y == at.1,
        |r| carriage_of_resident(owner_realm, owner_city, r),
        |r| r.id == thief.id || r.owner.as_deref() == Some(realm_id),
    );
    guarded.then(|| format!("an armed resident guards that {what}"))
}

/// Why a resident can't drive a carriage now (`driveProblem`): grown up, on foot and on its tile,
/// a horse to pull it that isn't Down, and nobody else driving it.
pub fn drive_problem(world: &WorldState, r: &Resident, carriage: &Carriage) -> Option<String> {
    let problem = if !can_work(r.born_at, world.tick as f64) {
        "children can’t drive"
    } else if r.riding.is_some() {
        "dismount first to drive"
    } else if carriage.x != r.x || carriage.y != r.y {
        "that carriage is not on the resident’s tile"
    } else {
        match horse_for(world, carriage) {
            Some(h) if h.x == carriage.x && h.y == carriage.y => {
                if is_down(h.down_until) {
                    "its horse is Down"
                } else if driver_of(world, &carriage.id).is_some_and(|d| d.id != r.id) {
                    "someone else is driving that carriage"
                } else {
                    return None;
                }
            }
            _ => "no horse here to pull that carriage",
        }
    };
    Some(problem.to_string())
}

/// The carriage as another realm or city would hold it (`{ ...carriage, realmId, cityId }`).
fn held_by(carriage: &Carriage, realm_id: Option<&str>, city_id: Option<&str>) -> Carriage {
    Carriage {
        realm_id: realm_id.map(str::to_string),
        city_id: city_id.map(str::to_string),
        ..carriage.clone()
    }
}

/// The horse of another organization a driver of `realm_id` would steal by driving off in the
/// carriage (`horseToSteal`): only with no horse hitched and no free horse of the realm's on its
/// tile. Of the free ones, one they can take, the carriage's owner's first; `named` keeps to that
/// horse.
pub fn horse_to_steal<'w>(
    world: &'w WorldState,
    driver: &Resident,
    carriage: &Carriage,
    realm_id: &str,
    named: Option<&str>,
) -> Option<&'w Horse> {
    if carriage.horse_id.as_deref().is_some_and(|id| !id.is_empty()) {
        return None;
    }
    if horse_for(world, &held_by(carriage, Some(realm_id), None)).is_some() {
        return None;
    }
    let free: Vec<&Horse> = world
        .horses
        .iter()
        .filter(|h| {
            named.is_none_or(|n| h.id == n)
                && h.x == carriage.x
                && h.y == carriage.y
                && h.realm_id.as_deref() != Some(realm_id)
                && world.carriages.iter().all(|k| k.horse_id.as_deref() != Some(h.id.as_str()))
                && !is_down(h.down_until)
                && !world.residents.iter().any(|r| r.riding.as_deref() == Some(h.id.as_str()))
        })
        .collect();
    let open: Vec<&Horse> = free
        .iter()
        .copied()
        .filter(|h| {
            take_problem(world, driver, (h.x, h.y), &h.realm_id, &h.city_id, realm_id, "horse")
                .is_none()
        })
        .collect();
    let same_owner = |h: &&Horse| h.realm_id == carriage.realm_id && h.city_id == carriage.city_id;
    open.iter().copied().find(same_owner).or(open.first().copied()).or(free.first().copied())
}

/// Why a resident can't drive a carriage of the realm `realm_id` off, stealing a horse to pull it
/// if there is one to steal (`hitchOffProblem`). `carriage` is the carriage as that realm holds it.
pub fn hitch_off_problem(
    world: &WorldState,
    driver: &Resident,
    carriage: &Carriage,
    realm_id: &str,
    named: Option<&str>,
) -> Option<String> {
    let Some(horse) = horse_to_steal(world, driver, carriage, realm_id, named) else {
        return drive_problem(world, driver, carriage);
    };
    take_problem(
        world,
        driver,
        (horse.x, horse.y),
        &horse.realm_id,
        &horse.city_id,
        realm_id,
        "horse",
    )
    .or_else(|| {
        let hitched = Carriage { horse_id: Some(horse.id.clone()), ..carriage.clone() };
        drive_problem(world, driver, &hitched)
    })
}

/// Why a caravan's or trader's crew keep its carriage from being taken (`crewHolds`): its driver,
/// or an armed escort, up and within `CARAVAN_GUARD_RANGE` of it.
fn crew_holds(
    residents: &[Resident],
    driver_id: Option<&str>,
    escort_ids: &[String],
    carriage: &Carriage,
    size: i32,
    what: &str,
) -> Option<String> {
    let at = (carriage.x as i32, carriage.y as i32);
    let near = |id: &str, armed: bool| {
        residents.iter().any(|r| {
            r.id == id
                && r.health > 0.0
                && !is_down(r.down_until)
                && (!armed || is_armed(&r.carried))
                && wrap_distance(size, (r.x as i32, r.y as i32), at) <= CARAVAN_GUARD_RANGE
        })
    };
    if driver_id.is_some_and(|id| near(id, false)) {
        return Some(format!("its driver is still with that {what}"));
    }
    if escort_ids.iter().any(|id| near(id, true)) {
        return Some(format!("its escort guards that {what}"));
    }
    None
}

/// Why a resident can't drive off in another organization's carriage for the realm `realm_id`
/// now (`driveOffProblem`): nobody may drive it or be aboard, a caravan's, trader's or supply
/// wagon's crew mustn't hold it, it mustn't be guarded, and they must be able to drive it as if it
/// were their realm's already (`hitch_off_problem`). `size` is the map's.
pub fn drive_off_problem(
    world: &WorldState,
    thief: &Resident,
    carriage: &Carriage,
    realm_id: &str,
    size: i32,
) -> Option<String> {
    if driver_of(world, &carriage.id).is_some() {
        return Some("someone is driving that carriage".to_string());
    }
    if !passengers_of(world, &carriage.id).is_empty() {
        return Some("someone is aboard that carriage".to_string());
    }
    let caravan = world.caravans.iter().find(|c| c.carriage_id == carriage.id);
    let trader = world.traders.iter().find(|t| t.carriage_id == carriage.id);
    let held = caravan
        .and_then(|c| {
            crew_holds(
                &world.residents,
                c.driver_id.as_deref(),
                &c.escort_ids,
                carriage,
                size,
                "caravan’s carriage",
            )
        })
        .or_else(|| {
            trader.and_then(|t| {
                crew_holds(
                    &world.residents,
                    t.driver_id.as_deref(),
                    &t.escort_ids,
                    carriage,
                    size,
                    "trader’s carriage",
                )
            })
        });
    if held.is_some() {
        return held;
    }
    // `wagonCrew`: a Trade Org army's supply wagon, its driver with the army's soldiers as escort.
    if let Some(wagon) = world.supply_wagons.iter().find(|w| w.carriage_id == carriage.id) {
        let escorts: Vec<String> = world
            .punishments
            .iter()
            .find(|p| Some(&p.id) == wagon.punishment_id.as_ref())
            .map(|p| p.members.iter().map(|m| m.resident_id.clone()).collect())
            .unwrap_or_default();
        let held = crew_holds(
            &world.residents,
            wagon.driver_id.as_deref(),
            &escorts,
            carriage,
            size,
            "supply wagon",
        );
        if held.is_some() {
            return held;
        }
    }
    take_problem(
        world,
        thief,
        (carriage.x, carriage.y),
        &carriage.realm_id,
        &carriage.city_id,
        realm_id,
        "carriage",
    )
    .or_else(|| {
        hitch_off_problem(world, thief, &held_by(carriage, Some(realm_id), None), realm_id, None)
    })
}

/// Why a resident can't handle a carriage's horse now (`handlerProblem`): grown up, of the
/// carriage's realm, on its tile.
fn handler_problem(r: &Resident, carriage: &Carriage, tick: f64, verb: &str) -> Option<String> {
    if !can_work(r.born_at, tick) {
        return Some(format!("children can’t {verb}"));
    }
    if !carriage_of_resident(&carriage.realm_id, &carriage.city_id, r) {
        return Some("not a carriage of your realm".to_string());
    }
    if carriage.x != r.x || carriage.y != r.y {
        return Some("that carriage is not on the resident’s tile".to_string());
    }
    None
}

/// Why a resident can't unhitch a carriage's horse now (`unhitchProblem`).
pub fn unhitch_problem(r: &Resident, carriage: Option<&Carriage>, tick: f64) -> Option<String> {
    let Some(carriage) = carriage else { return Some("no such carriage".to_string()) };
    handler_problem(r, carriage, tick, "unhitch").or_else(|| {
        carriage
            .horse_id
            .as_deref()
            .is_none_or(str::is_empty)
            .then(|| "no horse is hitched to that carriage".to_string())
    })
}

/// Why a resident can't hitch the named horse to a carriage now (`hitchProblem`): only the
/// realm's own horses that can be hitched.
pub fn hitch_problem(
    world: &WorldState,
    r: &Resident,
    carriage: Option<&Carriage>,
    horse_id: Option<&str>,
) -> Option<String> {
    let Some(carriage) = carriage else { return Some("no such carriage".to_string()) };
    if let Some(p) = handler_problem(r, carriage, world.tick as f64, "hitch") {
        return Some(p);
    }
    let Some(horse) = world.horses.iter().find(|h| Some(h.id.as_str()) == horse_id) else {
        return Some("no such horse".to_string());
    };
    hitch_horse_problem(world, carriage, horse).map(str::to_string)
}

/// Why a resident can't board a carriage now (`boardProblem`): `boarder_problem`, and room for
/// one more passenger.
pub fn board_problem(
    world: &WorldState,
    r: &Resident,
    carriage: Option<&Carriage>,
) -> Option<String> {
    let Some(carriage) = carriage else { return Some("no such carriage".to_string()) };
    boarder_problem(r, carriage).or_else(|| {
        (carriage_room(world, carriage) < PASSENGER_WEIGHT - 1e-9)
            .then(|| "the carriage is full".to_string())
    })
}

/// Why a resident can't board a carriage, room aside (`boarderProblem`).
pub fn boarder_problem(r: &Resident, carriage: &Carriage) -> Option<String> {
    let problem = if r.aboard.as_deref() == Some(carriage.id.as_str()) {
        "already aboard that carriage"
    } else if r.aboard.is_some() {
        "already aboard another carriage"
    } else if !carriage_of_resident(&carriage.realm_id, &carriage.city_id, r) {
        "not a carriage of your realm"
    } else if carriage.x != r.x || carriage.y != r.y {
        "that carriage is not on the resident’s tile"
    } else if super::carriages::driven_carriage_id(r).is_some() {
        "the driver can’t board"
    } else if r.riding.is_some() {
        "dismount first to board"
    } else {
        return None;
    };
    Some(problem.to_string())
}
