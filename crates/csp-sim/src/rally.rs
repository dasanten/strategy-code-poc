//! Rallying the crew (`CONTEXT.md`: Rallying the crew, Zeal; ADR 0042): an order for the Leader
//! alone. Standing at a workplace or construction site, the Leader rallies every resident of
//! their realm working there, building, tearing down or repairing: they do so at `RALLY_PACE`
//! times their pace while the Player's Zeal drains. Only work is faster, never walking, carrying,
//! training or fighting, and the Leader does no work of their own meanwhile.
//!
//! **By hand only: the one exception to ADR 0002.** Every other order kind is something a script
//! could request as well. This one isn't: the game API has no call for it
//! (`script_api::SCRIPT_API`), it can't be a queue step (`queue::can_be_queue_step`), and a script
//! running for the Leader can't start it. A script would spend the pool the moment it fills, and
//! being there would again give nothing (ADR 0042). `tests` prove it.
//!
//! It ends when the Player stops it or gives the Leader another order (that order replaces it),
//! when the Leader leaves the building or goes Down, or when the Zeal is used up; the rest of the
//! Zeal stays. It goes on until stopped (#1613): struck, the Leader runs their defence script and
//! takes the rally up again when it ends; given under attack, it holds until calm.

use csp_shared::balance::{MAP_SIZE, RALLY_PACE, ZEAL_PER_RALLIED_TICK};
use csp_shared::footprint::is_at;
use csp_shared::world::{
    Building, BuildingKind, OrderRequest, RallyOrder, Resident, ResidentOrder, WorldState,
};

use crate::order_meta::OrderMeta;
use crate::order_sender::{ordered_resident, realm_of, OrderSender};
use crate::queries::balance::workplace_skill;
use crate::queries::building::building_at;
use crate::queries::names::placed;
use crate::queries::residents::is_down;
use crate::queue::field_str as str_field;
use crate::running::{in_place, no_ties, RunningOrder};
use crate::sight::InvariantViolation;
use crate::world_index::{building_index, resident_index};
use crate::zeal::{set_zeal, zeal_of};

/// The order kind's name. Registered with the UI's order kinds only: never in the game API or a
/// queue step (ADR 0042).
pub const RALLY: &str = "rally";

/// Whether the Leader can rally the crew at `b` (`CONTEXT.md`: Rallying the crew): a construction
/// site, a building being torn down, or a standing workplace.
pub fn rallies_at(b: &Building) -> bool {
    b.site.is_some()
        || b.teardown.is_some()
        || (crate::ruins::standing(b)
            && (workplace_skill(b.kind).is_some() || b.kind == BuildingKind::Smithy))
}

/// The workplace or site the resident stands at that a Leader can rally the crew of, if any.
pub fn rally_place<'w>(world: &'w WorldState, r: &Resident) -> Option<&'w Building> {
    building_at(world, r.x as i32, r.y as i32, MAP_SIZE).filter(|b| rallies_at(b))
}

/// Why the Player's Leader can't rally the crew now, if they can't: what the card says on a
/// greyed-out row (T116.3).
pub fn rally_problem(world: &WorldState, user_id: u64, r: &Resident) -> Option<String> {
    let realm = realm_of(world, user_id)?;
    if realm.leader_id != r.id {
        return Some("only your Leader rallies the crew".into());
    }
    if is_down(r.down_until) {
        return Some(format!("{} is Down", r.name));
    }
    let Some(place) = rally_place(world, r) else {
        return Some("not at a workplace or construction site".into());
    };
    if let Some(ResidentOrder::Rally(o)) = &r.order {
        if o.building_id == place.id {
            return Some("already rallying the crew here".into());
        }
    }
    if zeal_of(world, user_id) <= 0.0 {
        return Some("no Zeal left".into());
    }
    None
}

/// Checks a rally order (`rally.validate`): the Player's own Leader, at a workplace or
/// construction site, with Zeal left.
pub fn validate_rally(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let Some(ri) = ordered_resident(world, sender, str_field(order, "residentId")) else {
        return Some("not one of your residents".into());
    };
    if sender.npc_city_id.is_some() {
        return Some("only a Player rallies the crew".into());
    }
    rally_problem(world, sender.user_id, &world.residents[ri])
}

/// Sets the Leader to rally the crew where they stand (`rally.apply`).
pub fn apply_rally(world: &mut WorldState, order: &OrderRequest) {
    let id = str_field(order, "residentId");
    let Some(ri) = world.residents.iter().position(|x| Some(x.id.as_str()) == id) else { return };
    let Some(place) = rally_place(world, &world.residents[ri]) else { return };
    let building_id = place.id.clone();
    world.residents[ri].order =
        Some(ResidentOrder::Rally(RallyOrder { building_id, worked_at: None }));
}

pub(crate) static RALLY_META: OrderMeta =
    OrderMeta::fns(RALLY, |w, s, o, _| validate_rally(w, s, o), |w, _, o, _| apply_rally(w, o))
        .gets_off_first()
        .goes_on_until_stopped();

impl RunningOrder for RallyOrder {
    in_place!();
    no_ties!();
}

/// The account of the Player whose Leader `r` is, if `r` is a realm's Leader.
fn leader_of(world: &WorldState, r: &Resident) -> Option<u64> {
    let realm = world.realms.iter().find(|x| Some(&x.id) == r.owner.as_ref())?;
    (realm.leader_id == r.id).then_some(realm.user_id)
}

/// Why the rally of the resident at `i` ends now, before anyone works this tick, if it does: no
/// longer the Leader, Down, the building gone or done, the Leader not at it, or no Zeal left.
fn ends(world: &WorldState, i: usize, o: &RallyOrder) -> bool {
    let r = &world.residents[i];
    let Some(user_id) = leader_of(world, r) else { return true };
    if is_down(r.down_until) || zeal_of(world, user_id) <= 0.0 {
        return true;
    }
    let Some(b) = building_index(world, &o.building_id).map(|bi| &world.buildings[bi]) else {
        return true;
    };
    !rallies_at(b) || !is_at((r.x as i32, r.y as i32), placed(b), MAP_SIZE)
}

/// Ends the rallies that can't go on (`CONTEXT.md`: Rallying the crew): run each tick after the
/// blows and before anyone works.
pub fn end_rallies(world: &mut WorldState) {
    for i in 0..world.residents.len() {
        let Some(ResidentOrder::Rally(o)) = &world.residents[i].order else { continue };
        if ends(world, i, &o.clone()) {
            world.residents[i].order = None;
        }
    }
}

/// Where the Leader rallying `r`'s crew at `building_id` is, if one is: `r`'s realm's Leader,
/// not `r`, rallying that very building.
fn rallying_leader(world: &WorldState, r: &Resident, building_id: &str) -> Option<usize> {
    let realm = world.realms.iter().find(|x| Some(&x.id) == r.owner.as_ref())?;
    if realm.leader_id == r.id {
        return None;
    }
    let li = resident_index(world, &realm.leader_id)?;
    match &world.residents[li].order {
        Some(ResidentOrder::Rally(o)) if o.building_id == building_id => Some(li),
        _ => None,
    }
}

/// What `r`'s work at `building_id` is multiplied by this tick: `RALLY_PACE` while their Leader
/// rallies the crew there, else 1. A rallied tick is noted on the Leader's order, so the Zeal
/// drains for it. Call it only where work is done.
pub fn rallied_pace(world: &mut WorldState, ri: usize, building_id: &str) -> f64 {
    let Some(li) = rallying_leader(world, &world.residents[ri], building_id) else { return 1.0 };
    let tick = world.tick as f64;
    if let Some(ResidentOrder::Rally(o)) = world.residents[li].order.as_mut() {
        o.worked_at = Some(tick);
    }
    RALLY_PACE
}

/// What `r`'s work at `building_id` would be multiplied by now, without noting it: what the
/// building's card shows (T116.3).
pub fn pace_shown(world: &WorldState, r: &Resident, building_id: &str) -> f64 {
    if rallying_leader(world, r, building_id).is_some() {
        RALLY_PACE
    } else {
        1.0
    }
}

/// Drains the Zeal of every Player whose crew was rallied this tick (`CONTEXT.md`: Zeal): a game
/// hour of rallying per game hour. Only then: a Leader rallying an empty building spends nothing.
/// A pool used up ends the rally; what is left stays.
pub fn drain_rallies(world: &mut WorldState) {
    let tick = world.tick as f64;
    for i in 0..world.residents.len() {
        let Some(ResidentOrder::Rally(o)) = &world.residents[i].order else { continue };
        if o.worked_at != Some(tick) {
            continue;
        }
        let Some(user_id) = leader_of(world, &world.residents[i]) else { continue };
        let left = zeal_of(world, user_id) - ZEAL_PER_RALLIED_TICK;
        set_zeal(world, user_id, left);
    }
    // Used up, or the site finished or torn down by this tick's work: it ends with the tick.
    end_rallies(world);
}

/// Invariant (ADR 0004): only a living Leader who is at the building rallies, with Zeal left, and
/// Zeal never drains while nobody is rallied. Checked after the tick: a rally order is on a
/// realm's Leader, not Down, at the workplace or site it names, the Player's pool not empty; and
/// a tick noted as rallied, which alone drains the pool, is never one still to come.
pub fn rallies_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (i, r) in world.residents.iter().enumerate() {
        let Some(ResidentOrder::Rally(o)) = &r.order else { continue };
        let mut fail = |message: &str| {
            out.push(InvariantViolation {
                invariant: "rallies-sound".into(),
                message: format!("{} rallies the crew of {}, but {message}", r.id, o.building_id),
                entity_ids: vec![r.id.clone(), o.building_id.clone()],
            });
        };
        if leader_of(world, r).is_none() {
            fail("isn't a realm's Leader");
        } else if ends(world, i, o) {
            fail("is Down, not at it, or out of Zeal");
        }
        if o.worked_at.is_some_and(|t| t > world.tick as f64) {
            fail("was noted as rallying at a later tick");
        }
    }
    out
}

#[cfg(test)]
mod tests;
