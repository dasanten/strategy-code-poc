//! `npc-big-city.test.ts`: a staged city of about 110 run for 40 game days (ADR 0029), held to
//! what it shows (T80.11). `--nocapture` shows its jobs and who stands on the storage.
//!
//! On a map with room it holds its idle share, as it goes on founding. Alone on a map too small for
//! a daughter, with no warehouse for its traders, nothing uses its goods up: that one only reports
//! and doesn't hold to the share (`CONTEXT.md`: Spare hands' work).

use csp_shared::balance::{NPC_FOUND_PARTY_MOST, NPC_PLAN_TICKS, NPC_VILLAGE};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, Good};

use super::big_city_fixture::{
    big_city, big_city_hold_report, big_city_report, count_big_city, run_big_city, BigCity,
    BigCityHold, BigCityWatch, BIG_CITY_RESIDENTS,
};
use crate::invariants::check_all;
use crate::npc_founding::founding_party;
use crate::npc_plan::farmers_wanted;
use crate::queries::building::max_workers;
use crate::queries::city::{stored_food, surplus_food_line};
use crate::queries::npc_trade::npc_reserve;

/// The first game day a city that started full of work has to show it has found its feet.
const HOLDS_FROM_DAY: f64 = 30.0;

/// The most of its adults idle from then on.
const MOST_IDLE_SHARE: f64 = 0.15;

/// The most ticks anyone stands on the storage with nothing to do: one pass and the ticks round it
/// (`LONGEST_ON_STORAGE`).
const LONGEST_ON_STORAGE: usize = NPC_PLAN_TICKS as usize + 5;

/// The most its farmers may change from one game day to the next: what a founding party leaving
/// takes off those it keeps, and the one more it keeps with no food surplus (`MOST_FARMER_SWING`).
const MOST_FARMER_SWING: usize = (NPC_FOUND_PARTY_MOST / 4.0).ceil() as usize + 1;

/// How long the city with only the farms it would build is run (#995).
const FARMS_RUN_DAYS: usize = 40;

/// The last game day its Food may still be short of its reserve (#995).
const FOOD_SHORT_UNTIL_DAY: f64 = 15.0;

/// The first game day its farmers are held to `MOST_FARMER_SWING`, the shortage behind it.
const FARMS_STEADY_FROM_DAY: f64 = 20.0;

fn invariants_hold(s: &BigCity) {
    assert_eq!(check_all(&s.world, &s.terrain), []);
}

#[test]
#[ignore = "344 s alone; see #1092"]
fn with_no_room_and_no_warehouse_keeps_its_storage_clear_and_reports_its_jobs() {
    let mut staged = big_city(None, 240);
    let mut watch = BigCityWatch::new(HOLDS_FROM_DAY);
    let run = run_big_city(&mut staged, 40, 5, &mut invariants_hold, &mut |s| watch.tick(s));
    let hold = watch.hold();
    eprintln!("Big city, {BIG_CITY_RESIDENTS} residents staged:\n{}", big_city_report(&run));
    eprintln!("From day {HOLDS_FROM_DAY}, no room, no warehouse:\n{}", big_city_hold_report(&hold));
    assert_eq!(run.counts.len(), 8);
    assert!(hold.longest_on_storage <= LONGEST_ON_STORAGE, "{hold:?}");
    // Needs grow with the city (`CONTEXT.md`: Spare hands' work): at most a second of each
    // workplace on a node, and no more farms than it was staged with.
    let places = &run.counts.last().expect("a count").places;
    eprintln!("Built by the end: {places:?}");
    assert_eq!(places.get("farm"), Some(&8));
    for kind in ["lumberCamp", "quarry", "mine"] {
        assert_eq!(places.get(kind), Some(&2), "{kind}");
    }
}

/// What the big city on a map with room did about its first daughter, run to game day 40
/// (`roomyRun`).
struct RoomyRun {
    set_out: Option<f64>,
    party: Vec<String>,
    moved: Option<(f64, usize)>,
    kept_food: f64,
    kept_food_line: f64,
    hold: BigCityHold,
}

fn roomy_run() -> RoomyRun {
    let mut staged = big_city(None, 1300);
    let mut watch = BigCityWatch::new(HOLDS_FROM_DAY);
    let city = staged.city.clone();
    let mut set_out = None;
    let mut party = Vec::new();
    let mut moved = None;
    let mut kept_food = f64::INFINITY;
    let mut kept_food_line = 0.0;
    // Nothing is held for it: its scouts and road crew go out with Food and its crew lays roads.
    run_big_city(&mut staged, 40, 5, &mut invariants_hold, &mut |s| {
        watch.tick(s);
        if moved.is_some() {
            return;
        }
        let world = &s.world;
        let day = world.tick as f64 / TICKS_PER_GAME_DAY;
        let now = founding_party(world.city_plans.get(&city));
        if set_out.is_none() && !now.is_empty() {
            set_out = Some(day);
            party = now;
        }
        if set_out.is_some() {
            kept_food = kept_food.min(stored_food(world, s.city()));
            kept_food_line = surplus_food_line(world, s.city());
        }
        let daughter = world
            .cities
            .iter()
            .find(|c| c.id != city && c.realm_id.is_none() && c.trade_org.is_none());
        let people = daughter.map_or(0, |d| {
            world.residents.iter().filter(|r| r.city_id.as_deref() == Some(d.id.as_str())).count()
        });
        if people > 0 {
            moved = Some((day, people));
        }
    });
    let hold = watch.hold();
    RoomyRun { set_out, party, moved, kept_food, kept_food_line, hold }
}

#[test]
#[ignore = "288 s alone; see #1092"]
fn on_a_map_with_room_founds_a_daughter_unaided_and_goes_on_feeding_itself() {
    let run = roomy_run();
    eprintln!(
        "Big city unaided: party of {} set out on day {:?}, moved by day {:?}",
        run.party.len(),
        run.set_out,
        run.moved.map(|m| m.0)
    );
    assert!(run.set_out.is_some());
    assert!(run.party.len() as f64 > NPC_VILLAGE.residents);
    assert_eq!(run.moved.map(|m| m.1), Some(run.party.len()));
    // What it gave the party leaves it Food enough: never short of a surplus for those who stayed.
    assert!(run.kept_food > run.kept_food_line, "{} {}", run.kept_food, run.kept_food_line);
}

#[test]
#[ignore = "271 s alone; see #1092"]
fn on_a_map_with_room_holds_its_idle_share_keeps_its_storage_clear_and_its_farmers_steady() {
    let RoomyRun { hold, .. } = roomy_run();
    eprintln!("From day {HOLDS_FROM_DAY}, on a map with room:\n{}", big_city_hold_report(&hold));
    assert!(hold.idle_share <= MOST_IDLE_SHARE, "{hold:?}");
    assert!(hold.longest_on_storage <= LONGEST_ON_STORAGE, "{hold:?}");
    assert!(hold.farmer_swing <= MOST_FARMER_SWING, "{hold:?}");
}

#[test]
#[ignore = "475 s alone; see #1092"]
fn with_only_the_farms_it_would_build_opens_more_until_food_is_no_longer_short_995() {
    let mut staged = big_city(None, 1300);
    let city = staged.city.clone();
    let farms: Vec<String> = staged
        .world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(city.as_str()))
        .map(|b| b.id.clone())
        .collect();
    let kept = farmers_wanted(&staged.world, staged.city())
        / max_workers(BuildingKind::Farm).unwrap_or(1.0);
    let gone = &farms[(kept.ceil() as usize).min(farms.len())..];
    staged.world.buildings.retain(|b| !gone.contains(&b.id));
    let mut watch = BigCityWatch::new(FARMS_STEADY_FROM_DAY);
    let mut days = Vec::new();
    let mut short_until = 0.0;
    run_big_city(
        &mut staged,
        FARMS_RUN_DAYS,
        5,
        &mut |s| {
            invariants_hold(s);
            let day = s.world.tick as f64 / TICKS_PER_GAME_DAY;
            let food =
                s.home().stock.as_ref().and_then(|st| st.get(&Good::Food)).copied().unwrap_or(0.0);
            let reserve = npc_reserve(&s.world, s.city()).get(&Good::Food).copied().unwrap_or(0.0);
            if food < reserve {
                short_until = day;
            }
            let c = count_big_city(s);
            let n = |k: &str| c.jobs.get(k).copied().unwrap_or(0);
            days.push(format!(
                "day {day}: Food {food} / {reserve}, farms {}, farm {}, idle {}, scout {}, work {}, build {}",
                c.places.get("farm").copied().unwrap_or(0),
                n("farm"),
                n("idle"),
                n("scout"),
                n("work"),
                n("build")
            ));
        },
        &mut |s| watch.tick(s),
    );
    let hold = watch.hold();
    eprintln!("Big city with {} farms:\n{}", kept.ceil(), days.join("\n"));
    eprintln!("Food short until day {short_until}\n{}", big_city_hold_report(&hold));
    assert!(short_until <= FOOD_SHORT_UNTIL_DAY, "{short_until}");
    assert!(hold.farmer_swing <= MOST_FARMER_SWING, "{hold:?}");
}
