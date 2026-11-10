//! A big NPC city's training ground and who trains there (`apps/server/src/npc-training.ts`,
//! `CONTEXT.md`: Bigger projects, Who trains; ADR 0029). Nothing about it is stored but the jobs
//! of its plan: its ground is the one in its area, and whose turn it is follows from the tick and
//! their ids.

use std::collections::HashSet;

use csp_shared::balance::{
    MAP_SIZE, NPC_SOLDIERS_ON_HALL, NPC_TRAIN_TURN_TICKS, TRAINING_GROUND_MAX_TRAINEES,
};
use csp_shared::footprint::{footprint_tiles, is_at, FOOTPRINT};
use csp_shared::world::{
    BuildingKind, City, CityJob, CityJobKind, CityProject, OrderRequest, ResidentOrder, Task,
    TrainingSubject, WorldState,
};
use serde_json::json;

use crate::npc_behaviour::{default_script, stop_work, walk_to, Jobs};
use crate::npc_chain::short_goods;
use crate::npc_inner_wall::holds_above_reserve;
use crate::npc_posts::{posts_to_hold, soldiers_at_hand, stands_posts};
use crate::order_sender::npc_sender;
use crate::queries::balance::{subject_value, training_gain};
use crate::queries::building::{build_materials, building_at, teacher_at, trainees_of};
use crate::queries::city::in_city_area;
use crate::queries::names::placed;
use crate::queries::npc_trade::is_big_npc_city;
use crate::queries::residents::is_armed;
use crate::random::hash_str;
use crate::sight::InvariantViolation;
use crate::teaching::{apply_teach, validate_teach};

/// Less than this is no gain: what is left of a ceiling by rounding.
const NO_GAIN: f64 = 1e-9;

/// Where in `world.buildings` a city's training ground stands, finished or begun (`cityGround`):
/// the one in its area.
pub fn city_ground(world: &WorldState, city: &City, size: i32) -> Option<usize> {
    world.buildings.iter().position(|b| {
        b.kind == BuildingKind::TrainingGround
            && in_city_area(world, &city.id, b.x as i32, b.y as i32, size)
    })
}

/// Whether a city wants to lay out its training ground (`wantsTrainingGround`): it is a big NPC
/// city with none, nothing is short of its reserve, and it holds the materials above that reserve.
pub fn wants_training_ground(world: &WorldState, city: &City, size: i32) -> bool {
    if city.trade_org.is_some() || !is_big_npc_city(world, city) {
        return false;
    }
    if city_ground(world, city, size).is_some() || !short_goods(world, city, size, None).is_empty()
    {
        return false;
    }
    holds_above_reserve(world, city, &build_materials(BuildingKind::TrainingGround))
}

/// Who teaches of those at hand (`pickTeacher`): the most Combat, among equals the most Strength,
/// then by id.
fn pick_teacher(world: &WorldState, soldiers: &[usize], tick: f64) -> Option<usize> {
    let r = |i: usize| &world.residents[i];
    let v = |i: usize, s| subject_value(r(i), s, tick);
    let mut sorted = soldiers.to_vec();
    sorted.sort_by(|&a, &b| {
        let combat = v(b, TrainingSubject::Combat) - v(a, TrainingSubject::Combat);
        let strength = v(b, TrainingSubject::Strength) - v(a, TrainingSubject::Strength);
        if combat != 0.0 {
            combat.total_cmp(&0.0)
        } else if strength != 0.0 {
            strength.total_cmp(&0.0)
        } else {
            r(a).id.cmp(&r(b).id)
        }
    });
    sorted.first().copied()
}

/// What a ground teaches now, and who can learn it (`lessonOf`): Combat while any of them is still
/// below the teacher in it, else Strength. `None` when nobody can learn either.
fn lesson_of(
    world: &WorldState,
    teacher: usize,
    others: &[usize],
    tick: f64,
) -> Option<(TrainingSubject, Vec<usize>)> {
    for subject in [TrainingSubject::Combat, TrainingSubject::Strength] {
        let learners: Vec<usize> = others
            .iter()
            .copied()
            .filter(|&i| {
                training_gain(&world.residents[i], &world.residents[teacher], subject, tick)
                    > NO_GAIN
            })
            .collect();
        if !learners.is_empty() {
            return Some((subject, learners));
        }
    }
    None
}

/// Whose turn it is (`theirTurn`): `places` of `learners`, going round all a city's `soldiers` by
/// id, a ground's worth further each turn.
fn their_turn(
    world: &WorldState,
    soldiers: &[usize],
    learners: &[usize],
    places: usize,
    tick: f64,
) -> Vec<usize> {
    let mut in_order = soldiers.to_vec();
    in_order.sort_by(|&a, &b| world.residents[a].id.cmp(&world.residents[b].id));
    let turn = (tick / NPC_TRAIN_TURN_TICKS).floor();
    let from = ((turn * TRAINING_GROUND_MAX_TRAINEES) % in_order.len() as f64) as usize;
    let can_learn: HashSet<usize> = learners.iter().copied().collect();
    in_order[from..]
        .iter()
        .chain(&in_order[..from])
        .copied()
        .filter(|i| can_learn.contains(i))
        .take(places)
        .collect()
}

/// A job at a training ground.
fn ground_job(kind: CityJobKind, ground_id: &str, subject: Option<TrainingSubject>) -> CityJob {
    CityJob {
        kind,
        building_id: None,
        target_id: None,
        stable_id: None,
        ground_id: Some(ground_id.to_string()),
        subject,
    }
}

/// Who trains in a big NPC city with a finished training ground, for its planning pass
/// (`planTraining`, `CONTEXT.md`: Who trains): of its soldiers at hand, once enough are left to
/// hold the posts on its hall and gates, the one with the most Combat teaches and others train, as
/// many as those left over and the room at the ground allow. `jobs` holds the jobs the pass has
/// given so far: only those it has as soldiers are moved.
pub fn plan_training(
    world: &WorldState,
    city: &City,
    adults: &[usize],
    jobs: &mut Jobs,
    size: i32,
) {
    if city.trade_org.is_some() || !is_big_npc_city(world, city) || !stands_posts(world, city) {
        return;
    }
    let Some(g) = city_ground(world, city, size) else { return };
    let ground = &world.buildings[g];
    if ground.site.is_some() {
        return;
    }
    let ours =
        |r: &csp_shared::world::Resident| r.owner.is_none() && r.city_id.as_ref() == Some(&city.id);
    if let Some(there) = teacher_at(ground, &world.residents, size) {
        if !ours(there) {
            return;
        }
    }
    let at_hand: Vec<usize> = soldiers_at_hand(world, city, adults)
        .into_iter()
        .filter(|&i| {
            jobs.get(&world.residents[i].id).is_some_and(|j| j.kind == CityJobKind::Soldier)
        })
        .collect();
    let to_spare = at_hand.len() as f64 - posts_to_hold(world, city);
    let room = TRAINING_GROUND_MAX_TRAINEES
        - trainees_of(ground, &world.residents, size).into_iter().filter(|r| !ours(r)).count()
            as f64;
    let places = (to_spare - 1.0).min(room);
    if places < 1.0 {
        return;
    }
    let tick = world.tick as f64;
    let Some(teacher) = pick_teacher(world, &at_hand, tick) else { return };
    let others: Vec<usize> = at_hand.iter().copied().filter(|&i| i != teacher).collect();
    let Some((subject, learners)) = lesson_of(world, teacher, &others, tick) else { return };
    let ground_id = ground.id.clone();
    jobs.insert(
        world.residents[teacher].id.clone(),
        ground_job(CityJobKind::Teach, &ground_id, Some(subject)),
    );
    let armed: Vec<usize> =
        adults.iter().copied().filter(|&i| is_armed(&world.residents[i].carried)).collect();
    for i in their_turn(world, &armed, &learners, places as usize, tick) {
        jobs.insert(
            world.residents[i].id.clone(),
            ground_job(CityJobKind::Train, &ground_id, None),
        );
    }
}

/// What a pass just now changed for one who trains or teaches, or is to (`steerTraining`): off the
/// ground's turn, they stop; a teacher goes on to the subject it has them teach; and one walking
/// anywhere else turns for the ground.
pub fn steer_training(world: &mut WorldState, city: &City, i: usize, job: Option<&CityJob>) {
    let ground_id = job
        .filter(|j| j.kind == CityJobKind::Train || j.kind == CityJobKind::Teach)
        .and_then(|j| j.ground_id.clone());
    let kind = job.map(|j| j.kind);
    let r = &world.residents[i];
    let script_ground =
        r.script.as_ref().and_then(|s| s.memory.get("groundId")).and_then(|v| v.as_str());
    let training = r.script.as_ref().is_some_and(|s| s.task == Some(Task::Train));
    if training && (kind != Some(CityJobKind::Train) || script_ground != ground_id.as_deref()) {
        stop_work(&mut world.residents[i]);
        return;
    }
    match &r.order {
        Some(ResidentOrder::Train(o)) => {
            if kind != Some(CityJobKind::Train) || Some(&o.building_id) != ground_id.as_ref() {
                stop_work(&mut world.residents[i]);
            }
        }
        Some(ResidentOrder::Teach(o)) => {
            if kind != Some(CityJobKind::Teach) || Some(&o.building_id) != ground_id.as_ref() {
                stop_work(&mut world.residents[i]);
            } else if let Some(subject) = job.and_then(|j| j.subject).filter(|s| *s != o.subject) {
                let building_id = o.building_id.clone();
                give_teach(world, city, i, &building_id, subject);
            }
        }
        Some(ResidentOrder::WalkTo(o)) if ground_id.is_some() && r.script.is_none() => {
            // The TypeScript's `buildingAt` without a size: `MAP_SIZE`.
            let at = building_at(world, o.target.x as i32, o.target.y as i32, MAP_SIZE);
            if at.map(|b| &b.id) != ground_id.as_ref() {
                world.residents[i].order = None;
            }
        }
        _ => {}
    }
}

/// The teach order, as a Player's resident standing there would be given it (`giveTeach`,
/// ADR 0002).
fn give_teach(
    world: &mut WorldState,
    city: &City,
    i: usize,
    building_id: &str,
    subject: TrainingSubject,
) {
    let sender = npc_sender(city);
    let request: OrderRequest = serde_json::from_value(json!({
        "kind": "teach",
        "residentId": world.residents[i].id,
        "buildingId": building_id,
        "subject": subject,
    }))
    .expect("an order");
    if validate_teach(world, &sender, &request).is_none() {
        apply_teach(world, &request);
    }
}

/// Sends one with a job at its training ground there and starts them (`goTrain`): a teacher stands
/// in its middle and teaches, a trainee stands on the tile their id gives them and runs the game's
/// Train default. In the city's area they set off only when its pass just ran (`passed`). Whether
/// this was their job.
pub fn go_train(
    world: &mut WorldState,
    city: &City,
    i: usize,
    job: Option<&CityJob>,
    passed: bool,
    size: i32,
) -> bool {
    let Some(job) = job.filter(|j| j.kind == CityJobKind::Train || j.kind == CityJobKind::Teach)
    else {
        return false;
    };
    let Some(ground) = world.buildings.iter().find(|b| Some(&b.id) == job.ground_id.as_ref())
    else {
        return false;
    };
    if ground.site.is_some() {
        return false;
    }
    let r = &world.residents[i];
    let (rx, ry) = (r.x as i32, r.y as i32);
    if !is_at((rx, ry), placed(ground), size) {
        if !passed && in_city_area(world, &city.id, rx, ry, size) {
            return true;
        }
        let tiles = footprint_tiles(placed(ground), size);
        let side = FOOTPRINT.get("trainingGround").expect("a footprint") as usize;
        let middle = side / 2;
        let (x, y) = if job.kind == CityJobKind::Teach {
            tiles[middle * side + middle]
        } else {
            tiles[hash_str(&r.id) as usize % tiles.len()]
        };
        walk_to(&mut world.residents[i], (f64::from(x), f64::from(y)));
        return true;
    }
    let ground_id = ground.id.clone();
    if job.kind == CityJobKind::Train {
        world.residents[i].script =
            Some(default_script(Task::Train, json!({ "groundId": ground_id })));
    } else if let Some(subject) = job.subject {
        give_teach(world, city, i, &ground_id, subject);
    }
    true
}

/// Invariant `npc-training-grounds-bounded` (`CONTEXT.md`: Bigger projects; ADR 0004): a plan made
/// this tick lays no training ground out where one stands or is begun in its area, nor at a city
/// that isn't big or is the Trade Organization's.
pub fn npc_training_grounds_bounded(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (city_id, plan) in &world.city_plans {
        let Some(CityProject::Build { building, x, y }) = &plan.project else { continue };
        if plan.planned_at != world.tick as f64 || *building != BuildingKind::TrainingGround {
            continue;
        }
        if building_at(world, *x as i32, *y as i32, MAP_SIZE).is_some() {
            continue;
        }
        let Some(city) = world.cities.iter().find(|c| &c.id == city_id) else { continue };
        let problem = if city.trade_org.is_some() || !is_big_npc_city(world, city) {
            "is not a big NPC city"
        } else if city_ground(world, city, size).is_some() {
            "already has one"
        } else {
            continue;
        };
        out.push(InvariantViolation {
            invariant: "npc-training-grounds-bounded".into(),
            message: format!("{city_id} plans a training ground and {problem}"),
            entity_ids: vec![city_id.clone()],
        });
    }
    out
}

/// Invariant `npc-trains-its-soldiers` (`CONTEXT.md`: Who trains; ADR 0004): in a plan made this
/// tick, the Trade Organization has nobody at a ground, a ground has one teacher and room for its
/// trainees, each of them is armed, and at least the hall's soldiers are left standing posts.
pub fn npc_trains_its_soldiers(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for (city_id, plan) in &world.city_plans {
        if plan.planned_at != world.tick as f64 {
            continue;
        }
        let of = |k| plan.jobs.iter().filter(move |(_, j)| j.kind == k).map(|(id, _)| id.clone());
        let teachers: Vec<String> = of(CityJobKind::Teach).collect();
        let trainees: Vec<String> = of(CityJobKind::Train).collect();
        let names: Vec<String> = teachers.iter().chain(&trainees).cloned().collect();
        if names.is_empty() {
            continue;
        }
        let mut report = |message: String, ids: Vec<String>| {
            let mut entity_ids = vec![city_id.clone()];
            entity_ids.extend(ids);
            out.push(InvariantViolation {
                invariant: "npc-trains-its-soldiers".into(),
                message: format!("{city_id} {message}"),
                entity_ids,
            });
        };
        if world.cities.iter().find(|c| &c.id == city_id).is_some_and(|c| c.trade_org.is_some()) {
            report("is the Trade Organization\u{2019}s, and trains".into(), names.clone());
        }
        if teachers.len() != 1 {
            report(format!("plans {} teachers", teachers.len()), names.clone());
        }
        if trainees.len() as f64 > TRAINING_GROUND_MAX_TRAINEES {
            report(format!("plans {} trainees", trainees.len()), names.clone());
        }
        for id in &names {
            if world.residents.iter().find(|r| &r.id == id).is_some_and(|r| !is_armed(&r.carried)) {
                report(format!("trains {id}, who is no soldier"), vec![id.clone()]);
            }
        }
        let on_posts = of(CityJobKind::Soldier).count();
        if (on_posts as f64) < NPC_SOLDIERS_ON_HALL {
            report(
                format!("leaves {on_posts} soldiers for its posts while training"),
                names.clone(),
            );
        }
    }
    out
}

#[cfg(test)]
mod slow_tests;
