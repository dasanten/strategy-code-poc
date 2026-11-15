//! Naming an heir (`CONTEXT.md`: Heir, T103.1): the Player names one adult of their realm to
//! carry it on, free, at once and from anywhere, by hand or from a script, and may clear it. The
//! heir lapses, with a line in the realm log, once they no longer qualify. The orders are plain
//! `validate`/`apply` pairs, like renaming (ADR 0002).

use csp_shared::world::{HeirLapse, RealmEventWhat, WorldState};

use crate::events::record_event;
use crate::queries::leader::{heir_problem, lives_in_realm, serves_others, ServesOthers};
use crate::queries::residents::can_work;
use crate::sight::InvariantViolation;

/// The input of a `nameHeir` or `clearHeir` order: `resident_id` is who asked, one of the realm's
/// residents; `heir_id` whom `nameHeir` names.
#[derive(Debug, Clone, Copy, Default)]
pub struct HeirRequest<'a> {
    pub resident_id: Option<&'a str>,
    pub heir_id: Option<&'a str>,
}

/// The sender's realm's index and that the asker is one of its residents; or why not.
fn asker(world: &WorldState, user_id: u64, o: &HeirRequest) -> Result<usize, String> {
    let ri = world.realms.iter().position(|r| r.user_id == user_id).ok_or("you have no realm")?;
    let realm_id = world.realms[ri].id.as_str();
    let ok = world
        .residents
        .iter()
        .any(|r| Some(r.id.as_str()) == o.resident_id && r.owner.as_deref() == Some(realm_id));
    if ok {
        Ok(ri)
    } else {
        Err("not one of your residents".into())
    }
}

/// `nameHeir.validate`.
pub fn validate_name_heir(world: &WorldState, user_id: u64, o: &HeirRequest) -> Option<String> {
    let ri = match asker(world, user_id, o) {
        Ok(ri) => ri,
        Err(e) => return Some(e),
    };
    let realm = &world.realms[ri];
    let target = world.residents.iter().find(|r| Some(r.id.as_str()) == o.heir_id);
    heir_problem(world, (&realm.id, &realm.leader_id), target)
}

/// `nameHeir.apply`: the resident becomes the realm's heir, in place of any before them.
pub fn apply_name_heir(world: &mut WorldState, user_id: u64, o: &HeirRequest) {
    if validate_name_heir(world, user_id, o).is_some() {
        return;
    }
    let Some(heir_id) = o.heir_id else { return };
    let Ok(ri) = asker(world, user_id, o) else { return };
    world.realms[ri].heir_id = Some(heir_id.to_string());
}

/// `clearHeir.validate`.
pub fn validate_clear_heir(world: &WorldState, user_id: u64, o: &HeirRequest) -> Option<String> {
    match asker(world, user_id, o) {
        Err(e) => Some(e),
        Ok(ri) if world.realms[ri].heir_id.is_none() => Some("your realm has no heir".into()),
        Ok(_) => None,
    }
}

/// `clearHeir.apply`: the realm has no heir.
pub fn apply_clear_heir(world: &mut WorldState, user_id: u64, o: &HeirRequest) {
    if validate_clear_heir(world, user_id, o).is_some() {
        return;
    }
    if let Ok(ri) = asker(world, user_id, o) {
        world.realms[ri].heir_id = None;
    }
}

/// Why the realm at `ri`'s heir no longer qualifies, if they don't (`CONTEXT.md`: Heir).
fn lapse_of(world: &WorldState, ri: usize) -> Option<HeirLapse> {
    let realm = &world.realms[ri];
    let heir_id = realm.heir_id.as_deref()?;
    let Some(heir) = world.residents.iter().find(|r| r.id == heir_id) else {
        return Some(HeirLapse::Died);
    };
    if heir.owner.as_deref() != Some(realm.id.as_str()) {
        return Some(HeirLapse::LeftRealm);
    }
    if heir.health <= 0.0 && heir.down_until.is_none() {
        return Some(HeirLapse::Died);
    }
    if realm.leader_id == heir_id {
        return Some(HeirLapse::BecameLeader);
    }
    match serves_others(world, heir_id) {
        Some(ServesOthers::Contract) => return Some(HeirLapse::Lent),
        Some(ServesOthers::AllianceArmy) => return Some(HeirLapse::AllianceArmy),
        None => {}
    }
    if !lives_in_realm(world, &realm.id, heir) {
        return Some(HeirLapse::Homeless);
    }
    None
}

/// The realm's heir, if it has one who still qualifies (a Down heir does): who takes over when its
/// Leader dies (`CONTEXT.md`: Leader death with an heir).
pub fn living_heir(world: &WorldState, realm_id: &str) -> Option<String> {
    let ri = world.realms.iter().position(|r| r.id == realm_id)?;
    if lapse_of(world, ri).is_some() {
        return None;
    }
    world.realms[ri].heir_id.clone()
}

/// Clears the realm at `ri`'s heir, saying why in its realm log; `name` is the heir's.
fn lapse(world: &mut WorldState, ri: usize, why: HeirLapse, name: String) {
    let Some(heir_id) = world.realms[ri].heir_id.take() else { return };
    let realm_id = world.realms[ri].id.clone();
    record_event(world, Some(&realm_id), RealmEventWhat::HeirLapsed { heir_id, heir: name, why });
}

/// A resident died (`die`): a realm whose heir they were has none now.
pub fn heir_died(world: &mut WorldState, id: &str, name: &str) {
    for ri in 0..world.realms.len() {
        if world.realms[ri].heir_id.as_deref() == Some(id) {
            lapse(world, ri, HeirLapse::Died, name.to_string());
        }
    }
}

/// Every realm whose heir no longer qualifies has none now, each with a line in its realm log
/// (`CONTEXT.md`: Heir). Run once the realm's cities, contracts and alliance army changed, and
/// after a Leader handover.
pub fn lapse_heirs(world: &mut WorldState) {
    for ri in 0..world.realms.len() {
        let Some(why) = lapse_of(world, ri) else { continue };
        let heir_id = world.realms[ri].heir_id.as_deref().unwrap_or_default();
        let name = world
            .residents
            .iter()
            .find(|r| r.id == heir_id)
            .map(|r| r.name.clone())
            .unwrap_or_default();
        lapse(world, ri, why, name);
    }
}

/// Invariant (`heirsQualify`, ADR 0004): a realm's heir is a living adult of that realm who lives
/// in one of its cities, is not its Leader and serves no one else.
pub fn heirs_qualify(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (ri, realm) in world.realms.iter().enumerate() {
        let Some(heir_id) = realm.heir_id.as_deref() else { continue };
        let child = world
            .residents
            .iter()
            .find(|r| r.id == heir_id)
            .is_some_and(|r| !can_work(r.born_at, world.tick as f64));
        let problem = match lapse_of(world, ri) {
            Some(HeirLapse::Died) => "is dead",
            Some(HeirLapse::LeftRealm) => "is not of the realm",
            Some(HeirLapse::Homeless) => "lives in no city of the realm",
            Some(HeirLapse::Lent) => "is rented out by a mercenary contract",
            Some(HeirLapse::AllianceArmy) => "is in an alliance army",
            Some(HeirLapse::BecameLeader) => "is its Leader",
            None if child => "is a child",
            None => continue,
        };
        out.push(InvariantViolation {
            invariant: "heirs-qualify".into(),
            message: format!("realm {}'s heir {heir_id} {problem}", realm.id),
            entity_ids: vec![realm.id.clone(), heir_id.to_string()],
        });
    }
    out
}

pub mod takeover;

#[cfg(test)]
mod tests;
