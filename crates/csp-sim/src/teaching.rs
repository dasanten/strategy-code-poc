//! The teach order (`apps/server/src/teaching.ts`, `CONTEXT.md`: Teacher): a grown resident
//! teaches a stat or a skill at the finished training ground they stand on. A ground has one
//! teacher at a time; teaching itself puts nothing into the world, trainees learn from it.

use std::collections::HashSet;

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::is_at;
use csp_shared::world::{
    BuildingKind, OrderRequest, ResidentOrder, TeachOrder, TrainingSubject, WorldState,
};

use crate::order_sender::{npc_training_problem, ordered_resident, OrderSender};
use crate::queries::building::{building_at, teach_problem, teacher_at};
use crate::queries::names::placed;
use crate::queue::field_str as str_field;

/// The training subject an order's input names, if it names one (`isTrainingSubject`).
pub fn subject_of(order: &OrderRequest) -> Option<TrainingSubject> {
    order.fields.get("subject").and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// Checks a teach order (`teach.validate`): a grown resident of the sender's teaches a stat or a
/// skill at the finished training ground they stand on. Of the game's cities only a big one's
/// soldiers teach.
pub fn validate_teach(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let Some(ri) = ordered_resident(world, sender, str_field(order, "residentId")) else {
        return Some("not one of your residents".into());
    };
    let r = &world.residents[ri];
    let problem = npc_training_problem(world, sender, r)
        .map(String::from)
        .or_else(|| teach_problem(world, r, subject_of(order)));
    if problem.is_some() {
        return problem;
    }
    let here = building_at(world, r.x as i32, r.y as i32, MAP_SIZE);
    if str_field(order, "buildingId") != here.map(|h| h.id.as_str()) {
        return Some("stand on the training ground to teach there".into());
    }
    None
}

/// Gives the resident the teach order (`teach.apply`). Two teach orders for one ground in a
/// tick: the first applied teaches, the other fails.
pub fn apply_teach(world: &mut WorldState, order: &OrderRequest) {
    let (Some(building_id), Some(subject)) = (str_field(order, "buildingId"), subject_of(order))
    else {
        return;
    };
    let id = str_field(order, "residentId");
    let Some(ri) = world.residents.iter().position(|x| Some(x.id.as_str()) == id) else { return };
    let Some(ground) = world.buildings.iter().find(|b| b.id == building_id) else { return };
    let r = &world.residents[ri];
    if !is_at((r.x as i32, r.y as i32), placed(ground), MAP_SIZE) {
        return;
    }
    if teacher_at(ground, &world.residents, MAP_SIZE).is_some_and(|t| t.id != r.id) {
        return;
    }
    world.residents[ri].order =
        Some(ResidentOrder::Teach(TeachOrder { building_id: building_id.to_string(), subject }));
}

/// Ends the teaching that no longer holds (`stepTeaching`): a teacher who has left the ground's
/// footprint, whose ground is gone, or who is one teacher too many there stops.
pub fn step_teaching(world: &mut WorldState, size: i32) {
    let mut taught: HashSet<String> = HashSet::new();
    for i in 0..world.residents.len() {
        let r = &world.residents[i];
        let Some(ResidentOrder::Teach(o)) = &r.order else { continue };
        let ground = world.buildings.iter().find(|b| b.id == o.building_id);
        let holds = ground.is_some_and(|g| {
            g.kind == BuildingKind::TrainingGround
                && g.site.is_none()
                && is_at((r.x as i32, r.y as i32), placed(g), size)
                && !taught.contains(&g.id)
        });
        if !holds {
            world.residents[i].order = None;
            continue;
        }
        taught.insert(o.building_id.clone());
    }
}
