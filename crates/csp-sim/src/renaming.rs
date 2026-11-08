//! Renaming a resident, a city or a horse (`CONTEXT.md`: Renaming a resident, Realm name,
//! Renaming a city, Renaming a horse), ported from `apps/server/src/renaming.ts`: the Player's
//! choice of a name, free, at once and from anywhere (ADR 0002). The orders are plain
//! `validate`/`apply` functions for the order queue (T86.2) to wire.

use csp_shared::balance::{CITY_NAME_MAX_LENGTH, HORSE_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH};
use csp_shared::world::{Realm, WorldState};

use crate::queries::people::{
    city_rename_problem, horse_rename_problem, js_trim, name_problem, rename_problem, Given,
};
use crate::sight::InvariantViolation;

/// A rename order (`RenameRequest`, `RenameCityRequest`, `RenameHorseRequest`): `resident_id`
/// is who asked; `target_id`, `city_id` or `horse_id` what gets `name`; `realm_name` names the
/// realm when the target is the Leader of a realm that has none yet.
#[derive(Debug, Clone, Copy, Default)]
pub struct RenameRequest<'a> {
    pub resident_id: Option<&'a str>,
    pub target_id: Option<&'a str>,
    pub city_id: Option<&'a str>,
    pub horse_id: Option<&'a str>,
    pub name: Given<'a>,
    pub realm_name: Given<'a>,
}

fn realm_of(world: &WorldState, user_id: u64) -> Option<&Realm> {
    world.realms.iter().find(|r| r.user_id == user_id)
}

/// The sender's realm and that the asker is one of its residents; or why not.
fn asker<'w>(world: &'w WorldState, user_id: u64, o: &RenameRequest) -> Result<&'w Realm, String> {
    let realm = realm_of(world, user_id).ok_or("you have no realm")?;
    let ok = world.residents.iter().any(|r| {
        Some(r.id.as_str()) == o.resident_id && r.owner.as_deref() == Some(realm.id.as_str())
    });
    if ok {
        Ok(realm)
    } else {
        Err("not one of your residents".into())
    }
}

/// `rename.validate`.
pub fn validate_rename(world: &WorldState, user_id: u64, o: &RenameRequest) -> Option<String> {
    let realm = match asker(world, user_id, o) {
        Ok(r) => r,
        Err(e) => return Some(e),
    };
    let target = world.residents.iter().find(|r| Some(r.id.as_str()) == o.target_id);
    rename_problem(realm, target, o.name, o.realm_name)
}

/// `rename.apply`: the resident takes the new name, trimmed, which is no longer the game's;
/// renaming the Leader of an unnamed realm names the realm too.
pub fn apply_rename(world: &mut WorldState, user_id: u64, o: &RenameRequest) {
    if validate_rename(world, user_id, o).is_some() {
        return;
    }
    let (Given::Text(name), Some(target_id)) = (o.name, o.target_id) else { return };
    let name = js_trim(name).to_string();
    let Some(ri) = world.realms.iter().position(|r| r.user_id == user_id) else { return };
    let Some(target) = world.residents.iter_mut().find(|r| r.id == target_id) else { return };
    if target.name != name {
        target.game_name = None;
    }
    target.name = name;
    let realm = &mut world.realms[ri];
    if target_id == realm.leader_id && realm.name.as_deref().is_none_or(str::is_empty) {
        if let Given::Text(realm_name) = o.realm_name {
            realm.name = Some(js_trim(realm_name).to_string());
        }
    }
}

/// `renameCity.validate`.
pub fn validate_rename_city(world: &WorldState, user_id: u64, o: &RenameRequest) -> Option<String> {
    let realm = match asker(world, user_id, o) {
        Ok(r) => r,
        Err(e) => return Some(e),
    };
    city_rename_problem(
        realm,
        world.cities.iter().find(|c| Some(c.id.as_str()) == o.city_id),
        o.name,
    )
}

/// `renameCity.apply`: the city takes the new name, trimmed, no longer the game's.
pub fn apply_rename_city(world: &mut WorldState, user_id: u64, o: &RenameRequest) {
    if validate_rename_city(world, user_id, o).is_some() {
        return;
    }
    let Given::Text(name) = o.name else { return };
    let name = js_trim(name).to_string();
    let Some(city) = world.cities.iter_mut().find(|c| Some(c.id.as_str()) == o.city_id) else {
        return;
    };
    if city.name != name {
        city.game_name = None;
    }
    city.name = name;
}

/// `renameHorse.validate`.
pub fn validate_rename_horse(
    world: &WorldState,
    user_id: u64,
    o: &RenameRequest,
) -> Option<String> {
    let realm = match asker(world, user_id, o) {
        Ok(r) => r,
        Err(e) => return Some(e),
    };
    horse_rename_problem(
        realm,
        world.horses.iter().find(|h| Some(h.id.as_str()) == o.horse_id),
        o.name,
    )
}

/// `renameHorse.apply`: the horse takes the new name, trimmed.
pub fn apply_rename_horse(world: &mut WorldState, user_id: u64, o: &RenameRequest) {
    if validate_rename_horse(world, user_id, o).is_some() {
        return;
    }
    let Given::Text(name) = o.name else { return };
    if let Some(h) = world.horses.iter_mut().find(|h| Some(h.id.as_str()) == o.horse_id) {
        h.name = js_trim(name).to_string();
    }
}

fn names_well_formed<'a>(
    invariant: &str,
    what: &str,
    max: f64,
    names: impl Iterator<Item = (&'a str, &'a str)>,
) -> Vec<InvariantViolation> {
    names
        .filter_map(|(id, name)| {
            let p = name_problem(Some(name), max)
                .or_else(|| (name != js_trim(name)).then(|| "not trimmed".into()))?;
            Some(InvariantViolation {
                invariant: invariant.into(),
                message: format!("{what} {id}'s name: {p}"),
                entity_ids: vec![id.to_string()],
            })
        })
        .collect()
}

/// Invariant (`cityNamesWellFormed`): every city's name is trimmed, not empty and not too long.
pub fn city_names_well_formed(world: &WorldState) -> Vec<InvariantViolation> {
    names_well_formed(
        "city-names-well-formed",
        "city",
        CITY_NAME_MAX_LENGTH,
        world.cities.iter().map(|c| (c.id.as_str(), c.name.as_str())),
    )
}

/// Invariant (`horseNamesWellFormed`).
pub fn horse_names_well_formed(world: &WorldState) -> Vec<InvariantViolation> {
    names_well_formed(
        "horse-names-well-formed",
        "horse",
        HORSE_NAME_MAX_LENGTH,
        world.horses.iter().map(|h| (h.id.as_str(), h.name.as_str())),
    )
}

/// Invariant (`residentNamesWellFormed`).
pub fn resident_names_well_formed(world: &WorldState) -> Vec<InvariantViolation> {
    names_well_formed(
        "resident-names-well-formed",
        "resident",
        RESIDENT_NAME_MAX_LENGTH,
        world.residents.iter().map(|r| (r.id.as_str(), r.name.as_str())),
    )
}

#[cfg(test)]
mod tests;
