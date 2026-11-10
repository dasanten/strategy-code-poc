//! `npc-training.test.ts`, its slow simulations: a big NPC city's training ground (`CONTEXT.md`:
//! Bigger projects, Who trains), and training and patrols sharing its soldiers.

use std::collections::HashSet;

use csp_shared::balance::{
    NPC_SOLDIERS_ON_HALL, NPC_TRAIN_TURN_TICKS, TRAINING_GROUND_MAX_TRAINEES,
};
use csp_shared::footprint::is_at;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityJobKind, Good, Resident, StatName, Task, WorldState,
};
use serde_json::json;

use super::big_city_fixture::{big_city, BigCity};
use super::unhurried_walking;
use crate::invariants::check_all;
use crate::npc_growth::{house_tile, wall_rings};
use crate::npc_posts::posts_to_hold;
use crate::npc_test_world::Runner;
use crate::npc_training::city_ground;
use crate::queries::building::{teacher_at, trainees_of};
use crate::queries::city::town_hall_of;
use crate::queries::names::placed;
use crate::queries::residents::{can_work, is_down, stat_value};
use crate::random::{new_id, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::tick::Scratch;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

/// A finished training ground where the city would put one, its own by standing in its area
/// (`withGround`); returns its id.
fn with_ground(s: &mut BigCity) -> String {
    let rings = wall_rings(&s.world, s.city(), s.home(), s.terrain.size);
    let (x, y) = house_tile(
        &s.world,
        s.city(),
        s.home(),
        &s.terrain,
        rings.as_ref(),
        BuildingKind::TrainingGround,
    )
    .expect("room for a training ground");
    let id = new_id("b", &mut s.world.next_id);
    let ground = crate::test_support::building(
        &id,
        BuildingKind::TrainingGround,
        None,
        f64::from(x),
        f64::from(y),
    );
    s.world.buildings.push(ground);
    id
}

/// An armed grown resident of a realm at `at`, their Leader off at `away` (`armedOutsider`);
/// returns the outsider's index.
fn armed_outsider(world: &mut WorldState, at: (f64, f64), away: (f64, f64)) -> usize {
    let make = |world: &mut WorldState, id: &str, (x, y): (f64, f64)| {
        let mut m = Mulberry32::new((world.residents.len() + 1) as f64);
        let fields =
            NewResident { id, owner: Some("r1"), city_id: None, x, y, tick: world.tick as f64 };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.born_at = world.tick as f64 - 20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
        world.residents.push(r);
        world.residents.len() - 1
    };
    make(world, "leader", away);
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "leader" }))
            .expect("a realm"),
    );
    let i = make(world, "outsider", at);
    world.residents[i].carried.insert(Good::Sword, 1.0);
    i
}

/// The city's soldiers: its residents who carry a spear (`soldiersOf`).
fn soldiers_of(world: &WorldState, city: &str) -> Vec<String> {
    world
        .residents
        .iter()
        .filter(|r| {
            r.city_id.as_deref() == Some(city)
                && r.carried.get(&Good::Spear).copied().unwrap_or(0.0) > 0.0
        })
        .map(|r| r.id.clone())
        .collect()
}

fn resident<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).expect("the resident")
}

/// Those the city's plan gives a job of `kind` (`jobsOf`).
fn jobs_of(world: &WorldState, city: &str, kind: CityJobKind) -> Vec<String> {
    world.city_plans.get(city).map_or_else(Vec::new, |p| {
        p.jobs.iter().filter(|(_, j)| j.kind == kind).map(|(id, _)| id.clone()).collect()
    })
}

fn ground_of(s: &BigCity, id: &str) -> Building {
    s.world.buildings.iter().find(|b| b.id == id).expect("the ground").clone()
}

fn trainees(s: &BigCity, ground: &str) -> Vec<String> {
    let g = ground_of(s, ground);
    trainees_of(&g, &s.world.residents, s.terrain.size).iter().map(|r| r.id.clone()).collect()
}

fn teacher(s: &BigCity, ground: &str) -> Option<String> {
    let g = ground_of(s, ground);
    teacher_at(&g, &s.world.residents, s.terrain.size).map(|r| r.id.clone())
}

/// Whether one of the soldiers stands at the hall, or walks there (`held`).
fn hall_held(s: &BigCity, soldiers: &[String]) -> bool {
    let hall = town_hall_of(&s.world, s.city()).expect("a hall");
    let size = s.terrain.size;
    soldiers.iter().filter_map(|id| s.world.residents.iter().find(|r| &r.id == id)).any(|r| {
        if is_down(r.down_until) {
            return false;
        }
        if is_at((r.x as i32, r.y as i32), placed(hall), size) {
            return true;
        }
        let order = serde_json::to_value(&r.order).unwrap_or_default();
        order["kind"] == "walkTo"
            && is_at(
                (
                    order["target"]["x"].as_f64().unwrap_or(f64::NAN) as i32,
                    order["target"]["y"].as_f64().unwrap_or(f64::NAN) as i32,
                ),
                placed(hall),
                size,
            )
    })
}

fn task_of(r: &Resident) -> Option<Task> {
    r.script.as_ref().and_then(|s| s.task)
}

/// The staged city with its ground, stepped with unhurried walking (`running`).
struct Running {
    s: BigCity,
    ground: String,
    runner: Runner,
}

impl Running {
    fn new() -> Self {
        let mut s = big_city(None, 240);
        let ground = with_ground(&mut s);
        let runner = Runner { walking: unhurried_walking(&s.terrain), scratch: Scratch::default() };
        Running { s, ground, runner }
    }

    fn step(&mut self, ticks: usize) {
        for _ in 0..ticks {
            self.runner.step(&mut self.s.world, &self.s.terrain);
        }
    }
}

#[test]
#[ignore = "62 s alone; see #1092"]
fn goes_up_on_a_run_of_the_staged_city_one_only_with_no_invariant_broken() {
    let mut s = big_city(None, 240);
    let mut runner = Runner { walking: unhurried_walking(&s.terrain), scratch: Scratch::default() };
    let mut built = false;
    for t in 0..12 * DAY {
        runner.step(&mut s.world, &s.terrain);
        if t % 60 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
        let grounds: Vec<&Building> =
            s.world.buildings.iter().filter(|b| b.kind == BuildingKind::TrainingGround).collect();
        assert!(grounds.len() <= 1);
        if grounds.first().is_some_and(|g| g.site.is_none()) {
            built = true;
            eprintln!("built by tick {}", s.world.tick);
            break;
        }
    }
    assert!(built);
    assert!(city_ground(&s.world, s.city(), s.terrain.size).is_some());
}

#[test]
#[ignore = "7 s alone; see #1092"]
fn walk_there_run_the_train_default_and_learn_the_hall_held_all_the_while_their_values_rising() {
    let mut run = Running::new();
    let soldiers = soldiers_of(&run.s.world, &run.s.city);
    let tick = run.s.world.tick as f64;
    let before: Vec<(String, f64)> = soldiers
        .iter()
        .map(|id| (id.clone(), stat_value(resident(&run.s.world, id), StatName::Strength, tick)))
        .collect();
    let hall = town_hall_of(&run.s.world, run.s.city()).expect("a hall").clone();
    let size = run.s.terrain.size;
    let mut all_there = false;
    let mut on_hall = 0;
    for _ in 0..DAY {
        run.step(1);
        if run.s.world.city_plans.contains_key(&run.s.city) {
            assert!(hall_held(&run.s, &soldiers), "the hall left at tick {}", run.s.world.tick);
        }
        on_hall = soldiers
            .iter()
            .filter(|id| {
                let r = resident(&run.s.world, id);
                is_at((r.x as i32, r.y as i32), placed(&hall), size)
            })
            .count();
        all_there |=
            teacher(&run.s, &run.ground).is_some() && !trainees(&run.s, &run.ground).is_empty();
    }
    assert!(all_there);
    assert!(on_hall as f64 >= NPC_SOLDIERS_ON_HALL, "{on_hall} on the hall");
    let lot = trainees(&run.s, &run.ground);
    assert!(!lot.is_empty());
    for id in &lot {
        let r = resident(&run.s.world, id);
        let script = r.script.as_ref().expect("a script");
        assert_eq!((script.task, script.script_id), (Some(Task::Train), 0), "{id}");
    }
    let teacher_id = teacher(&run.s, &run.ground).expect("a teacher");
    let t = resident(&run.s.world, &teacher_id);
    let order = serde_json::to_value(&t.order).unwrap();
    assert_eq!(
        (order["kind"].as_str(), order["subject"].as_str()),
        (Some("teach"), Some("strength"))
    );
    let now = run.s.world.tick as f64;
    let rose = lot
        .iter()
        .filter(|id| {
            let was = before.iter().find(|(b, _)| b == *id).map_or(f64::INFINITY, |(_, v)| *v);
            stat_value(resident(&run.s.world, id), StatName::Strength, now) > was
        })
        .count();
    assert!(rose > 0);
    assert_eq!(t.stats.strength.trained, 0.0);
    assert_eq!(check_all(&run.s.world, &run.s.terrain), []);
    // Spread over the ground, not in a heap on one tile.
    let tiles: HashSet<(i64, i64)> = lot
        .iter()
        .map(|id| {
            let r = resident(&run.s.world, id);
            ((r.x * 1000.0) as i64, (r.y * 1000.0) as i64)
        })
        .collect();
    assert!(tiles.len() > 1);
}

#[test]
#[ignore = "7 s alone; see #1092"]
fn wait_with_no_teacher_and_leave_once_the_pass_finds_none() {
    let mut run = Running::new();
    run.step(DAY / 2);
    let lot = trainees(&run.s, &run.ground);
    assert!(!lot.is_empty());
    // No soldiers to spare any more: all but those the hall and gates need are gone.
    let posts = posts_to_hold(&run.s.world, run.s.city()) as usize;
    let keep: HashSet<String> = lot.iter().take(posts).cloned().collect();
    for id in soldiers_of(&run.s.world, &run.s.city) {
        if !keep.contains(&id) {
            let r = run.s.world.residents.iter_mut().find(|r| r.id == id).expect("a soldier");
            r.carried.shift_remove(&Good::Spear);
        }
    }
    run.step(90);
    assert_eq!(teacher(&run.s, &run.ground), None);
    assert_eq!(trainees(&run.s, &run.ground), Vec::<String>::new());
    for id in soldiers_of(&run.s.world, &run.s.city) {
        assert_ne!(task_of(resident(&run.s.world, &id)), Some(Task::Train), "{id}");
    }
    assert_eq!(check_all(&run.s.world, &run.s.terrain), []);
}

#[test]
#[ignore = "nothing raises an outsider alarm yet: outsiders.ts is not ported; 6 s alone; see #1092"]
fn are_taken_off_by_an_alarm_and_come_back_to_it_after() {
    let mut run = Running::new();
    run.step(DAY / 2);
    let teacher_id = teacher(&run.s, &run.ground).expect("a teacher");
    let lot = trainees(&run.s, &run.ground);
    assert!(!lot.is_empty());

    // An armed outsider walks up to the ground: they drop what they are at, what it was kept aside.
    let away = (170.0, 170.0);
    let g = ground_of(&run.s, &run.ground);
    let outsider = armed_outsider(&mut run.s.world, (g.x - 2.0, g.y), away);
    let people: Vec<String> = std::iter::once(teacher_id).chain(lot).collect();
    let on_alarm = |s: &BigCity| -> Vec<String> {
        people
            .iter()
            .filter(|id| task_of(resident(&s.world, id)) == Some(Task::Alarm))
            .cloned()
            .collect()
    };
    let mut t = 0;
    while t < 60 && on_alarm(&run.s).is_empty() {
        run.step(1);
        t += 1;
    }
    let called = on_alarm(&run.s);
    assert!(!called.is_empty());
    for id in &called {
        assert!(resident(&run.s.world, id).interrupted.is_some(), "{id}");
    }
    assert_eq!(check_all(&run.s.world, &run.s.terrain), []);

    // The outsider gone, they are back at the ground within a game hour or two of standing down.
    (run.s.world.residents[outsider].x, run.s.world.residents[outsider].y) = away;
    let mut t = 0;
    while t < DAY / 2 && !on_alarm(&run.s).is_empty() {
        run.step(1);
        t += 1;
    }
    assert_eq!(on_alarm(&run.s), Vec::<String>::new());
    run.step(DAY / 4);
    assert!(teacher(&run.s, &run.ground).is_some());
    assert!(!trainees(&run.s, &run.ground).is_empty());
    assert_eq!(check_all(&run.s.world, &run.s.terrain), []);
    assert!(run.s.city().occupation.is_none());
}

#[test]
#[ignore = "4 s alone, 12 s in a full run; see #1092"]
fn are_kept_at_it_by_the_citys_defence_which_clears_any_other_script_from_its_soldiers() {
    let mut run = Running::new();
    run.step(DAY / 2);
    let lot = trainees(&run.s, &run.ground);
    run.step(30);
    assert_eq!(trainees(&run.s, &run.ground), lot);
    for id in soldiers_of(&run.s.world, &run.s.city) {
        let task = task_of(resident(&run.s.world, &id));
        assert!(task.is_none() || task == Some(Task::Train), "{id}: {task:?}");
    }
}

#[test]
#[ignore = "57 s alone; see #1092"]
fn leave_the_ground_at_the_end_of_their_turn_for_the_next_lot() {
    let mut run = Running::new();
    run.step(DAY / 2);
    let first = trainees(&run.s, &run.ground);
    assert!(!first.is_empty());
    let turn = NPC_TRAIN_TURN_TICKS as u64;
    let to_next = turn - run.s.world.tick % turn;
    run.step(to_next as usize + DAY / 2);
    let next = trainees(&run.s, &run.ground);
    assert!(!next.is_empty());
    assert_ne!(next, first);
    assert_eq!(check_all(&run.s.world, &run.s.terrain), []);
}

/// What `run_both` saw, hour by hour.
#[derive(Debug, Default)]
struct Seen {
    hours: usize,
    trainees: usize,
    rounds: usize,
    left_for_wall: f64,
    hours_with_rounds: usize,
    hours_with_both: usize,
    most_moved_in_a_turn: usize,
}

/// Runs a city for `days`, checking both rules as it goes (`runBoth`).
fn run_both(s: &mut BigCity, days: usize) -> Seen {
    let mut runner = Runner { walking: unhurried_walking(&s.terrain), scratch: Scratch::default() };
    let mut seen = Seen::default();
    let mut before: (f64, HashSet<String>) = (-1.0, HashSet::new());
    for t in 0..days * DAY {
        runner.step(&mut s.world, &s.terrain);
        if t % 20 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
        let Some(plan) = s.world.city_plans.get(&s.city) else { continue };
        let soldiers = soldiers_of(&s.world, &s.city);
        assert!(hall_held(s, &soldiers), "the hall left at tick {}", s.world.tick);
        // Never on a round and at the ground at once.
        let out: Vec<String> =
            plan.patrols.iter().flatten().map(|p| p.resident_id.clone()).collect();
        for id in &out {
            assert_eq!(plan.jobs.get(id).map(|j| j.kind), Some(CityJobKind::Soldier), "{id}");
        }
        if t % 60 != 0 {
            continue;
        }
        let lot = jobs_of(&s.world, &s.city, CityJobKind::Train);
        let turn = (plan.planned_at / NPC_TRAIN_TURN_TICKS).floor();
        if turn == before.0 {
            let moved = lot.iter().filter(|id| !before.1.contains(*id)).count();
            seen.most_moved_in_a_turn = seen.most_moved_in_a_turn.max(moved);
        }
        before = (turn, lot.iter().cloned().collect());
        seen.left_for_wall += jobs_of(&s.world, &s.city, CityJobKind::Soldier).len() as f64
            - out.len() as f64
            - posts_to_hold(&s.world, s.city());
        seen.hours += 1;
        seen.trainees += lot.len();
        seen.rounds += out.len();
        if !out.is_empty() {
            seen.hours_with_rounds += 1;
        }
        if !out.is_empty() && !lot.is_empty() {
            seen.hours_with_both += 1;
        }
    }
    seen
}

#[test]
#[ignore = "109 s alone; see #1092"]
fn a_city_of_110_does_both_at_once_with_invariants_checked_and_the_hall_held() {
    let mut s = big_city(None, 240);
    with_ground(&mut s);
    let seen = run_both(&mut s, 12);
    eprintln!("Training and patrols, city of 110: {seen:?}");
    assert!(seen.hours_with_both > 0);
    // A lot stays a lot: someone back from a round takes a place, but it is never reshuffled.
    assert!(seen.most_moved_in_a_turn as f64 <= TRAINING_GROUND_MAX_TRAINEES / 2.0, "{seen:?}");
}

#[test]
#[ignore = "72 s alone; see #1092"]
fn a_city_just_big_enough_keeps_its_hall_and_gates_with_its_wall_left_to_training() {
    let mut s = big_city(None, 240);
    with_ground(&mut s);
    // Down to 52 residents, 10 of them soldiers: few past those it must keep.
    for id in soldiers_of(&s.world, &s.city).into_iter().skip(10) {
        let r = s.world.residents.iter_mut().find(|r| r.id == id).expect("a soldier");
        r.carried.shift_remove(&Good::Spear);
    }
    let tick = s.world.tick as f64;
    let city = s.city.clone();
    let spare: Vec<String> = s
        .world
        .residents
        .iter()
        .filter(|r| {
            r.city_id.as_deref() == Some(city.as_str())
                && r.carried.get(&Good::Spear).copied().unwrap_or(0.0) <= 0.0
                && can_work(r.born_at, tick)
        })
        .map(|r| r.id.clone())
        .collect();
    let drop = s.world.residents.len().saturating_sub(52);
    let gone: HashSet<String> = spare.into_iter().take(drop).collect();
    s.world.residents.retain(|r| !gone.contains(&r.id));
    let seen = run_both(&mut s, 12);
    eprintln!("Training and patrols, city of 52: {seen:?}");
    assert!(seen.trainees > 0);
}
