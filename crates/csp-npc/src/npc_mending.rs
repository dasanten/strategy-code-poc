//! An NPC city mends its gear (`CONTEXT.md`: Mending): a soldier whose weapon, shield or armour is
//! worn or nearly broken takes it to the city's smithy and waits there, and one of the smithy's
//! workers mends while there is something to mend, then goes back to forging. Only orders a
//! Player could give (ADR 0002): a walk, and the Work default told to mend.

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::is_at;
use csp_shared::world::{
    BuildingKind, City, CityJob, CityJobKind, DropOrder, GoodsSpot, PickUpOrder, ResidentOrder,
    Stock, Task, WorldState,
};
use serde_json::json;

use crate::equipment::{equipped, SLOTS};
use crate::mending::{mend_input, piece_to_mend_for, wants_mending, MEND};
use crate::npc_behaviour::{put_to_work_making, stop_work, walk_to};
use crate::npc_chain::{chain_makes, own_workplace_indices};
use crate::queries::building::{input_at, worker_indices};
use crate::queries::names::{good_name, held, placed};
use crate::queries::residents::{can_work, is_armed};
use crate::wear::{in_use, slot_condition, PieceCondition};

/// The city's finished smithy, if it has one: where its soldiers take worn gear.
fn mending_smithy(world: &WorldState, city: &City) -> Option<usize> {
    own_workplace_indices(world, city).into_iter().find(|&b| {
        let s = &world.buildings[b];
        s.kind == BuildingKind::Smithy && s.site.is_none()
    })
}

/// Whether resident `i` has a piece equipped that wants mending.
pub fn gear_wants_mending(world: &WorldState, i: usize) -> bool {
    let r = &world.residents[i];
    SLOTS
        .into_iter()
        .any(|slot| slot_condition(world, r, slot).is_some_and(|c| c != PieceCondition::Good))
}

/// The mending input of the most worn piece resident `i` has equipped, if a smithy can mend it.
fn own_mend_input(world: &WorldState, i: usize) -> Option<Stock> {
    let r = &world.residents[i];
    let worst = SLOTS
        .into_iter()
        .filter_map(|slot| equipped(r, slot))
        .map(|g| (g, in_use(world, &r.id, g)))
        .filter(|&(_, w)| wants_mending(w))
        .max_by(|a, b| a.1.total_cmp(&b.1))?;
    mend_input(worst.0).map(|input| input.into_iter().collect())
}

/// A free soldier `i` of the city (no order, no script) with worn gear takes it to the city's
/// smithy and stands there until it is mended, bringing what mending it takes: they pick it up at
/// the city's storage (`storage`) unless the smithy holds it, and put it on the smithy's pile.
/// Whether they are about it.
pub fn go_mend(world: &mut WorldState, city: &City, i: usize, storage: Option<usize>) -> bool {
    if !is_armed(&world.residents[i]) || !gear_wants_mending(world, i) {
        return false;
    }
    let Some(s) = mending_smithy(world, city) else { return false };
    let Some(input) = own_mend_input(world, i) else { return false };
    let smithy = world.buildings[s].clone();
    let at_smithy = input_at(world, &smithy);
    let lacks = |stock: &Stock| input.iter().any(|(g, n)| held(stock, *g) < *n);
    let r = &world.residents[i];
    let here = (r.x as i32, r.y as i32);
    if lacks(&at_smithy) && lacks(&r.carried) {
        // Fetch it first, while the storage holds it; else wait at the smithy all the same.
        if let Some(st) = storage
            .filter(|&st| !lacks(world.buildings[st].stock.as_ref().unwrap_or(&Stock::new())))
        {
            let sb = &world.buildings[st];
            if is_at(here, placed(sb), MAP_SIZE) {
                let from = GoodsSpot::Storage { storage_id: sb.id.clone() };
                world.residents[i].order =
                    Some(ResidentOrder::PickUp(PickUpOrder { from, goods: input }));
            } else {
                let to = (sb.x, sb.y);
                walk_to(&mut world.residents[i], to);
            }
            return true;
        }
    }
    if here != (smithy.x as i32, smithy.y as i32) {
        walk_to(&mut world.residents[i], (smithy.x, smithy.y));
    } else if lacks(&at_smithy) && !lacks(&r.carried) {
        world.residents[i].order =
            Some(ResidentOrder::Drop(DropOrder { to: GoodsSpot::Ground, goods: input }));
    }
    true
}

/// Has one worker of each of the city's smithies mend while there is something to mend there
/// (`piece_to_mend`: what its workers carry, its pile, and the gear of the city's residents
/// standing on it), and sends them back to forging once there is nothing.
pub fn steer_menders(world: &mut WorldState, city: &City) {
    for b in own_workplace_indices(world, city) {
        let smithy = world.buildings[b].clone();
        if smithy.kind != BuildingKind::Smithy || smithy.site.is_some() {
            continue;
        }
        let workers = worker_indices(world, &smithy);
        let mends = |world: &WorldState, i: usize| matches!(&world.residents[i].order, Some(ResidentOrder::WorkAt(o)) if o.mends);
        let menders: Vec<usize> = workers.iter().copied().filter(|&i| mends(world, i)).collect();
        let wanted = piece_to_mend_for(world, &smithy, Some(&city.id)).is_some();
        // One sent to mend here still on their way.
        let coming = world.residents.iter().any(|r| {
            r.script.as_ref().is_some_and(|s| {
                s.memory.get("workplaceId").and_then(|v| v.as_str()) == Some(smithy.id.as_str())
                    && s.memory.get("makes").and_then(|v| v.as_str()) == Some(MEND)
            })
        });
        if wanted && menders.is_empty() && !coming {
            if let Some(&i) = workers.iter().find(|&&i| world.residents[i].script.is_some()) {
                set_makes(world, i, json!(MEND));
            } else if let Some(i) = spare_hand(world, city, &smithy.id) {
                // Nobody works it: one of the city's idle, else a worker from elsewhere (a farm
                // last), takes up mending there.
                put_to_work_making(&mut world.residents[i], &smithy, None);
                let job = CityJob {
                    kind: CityJobKind::Work,
                    building_id: Some(smithy.id.clone()),
                    target_id: None,
                    stable_id: None,
                    ground_id: None,
                    subject: None,
                };
                let id = world.residents[i].id.clone();
                if let Some(plan) = world.city_plans.get_mut(&city.id) {
                    plan.jobs.insert(id, job);
                }
                set_makes(world, i, json!(MEND));
            }
        } else if !wanted && !soldiers_waiting(world, city) {
            let makes = chain_makes(world, &smithy).map(good_name);
            for i in menders {
                match makes {
                    Some(m) => set_makes(world, i, json!(m)),
                    // Nothing to forge there: back to whatever the city has for them.
                    None => stop_work(&mut world.residents[i]),
                }
            }
        }
    }
}

/// Tells worker `i`'s Work default what to make (or to mend); their order ends, so the script
/// gives the new one.
fn set_makes(world: &mut WorldState, i: usize, makes: serde_json::Value) {
    let r = &mut world.residents[i];
    let Some(script) = r.script.as_mut() else { return };
    script.memory.insert("makes".into(), makes);
    r.order = None;
}

/// Who of the city takes up mending at a smithy nobody works (id `smithy_id`): one of its adults
/// with nothing to do (at no order or script but an idle walk), else one working another of its
/// workplaces, a farm's last. Unarmed adults only.
fn spare_hand(world: &WorldState, city: &City, smithy_id: &str) -> Option<usize> {
    let tick = world.tick as f64;
    let ours: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.owner.is_none()
                && r.city_id.as_deref() == Some(city.id.as_str())
                && r.health > 0.0
                && can_work(r.born_at, tick)
                && !is_armed(r)
                && r.carrying.is_none()
                && r.down_until.is_none()
        })
        .collect();
    let idle = ours.iter().copied().find(|&i| {
        let r = &world.residents[i];
        r.script.is_none() && matches!(r.order, None | Some(ResidentOrder::WalkTo(_)))
    });
    let works_at = |i: usize| -> Option<&str> {
        let s = world.residents[i].script.as_ref().filter(|s| s.task == Some(Task::Work))?;
        s.memory.get("workplaceId")?.as_str().filter(|&w| w != smithy_id)
    };
    let is_farm =
        |id: &str| world.buildings.iter().any(|b| b.id == id && b.kind == BuildingKind::Farm);
    let worker = |farm: bool| {
        ours.iter().copied().find(|&i| works_at(i).is_some_and(|w| is_farm(w) == farm))
    };
    idle.or_else(|| worker(false)).or_else(|| worker(true))
}

/// Whether any of the city's soldiers has gear that wants mending: its smith keeps mending while
/// they are on their way, or stepped off the smithy for a moment.
fn soldiers_waiting(world: &WorldState, city: &City) -> bool {
    (0..world.residents.len()).any(|i| {
        let r = &world.residents[i];
        r.owner.is_none()
            && r.city_id.as_deref() == Some(city.id.as_str())
            && r.health > 0.0
            && is_armed(r)
            && gear_wants_mending(world, i)
            && own_mend_input(world, i).is_some()
    })
}

/// Whether resident `r` mends at a smithy: the city keeps them there while they do.
pub fn mends(r: &csp_shared::world::Resident) -> bool {
    matches!(&r.order, Some(ResidentOrder::WorkAt(o)) if o.mends)
}
