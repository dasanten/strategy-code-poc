//! NPC cities: what they build, work, fetch and trade, and how their residents behave.

use std::collections::HashSet;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;

use super::shared::{kind_of, Out};
use super::{invariant, violation, Invariant};
use crate::npc_behaviour::run_by_npc_city;
use crate::order_meta::running_meta;

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("npc-orders-allowed", npc_orders_allowed),
    invariant("city-plans-sound", |w, _t| crate::npc_plan::city_plans_sound(w)),
    invariant("steel-only-with-coal", |w, _t| crate::npc_chain::steel_only_with_coal(w)),
    invariant("coins-short-only-with-income", |w, t| {
        crate::npc_coins::coins_short_only_with_income(w, t.size)
    }),
    invariant("npc-cities-have-halls", |w, _t| crate::npc_founding::npc_cities_have_halls(w)),
    invariant("city-layouts-sound", |w, _t| crate::city_layout::city_layouts_sound(w)),
    invariant("city-streets-sound", |w, _t| crate::city_layout::city_streets_sound(w)),
    invariant("npc-farmers-kept", |w, _t| crate::npc_plan::npc_farmers_kept(w)),
    invariant("npc-called-home-sound", |w, _t| crate::npc_plan::npc_called_home_sound(w)),
    invariant("npc-wall-stone-set-aside", |w, _t| crate::npc_plan::npc_wall_stone_set_aside(w)),
    invariant("npc-surplus-capped", |w, _t| crate::npc_plan::npc_surplus_capped(w)),
    invariant("npc-spare-hands-work", |w, _t| crate::npc_plan::npc_spare_hands_work(w)),
    invariant("npc-workplaces-bounded", |w, _t| crate::npc_plan::npc_workplaces_bounded(w)),
    invariant("npc-road-crew-sized", |w, _t| crate::npc_behaviour::npc_road_crew_sized(w)),
    invariant("npc-roads-once", |w, _t| crate::npc_roads::npc_roads_once(w)),
    invariant("npc-one-feeder", |w, _t| crate::npc_stable::npc_one_feeder(w)),
    invariant("npc-residents-kept-going", |w, _t| {
        crate::npc_behaviour::npc_residents_kept_going(w)
    }),
    invariant("npc-far-workers-go-home-fed", |w, t| {
        crate::npc_behaviour::npc_far_workers_go_home_fed(w, t)
    }),
    invariant("npc-idle-off-the-storage", |w, t| {
        crate::npc_behaviour::npc_idle_off_the_storage(w, t)
    }),
    invariant("npc-takings-sound", |w, _t| crate::npc_take_node::npc_takings_sound(w)),
    invariant("npc-leaves-dry-workplaces", |w, _t| crate::npc_plan::npc_leaves_dry_workplaces(w)),
    invariant("npc-traders-sound", |w, _t| crate::npc_trader::npc_traders_sound(w)),
];

/// An NPC city does nothing a Player's residents couldn't (`npcOrdersAllowed`).
pub fn npc_orders_allowed(world: &WorldState, _: &TerrainMap) -> Out {
    let name = "npc-orders-allowed";
    let drivers: HashSet<&str> = world
        .caravans
        .iter()
        .filter_map(|c| c.driver_id.as_deref())
        .chain(world.traders.iter().filter_map(|t| t.driver_id.as_deref()))
        .chain(world.supply_wagons.iter().filter_map(|w| w.driver_id.as_deref()))
        .collect();
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(o) = &r.order else { continue };
        if !run_by_npc_city(world, r) {
            continue;
        }
        let kind = kind_of(o);
        let allowed =
            running_meta(o).npc_city || (kind == "drive" && drivers.contains(r.id.as_str()));
        if !allowed {
            out.push(violation(
                name,
                format!("NPC resident {} holds a {kind} order", r.id),
                &[&r.id],
            ));
        }
    }
    out
}
