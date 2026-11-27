//! Fighting: attacks, shots, armies, demands, defence and alarms.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{ResidentOrder, WorldState};

use super::shared::Out;
use super::{invariant, js_number, violation, Invariant};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("attack-orders-sound", attack_orders_sound),
    invariant("shots-within-reach", shots_within_reach),
    invariant("armies-sound", |w, _| crate::armies::armies_sound(w)),
    invariant("contracts-sound", |w, _| crate::contracts::contracts_sound(w)),
    invariant("demands-sound", |w, _| crate::demands::demands_sound(w)),
    invariant("supply-lines-sound", |w, _| crate::armies::supply_lines_sound(w)),
    invariant("threat-sound", |w, _| crate::npc_hooks::threat_sound(w)),
    invariant("supply-wagons-sound", |w, _| crate::supply_wagons::supply_wagons_sound(w)),
    invariant("interrupted-runs-defence", |w, _| crate::defence::interrupted_sound(w)),
    invariant("given-under-attack-sound", |w, _| crate::defence::given_under_attack_sound(w)),
    invariant("struck-driver-drives-on", |w, _| crate::defence::struck_driver_drives_on(w)),
    invariant("defence-script-sound", |w, _| crate::defence::defence_script_sound(w)),
    invariant("alarms-sound", |w, _| crate::alarms::alarms_sound(w)),
    invariant("alarm-script-sound", |w, _| crate::alarms::alarm_script_sound(w)),
    invariant("alarmed-attackers-sound", |w, _| crate::alarms::alarmed_attackers_sound(w)),
];

/// Attack orders are sound, and who last struck a resident struck them no later than now
/// (`attackOrdersSound`).
pub fn attack_orders_sound(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "attack-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        if let Some(s) = &r.struck {
            if s.tick > world.tick as f64 {
                let msg = format!(
                    "resident {} was struck at tick {}, after tick {}",
                    r.id,
                    js_number(s.tick),
                    world.tick
                );
                out.push(violation(name, msg, &[&r.id]));
            }
        }
        let Some(ResidentOrder::Attack(o)) = &r.order else { continue };
        let problem = if o.target_id == r.id {
            Some("attacks themselves".to_string())
        } else if !(o.strike >= 0.0 && o.strike < 1.0) {
            Some(format!("is {} of the way to a blow", js_number(o.strike)))
        } else {
            None
        };
        if let Some(p) = problem {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}

/// Nobody strikes or shoots from beyond their reach (`CONTEXT.md`: Ranged combat; ADR 0004): a
/// resident struck in the tick just stepped stands within their striker's `strike_reach`, contact
/// without a Bow or Crossbow. One tile of slack, as a fall from a broken wall tile can move either
/// of them a tile after the blow. Those aboard a vessel are left out: from a docked ship anyone on
/// its haven is in reach (`CONTEXT.md`: Fighting at a vessel).
pub fn shots_within_reach(world: &WorldState, terrain: &TerrainMap) -> Out {
    let name = "shots-within-reach";
    let last = world.tick as f64 - 1.0;
    let mut out = Vec::new();
    for t in &world.residents {
        let Some(s) = t.struck.as_ref().filter(|s| s.tick == last) else { continue };
        let Some(a) = world.residents.iter().find(|a| a.id == s.by) else { continue };
        if a.aboard.is_some() || t.aboard.is_some() {
            continue;
        }
        let apart = crate::queries::combat::tiles_apart(
            terrain.size,
            (a.x as i32, a.y as i32),
            (t.x as i32, t.y as i32),
        );
        let reach = crate::queries::combat::strike_reach(world, a);
        if apart > reach + 1.0 {
            let msg = format!(
                "resident {} struck {} from {} tiles away, beyond their reach of {}",
                a.id,
                t.id,
                js_number(apart),
                js_number(reach)
            );
            out.push(violation(name, msg, &[&a.id, &t.id]));
        }
    }
    out
}
