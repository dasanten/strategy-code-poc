//! T101.6: the staged city of Epic 80 (`big_city`) with a coal node in reach goes for Steel
//! (`CONTEXT.md`: NPC reserve) and ends a game season with steel-armed soldiers, with no more of
//! its adults idle than the same city without the coal node. `--nocapture` shows both runs.

use csp_shared::time::GAME_DAYS_PER_YEAR;
use csp_shared::world::{BuildingKind, Good, ResourceKind};

use super::add_node;
use super::big_city_fixture::{
    big_city, big_city_hold_report, big_city_report, run_big_city, BigCity, BigCityHold,
    BigCityWatch,
};
use crate::invariants::check_all;
use crate::npc_chain::own_workplaces;
use crate::queries::city::city_residents;
use crate::queries::npc_trade::{npc_archer_target, npc_makes_steel, npc_soldier_target};
use crate::queries::residents::can_work;

/// A game season: a quarter of a game year.
const SEASON_DAYS: usize = (GAME_DAYS_PER_YEAR / 4.0) as usize;

/// The first game day its idle share is watched from, as in the big city's own runs.
const WATCHED_FROM_DAY: f64 = 30.0;

/// How much more of its adults the steel city may have idle, on the mean over its plans, than
/// the same city without the coal node: a run's noise, no more.
const IDLE_SLACK: f64 = 0.02;

/// What a season of the big city came to.
struct Season {
    hold: BigCityHold,
    steel_armed: usize,
    soldiers_wanted: f64,
    smelters: usize,
    report: String,
}

/// Runs the big city, on a map with room, for a game season, with a coal node in its reach or
/// without.
fn season(coal: bool) -> Season {
    let mut staged: BigCity = big_city(None, 1300);
    if coal {
        let east = staged.world.nodes.iter().map(|n| n.x).fold(0.0, f64::max);
        add_node(&mut staged.world, &mut staged.terrain, ResourceKind::Coal, east, 100.0);
        assert!(npc_makes_steel(&staged.world, staged.city()));
    }
    let mut watch = BigCityWatch::new(WATCHED_FROM_DAY);
    let run = run_big_city(
        &mut staged,
        SEASON_DAYS,
        15,
        &mut |s| assert_eq!(check_all(&s.world, &s.terrain), []),
        &mut |s| watch.tick(s),
    );
    let world = &staged.world;
    let tick = world.tick as f64;
    let people = city_residents(world, &staged.city);
    let adults =
        people.iter().filter(|r| r.health > 0.0 && can_work(r.born_at, tick)).count() as f64;
    let steel_armed = people
        .iter()
        .filter(|r| {
            r.health > 0.0 && r.carried.get(&Good::SteelSword).copied().unwrap_or(0.0) > 0.0
        })
        .count();
    let smelters = own_workplaces(world, staged.city())
        .iter()
        .filter(|b| b.kind == BuildingKind::Smelter && b.site.is_none())
        .count();
    Season {
        hold: watch.hold(),
        steel_armed,
        // Its archers carry a Bow, not a sword (`CONTEXT.md`: Ranged combat).
        soldiers_wanted: npc_soldier_target(adults)
            - npc_archer_target(world, staged.city(), adults),
        smelters,
        report: big_city_report(&run),
    }
}

#[test]
#[ignore = "two game seasons of the big city, side by side; minutes in release"]
fn with_a_coal_node_in_reach_ends_a_season_steel_armed_and_no_more_idle() {
    let (iron, steel) = std::thread::scope(|s| {
        let iron = s.spawn(|| season(false));
        let steel = s.spawn(|| season(true));
        (iron.join().expect("the iron run"), steel.join().expect("the steel run"))
    });
    for (name, run) in [("without coal", &iron), ("with a coal node", &steel)] {
        eprintln!(
            "Big city {name}, {SEASON_DAYS} days: {} steel-armed of {} soldiers, {} smelters\n{}\n{}",
            run.steel_armed,
            run.soldiers_wanted,
            run.smelters,
            run.report,
            big_city_hold_report(&run.hold)
        );
    }
    assert_eq!(iron.steel_armed, 0);
    assert!(steel.smelters >= 2, "an Iron and a Steel smelter");
    assert!(
        steel.steel_armed as f64 >= steel.soldiers_wanted,
        "{} steel-armed of {}",
        steel.steel_armed,
        steel.soldiers_wanted
    );
    assert!(
        steel.hold.mean_idle_share <= iron.hold.mean_idle_share + IDLE_SLACK,
        "idle {:.3} with coal, {:.3} without",
        steel.hold.mean_idle_share,
        iron.hold.mean_idle_share
    );
}
