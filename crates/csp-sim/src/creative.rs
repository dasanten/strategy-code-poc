//! Creative actions (`CONTEXT.md`: Creative mode, ADR 0043): what an admin on a server started
//! with `CREATIVE=1` does to the world by hand, between ticks. They are no order kind and no
//! script call (ADR 0002 stays whole for Players): the server's creative routes call them
//! directly. They reach every realm and unowned things alike.
//!
//! - **Goods:** give or take goods in a storage (or warehouse, stable or haven) or a carriage.
//! - **Finish now:** a construction site, the rest of the road or wall lines building on it, or
//!   the trainings at a training ground. Each ends as it would at normal speed: the site becomes
//!   its building through [`finish_site_by`], and the orders on it go on or end as after the last
//!   tick of work.

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::is_at;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, Good, ResidentOrder, Stock, TrainingSubject, WallMaterial, WorldState,
};

use crate::building::{building_part, finish_site_by, lay_out_site, orders_follow_sites};
use crate::cities::update_city_membership;
use crate::queries::balance::training_gain;
use crate::queries::building::{
    build_problem_for, construction_index_at, is_stone, line_building, line_kind_at, materials_of,
    teacher_at, work_of, TerrainLookup, KEEPS_GOODS,
};
use crate::queries::carriages::carriage_capacity;
use crate::queries::goods::take_out;
use crate::queries::names::placed;
use crate::queries::residents::{good_weight, stock_weight};
use crate::training::learn;

/// The most ticks of training [`finish_now`] runs for one trainee: far more than any training
/// to its ceiling takes, so it only stops one that would never end.
const MOST_TRAINING_TICKS: u32 = 10_000_000;

/// Whole units of goods, more than none: what a creative goods action moves.
fn units(amount: f64) -> Result<f64, String> {
    if amount.is_finite() && amount >= 1.0 && amount.fract() == 0.0 {
        Ok(amount)
    } else {
        Err("Give a whole number of units, at least one.".into())
    }
}

/// Where goods are given or taken: a building that keeps goods, or a carriage.
enum Holder {
    Building(usize),
    Carriage(usize),
}

fn holder(world: &WorldState, id: &str) -> Result<Holder, String> {
    if let Some(i) = world.buildings.iter().position(|b| b.id == id) {
        let b = &world.buildings[i];
        if !KEEPS_GOODS.contains(&b.kind) || b.site.is_some() {
            return Err("Only a storage, warehouse, stable, haven or carriage holds goods.".into());
        }
        return Ok(Holder::Building(i));
    }
    world
        .carriages
        .iter()
        .position(|k| k.id == id)
        .map(Holder::Carriage)
        .ok_or_else(|| "No such building or carriage.".into())
}

/// Gives `amount` units of `good` to the storage or carriage `id`, from nothing. A carriage takes
/// no more than it holds. Answers the units given.
pub fn give_goods(
    world: &mut WorldState,
    id: &str,
    good: Good,
    amount: f64,
) -> Result<f64, String> {
    let units = units(amount)?;
    let stock: &mut Stock = match holder(world, id)? {
        Holder::Building(i) => world.buildings[i].stock.get_or_insert_with(Stock::new),
        Holder::Carriage(i) => {
            let capacity = carriage_capacity(world, &world.carriages[i]);
            let load = &world.carriages[i].load;
            if stock_weight(load) + units * good_weight(good) > capacity + 1e-9 {
                let free = (capacity - stock_weight(load)).max(0.0);
                return Err(format!(
                    "The carriage holds {capacity} kg; it has room for {} kg more.",
                    free.floor()
                ));
            }
            &mut world.carriages[i].load
        }
    };
    *stock.entry(good).or_insert(0.0) += units;
    Ok(units)
}

/// Takes up to `amount` units of `good` out of the storage or carriage `id`, never below none.
/// Answers the units taken.
pub fn take_goods(
    world: &mut WorldState,
    id: &str,
    good: Good,
    amount: f64,
) -> Result<f64, String> {
    let units = units(amount)?;
    let stock: &mut Stock = match holder(world, id)? {
        Holder::Building(i) => world.buildings[i].stock.get_or_insert_with(Stock::new),
        Holder::Carriage(i) => &mut world.carriages[i].load,
    };
    let taken = units.min(stock.get(&good).copied().unwrap_or(0.0));
    take_out(stock, good, taken);
    Ok(taken)
}

/// Finishes the construction site or the trainings at the building `id` now (`CONTEXT.md`:
/// Creative mode, finish now), as they would end at normal speed:
///
/// - **A site** gets all its materials and work and becomes its building (or boat, ship, carriage
///   or siege machine) for the realm of a resident building it, else the realm that laid it out;
///   the builders' orders end.
/// - **A road or wall line** building on that site builds every tile it has left the same way,
///   where a site may go, and its order ends.
/// - **A training ground:** every trainee there trains to where their teacher takes them (their
///   ceiling, or the teacher's level) and their order ends.
///
/// Answers what was done, for the admin.
pub fn finish_now(
    world: &mut WorldState,
    id: &str,
    terrain: Option<&TerrainMap>,
) -> Result<String, String> {
    let i = world.buildings.iter().position(|b| b.id == id).ok_or("No such building.")?;
    if world.buildings[i].site.is_some() {
        return finish_site_now(world, i, terrain);
    }
    if world.buildings[i].kind == BuildingKind::TrainingGround {
        let size = terrain.map_or(MAP_SIZE, |t| t.size);
        let trained = finish_training(world, i, size);
        if trained == 0 {
            return Err("Nobody trains here.".into());
        }
        let s = if trained == 1 { "" } else { "s" };
        return Ok(format!("{trained} trainee{s} finished training."));
    }
    Err("Nothing to finish here: it is no construction site or training ground.".into())
}

/// Gives a site everything it still needs: all its materials and all its work.
fn complete(world: &mut WorldState, i: usize) {
    let (materials, work) = (materials_of(&world.buildings[i]), work_of(&world.buildings[i]));
    if let Some(site) = world.buildings[i].site.as_mut() {
        site.delivered = materials;
        site.work = work;
    }
}

/// A line order building on a site: who builds it, of what, and the tiles left after this one.
struct Line {
    resident: usize,
    building: BuildingKind,
    material: Option<WallMaterial>,
    rest: Vec<(f64, f64)>,
}

fn finish_site_now(
    world: &mut WorldState,
    i: usize,
    terrain: Option<&TerrainMap>,
) -> Result<String, String> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let site_id = world.buildings[i].id.clone();
    // Who builds it: the first builder there gives the finished thing their realm, as the one who
    // puts the last in would; without one, the realm (or city) that laid it out.
    let builders: Vec<usize> = (0..world.residents.len())
        .filter(|&r| {
            building_part(world.residents[r].order.as_ref())
                .is_some_and(|p| p.site_id.as_deref() == Some(site_id.as_str()))
        })
        .collect();
    let (owner, city_id) = match builders.first() {
        Some(&r) => (world.residents[r].owner.clone(), world.residents[r].city_id.clone()),
        None => (world.buildings[i].realm_id.clone(), world.buildings[i].city_id.clone()),
    };
    let lines: Vec<Line> = builders
        .iter()
        .filter_map(|&r| match &world.residents[r].order {
            Some(o @ (ResidentOrder::RoadLine(l) | ResidentOrder::WallLine(l))) => Some(Line {
                resident: r,
                building: line_building(o)?,
                material: l.material,
                rest: l.tiles.iter().skip(1).copied().collect(),
            }),
            _ => None,
        })
        .collect();
    let kind = world.buildings[i].kind;
    complete(world, i);
    if !finish_site_by(world, i, owner.as_deref(), city_id.as_deref(), terrain) {
        return Err("It can't be finished: no free water next to it to float it on.".into());
    }
    let mut changed_cities = kind != BuildingKind::Road;
    let mut tiles = 0;
    for line in &lines {
        // The line is done: its builder no longer walks it.
        world.residents[line.resident].order = None;
        for &(x, y) in &line.rest {
            if let Some(built) = finish_line_tile(world, line, (x, y), terrain) {
                tiles += 1;
                changed_cities |= built != BuildingKind::Road;
            }
        }
    }
    if changed_cities {
        update_city_membership(world, size);
    }
    orders_follow_sites(world);
    Ok(if tiles == 0 {
        "Finished.".into()
    } else {
        let s = if tiles == 1 { "" } else { "s" };
        format!("Finished, and {tiles} more tile{s} of the line.")
    })
}

/// Builds one more tile of a line at once, as its builder would on reaching it: joins the
/// unfinished site of its kind there, or lays out a new one where it may go, and finishes it.
/// Answers what was built, or nothing where it can't go.
fn finish_line_tile(
    world: &mut WorldState,
    line: &Line,
    (x, y): (f64, f64),
    terrain: Option<&TerrainMap>,
) -> Option<BuildingKind> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let lookup = terrain.map(|t| t as &dyn TerrainLookup);
    let (tx, ty) = (x as i32, y as i32);
    let kind = line_kind_at(world, line.building, line.material, tx, ty);
    let joins = construction_index_at(world, tx, ty, kind).filter(|&i| {
        let h = &world.buildings[i];
        h.site.is_some()
            && h.kind == kind
            && is_stone(h.kind, h.material) == is_stone(kind, line.material)
    });
    let i = match joins {
        Some(i) => i,
        None => {
            if build_problem_for(world, tx, ty, kind, line.material, lookup).is_some() {
                return None;
            }
            let id = lay_out_site(world, line.resident, (x, y), kind, line.material, size);
            world.buildings.iter().position(|b| b.id == id)?
        }
    };
    complete(world, i);
    let r = &world.residents[line.resident];
    let (owner, city_id) = (r.owner.clone(), r.city_id.clone());
    finish_site_by(world, i, owner.as_deref(), city_id.as_deref(), terrain).then_some(kind)
}

/// Every trainee at the training ground `gi` trains on, tick by tick as at normal speed, until
/// they gain no more from its teacher, and stops. Answers how many trained.
fn finish_training(world: &mut WorldState, gi: usize, size: i32) -> usize {
    let ground = world.buildings[gi].clone();
    let trainees: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            matches!(&r.order, Some(ResidentOrder::Train(o)) if o.building_id == ground.id)
                && is_at((r.x as i32, r.y as i32), placed(&ground), size)
        })
        .collect();
    let lesson = teacher_at(&ground, &world.residents, size).and_then(|t| match &t.order {
        Some(ResidentOrder::Teach(o)) => Some((t.clone(), o.subject)),
        _ => None,
    });
    let tick = world.tick as f64;
    for &i in &trainees {
        if let Some((teacher, subject)) = &lesson {
            train_to_the_end(&mut world.residents[i], teacher, *subject, tick);
        }
        world.residents[i].order = None;
    }
    trainees.len()
}

fn train_to_the_end(
    r: &mut csp_shared::world::Resident,
    teacher: &csp_shared::world::Resident,
    subject: TrainingSubject,
    tick: f64,
) {
    for _ in 0..MOST_TRAINING_TICKS {
        let gain = training_gain(r, teacher, subject, tick);
        if gain <= 1e-12 {
            return;
        }
        learn(r, subject, gain);
    }
}

/// The creative actions as the server's creative route names them: none is an order kind or a
/// script call.
pub const CREATIVE_ACTIONS: [&str; 3] = ["giveGoods", "takeGoods", "finishNow"];
