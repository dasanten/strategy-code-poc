//! What an NPC city's jobs are worth (`apps/server/src/npc-scores.ts`, `CONTEXT.md`: NPC city;
//! ADR 0029). Its planning pass says what a free adult could do, as far as it knows, and these say
//! what each is worth, so each goes to the highest-scoring job with room (`shareOut`). Pure, with
//! the numbers in `balance.rs`.

use csp_shared::balance::{NPC_JOB_MARGIN, NPC_JOB_SCORE};

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
    /// Working for surplus; `full` is how full its good's cap is, below 1, below 0 under its
    /// reserve.
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

    // "a city shares out its adults by the scores" runs `planCity`: those tests come with
    // `npc_plan`.
}

#[cfg(test)]
mod share_tests;
