//! Scripts: queues, the game's default scripts and script logs.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;

use super::shared::Out;
use super::{invariant, Invariant};
use crate::script_runner::{
    defaults_have_a_target, one_carrier_at_a_time, one_fetcher_at_a_time,
    one_input_fetcher_at_a_time,
};

pub(super) const INVARIANTS: &[Invariant] = &[
    invariant("one-carrier-at-a-time", game_default_carriers),
    invariant("one-fetcher-at-a-time", game_default_fetchers),
    invariant("one-input-fetcher-at-a-time", game_default_input_fetchers),
    invariant("defaults-have-a-target", game_default_targets),
    invariant("queues-sound", crate::queues::queues_sound),
    invariant("script-logs-sound", |w, _| crate::script_log::script_logs_sound(w)),
];

/// Whether a resident runs the game's own default script (`r.script?.scriptId === 0`): an NPC
/// city's residents; a Player's unedited ones are checked where their scripts run.
fn runs_the_game_default(r: &csp_shared::world::Resident) -> bool {
    r.script.as_ref().is_some_and(|s| s.script_id == 0)
}

/// At most one carrier of a workplace's output at once, among NPC cities' residents running the
/// game's own Work default (`gameDefaultCarriers`).
pub fn game_default_carriers(world: &WorldState, _: &TerrainMap) -> Out {
    one_carrier_at_a_time(world, &runs_the_game_default)
}

/// At most one fetcher of a site's materials at once (`gameDefaultFetchers`).
pub fn game_default_fetchers(world: &WorldState, _: &TerrainMap) -> Out {
    one_fetcher_at_a_time(world, &runs_the_game_default)
}

/// At most one fetcher of a processing workplace's inputs at once (`gameDefaultInputFetchers`).
pub fn game_default_input_fetchers(world: &WorldState, _: &TerrainMap) -> Out {
    one_input_fetcher_at_a_time(world, &runs_the_game_default)
}

/// Nobody runs Work, Build or Haul for longer than a tick without its target
/// (`gameDefaultTargets`).
pub fn game_default_targets(world: &WorldState, _: &TerrainMap) -> Out {
    defaults_have_a_target(world, &|r| r.script.as_ref().filter(|s| s.script_id == 0)?.task)
}
