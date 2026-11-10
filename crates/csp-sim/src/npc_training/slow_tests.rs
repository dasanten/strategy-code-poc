//! `npc-training.test.ts`'s slow simulations (#1038), on the staged big city
//! (`crate::npc_big_city`). The file's other cases are not ported yet.

use std::collections::HashSet;

use csp_shared::balance::{NPC_SOLDIERS_ON_HALL, NPC_TRAIN_TURN_TICKS, TRAINING_GROUND_MAX_TRAINEES};
use csp_shared::footprint::is_at;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Building, BuildingKind, CityJobKind, Good, ResidentOrder, StatName};
use serde_json::{json, Value};

use super::city_ground;
use crate::invariants::check_all;
use crate::npc_big_city::{big_city, Staged, Unhurried};
use crate::npc_growth::{house_tile, wall_rings};
use crate::npc_posts::posts_to_hold;
use crate::queries::building::{teacher_at, trainees_of};
use crate::queries::city::town_hall_of;
use crate::queries::names::{held, placed};
use crate::queries::residents::{can_work, is_down, stat_value};
use crate::random::{new_id, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::tick::Scratch;
use crate::world::step_world;

/// A finished training ground where the city would put one, its own by standing in its area
/// (`withGround`). Returns its id.
fn with_ground(s: &mut Staged) -> String {
    let home = s.home().clone();
    let rings = wall_rings(&s.world, s.city(), &home, s.terrain.size);
    let at = house_tile(&s.world, s.city(), &home, &s.terrain, rings.as_ref(), BuildingKind::TrainingGround)
        .expect("a spot");
    let id = new_id("b", &mut s.world.next_id);
    let ground = serde_json::from_value(json!({
        "id": id, "kind": "trainingGround", "cityId": null, "x": at.0, "y": at.1,
    }))
    .unwrap();
    s.world.buildings.push(ground);
    id
}

fn soldiers(s: &Staged) -> Vec<String> {
    s.world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(s.city.as_str()) && held(&r.carried, Good::Spear) > 0.0)
        .map(|r| r.id.clone())
        .collect()
}

fn jobs_of(s: &Staged, kind: CityJobKind) -> Vec<String> {
    s.world
        .city_plans
        .get(&s.city)
        .map(|p| p.jobs.iter().filter(|(_, j)| j.kind == kind).map(|(id, _)| id.clone()).collect())
        .unwrap_or_default()
}

fn task_of(s: &Staged, id: &str) -> Value {
    let r = s.world.residents.iter().find(|r| r.id == id).unwrap();
    serde_json::to_value(&r.script).unwrap()["task"].clone()
}

/// The staged city with its ground, stepped with unhurried walking (`running`).
struct Running {
    s: Staged,
    ground: Building,
    hall: Building,
    walking: Unhurried,
    scratch: Scratch,
}

impl Running {
    fn new() -> Self {
        let mut s = big_city(240);
        let ground = with_ground(&mut s);
        let ground = s.world.buildings.iter().find(|b| b.id == ground).unwrap().clone();
        let hall = town_hall_of(&s.world, s.city()).unwrap().clone();
        let walking = Unhurried::new(&s.terrain);
        Running { s, ground, hall, walking, scratch: Scratch::default() }
    }

    fn step(&mut self, ticks: usize) {
        for _ in 0..ticks {
            step_world(&mut self.s.world, &self.s.terrain, &mut self.scratch, Some(&mut self.walking), None);
        }
    }

    fn trainees(&self) -> Vec<String> {
        trainees_of(&self.ground, &self.s.world.residents, self.s.terrain.size)
            .into_iter()
            .map(|r| r.id.clone())
            .collect()
    }

    fn teacher(&self) -> Option<String> {
        teacher_at(&self.ground, &self.s.world.residents, self.s.terrain.size).map(|r| r.id.clone())
    }

    fn sound(&self) {
        assert_eq!(check_all(&self.s.world, &self.s.terrain), []);
    }
}

/// Whether one of the city's soldiers holds its hall, or walks to it.
fn hall_held(s: &Staged, hall: &Building) -> bool {
    let size = s.terrain.size;
    let ids: HashSet<String> = soldiers(s).into_iter().collect();
    s.world.residents.iter().filter(|r| ids.contains(&r.id)).any(|r| {
        !is_down(r.down_until)
            && (is_at((r.x as i32, r.y as i32), placed(hall), size)
                || matches!(&r.order, Some(ResidentOrder::WalkTo(o))
                    if is_at((o.target.x as i32, o.target.y as i32), placed(hall), size)))
    })
}

#[test]
#[ignore = "timed in the PR"]
fn goes_up_on_a_run_of_the_staged_city_one_only_with_no_invariant_broken() {
    let mut s = big_city(240);
    let mut walking = Unhurried::new(&s.terrain);
    let mut scratch = Scratch::default();
    let mut built = false;
    for t in 0..12 * TICKS_PER_GAME_DAY as usize {
        step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
        if t % 60 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
        let grounds: Vec<_> =
            s.world.buildings.iter().filter(|b| b.kind == BuildingKind::TrainingGround).collect();
        assert!(grounds.len() <= 1);
        if grounds.first().is_some_and(|g| g.site.is_none()) {
            built = true;
            break;
        }
    }
    assert!(built);
    assert!(city_ground(&s.world, s.city(), s.terrain.size).is_some());
}

#[test]
#[ignore = "timed in the PR"]
fn walk_there_run_the_train_default_and_learn_the_hall_held_all_the_while_their_values_rising() {
    let mut r = Running::new();
    let tick = r.s.world.tick as f64;
    let before: Vec<(String, f64)> = soldiers(&r.s)
        .into_iter()
        .map(|id| {
            let x = r.s.world.residents.iter().find(|x| x.id == id).unwrap();
            (id, stat_value(x, StatName::Strength, tick))
        })
        .collect();
    let mut all_there = false;
    let mut on_hall = 0;
    for _ in 0..TICKS_PER_GAME_DAY as usize {
        r.step(1);
        if r.s.world.city_plans.contains_key(&r.s.city) {
            assert!(hall_held(&r.s, &r.hall), "the hall is left at tick {}", r.s.world.tick);
        }
        let size = r.s.terrain.size;
        let ids = soldiers(&r.s);
        on_hall = r
            .s
            .world
            .residents
            .iter()
            .filter(|x| ids.contains(&x.id) && is_at((x.x as i32, x.y as i32), placed(&r.hall), size))
            .count();
        all_there |= r.teacher().is_some() && !r.trainees().is_empty();
    }
    assert!(all_there);
    assert!(on_hall as f64 >= NPC_SOLDIERS_ON_HALL);
    let trainees = r.trainees();
    assert!(!trainees.is_empty());
    for id in &trainees {
        let x = r.s.world.residents.iter().find(|x| &x.id == id).unwrap();
        let script = serde_json::to_value(&x.script).unwrap();
        assert_eq!((script["task"].clone(), script["scriptId"].clone()), (json!("train"), json!(0)));
    }
    let teacher = r.teacher().unwrap();
    let teacher = r.s.world.residents.iter().find(|x| x.id == teacher).unwrap();
    let order = serde_json::to_value(&teacher.order).unwrap();
    assert_eq!((order["kind"].clone(), order["subject"].clone()), (json!("teach"), json!("strength")));
    let tick = r.s.world.tick as f64;
    let rose = trainees.iter().filter(|id| {
        let x = r.s.world.residents.iter().find(|x| &x.id == *id).unwrap();
        let was = before.iter().find(|(b, _)| b == *id).map_or(f64::INFINITY, |(_, v)| *v);
        stat_value(x, StatName::Strength, tick) > was
    });
    assert!(rose.count() > 0);
    assert_eq!(teacher.stats.strength.trained, 0.0);
    r.sound();
    // Spread over the ground, not in a heap on one tile.
    let tiles: HashSet<(i64, i64)> = trainees
        .iter()
        .map(|id| {
            let x = r.s.world.residents.iter().find(|x| &x.id == id).unwrap();
            (x.x as i64, x.y as i64)
        })
        .collect();
    assert!(tiles.len() > 1);
}

#[test]
#[ignore = "timed in the PR"]
fn wait_with_no_teacher_and_leave_once_the_pass_finds_none() {
    let mut r = Running::new();
    r.step(TICKS_PER_GAME_DAY as usize / 2);
    let trainees = r.trainees();
    assert!(!trainees.is_empty());
    // No soldiers to spare any more: all but those the hall and gates need are gone.
    let hold = posts_to_hold(&r.s.world, r.s.city()) as usize;
    let keep: HashSet<String> = trainees.iter().take(hold).cloned().collect();
    for id in soldiers(&r.s) {
        if !keep.contains(&id) {
            let x = r.s.world.residents.iter_mut().find(|x| x.id == id).unwrap();
            x.carried.shift_remove(&Good::Spear);
        }
    }
    r.step(90);
    assert_eq!(r.teacher(), None);
    assert_eq!(r.trainees(), Vec::<String>::new());
    for id in soldiers(&r.s) {
        assert_ne!(task_of(&r.s, &id), json!("train"));
    }
    r.sound();
}

#[test]
#[ignore = "timed in the PR"]
fn are_taken_off_by_an_alarm_and_come_back_to_it_after() {
    let mut r = Running::new();
    r.step(TICKS_PER_GAME_DAY as usize / 2);
    let teacher = r.teacher().expect("a teacher");
    let trainees = r.trainees();
    assert!(!trainees.is_empty());

    // An armed outsider walks up to the ground: they drop what they are at, what it was kept
    // aside (`armedOutsider`).
    let away = (170.0, 170.0);
    let tick = r.s.world.tick as f64;
    let mut make = |id: &str, (x, y): (f64, f64)| {
        let mut m = Mulberry32::new(r.s.world.residents.len() as f64 + 1.0);
        let fields = NewResident { id, owner: Some("r1"), city_id: None, x, y, tick };
        let mut x = new_resident(&mut || m.next(), &fields, None);
        x.born_at = tick - 20.0 * 24.0 * 3600.0;
        x.lifespan = 60.0;
        r.s.world.residents.push(x);
    };
    make("leader", away);
    let realm = json!({ "id": "r1", "userId": 7, "leaderId": "leader" });
    r.s.world.realms.push(serde_json::from_value(realm).unwrap());
    make("outsider", (r.ground.x - 2.0, r.ground.y));
    let oi = r.s.world.residents.iter().position(|x| x.id == "outsider").unwrap();
    r.s.world.residents[oi].carried.insert(Good::Sword, 1.0);

    let crew: Vec<String> = std::iter::once(teacher).chain(trainees).collect();
    let on_alarm = |s: &Staged| -> Vec<String> {
        crew.iter().filter(|id| task_of(s, id) == json!("alarm")).cloned().collect()
    };
    let mut t = 0;
    while t < 60 && on_alarm(&r.s).is_empty() {
        r.step(1);
        t += 1;
    }
    let called = on_alarm(&r.s);
    assert!(!called.is_empty());
    for id in &called {
        let x = r.s.world.residents.iter().find(|x| &x.id == id).unwrap();
        assert!(x.interrupted.is_some(), "{id} kept nothing aside");
    }
    r.sound();

    // The outsider gone, they are back at the ground within a game hour or two of standing down.
    r.s.world.residents[oi].x = away.0;
    r.s.world.residents[oi].y = away.1;
    let mut t = 0;
    while t < TICKS_PER_GAME_DAY as usize / 2 && !on_alarm(&r.s).is_empty() {
        r.step(1);
        t += 1;
    }
    assert_eq!(on_alarm(&r.s), Vec::<String>::new());
    r.step(TICKS_PER_GAME_DAY as usize / 4);
    assert!(r.teacher().is_some());
    assert!(!r.trainees().is_empty());
    r.sound();
    assert_eq!(r.s.city().occupation, None);
}

#[test]
#[ignore = "timed in the PR"]
fn are_kept_at_it_by_the_citys_defence_which_clears_any_other_script_from_its_soldiers() {
    let mut r = Running::new();
    r.step(TICKS_PER_GAME_DAY as usize / 2);
    let trainees = r.trainees();
    r.step(30);
    assert_eq!(r.trainees(), trainees);
    for id in soldiers(&r.s) {
        let task = task_of(&r.s, &id);
        assert!(task.is_null() || task == json!("train"), "{id}: {task}");
    }
}

#[test]
#[ignore = "timed in the PR"]
fn leave_the_ground_at_the_end_of_their_turn_for_the_next_lot() {
    let mut r = Running::new();
    r.step(TICKS_PER_GAME_DAY as usize / 2);
    let first = r.trainees();
    assert!(!first.is_empty());
    let to_next = NPC_TRAIN_TURN_TICKS - (r.s.world.tick as f64 % NPC_TRAIN_TURN_TICKS);
    r.step((to_next + TICKS_PER_GAME_DAY / 2.0) as usize);
    let next = r.trainees();
    assert!(!next.is_empty());
    assert_ne!(next, first);
    r.sound();
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
fn run_both(s: &mut Staged, days: usize) -> Seen {
    let hall = town_hall_of(&s.world, s.city()).unwrap().clone();
    let mut walking = Unhurried::new(&s.terrain);
    let mut scratch = Scratch::default();
    let mut seen = Seen::default();
    let mut before: (f64, HashSet<String>) = (-1.0, HashSet::new());
    for t in 0..days * TICKS_PER_GAME_DAY as usize {
        step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
        if t % 20 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), []);
        }
        let Some(plan) = s.world.city_plans.get(&s.city).cloned() else { continue };
        assert!(hall_held(s, &hall), "the hall is left at tick {}", s.world.tick);
        // Never on a round and at the ground at once.
        let out: Vec<String> =
            plan.patrols.iter().flatten().map(|p| p.resident_id.clone()).collect();
        for id in &out {
            assert_eq!(plan.jobs.get(id).map(|j| j.kind), Some(CityJobKind::Soldier));
        }
        if t % 60 != 0 {
            continue;
        }
        let trainees = jobs_of(s, CityJobKind::Train);
        let turn = (plan.planned_at / NPC_TRAIN_TURN_TICKS).floor();
        if turn == before.0 {
            let moved = trainees.iter().filter(|id| !before.1.contains(*id)).count();
            seen.most_moved_in_a_turn = seen.most_moved_in_a_turn.max(moved);
        }
        before = (turn, trainees.iter().cloned().collect());
        seen.left_for_wall += jobs_of(s, CityJobKind::Soldier).len() as f64
            - out.len() as f64
            - posts_to_hold(&s.world, s.city());
        seen.hours += 1;
        seen.trainees += trainees.len();
        seen.rounds += out.len();
        if !out.is_empty() {
            seen.hours_with_rounds += 1;
        }
        if !out.is_empty() && !trainees.is_empty() {
            seen.hours_with_both += 1;
        }
    }
    seen
}

#[test]
#[ignore = "timed in the PR"]
fn a_city_of_110_does_both_at_once_with_invariants_checked_and_the_hall_held() {
    let mut s = big_city(240);
    with_ground(&mut s);
    let seen = run_both(&mut s, 12);
    println!("Training and patrols, city of 110: {seen:?}");
    assert!(seen.hours_with_both > 0);
    // A lot stays a lot: someone back from a round takes a place, but it is never reshuffled.
    assert!(seen.most_moved_in_a_turn as f64 <= TRAINING_GROUND_MAX_TRAINEES / 2.0);
}

#[test]
#[ignore = "timed in the PR"]
fn a_city_just_big_enough_keeps_its_hall_and_gates_with_its_wall_left_to_training() {
    let mut s = big_city(240);
    with_ground(&mut s);
    // Down to 52 residents, 10 of them soldiers: few past those it must keep.
    for id in soldiers(&s).into_iter().skip(10) {
        let x = s.world.residents.iter_mut().find(|x| x.id == id).unwrap();
        x.carried.shift_remove(&Good::Spear);
    }
    let tick = s.world.tick as f64;
    let spare: Vec<String> = s
        .world
        .residents
        .iter()
        .filter(|r| {
            r.city_id.as_deref() == Some(s.city.as_str())
                && held(&r.carried, Good::Spear) == 0.0
                && can_work(r.born_at, tick)
        })
        .map(|r| r.id.clone())
        .collect();
    let n = s.world.residents.len().saturating_sub(52);
    let gone: HashSet<String> = spare.into_iter().take(n).collect();
    s.world.residents.retain(|r| !gone.contains(&r.id));
    let seen = run_both(&mut s, 12);
    println!("Training and patrols, city of 52: {seen:?}");
    assert!(seen.trainees > 0);
}
