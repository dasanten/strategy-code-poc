//! What an NPC city's jobs are worth (`apps/server/src/npc-scores.ts`, `CONTEXT.md`: NPC city;
//! ADR 0029). Its planning pass says what a free adult could do, as far as it knows, and these say
//! what each is worth, so each goes to the highest-scoring job with room (`shareOut`). Pure, with
//! the numbers in `balance.rs`.

use csp_shared::balance::{
    NpcJobWeights, NPC_JOB_MARGIN, NPC_JOB_SCORE, NPC_JOB_WEIGHTS, NPC_STANCE,
};
use csp_shared::world::City;

#[cfg(test)]
thread_local! {
    static WEIGHTS: std::cell::Cell<Option<NpcJobWeights>> = const { std::cell::Cell::new(None) };
}

/// What weighs on `city`'s jobs at a place now (`jobWeights`, `CONTEXT.md`: Stance): `NPC_JOB_WEIGHTS`,
/// with danger weighing `NPC_STANCE.fortify_danger` times as much under Fortify. Its temperament
/// weighs in through the stance it leans to.
pub fn job_weights(city: &City) -> NpcJobWeights {
    #[cfg(test)]
    if let Some(w) = WEIGHTS.with(std::cell::Cell::get) {
        return w;
    }
    let mut w = NPC_JOB_WEIGHTS;
    if crate::npc_stance::stance_of(city) == csp_shared::world::Stance::Fortify {
        w.danger *= NPC_STANCE.fortify_danger;
    }
    w
}

/// Runs `f` with every city weighing its jobs by `weights`, on this thread.
#[cfg(test)]
pub fn with_job_weights<T>(weights: NpcJobWeights, f: impl FnOnce() -> T) -> T {
    let before = WEIGHTS.with(|w| w.replace(Some(weights)));
    let out = f();
    WEIGHTS.with(|w| w.set(before));
    out
}

/// What a job at a place costs besides what it is for (`Considerations`, `CONTEXT.md`: Stance).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Considerations {
    /// Tiles from the city's storage.
    pub distance: f64,
    /// The weight of the danger places the city remembers by the way there.
    pub danger: f64,
    /// Workers of the city already there, besides the one weighing it.
    pub crew: f64,
}

/// How much `at` takes from a job's score under `weights` (`placeCost`): never more than
/// `weights.most`, never below nothing.
pub fn place_cost(at: Considerations, weights: &NpcJobWeights) -> f64 {
    let cost = weights.distance * at.distance.max(0.0)
        + weights.danger * at.danger.max(0.0)
        + weights.crew * at.crew.max(0.0);
    cost.min(weights.most).max(0.0)
}

/// What a job at a place is worth now (`blendedScore`): what it is for, less what the place costs.
/// Farming while Food runs short is never weighed down: it comes first.
pub fn blended_score(job: ScoredJob, at: Considerations, weights: &NpcJobWeights) -> f64 {
    if job == (ScoredJob::Farm { food_short: true }) {
        return job_score(job);
    }
    job_score(job) - place_cost(at, weights)
}

/// A job as the pass knows it (`ScoredJob`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScoredJob {
    /// Farming: while Food runs short for a worker off the farms, else while it lacks farmers.
    Farm { food_short: bool },
    /// Revivers aren't weighed (ADR 0029); this is where their turn comes among the jobs that
    /// are.
    Revive,
    /// Building the city's project.
    Project,
    /// Making a good short of its reserve; `share` is how much of what it wants it lacks, 0 to 1.
    Short { share: f64 },
    /// The road crew.
    Road,
    /// Scouting.
    Scout,
    /// Going back to the workplace they were let go from.
    Back,
    /// Working for surplus; `full` is how full its good's cap is: below 1, below 0 under its
    /// reserve, from 1 once worked past its cap (`NPC_SURPLUS_PAST_CAP`).
    Surplus { full: f64 },
}

/// What a job is worth now (`jobScore`).
pub fn job_score(job: ScoredJob) -> f64 {
    let s = NPC_JOB_SCORE;
    match job {
        ScoredJob::Farm { food_short } => {
            if food_short {
                s.farm_food_short
            } else {
                s.farm
            }
        }
        ScoredJob::Revive => s.revive,
        ScoredJob::Project => s.project,
        ScoredJob::Short { share } => s.short + s.short_range * share,
        ScoredJob::Road => s.road,
        ScoredJob::Scout => s.scout,
        ScoredJob::Back => s.back,
        ScoredJob::Surplus { full } if full >= 1.0 => {
            // Past its cap (`NPC_SURPLUS_PAST_CAP`) it scores below every job under one, by as much
            // again at most, and further past always scores less.
            let past = full - 1.0;
            s.surplus - s.surplus_range * (past / (1.0 + past))
        }
        ScoredJob::Surplus { full } => {
            // However far below its cap, it stays inside its range, and further below always
            // scores more.
            let below = 1.0 - full;
            s.surplus + s.surplus_range * (below / (1.0 + below))
        }
    }
}

/// Jobs, the highest-scoring first; equal ones stay in the order given (`rankJobs`, a stable
/// sort). `job` says which job an offer is.
pub fn rank_jobs<T>(mut offers: Vec<T>, job: impl Fn(&T) -> ScoredJob) -> Vec<T> {
    offers.sort_by(|a, b| job_score(job(b)).total_cmp(&job_score(job(a))));
    offers
}

/// Whether a job is worth a worker leaving one that scores `held`: by more than the margin
/// (`beats`).
pub fn beats(score: f64, held: f64) -> bool {
    score > held + NPC_JOB_MARGIN
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranked(jobs: Vec<ScoredJob>) -> Vec<ScoredJob> {
        rank_jobs(jobs, |j| *j)
    }

    #[test]
    fn puts_farming_first_then_the_project_then_the_good_shortest() {
        use ScoredJob::*;
        assert_eq!(
            ranked(vec![
                Surplus { full: 0.0 },
                Short { share: 0.2 },
                Scout,
                Short { share: 0.9 },
                Road,
                Project,
                Farm { food_short: false },
                Back,
            ]),
            [
                Farm { food_short: false },
                Project,
                Short { share: 0.9 },
                Short { share: 0.2 },
                Road,
                Scout,
                Back,
                Surplus { full: 0.0 },
            ]
        );
    }

    #[test]
    fn keeps_goods_that_lack_as_much_in_the_order_given() {
        let offers = vec![
            ("food", ScoredJob::Short { share: 0.5 }),
            ("wood", ScoredJob::Short { share: 0.5 }),
        ];
        let names: Vec<&str> = rank_jobs(offers, |o| o.1).into_iter().map(|o| o.0).collect();
        assert_eq!(names, ["food", "wood"]);
    }

    #[test]
    fn weighs_surplus_by_how_far_below_its_cap_and_never_above_going_back() {
        let surplus = |full| job_score(ScoredJob::Surplus { full });
        assert!(surplus(0.2) > surplus(0.8));
        assert!(surplus(-3.0) > surplus(-2.0));
        assert!(surplus(-1000.0) < job_score(ScoredJob::Back));
    }

    #[test]
    fn weighs_work_past_a_cap_below_any_under_one_and_less_the_further_past() {
        let surplus = |full| job_score(ScoredJob::Surplus { full });
        assert!(surplus(0.999) >= surplus(1.0));
        assert!(surplus(1.5) > surplus(3.0));
        assert!(surplus(1000.0) > 0.0);
        // Inside a range of its own, below the one under a cap.
        assert!(surplus(1.0) - surplus(1000.0) <= NPC_JOB_SCORE.surplus_range);
    }

    #[test]
    fn moves_a_worker_only_for_more_than_the_margin() {
        assert!(beats(10.0 + NPC_JOB_MARGIN + 0.1, 10.0));
        assert!(!beats(10.0 + NPC_JOB_MARGIN, 10.0));
        assert!(!beats(10.0, 10.0));
    }

    #[test]
    fn has_a_worker_on_what_is_short_stay_for_anything_but_farming() {
        for share in [0.0, 0.01, 0.5, 1.0] {
            let held = job_score(ScoredJob::Short { share });
            assert!(beats(job_score(ScoredJob::Farm { food_short: false }), held));
            assert!(beats(job_score(ScoredJob::Farm { food_short: true }), held));
            assert!(!beats(job_score(ScoredJob::Project), held));
            assert!(!beats(job_score(ScoredJob::Short { share: 1.0 }), held));
            assert!(!beats(job_score(ScoredJob::Road), held));
        }
    }

    #[test]
    fn has_a_worker_let_go_move_for_anything_above_going_back() {
        let held = job_score(ScoredJob::Back);
        for job in [
            ScoredJob::Project,
            ScoredJob::Short { share: 0.01 },
            ScoredJob::Road,
            ScoredJob::Scout,
        ] {
            assert!(beats(job_score(job), held));
        }
    }

    #[test]
    fn weighs_a_place_by_distance_danger_and_crew_at_most_by_the_cap() {
        let w = NpcJobWeights { distance: 0.1, danger: 5.0, crew: 1.0, most: 12.0 };
        let near = Considerations { distance: 10.0, danger: 0.0, crew: 0.0 };
        let far = Considerations { distance: 100.0, danger: 0.0, crew: 0.0 };
        let dangerous = Considerations { distance: 10.0, danger: 1.0, crew: 0.0 };
        assert_eq!(place_cost(near, &w), 1.0);
        assert_eq!(place_cost(far, &w), 10.0);
        assert_eq!(place_cost(dangerous, &w), 6.0);
        assert_eq!(place_cost(Considerations { distance: 10.0, danger: 9.0, crew: 3.0 }, &w), 12.0);
        let short = ScoredJob::Short { share: 0.5 };
        assert!(blended_score(short, near, &w) > blended_score(short, dangerous, &w));
    }

    #[test]
    fn weighs_nothing_down_with_neutral_weights_nor_farming_while_food_is_short() {
        let at = Considerations { distance: 80.0, danger: 4.0, crew: 6.0 };
        for job in [ScoredJob::Short { share: 0.3 }, ScoredJob::Surplus { full: 0.5 }] {
            assert_eq!(blended_score(job, at, &NpcJobWeights::NEUTRAL), job_score(job));
        }
        let food = ScoredJob::Farm { food_short: true };
        assert_eq!(blended_score(food, at, &NPC_JOB_WEIGHTS), job_score(food));
    }

    #[test]
    fn keeps_work_on_a_short_good_ahead_of_the_road_crew_however_far_or_dangerous() {
        let worst = Considerations { distance: 1e6, danger: 1e6, crew: 1e6 };
        let short = blended_score(ScoredJob::Short { share: 0.0 }, worst, &NPC_JOB_WEIGHTS);
        assert!(short > job_score(ScoredJob::Road));
    }

    // "a city shares out its adults by the scores" runs `planCity`: those tests come with
    // `npc_plan`.
}

#[cfg(test)]
mod share_tests;

#[cfg(test)]
mod neutral_tests;
