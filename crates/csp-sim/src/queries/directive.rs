//! Admin directive queries of `packages/shared/src/directive.ts` (`CONTEXT.md`: Admin directive).

use csp_shared::world::{Directive, WorldState};

/// The Organizations a directive names (`directiveTargets`): its target, and with
/// `with_alliance` every member of the target's alliance as it stands now.
pub fn directive_targets(world: &WorldState, d: &Directive) -> Vec<String> {
    if !d.with_alliance {
        return vec![d.target.clone()];
    }
    match world.alliances.iter().find(|a| a.members.iter().any(|m| m.realm_id == d.target)) {
        Some(a) => a.members.iter().map(|m| m.realm_id.clone()).collect(),
        None => vec![d.target.clone()],
    }
}

/// The directive that has the Trade Organization treat an Organization as one to punish, if any
/// (`directiveAgainst`): the oldest naming it.
pub fn directive_against<'w>(world: &'w WorldState, org: &str) -> Option<&'w Directive> {
    world.directives.iter().find(|d| directive_targets(world, d).iter().any(|t| t == org))
}
