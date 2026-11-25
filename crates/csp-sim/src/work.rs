//! The work-at order (`apps/server/src/work.ts`, `CONTEXT.md`: Workplace): a resident works the
//! finished workplace on their tile, making its good, or at a smelter, mint or smithy the batches
//! of their recipe while its input is there.

use std::collections::HashMap;

use csp_shared::balance::{MAP_SIZE, RECIPES};
use csp_shared::footprint::is_at;
use csp_shared::world::{
    Building, BuildingKind, Good, OrderRequest, Resident, ResidentOrder, Stock, Tile, WorkOrder,
    WorldState,
};

use crate::mending::{has_mend_input, mend_input, mend_pace, mend_piece, piece_to_mend, MEND};
use crate::order_meta::OrderMeta;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::queries::balance::{batch_work, skill_of, work_learned, work_output, workplace_skill};
use crate::queries::building::{building_at, work_problem, CARRYING_A_CHILD};
use crate::queries::building::{
    building_pile_index, has_input, max_workers, recipe_for, recipe_input, recipe_output,
    richness_factor, worker_indices, workplace_good,
};
use crate::queries::names::{good_name, good_of, held, kind_name, placed};
use crate::queries::residents::can_work;
use crate::queue::field_str as str_field;
use crate::script_actions::{arg_as, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;
use crate::survival::drop_goods;
use crate::tick::Scratch;
use crate::veins::{take_from_vein, Take};
use crate::world_index::{building_index, resident_index};

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
    if str_field(order, "makes") == Some(MEND) {
        return mend_problem(world, r);
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

/// Why a resident can't be set to mend at the building on their tile (`CONTEXT.md`: Mending).
fn mend_problem(world: &WorldState, r: &Resident) -> Option<String> {
    let here = building_at(world, r.x as i32, r.y as i32, MAP_SIZE);
    let Some(here) = here.filter(|b| b.kind == BuildingKind::Smithy) else {
        return Some("only a smithy mends".into());
    };
    if here.site.is_some() {
        return Some("it is still a construction site".into());
    }
    if let Some(ResidentOrder::WorkAt(o)) = &r.order {
        if o.building_id == here.id {
            return o.mends.then(|| "already mending here".into());
        }
    }
    let max = max_workers(here.kind).unwrap_or(0.0);
    if worker_indices(world, here).len() as f64 >= max {
        return Some(format!("it already has {max} workers"));
    }
    None
}

/// Sets the resident to work the workplace on their tile (`workAt.apply`), at a smithy mending
/// for `makes: "mend"`.
pub fn apply_work_at(world: &mut WorldState, order: &OrderRequest) {
    let mends = str_field(order, "makes") == Some(MEND);
    let makes = str_field(order, "makes").and_then(good_of);
    let id = str_field(order, "residentId");
    let Some(ri) = world.residents.iter().position(|x| Some(x.id.as_str()) == id) else { return };
    let (x, y) = (world.residents[ri].x as i32, world.residents[ri].y as i32);
    if let Some(here) = building_at(world, x, y, MAP_SIZE).cloned() {
        start_work(&mut world.residents[ri], &here, makes);
        if let Some(ResidentOrder::WorkAt(o)) = world.residents[ri].order.as_mut() {
            o.mends = mends;
        }
    }
}

pub(crate) static WORK_AT_META: OrderMeta = OrderMeta::fns(
    "workAt",
    |w, s, o, _| validate_work_at(w, s, o),
    |w, _, o, _| apply_work_at(w, o),
)
.queue_step()
.never_ends()
.gets_off_first()
.adults_only()
.npc_city()
.blocked_carrying_child()
.goes_on_until_stopped()
.script(&[WORK_AT_ACTION]);

const WORK_AT_ACTION: ScriptAction = ScriptAction {
    name: "workAt",
    group: ActionGroup::Work,
    request: Request::Fields(&[arg_as("makes?", "makes")]),
    cost: 10.0,
    description: "Work the workplace on my tile; at a smithy, say what to make, or \"mend\" to mend the most worn weapon, piece of armour or set of Tools there (carried by its workers or on its pile) back to good, for a share of its recipe.",
    returns: ScriptType::String,
};

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
        mends: false,
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
        let Some(ri) = resident_index(world, &a.resident_id) else {
            continue;
        };
        let r = &world.residents[ri];
        let Some(ResidentOrder::WorkAt(o)) = &r.order else { continue };
        let (building_id, makes, at) = (o.building_id.clone(), o.makes, o.at);
        let place = building_index(world, &building_id);
        let count = workers.get(&building_id).copied().unwrap_or(0.0);
        if o.mends {
            let fits = place.filter(|&pi| {
                let p = &world.buildings[pi];
                let max = max_workers(p.kind).unwrap_or(0.0);
                let on_it =
                    p.site.is_none() && is_at((r.x as i32, r.y as i32), placed(p), MAP_SIZE);
                p.kind == BuildingKind::Smithy && on_it && r.x == at.x && r.y == at.y && count < max
            });
            let Some(pi) = fits else {
                world.residents[ri].order = None;
                continue;
            };
            workers.insert(building_id, count + 1.0);
            mend_work(world, ri, pi, tick);
            continue;
        }
        let fits = place.and_then(|pi| {
            let p = &world.buildings[pi];
            let max = max_workers(p.kind).unwrap_or(0.0);
            let good = workplace_good(world, p, makes)?;
            let skill = workplace_skill(p.kind)?;
            let on_it =
                crate::ruins::standing(p) && is_at((r.x as i32, r.y as i32), placed(p), MAP_SIZE);
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
            None => {
                work_output(r, good, skill, tick) * richness_factor(world, &world.buildings[pi])
            }
        };
        let learned = work_learned(r, skill, tick);
        let had = skill_of(r, skill);
        // Rallied by their Leader, they work at a multiple of their pace (`CONTEXT.md`: Rallying
        // the crew); what they learn stays as it was.
        let place_id = world.buildings[pi].id.clone();
        let gain = gain * crate::rally::rallied_pace(world, ri, &place_id);
        work_order(world, ri).progress += gain;
        world.residents[ri].skills.insert(skill, had + learned);
        crate::wear::wear_tools(world, ri);
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
                    use_up(world, &place, &recipe_input(recipe));
                    for (made, units) in recipe_output(recipe) {
                        for _ in 0..units as u32 {
                            produce(world, &place, made, scratch);
                        }
                    }
                }
                // A unit from a vein uses its stock up; its last runs it dry, and the workplace
                // makes nothing more (`CONTEXT.md`: Running dry).
                None => match take_from_vein(world, &place) {
                    Take::Made => produce(world, &place, good, scratch),
                    Take::Last => {
                        produce(world, &place, good, scratch);
                        break;
                    }
                    Take::Nothing => break,
                },
            }
        }
    }
}

/// A tick of mending (`CONTEXT.md`: Mending) by resident `ri` at the smithy at `pi`: their work
/// goes into mending the most worn piece there (`piece_to_mend`) at `mend_pace` times a batch's
/// pace, only while the smithy holds the input for it; mended, the piece is good again and the
/// input used up. With nothing to mend, or no input, they stand idle: no work, nothing learned.
fn mend_work(world: &mut WorldState, ri: usize, pi: usize, tick: f64) {
    let place = world.buildings[pi].clone();
    let Some(piece) = piece_to_mend(world, &place) else { return };
    if !has_mend_input(world, &place, &piece) {
        return;
    }
    let r = &world.residents[ri];
    let Some(skill) = workplace_skill(place.kind) else { return };
    let gain = batch_work(r, place.kind, tick) * mend_pace();
    let learned = work_learned(r, skill, tick);
    let had = skill_of(r, skill);
    let gain = gain * crate::rally::rallied_pace(world, ri, &place.id);
    world.residents[ri].skills.insert(skill, had + learned);
    let o = work_order(world, ri);
    o.progress += gain;
    if o.progress < 1.0 {
        return;
    }
    o.progress -= 1.0;
    use_up(world, &place, &mend_input(piece.good).unwrap_or_default());
    mend_piece(world, &piece);
}

/// Takes a batch's input from what a processing workplace's workers carry, the most laden first,
/// and then from its pile (`useUp`). The caller has checked it is all there.
fn use_up(world: &mut WorldState, place: &Building, input: &[(Good, f64)]) {
    for &(good, units) in input {
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
