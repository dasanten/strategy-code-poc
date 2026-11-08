//! The work-at order (`apps/server/src/work.ts`, `CONTEXT.md`: Workplace): a resident works the
//! finished workplace on their tile, making its good, or at a smelter, mint or smithy the batches
//! of their recipe while its input is there.

use std::collections::HashMap;

use csp_shared::balance::{Recipe, MAP_SIZE, RECIPES};
use csp_shared::footprint::is_at;
use csp_shared::world::{
    Building, Good, OrderRequest, Resident, ResidentOrder, Stock, Tile, WorkOrder, WorldState,
};

use crate::order_sender::{ordered_resident, OrderSender};
use crate::queries::balance::{batch_work, skill_of, work_learned, work_output, workplace_skill};
use crate::queries::building::{building_at, work_problem, CARRYING_A_CHILD};
use crate::queries::building::{
    building_pile_index, has_input, max_workers, recipe_for, recipe_input, recipe_output,
    worker_indices, workplace_good,
};
use crate::queries::names::{good_name, good_of, held, kind_name, placed};
use crate::queries::residents::can_work;
use crate::queue::field_str as str_field;
use crate::survival::drop_goods;
use crate::tick::Scratch;

/// Checks a work-at order (`workAt.validate`): one of the sender's adult residents works the
/// finished workplace on their tile until given another order; at a smithy the order names what
/// they make.
pub fn validate_work_at(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let Some(ri) = ordered_resident(world, sender, str_field(order, "residentId")) else {
        return Some("not one of your residents".into());
    };
    let r = &world.residents[ri];
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t work".into());
    }
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    let makes = match order.fields.get("makes") {
        None => None,
        Some(v) => match v.as_str().and_then(good_of) {
            Some(g) => Some(g),
            None => return Some("no such good".into()),
        },
    };
    work_problem(world, r, makes)
}

/// Sets the resident to work the workplace on their tile (`workAt.apply`).
pub fn apply_work_at(world: &mut WorldState, order: &OrderRequest) {
    let makes = str_field(order, "makes").and_then(good_of);
    let id = str_field(order, "residentId");
    let Some(ri) = world.residents.iter().position(|x| Some(x.id.as_str()) == id) else { return };
    let (x, y) = (world.residents[ri].x as i32, world.residents[ri].y as i32);
    if let Some(here) = building_at(world, x, y, MAP_SIZE).cloned() {
        start_work(&mut world.residents[ri], &here, makes);
    }
}

/// An action a resident with a work-at order requests (`WorkAction`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkAction {
    pub resident_id: String,
}

/// Sets a resident to work the workplace on their tile, making `makes` at a smithy
/// (`startWork`).
pub fn start_work(r: &mut Resident, workplace: &Building, makes: Option<Good>) {
    r.order = Some(ResidentOrder::WorkAt(WorkOrder {
        building_id: workplace.id.clone(),
        at: Tile { x: r.x, y: r.y },
        progress: 0.0,
        makes,
    }));
}

/// Requests this tick's work actions from residents' work-at orders (`requestWork`).
pub fn request_work(world: &WorldState) -> Vec<WorkAction> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::WorkAt(_))))
        .map(|r| WorkAction { resident_id: r.id.clone() })
        .collect()
}

/// The work-at order of the resident at `ri`, which the caller knows it holds.
fn work_order(world: &mut WorldState, ri: usize) -> &mut WorkOrder {
    match world.residents[ri].order.as_mut() {
        Some(ResidentOrder::WorkAt(o)) => o,
        _ => unreachable!("a work action's resident holds a work-at order"),
    }
}

/// Resolves work actions (ADR 0002), one after another (`resolveWork`). A resident who has left
/// the tile, whose workplace is gone or not finished, or who would be one worker too many stops.
/// Otherwise their work adds to their share of the next unit of the workplace's good and teaches
/// its skill; each whole unit goes on the workplace's pile. At a processing workplace the work
/// goes into the next batch of the worker's recipe, only while the input for it is there; a
/// finished batch uses that input up and leaves its output on the pile.
pub fn resolve_work(world: &mut WorldState, actions: &[WorkAction], scratch: &mut Scratch) {
    let mut workers: HashMap<String, f64> = HashMap::new();
    let tick = world.tick as f64;
    for a in actions {
        let Some(ri) = world.residents.iter().position(|x| x.id == a.resident_id) else {
            continue;
        };
        let r = &world.residents[ri];
        let Some(ResidentOrder::WorkAt(o)) = &r.order else { continue };
        let (building_id, makes, at) = (o.building_id.clone(), o.makes, o.at);
        let place = world.buildings.iter().position(|b| b.id == building_id);
        let count = workers.get(&building_id).copied().unwrap_or(0.0);
        let fits = place.and_then(|pi| {
            let p = &world.buildings[pi];
            let max = max_workers(p.kind).unwrap_or(0.0);
            let good = workplace_good(world, p, makes)?;
            let skill = workplace_skill(p.kind)?;
            let on_it = p.site.is_none() && is_at((r.x as i32, r.y as i32), placed(p), MAP_SIZE);
            (on_it && r.x == at.x && r.y == at.y && count < max).then_some((pi, good, skill))
        });
        let Some((pi, good, skill)) = fits else {
            world.residents[ri].order = None;
            continue;
        };
        workers.insert(building_id, count + 1.0);
        let kind = world.buildings[pi].kind;
        let recipe =
            RECIPES.get(kind_name(kind)).and_then(|_| recipe_for(kind, makes.map(good_name)));
        let gain = match recipe {
            Some(recipe) => {
                // A workplace without the input for a batch stands idle: no work, nothing learned.
                if !has_input(world, &world.buildings[pi], recipe) {
                    continue;
                }
                batch_work(r, kind, tick)
            }
            None => work_output(r, good, skill, tick),
        };
        let learned = work_learned(r, skill, tick);
        let had = skill_of(r, skill);
        work_order(world, ri).progress += gain;
        world.residents[ri].skills.insert(skill, had + learned);
        while work_order(world, ri).progress >= 1.0 {
            if let Some(recipe) = recipe {
                if !has_input(world, &world.buildings[pi], recipe) {
                    let o = work_order(world, ri);
                    o.progress = o.progress.min(1.0 - 1e-9);
                    break;
                }
            }
            work_order(world, ri).progress -= 1.0;
            let place = world.buildings[pi].clone();
            match recipe {
                Some(recipe) => {
                    use_up(world, &place, recipe);
                    for (made, units) in recipe_output(recipe) {
                        for _ in 0..units as u32 {
                            produce(world, &place, made, scratch);
                        }
                    }
                }
                None => produce(world, &place, good, scratch),
            }
        }
    }
}

/// Takes a batch's input from what a processing workplace's workers carry, the most laden first,
/// and then from its pile (`useUp`). The caller has checked it is all there.
fn use_up(world: &mut WorldState, place: &Building, recipe: &Recipe) {
    for (good, units) in recipe_input(recipe) {
        let mut left = units;
        let mut carriers = worker_indices(world, place);
        // `sort` is stable, as JavaScript's is.
        carriers.sort_by(|&a, &b| {
            let (x, y) =
                (held(&world.residents[b].carried, good), held(&world.residents[a].carried, good));
            x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal)
        });
        let pile = building_pile_index(world, place);
        let mut take_from = |stock: &mut Stock| {
            let take = left.min(held(stock, good));
            if take <= 0.0 {
                return;
            }
            if held(stock, good) > take {
                *stock.entry(good).or_insert(0.0) -= take;
            } else {
                stock.shift_remove(&good);
            }
            left -= take;
        };
        for i in carriers {
            take_from(&mut world.residents[i].carried);
        }
        if let Some(p) = pile {
            take_from(&mut world.piles[p].goods);
        }
    }
    world.piles.retain(|p| p.goods.values().any(|&n| n > 0.0));
}

/// One unit of a workplace's good, left in its pile (`produce`).
fn produce(world: &mut WorldState, place: &Building, good: Good, scratch: &mut Scratch) {
    let one = Stock::from([(good, 1.0)]);
    drop_goods(world, place.x, place.y, &one, MAP_SIZE);
    scratch.made.note(&one);
}
