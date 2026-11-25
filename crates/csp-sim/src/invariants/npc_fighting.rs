//! NPC cities at war and on guard: soldiers, patrols, scouts, hired help and demands.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{ResidentOrder, WorldState};

use super::shared::Out;
use super::{invariant, ledgered, violation, Invariant};
use crate::npc_behaviour::run_by_npc_city;

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("npc-fights-outsiders", npc_fights_outsiders),
    ledgered("npc-lending-keeps-reserve", |_, l| {
        crate::npc_hire::npc_lending_keeps_reserve(l.lent_gear)
    }),
    invariant("npc-hire-sound", |w, _| crate::npc_hire::npc_hire_sound(w)),
    invariant("npc-gate-shut-to-its-punishers", |w, t| {
        crate::npc_defence::npc_gate_shut_to_its_punishers(w, t.size)
    }),
    invariant("npc-soldiers-stand-down", |w, t| {
        crate::npc_defence::npc_soldiers_stand_down(w, t.size)
    }),
    invariant("stances-sound", |w, _t| crate::npc_stance::stances_sound(w)),
    invariant("marches-sound", |w, _t| crate::npc_retaliate::marches_sound(w)),
    invariant("inner-wall-leaves-a-way", |w, t| {
        crate::npc_inner_wall::inner_wall_leaves_a_way(w, t)
    }),
    invariant("npc-revivers", |w, t| crate::npc_revive::npc_revivers(w, t.size)),
    invariant("npc-scouts-sound", crate::npc_scouts::npc_scouts_sound),
    invariant("npc-soldiers-on-posts", crate::npc_behaviour::npc_soldiers_on_posts),
    invariant("npc-patrols-sound", |w, _t| crate::npc_patrols::npc_patrols_sound(w)),
    invariant("npc-hunts-sound", |w, _t| crate::npc_hunts::npc_hunts_sound(w)),
    invariant("npc-demands-sound", |w, _t| crate::npc_demands::npc_demands_sound(w)),
    invariant("npc-training-grounds-bounded", |w, t| {
        crate::npc_training::npc_training_grounds_bounded(w, t.size)
    }),
    invariant("npc-trains-its-soldiers", |w, _t| crate::npc_training::npc_trains_its_soldiers(w)),
    invariant("npc-escorts-sound", |w, _t| crate::npc_escort::npc_escorts_sound(w)),
];

/// An NPC city fights only outsiders (`npcFightsOutsiders`).
pub fn npc_fights_outsiders(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "npc-fights-outsiders";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Attack(o)) = &r.order else { continue };
        if !run_by_npc_city(world, r) {
            continue;
        }
        // `new Map(...)`: the last resident with the id.
        let t = world.residents.iter().rev().find(|x| x.id == o.target_id);
        if t.is_some_and(|t| t.owner.is_none() && t.city_id == r.city_id) {
            let msg = format!("NPC resident {} attacks someone of their own city", r.id);
            out.push(violation(name, msg, &[&r.id]));
        }
    }
    out
}
