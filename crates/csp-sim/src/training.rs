//! The train order (`apps/server/src/training.ts`, `CONTEXT.md`: Trainee, Training): a grown
//! resident trains at the finished training ground they stand on, gaining in what its teacher
//! teaches, up to `TRAINING_GROUND_MAX_TRAINEES` at a ground.

use std::collections::HashMap;

use csp_shared::balance::{trained_cap, MAP_SIZE, SKILL_MAX, TRAINING_GROUND_MAX_TRAINEES};
use csp_shared::footprint::is_at;
use csp_shared::world::{
    Building, BuildingKind, OrderRequest, Resident, ResidentOrder, StatName, TrainOrder,
    TrainingSubject, WorldState,
};

use crate::queries::balance::{skill_of, skill_value, subject_parts, training_gain};
use crate::queries::building::{building_at, teacher_at, train_problem, trainees_of};
use crate::queries::names::placed;
use crate::stand_ins::{npc_training_problem, ordered_resident, str_field, OrderSender};

/// Checks a train order (`train.validate`): a grown resident of the sender's trains at the
/// finished training ground they stand on. Of the game's cities only a big one's soldiers train.
pub fn validate_train(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let Some(ri) = ordered_resident(world, sender, str_field(order, "residentId")) else {
        return Some("not one of your residents".into());
    };
    let r = &world.residents[ri];
    let problem = npc_training_problem(world, sender, r).or_else(|| train_problem(world, r));
    if problem.is_some() {
        return problem;
    }
    let here = building_at(world, r.x as i32, r.y as i32, MAP_SIZE);
    if str_field(order, "buildingId") != here.map(|h| h.id.as_str()) {
        return Some("stand on the training ground to train there".into());
    }
    None
}

/// Gives the resident the train order (`train.apply`). Train orders for a full ground in one
/// tick: the first applied train, the others fail.
pub fn apply_train(world: &mut WorldState, order: &OrderRequest) {
    let Some(building_id) = str_field(order, "buildingId") else { return };
    let id = str_field(order, "residentId");
    let Some(ri) = world.residents.iter().position(|x| Some(x.id.as_str()) == id) else { return };
    let Some(ground) = world.buildings.iter().find(|b| b.id == building_id) else { return };
    let r = &world.residents[ri];
    if !is_at((r.x as i32, r.y as i32), placed(ground), MAP_SIZE) {
        return;
    }
    let full = trainees_of(ground, &world.residents, MAP_SIZE).len() as f64
        >= TRAINING_GROUND_MAX_TRAINEES;
    if full {
        return;
    }
    let learning = lesson(world, r, ground, MAP_SIZE).0;
    world.residents[ri].order =
        Some(ResidentOrder::Train(TrainOrder { building_id: building_id.to_string(), learning }));
}

/// What a trainee at `ground` would learn this tick (`lesson`): the subject its teacher teaches
/// and their gain in it; no subject while there is no teacher or they are at the ceiling.
pub fn lesson(
    world: &WorldState,
    r: &Resident,
    ground: &Building,
    size: i32,
) -> (Option<TrainingSubject>, f64) {
    let Some(teacher) = teacher_at(ground, &world.residents, size) else { return (None, 0.0) };
    let Some(ResidentOrder::Teach(o)) = &teacher.order else { return (None, 0.0) };
    let gain = training_gain(r, teacher, o.subject, world.tick as f64);
    ((gain > 0.0).then_some(o.subject), gain)
}

/// Training, each tick (`stepTraining`). A trainee who has left the ground's footprint, whose
/// ground is gone, or who is one trainee too many there stops. The others gain in the subject the
/// ground's teacher teaches; without a teacher, or at their ceiling, they wait. Runs after
/// `step_teaching`, so only a teacher who still holds teaches.
pub fn step_training(world: &mut WorldState, size: i32) {
    let mut trainees: HashMap<String, f64> = HashMap::new();
    for i in 0..world.residents.len() {
        let r = &world.residents[i];
        let Some(ResidentOrder::Train(o)) = &r.order else { continue };
        let building_id = o.building_id.clone();
        let count = trainees.get(&building_id).copied().unwrap_or(0.0);
        let ground = world.buildings.iter().find(|b| b.id == building_id).filter(|g| {
            g.kind == BuildingKind::TrainingGround
                && g.site.is_none()
                && is_at((r.x as i32, r.y as i32), placed(g), size)
                && count < TRAINING_GROUND_MAX_TRAINEES
        });
        let Some(ground) = ground else {
            world.residents[i].order = None;
            continue;
        };
        trainees.insert(building_id, count + 1.0);
        let (subject, gain) = lesson(world, r, ground, size);
        let r = &mut world.residents[i];
        if let Some(subject) = subject {
            learn(r, subject, gain);
        }
        if let Some(ResidentOrder::Train(o)) = &mut r.order {
            o.learning = subject;
        }
    }
}

/// Adds `gain` to a trainee's stat's trained bonus or skill, within its cap or maximum (`learn`).
fn learn(r: &mut Resident, subject: TrainingSubject, gain: f64) {
    match subject_parts(subject) {
        Ok(stat) => {
            let s = match stat {
                StatName::Strength => &mut r.stats.strength,
                StatName::Endurance => &mut r.stats.endurance,
                StatName::Agility => &mut r.stats.agility,
                StatName::Intellect => &mut r.stats.intellect,
            };
            s.trained = trained_cap(s.base).min(s.trained + gain);
        }
        Err(skill) => {
            let to = skill_value(&SKILL_MAX, skill).min(skill_of(r, skill) + gain);
            r.skills.insert(skill, to);
        }
    }
}
