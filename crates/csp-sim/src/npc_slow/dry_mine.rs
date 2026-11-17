//! Moving on from a dry node (`CONTEXT.md`: Running dry, NPC city; T102.4), its slow run: the
//! staged big city of Epic 80 with its iron ore vein nearly empty and a second iron ore node
//! further off ends a game season working the second, with no more idle adults than before.
//! Its builders tear the dead mine down. `--nocapture` shows when the vein ran dry, the new mine
//! and the idle shares.

use csp_shared::balance::{WORKPLACE_MAX_WORKERS, WORK_OUTPUT_PER_DAY};
use csp_shared::time::{GAME_DAYS_PER_YEAR, TICKS_PER_GAME_DAY};
use csp_shared::world::{BuildingKind, CityJobKind, Good, ResourceKind, VeinStock};

use super::big_city_fixture::{big_city, BigCity};
use super::{add_node, unhurried_walking};
use crate::invariants::check_all;
use crate::npc_chain::own_workplaces;
use crate::npc_test_world::Runner;
use crate::queries::building::workplace_node;
use crate::queries::city::city_residents;
use crate::queries::names::held;
use crate::queries::npc_trade::npc_reserve;
use crate::queries::residents::{can_work, is_down};
use crate::tick::Scratch;

/// A game season: a quarter of a game year.
const SEASON_DAYS: usize = (GAME_DAYS_PER_YEAR / 4.0) as usize;

/// Game days a full crew takes to empty the vein the staged city starts on.
const VEIN_DAYS_LEFT: f64 = 15.0;

/// The first game day the city counts as settled from its staging, everyone free at home.
const SETTLED_FROM_DAY: f64 = 5.0;

/// Game days after the vein ran dry that the city has to move on before it is held to its idle
/// share again.
const MOVING_ON_DAYS: f64 = 15.0;

/// How far its mean idle share after moving on may lie above the one before, as a share of its
/// adults: about one adult of its hundred.
const IDLE_SLACK: f64 = 0.01;

/// The share of its plans after moving on that put someone to work at the new mine, at least.
const MOST_WORKED: f64 = 0.75;

/// The share of its adults the city's plan leaves idle.
fn idle_share(s: &BigCity) -> Option<f64> {
    let world = &s.world;
    let plan = world.city_plans.get(&s.city)?;
    let tick = world.tick as f64;
    let adults: Vec<_> = city_residents(world, &s.city)
        .into_iter()
        .filter(|r| !is_down(r.down_until) && can_work(r.born_at, tick))
        .collect();
    let idle = adults
        .iter()
        .filter(|r| plan.jobs.get(&r.id).is_some_and(|j| j.kind == CityJobKind::Idle))
        .count();
    Some(idle as f64 / adults.len() as f64)
}

#[test]
#[ignore = "324 s alone in release; see #1132"]
fn a_big_city_whose_vein_runs_dry_ends_a_season_working_the_next_node_no_idler_than_before() {
    let mut staged = big_city(None, 1300);
    // Its mine's vein nearly empty, the spare iron ore node beside it gone, another further off.
    let mine = own_workplaces(&staged.world, staged.city())
        .into_iter()
        .find(|b| b.kind == BuildingKind::Mine)
        .expect("its mine")
        .clone();
    let ore = workplace_node(&staged.world, &mine).expect("its node").id.clone();
    let crew_day = WORK_OUTPUT_PER_DAY.get("ironOre").expect("iron ore")
        * WORKPLACE_MAX_WORKERS.get("mine").expect("a mine");
    let left = (crew_day * VEIN_DAYS_LEFT).round();
    let node = staged.world.nodes.iter_mut().find(|n| n.id == ore).expect("its node");
    node.stock = Some(VeinStock { first: left * 10.0, left, made: left * 9.0 });
    staged.world.nodes.retain(|n| {
        n.kind != ResourceKind::IronOre || n.id == ore || n.x != mine.x + 10.0 || n.y != mine.y
    });
    let far = (mine.x + 70.0, mine.y + 60.0);
    let ore2 =
        add_node(&mut staged.world, &mut staged.terrain, ResourceKind::IronOre, far.0, far.1);
    staged.world.nodes.last_mut().expect("the node").fill_stock();

    let mut dry_day: Option<f64> = None;
    let mut planned_at = None;
    let (mut before, mut after) = (Vec::new(), Vec::new());
    // For each plan after it moved on: whether anyone works a mine on the second node.
    let mut worked: Vec<bool> = Vec::new();
    let mut runner =
        Runner { walking: unhurried_walking(&staged.terrain), scratch: Scratch::default() };
    for _ in 0..SEASON_DAYS {
        // Whatever Iron ore and Iron it has goes out, so it keeps wanting more: its mine is worked.
        // Its archers' Arrows are topped up to its reserve: forged from Iron that never stays, they
        // would be short all season and pull its hands from the mine onto other work.
        let arrows = held(&npc_reserve(&staged.world, staged.city()), Good::Arrows);
        let stock = staged.home_mut().stock.get_or_insert_with(Default::default);
        stock.insert(Good::IronOre, 0.0);
        stock.insert(Good::Iron, 0.0);
        if held(stock, Good::Arrows) < arrows {
            stock.insert(Good::Arrows, arrows);
        }
        for _ in 0..TICKS_PER_GAME_DAY as usize {
            runner.step(&mut staged.world, &staged.terrain);
            let s = &staged;
            let day = s.world.tick as f64 / TICKS_PER_GAME_DAY;
            if dry_day.is_none() && s.world.dry_nodes.iter().any(|d| d.id == ore) {
                dry_day = Some(day);
            }
            let Some(plan) = s.world.city_plans.get(&s.city) else { continue };
            if Some(plan.planned_at) == planned_at || day < SETTLED_FROM_DAY {
                continue;
            }
            planned_at = Some(plan.planned_at);
            let Some(share) = idle_share(s) else { continue };
            match dry_day {
                None => before.push(share),
                Some(d) if day >= d + MOVING_ON_DAYS => {
                    after.push(share);
                    let on_ore2 = |id: &String| {
                        s.world.buildings.iter().any(|b| {
                            &b.id == id
                                && b.kind == BuildingKind::Mine
                                && workplace_node(&s.world, b).is_some_and(|n| n.id == ore2)
                        })
                    };
                    worked.push(
                        plan.jobs.values().any(|j| j.building_id.as_ref().is_some_and(on_ore2)),
                    );
                }
                Some(_) => {}
            }
        }
        assert_eq!(check_all(&staged.world, &staged.terrain), []);
    }

    let world = &staged.world;
    let new_mine = own_workplaces(world, staged.city())
        .into_iter()
        .find(|b| {
            b.kind == BuildingKind::Mine && workplace_node(world, b).is_some_and(|n| n.id == ore2)
        })
        .cloned();
    let crew = new_mine.as_ref().map_or(0, |m| {
        world.city_plans.get(&staged.city).map_or(0, |p| {
            p.jobs.values().filter(|j| j.building_id.as_deref() == Some(m.id.as_str())).count()
        })
    });
    let dead_gone = !world.buildings.iter().any(|b| b.id == mine.id);
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
    eprintln!(
        "vein ran dry on day {dry_day:?}; new mine {:?}, finished {}, crew {crew}, worked in {:.0}% of plans after; dead mine torn \
         down: {dead_gone}; idle before {:.1}% ({} plans), after {:.1}% ({} plans)",
        new_mine.as_ref().map(|m| (m.x, m.y)),
        new_mine.as_ref().is_some_and(|m| m.site.is_none()),
        worked.iter().filter(|w| **w).count() as f64 / worked.len().max(1) as f64 * 100.0,
        mean(&before) * 100.0,
        before.len(),
        mean(&after) * 100.0,
        after.len()
    );
    assert!(dry_day.is_some(), "the vein never ran dry");
    let new_mine = new_mine.expect("a mine on the second node");
    assert!(new_mine.site.is_none(), "the new mine is still a site");
    // It works the new mine through the season after moving on, not only on its last day: a birth
    // can make Wood short for a day and send the crew to the lumber camp, and a city that founds
    // daughters keeps them there for its parties' Wood (T100.8).
    let share = worked.iter().filter(|w| **w).count() as f64 / worked.len().max(1) as f64;
    assert!(share >= MOST_WORKED, "the new mine is worked in {:.0}% of plans", share * 100.0);
    assert!(dead_gone, "the dead mine still stands");
    assert!(!before.is_empty() && !after.is_empty());
    assert!(mean(&after) <= mean(&before) + IDLE_SLACK, "{before:?}\n{after:?}");
}
