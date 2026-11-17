//! How many of a game-run city's adults stand idle (`CONTEXT.md`: Soldiers in peace, Standing
//! idle; T97.9): those its plan leaves Idle, and its soldiers just standing on a post. Soldiers
//! on a round, escorting a trader or a founding party, training, on alarm or fighting are busy.
//! Monitoring reports it; the big city's slow run holds it.

use std::collections::HashSet;

use csp_shared::world::{City, CityJobKind, ResidentOrder, WorldState};

use crate::queries::city::city_residents;
use crate::queries::residents::{can_work, is_down};

/// A city's idle adults and its adults, neither Down.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct IdleCount {
    pub idle: usize,
    pub adults: usize,
}

impl IdleCount {
    /// The idle share of its adults, 0 with none.
    pub fn share(&self) -> f64 {
        if self.adults == 0 {
            0.0
        } else {
            self.idle as f64 / self.adults as f64
        }
    }
}

/// How many of `city`'s adults stand idle, soldiers standing on a post counted.
pub fn npc_idle(world: &WorldState, city: &City) -> IdleCount {
    let tick = world.tick as f64;
    let plan = world.city_plans.get(&city.id);
    let busy_soldiers: HashSet<&String> = plan
        .into_iter()
        .flat_map(|p| {
            let rounds = p.patrols.iter().flatten().map(|r| &r.resident_id);
            let escorts = p
                .traders
                .iter()
                .flatten()
                .flat_map(|t| std::iter::once(&t.resident_id).chain(&t.escort_ids));
            rounds.chain(escorts)
        })
        .collect();
    let mut out = IdleCount::default();
    for r in city_residents(world, &city.id) {
        if is_down(r.down_until) || !can_work(r.born_at, tick) {
            continue;
        }
        out.adults += 1;
        let job = plan.and_then(|p| p.jobs.get(&r.id)).map(|j| j.kind);
        let idle = match job {
            Some(CityJobKind::Idle) => true,
            // On a post: no script (training, alarm), not fighting, not on a round or escorting.
            Some(CityJobKind::Soldier) => {
                r.script.is_none()
                    && !matches!(r.order, Some(ResidentOrder::Attack(_)))
                    && !busy_soldiers.contains(&r.id)
            }
            _ => false,
        };
        if idle {
            out.idle += 1;
        }
    }
    out
}

/// The idle share over all the game-run cities but the Trade Organization's, for monitoring.
pub fn npc_idle_share(world: &WorldState) -> f64 {
    let total = world
        .cities
        .iter()
        .filter(|c| c.realm_id.is_none() && c.trade_org.is_none())
        .map(|c| npc_idle(world, c))
        .fold(IdleCount::default(), |a, b| IdleCount {
            idle: a.idle + b.idle,
            adults: a.adults + b.adults,
        });
    total.share()
}

#[cfg(test)]
mod tests {
    use csp_shared::world::{CityJob, Task};
    use serde_json::json;

    use super::*;
    use crate::npc_behaviour::default_script;
    use crate::npc_test_world::village;

    fn job(kind: CityJobKind) -> CityJob {
        CityJob {
            kind,
            building_id: None,
            target_id: None,
            stable_id: None,
            ground_id: None,
            subject: None,
        }
    }

    #[test]
    fn counts_the_idle_and_soldiers_standing_on_a_post_but_not_those_training_or_at_work() {
        let mut v = village(None);
        let ids: Vec<String> = city_residents(&v.world, &v.city)
            .into_iter()
            .filter(|r| can_work(r.born_at, v.world.tick as f64))
            .map(|r| r.id.clone())
            .collect();
        assert!(ids.len() >= 4, "{ids:?}");
        let kinds =
            [CityJobKind::Idle, CityJobKind::Soldier, CityJobKind::Soldier, CityJobKind::Work];
        let plan = v.world.city_plans.get_mut(&v.city).expect("a plan");
        plan.jobs.clear();
        for (id, kind) in ids.iter().zip(kinds) {
            plan.jobs.insert(id.clone(), job(kind));
        }
        // The second soldier trains.
        let trainee = v.world.residents.iter_mut().find(|r| r.id == ids[2]).expect("them");
        trainee.script = Some(default_script(Task::Train, json!({})));
        for r in v.world.residents.iter_mut().filter(|r| r.id == ids[1]) {
            r.script = None;
            r.order = None;
        }
        for r in v.world.residents.iter_mut().filter(|r| r.id == ids[0]) {
            r.script = None;
        }
        let count = npc_idle(&v.world, v.city());
        assert_eq!(count.adults, ids.len());
        assert_eq!(count.idle, 2, "the Idle one and the soldier on a post");
        assert!((npc_idle_share(&v.world) - 2.0 / ids.len() as f64).abs() < 1e-9);
    }
}
