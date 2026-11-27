//! T1719 experiment: the NPC modules of csp-sim as their own crate. `pub use csp_sim::*` keeps
//! their `crate::` paths into the core working unchanged.
pub use csp_sim::*;
pub mod hooks;
pub use hooks::install;
pub mod invariants_npc;
pub mod npc_acting_first;
pub mod npc_behaviour;
pub mod npc_chain;
pub mod npc_cities;
pub mod npc_coins;
pub mod npc_defence;
pub mod npc_demands;
pub mod npc_escort;
pub mod npc_founding;
pub mod npc_growth;
pub mod npc_hire;
pub mod npc_hunts;
pub mod npc_inner_wall;
pub mod npc_mending;
pub mod npc_patrols;
pub mod npc_plan;
pub mod npc_posts;
pub mod npc_repair;
pub mod npc_retaliate;
pub mod npc_revive;
pub mod npc_roads;
pub mod npc_scores;
pub mod npc_scouts;
#[cfg(test)]
mod npc_slow;
pub mod npc_stable;
pub mod npc_stance;
pub mod npc_stone_walls;
pub mod npc_supply;
pub mod npc_take_node;
#[cfg(test)]
mod npc_test_world;
pub mod npc_threat;
pub mod npc_towers;
pub mod npc_trader;
pub mod npc_training;
