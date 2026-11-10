//! World queries about admin directives (`packages/shared/src/directive.ts`, `CONTEXT.md`: Admin
//! directive), for the game API (ADR 0002). Every Player sees each directive's target, reason and
//! goals; who gave it and how far its goals have come stay with admins. Here rather than in
//! `csp-shared` because a soldier is told by `is_armed`, which `crate::queries` holds.

use csp_lang::js::number_to_string;
use csp_shared::world::{Directive, DirectiveGoal, Resident, WorldState};
use serde::Serialize;
use ts_rs::TS;

use crate::queries::residents::is_armed;

/// The longest reason an admin can give, in characters.
pub const MAX_DIRECTIVE_REASON: usize = 500;

/// The most goals one directive can have.
pub const MAX_DIRECTIVE_GOALS: usize = 8;

/// The most soldiers a `soldiers` goal can ask to be killed.
pub const MAX_DIRECTIVE_SOLDIERS: f64 = 10_000.0;

/// The Organizations a directive names (`directiveTargets`): its target, and with
/// `with_alliance` every member of the target's alliance as it stands now.
pub fn directive_targets(world: &WorldState, target: &str, with_alliance: bool) -> Vec<String> {
    if !with_alliance {
        return vec![target.to_string()];
    }
    let alliance = world.alliances.iter().find(|a| a.members.iter().any(|m| m.realm_id == target));
    match alliance {
        Some(a) => a.members.iter().map(|m| m.realm_id.clone()).collect(),
        None => vec![target.to_string()],
    }
}

/// The directive that has the Trade Organization treat an Organization as one to punish, if any:
/// the oldest naming it (`directiveAgainst`).
pub fn directive_against<'w>(world: &'w WorldState, org: &str) -> Option<&'w Directive> {
    world
        .directives
        .iter()
        .find(|d| directive_targets(world, &d.target, d.with_alliance).iter().any(|t| t == org))
}

/// The soldiers of the Organizations a directive names (`directiveSoldiers`): armed residents of
/// those realms, or of those NPC cities.
pub fn directive_soldiers<'w>(
    world: &'w WorldState,
    target: &str,
    with_alliance: bool,
) -> Vec<&'w Resident> {
    let orgs = directive_targets(world, target, with_alliance);
    world
        .residents
        .iter()
        .filter(|r| {
            let org = r.owner.as_deref().or(r.city_id.as_deref()).unwrap_or("");
            orgs.iter().any(|o| o == org) && is_armed(&r.carried)
        })
        .collect()
}

/// Whether a directive's goal is met (`goalMet`).
pub fn goal_met(d: &Directive, goal: &DirectiveGoal) -> bool {
    match goal {
        DirectiveGoal::City { met, .. } => *met,
        DirectiveGoal::Soldiers { count, .. } => d.soldiers_killed >= *count,
    }
}

/// Whether all of a directive's goals are met, so it ends (`goalsMet`). One with no goals ends
/// only when an admin lifts it.
pub fn goals_met(d: &Directive) -> bool {
    !d.goals.is_empty() && d.goals.iter().all(|g| goal_met(d, g))
}

/// A directive's goal as every Player sees it: what it asks, not how far it has come
/// (`DirectiveGoalView`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DirectiveGoalView {
    City {
        city: String,
    },
    Soldiers {
        count: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        percent: Option<f64>,
    },
}

/// A directive as every Player sees it: its target, reason, goals and price, never who gave it
/// (`DirectiveView`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DirectiveView {
    pub id: String,
    pub target: String,
    /// The target's name: a realm's by its realm name, an NPC city's its own.
    pub target_name: String,
    pub with_alliance: bool,
    pub reason: String,
    pub given_at: f64,
    pub goals: Vec<DirectiveGoalView>,
    /// The Coins the target can pay at any Trade Org warehouse to buy it off; `None` when it can't.
    pub price: Option<f64>,
}

/// Every directive in force as a Player sees it, oldest first (`directivesFor`).
pub fn directives_for(world: &WorldState, name_of: impl Fn(&str) -> String) -> Vec<DirectiveView> {
    world
        .directives
        .iter()
        .map(|d| DirectiveView {
            id: d.id.clone(),
            target: d.target.clone(),
            target_name: name_of(&d.target),
            with_alliance: d.with_alliance,
            reason: d.reason.clone(),
            given_at: d.given_at,
            goals: d
                .goals
                .iter()
                .map(|g| match g {
                    DirectiveGoal::City { city, .. } => {
                        DirectiveGoalView::City { city: city.clone() }
                    }
                    DirectiveGoal::Soldiers { count, percent } => {
                        DirectiveGoalView::Soldiers { count: *count, percent: *percent }
                    }
                })
                .collect(),
            price: d.price,
        })
        .collect()
}

/// A directive's goal in words, for the admin panel and Players (`describeGoal`).
pub fn describe_goal(goal: &DirectiveGoalView) -> String {
    match goal {
        DirectiveGoalView::City { city } => format!("{city} destroyed"),
        DirectiveGoalView::Soldiers { count, percent } => {
            let plural = if *count == 1.0 { "" } else { "s" };
            let soldiers = format!("{} soldier{plural}", number_to_string(*count));
            match percent {
                None => format!("{soldiers} killed"),
                Some(p) => format!("{}% of its soldiers killed ({soldiers})", number_to_string(*p)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_goals_in_words() {
        let city = DirectiveGoalView::City { city: "Ashford".into() };
        assert_eq!(describe_goal(&city), "Ashford destroyed");
        let one = DirectiveGoalView::Soldiers { count: 1.0, percent: None };
        assert_eq!(describe_goal(&one), "1 soldier killed");
        let share = DirectiveGoalView::Soldiers { count: 12.0, percent: Some(50.0) };
        assert_eq!(describe_goal(&share), "50% of its soldiers killed (12 soldiers)");
    }

    #[test]
    fn ends_only_once_every_goal_is_met() {
        let mut d: Directive = serde_json::from_value(serde_json::json!({
            "id": "d1", "target": "r1", "withAlliance": false, "reason": "raids", "givenBy": "admin",
            "givenAt": 0, "goals": [{ "kind": "soldiers", "count": 2 }], "soldiersKilled": 1,
            "price": null
        }))
        .unwrap();
        assert!(!goals_met(&d));
        d.soldiers_killed = 2.0;
        assert!(goals_met(&d));
        d.goals.clear();
        assert!(!goals_met(&d));
    }
}
