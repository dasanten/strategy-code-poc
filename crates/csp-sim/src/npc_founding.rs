//! An NPC city founds a daughter (`apps/server/src/npc-founding.ts`, `CONTEXT.md`: Founding).

use csp_shared::world::{CityJobKind, CityPlan};

/// The ids of a city's founding party (`foundingParty`): those whose job is `found`.
pub fn founding_party(plan: Option<&CityPlan>) -> Vec<String> {
    let Some(plan) = plan else { return Vec::new() };
    plan.jobs
        .iter()
        .filter(|(_, j)| j.kind == CityJobKind::Found)
        .map(|(id, _)| id.clone())
        .collect()
}
