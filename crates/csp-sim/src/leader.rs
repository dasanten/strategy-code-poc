//! The Leader handover (`CONTEXT.md`: Leader, Leader handover), ported from
//! `apps/server/src/leader.ts`: the Player's choice of who leads their realm, plain data. Checked
//! when it arrives and again when it applies. The order is a plain `validate`/`apply` pair for
//! the order queue (T86.2) to wire.

use csp_shared::balance::MAP_SIZE;
use csp_shared::world::{RealmEventWhat, WorldState};

use crate::events::record_event;
use crate::queries::city_area::in_city_area;
use crate::queries::leader::{hand_over_problem, serves_others, ServesOthers as Serves};
use crate::queries::residents::can_work;
use crate::sight::InvariantViolation;

/// The input of a handover order (`HandOverRequest`): the Leader names the new one.
#[derive(Debug, Clone, Copy, Default)]
pub struct HandOverRequest<'a> {
    pub resident_id: Option<&'a str>,
    pub new_leader_id: Option<&'a str>,
}

fn problem(world: &WorldState, user_id: u64, o: &HandOverRequest, size: i32) -> Option<String> {
    let Some(realm) = world.realms.iter().find(|r| r.user_id == user_id) else {
        return Some("you have no realm".into());
    };
    let leader = world.residents.iter().find(|r| Some(r.id.as_str()) == o.resident_id);
    let target = world.residents.iter().find(|r| Some(r.id.as_str()) == o.new_leader_id);
    hand_over_problem(world, (&realm.id, &realm.leader_id), leader, target, size)
}

/// `handOver.validate`; without a map, `MAP_SIZE`.
pub fn validate_hand_over(
    world: &WorldState,
    user_id: u64,
    o: &HandOverRequest,
    size: Option<i32>,
) -> Option<String> {
    problem(world, user_id, o, size.unwrap_or(MAP_SIZE))
}

/// `handOver.apply`: the realm's Leader makes another resident its Leader, free and at once. Only
/// `leader_id` changes; the realm log records it.
pub fn apply_hand_over(
    world: &mut WorldState,
    user_id: u64,
    o: &HandOverRequest,
    size: Option<i32>,
) {
    let size = size.unwrap_or(MAP_SIZE);
    if problem(world, user_id, o, size).is_some() {
        return;
    }
    let (Some(from_id), Some(to_id)) = (o.resident_id, o.new_leader_id) else { return };
    let ri = world.realms.iter().position(|r| r.user_id == user_id).expect("checked");
    let realm_id = world.realms[ri].id.clone();
    let from = world.residents.iter().find(|r| r.id == from_id).expect("checked");
    let to = world.residents.iter().find(|r| r.id == to_id).expect("checked");
    let city = world
        .cities
        .iter()
        .find(|c| {
            c.realm_id.as_deref() == Some(realm_id.as_str())
                && in_city_area(world, &c.id, from.x, from.y, size)
                && in_city_area(world, &c.id, to.x, to.y, size)
        })
        .expect("checked");
    let what = RealmEventWhat::LeaderHandedOver {
        from_id: from.id.clone(),
        from: from.name.clone(),
        to_id: to.id.clone(),
        to: to.name.clone(),
        city_id: city.id.clone(),
        city: city.name.clone(),
        x: from.x,
        y: from.y,
    };
    world.realms[ri].leader_id = to_id.to_string();
    record_event(world, Some(&realm_id), what);
}

/// Invariant (`leadersServeNoOne`): every realm's Leader is a living adult of that realm who
/// serves no one else. A Leader who is Down still leads.
pub fn leaders_serve_no_one(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for realm in &world.realms {
        let Some(leader) = world.residents.iter().find(|r| r.id == realm.leader_id) else {
            continue;
        };
        if leader.owner.as_deref() != Some(realm.id.as_str()) {
            continue;
        }
        let mut fail = |p: &str| {
            out.push(InvariantViolation {
                invariant: "leaders-serve-no-one".into(),
                message: format!("realm {}'s Leader {} {p}", realm.id, leader.id),
                entity_ids: vec![realm.id.clone(), leader.id.clone()],
            })
        };
        if leader.health <= 0.0 && leader.down_until.is_none() {
            fail("is dead");
        }
        if !can_work(leader.born_at, world.tick as f64) {
            fail("is a child");
        }
        match serves_others(world, &leader.id) {
            Some(Serves::Contract) => fail("is rented out by a mercenary contract"),
            Some(Serves::AllianceArmy) => fail("is in an alliance army"),
            None => {}
        }
    }
    out
}

#[cfg(test)]
mod tests;
