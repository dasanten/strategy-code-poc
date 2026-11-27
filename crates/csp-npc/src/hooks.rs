//! T1719 experiment: sets the core's NPC hooks (`csp_sim::npc_hooks`).
use crate::*;

/// Installs the NPC hooks; call before the first tick (later calls do nothing).
pub fn install() {
    csp_sim::npc_hooks::install(csp_sim::npc_hooks::NpcHooks {
        founding_party: npc_founding::founding_party,
        mother_fetch: npc_founding::mother_fetch,
        supplying_mother: npc_founding::supplying_mother,
        hunting: npc_hunts::hunting,
        walk_to: npc_behaviour::walk_to,
        npc_home: npc_behaviour::npc_home,
        is_npc_order: npc_behaviour::is_npc_order,
        workplace_of: npc_behaviour::workplace_of,
        default_script: npc_behaviour::default_script,
        note_crime_known: npc_threat::note_crime_known,
        note_losses: npc_threat::note_losses,
        npc_demand_ended: npc_demands::npc_demand_ended,
        plan_due: npc_plan::plan_due,
        marching_for: npc_retaliate::marching_for,
        reserve_lacks: npc_chain::reserve_lacks,
        chain_good: npc_chain::chain_good,
        own_workplaces: npc_chain::own_workplaces,
        trade_org_reserve: npc_chain::trade_org_reserve,
        knows_node: npc_scouts::knows_node,
        scout_edge: npc_scouts::scout_edge,
        scout_ended: npc_scouts::scout_ended,
        soldiers_factor: npc_stance::soldiers_factor,
        stance_of: npc_stance::stance_of,
        wall_stone_set_aside: npc_stone_walls::wall_stone_set_aside,
        found_npc_city: npc_cities::found_npc_city,
        give_npc_horses: npc_cities::give_npc_horses,
        npc_site_fits_among: npc_cities::npc_site_fits_among,
        taken_ground: npc_cities::taken_ground,
        attackers_of: npc_defence::attackers_of,
        go_after_nearest: npc_defence::go_after_nearest,
        step_npc_hunts: npc_hunts::step_npc_hunts,
        step_npc_take_nodes: npc_take_node::step_npc_take_nodes,
        step_npc_acting_first: npc_acting_first::step_npc_acting_first,
        step_npc_retaliate: npc_retaliate::step_npc_retaliate,
        step_threat: npc_threat::step_threat,
        step_stances: npc_stance::step_stances,
        step_npc_demands: npc_demands::step_npc_demands,
        step_npc_defence: npc_defence::step_npc_defence,
        step_npc_hire: npc_hire::step_npc_hire,
        step_npc_cities: npc_behaviour::step_npc_cities,
        threat_sound: npc_threat::threat_sound,
        trade_org_breeds_no_horses: npc_stable::trade_org_breeds_no_horses,
        trade_org_sends_no_one: npc_plan::trade_org_sends_no_one,
        house_tile: |w, c, h, t, k| npc_growth::house_tile(w, c, h, t, None, k),
        npc_invariants: || {
            vec![
                ("npc_cities", invariants_npc::npc_cities::INVARIANTS),
                ("npc_founding", invariants_npc::npc_founding::INVARIANTS),
                ("npc_fighting", invariants_npc::npc_fighting::INVARIANTS),
            ]
        },
    });
}
