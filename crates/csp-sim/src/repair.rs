//! Decay and repairing (`CONTEXT.md`: Decay, Repairing; Epic 97): every finished building, wall,
//! gate and road loses condition at a steady pace per game day of its kind, used or not; a
//! resident at a worn building puts it back to good with a share of its materials and some work.
//! Blows from attackers are apart from this (`Building::damage`).

use csp_shared::balance::{
    DECAY_DAYS, DECAY_NEARLY_RUIN, DECAY_WORN, MAP_SIZE, REPAIR_MATERIALS_SHARE, REPAIR_WORK_SHARE,
};
use csp_shared::footprint::{covers, is_at};
use csp_shared::terrain::{terrain_at, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, ConstructionSite, OrderRequest, RepairOrder, ResidentOrder, SkillName,
    Stock, Tile, WorldState,
};

use crate::order_sender::{commands, realm_of, OrderSender};
use crate::queries::balance::{build_work, construction_learned, skill_of};
use crate::queries::building::{build_materials, build_work_of, site_work_of, CARRYING_A_CHILD};
use crate::queries::names::{held, kind_name, placed};
use crate::queries::residents::can_work;
use crate::queue::field_str as str_field;
use crate::world_index::{building_index, resident_index};

/// How a building's condition reads (`CONTEXT.md`: Decay): good, worn, nearly a ruin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Condition {
    Good,
    Worn,
    NearlyRuin,
    /// Nothing left: a ruin (`CONTEXT.md`: Ruin), rebuilt with the repair order.
    Ruin,
}

impl Condition {
    /// The word scripts see (`building.condition`).
    pub fn name(self) -> &'static str {
        match self {
            Condition::Good => "good",
            Condition::Worn => "worn",
            Condition::NearlyRuin => "nearlyRuin",
            Condition::Ruin => "ruin",
        }
    }
}

/// Game days a building of `kind` takes to lose all its condition (`DECAY_DAYS`); `None` for a
/// kind that never decays.
pub fn decay_days(kind: BuildingKind) -> Option<f64> {
    DECAY_DAYS.get(kind_name(kind))
}

/// Whether `b` decays: a finished building of a kind that does.
pub fn decays(b: &Building) -> bool {
    b.site.is_none() && decay_days(b.kind).is_some()
}

/// How the building's condition reads; `None` for a construction site or a kind that never
/// decays.
pub fn condition_of(b: &Building) -> Option<Condition> {
    if !decays(b) {
        return None;
    }
    if crate::ruins::is_ruin(b) {
        return Some(Condition::Ruin);
    }
    let lost = b.decay.unwrap_or(0.0);
    Some(if lost >= DECAY_NEARLY_RUIN {
        Condition::NearlyRuin
    } else if lost >= DECAY_WORN {
        Condition::Worn
    } else {
        Condition::Good
    })
}

/// Every finished building loses its day's share of condition at the turn of each game day
/// (`CONTEXT.md`: Decay): once a day, not a sliver each tick, so what the Players are sent of a
/// building changes once a game day rather than every tick. Its condition never goes below
/// nothing. Rounded to a billionth, so a road worn after 15 of its 60 days reads worn on the 15th
/// rather than a sliver short of it.
pub fn step_decay(world: &mut WorldState) {
    if world.tick == 0 || world.tick as f64 % TICKS_PER_GAME_DAY != 0.0 {
        return;
    }
    for b in &mut world.buildings {
        if b.site.is_some() {
            continue;
        }
        let Some(days) = decay_days(b.kind) else { continue };
        let lost = ((b.decay.unwrap_or(0.0) + 1.0 / days) * 1e9).round() / 1e9;
        b.decay = Some(lost.min(1.0));
    }
}

/// The materials a repair of a building of `kind` takes (`REPAIR_MATERIALS_SHARE` of its
/// `BUILD_MATERIALS`, rounded up to whole units).
pub fn repair_materials(kind: BuildingKind) -> Stock {
    build_materials(kind)
        .into_iter()
        .map(|(g, n)| (g, (n * REPAIR_MATERIALS_SHARE).ceil()))
        .filter(|(_, n)| *n > 0.0)
        .collect()
}

/// The work a repair of a building of `kind` takes (`REPAIR_WORK_SHARE` of its `BUILD_WORK`).
pub fn repair_work(kind: BuildingKind) -> f64 {
    build_work_of(kind) * REPAIR_WORK_SHARE
}

/// The materials a repair of `b` takes in all: rebuilding it if it is a ruin (`CONTEXT.md`: Ruin).
pub fn repair_materials_of(b: &Building) -> Stock {
    if crate::ruins::is_ruin(b) {
        crate::ruins::rebuild_materials(b.kind)
    } else {
        repair_materials(b.kind)
    }
}

/// The work a repair of `b` takes in all: rebuilding it if it is a ruin.
pub fn repair_work_of(b: &Building) -> f64 {
    if crate::ruins::is_ruin(b) {
        crate::ruins::rebuild_work(b.kind)
    } else {
        repair_work(b.kind)
    }
}

/// The materials a repair of `b` still lacks: all of them before anyone starts.
pub fn repair_materials_needed(b: &Building) -> Stock {
    let mut out = Stock::new();
    for (good, units) in repair_materials_of(b) {
        let left = units - b.repair.as_ref().map_or(0.0, |r| held(&r.delivered, good));
        if left > 0.0 {
            out.insert(good, left);
        }
    }
    out
}

/// The work a repair of `b` still needs.
pub fn repair_work_needed(b: &Building) -> f64 {
    0f64.max(repair_work_of(b) - b.repair.as_ref().map_or(0.0, |r| r.work))
}

/// Whether `b` can be repaired: worn or worse, or with a repair under way.
pub fn repairable(b: &Building) -> bool {
    b.repair.is_some() || condition_of(b).is_some_and(|c| c != Condition::Good)
}

/// Why a resident on (x, y) can't repair the building `building_id` (`repairProblem`).
pub fn repair_problem(world: &WorldState, x: i32, y: i32, building_id: &str) -> Option<String> {
    let b = world.buildings.iter().find(|c| c.id == building_id);
    let Some(b) = b.filter(|b| covers(placed(b), x, y, MAP_SIZE)) else {
        return Some("the resident is not at that building".into());
    };
    if b.site.is_some() {
        return Some("it is still a construction site".into());
    }
    if !decays(b) {
        return Some(format!("a {} can’t be repaired", kind_name(b.kind)));
    }
    if !repairable(b) {
        return Some(format!("the {} is in good condition", kind_name(b.kind)));
    }
    None
}

/// An action a resident with a repair order requests: a tick's repairing (`RepairAction`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepairAction {
    pub resident_id: String,
}

/// Requests this tick's repairing.
pub fn request_repairing(world: &WorldState) -> Vec<RepairAction> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::Repair(_))))
        .map(|r| RepairAction { resident_id: r.id.clone() })
        .collect()
}

/// Resolves repairing (ADR 0002), one action after another. A resident who has left the tile, or
/// whose building is gone or no longer needs repairing, stops. What they carry of the materials
/// the repair lacks goes in first; then their work, up to what it needs, which teaches
/// Construction. Once it has all its materials and work the building is good again, and
/// everyone's repair order on it is done. Returns how many repairs were finished.
pub fn resolve_repairing(
    world: &mut WorldState,
    actions: &[RepairAction],
    terrain: Option<&TerrainMap>,
) -> usize {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let tick = world.tick as f64;
    let mut done: Vec<String> = Vec::new();
    for a in actions {
        let Some(ri) = resident_index(world, &a.resident_id) else { continue };
        let r = &world.residents[ri];
        let Some(ResidentOrder::Repair(o)) = &r.order else { continue };
        let (rx, ry) = (r.x as i32, r.y as i32);
        let stays = (rx, ry) == (o.at.x as i32, o.at.y as i32);
        let bi = building_index(world, &o.building_id).filter(|&i| {
            let b = &world.buildings[i];
            stays && is_at((rx, ry), placed(b), size) && repairable(b) && decays(b)
        });
        let Some(bi) = bi else {
            world.residents[ri].order = None;
            continue;
        };
        // What they carry of what the repair lacks goes in.
        let lacking = repair_materials_needed(&world.buildings[bi]);
        let mut brought = Stock::new();
        for (good, units) in lacking {
            let carried = held(&world.residents[ri].carried, good);
            let n = carried.min(units);
            if n > 0.0 {
                brought.insert(good, n);
            }
        }
        let repair = world.buildings[bi]
            .repair
            .get_or_insert_with(|| ConstructionSite { delivered: Stock::new(), work: 0.0 });
        for (good, n) in brought {
            *repair.delivered.entry(good).or_insert(0.0) += n;
            let carried = &mut world.residents[ri].carried;
            let left = held(carried, good) - n;
            if left > 0.0 {
                carried.insert(good, left);
            } else {
                carried.shift_remove(&good);
            }
        }
        // Then a tick's work.
        let b = &world.buildings[bi];
        if repair_work_needed(b) > 0.0 {
            let r = &world.residents[ri];
            let under = terrain.map(|t| terrain_at(t, b.x as i32, b.y as i32));
            let work = site_work_of(build_work(r, tick), b.kind, under);
            let total = repair_work_of(b).min(b.repair.as_ref().map_or(0.0, |x| x.work) + work);
            let learned = construction_learned(r, tick);
            let had = skill_of(r, SkillName::Construction);
            if let Some(x) = world.buildings[bi].repair.as_mut() {
                x.work = total;
            }
            world.residents[ri].skills.insert(SkillName::Construction, had + learned);
        }
        let b = &mut world.buildings[bi];
        if repair_work_needed(b) == 0.0 && repair_materials_needed(b).is_empty() {
            b.decay = None;
            b.repair = None;
            b.ruined_at = None;
            done.push(b.id.clone());
        }
    }
    if !done.is_empty() {
        for r in &mut world.residents {
            if matches!(&r.order, Some(ResidentOrder::Repair(o)) if done.contains(&o.building_id)) {
                r.order = None;
            }
        }
    }
    done.len()
}

/// Checks a repair order: one of the Player's adult residents repairs the worn building on
/// their tile, whoever's it is.
pub fn validate_repair(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let id = str_field(order, "residentId");
    let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id);
    let realm = realm_of(world, sender.user_id);
    let (Some(realm), Some(r)) = (realm, r) else {
        return Some("not one of your residents".into());
    };
    if !commands(world, &realm.id, Some(r)) {
        return Some("not one of your residents".into());
    }
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t repair buildings".into());
    }
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    let Some(building_id) = str_field(order, "buildingId") else {
        return Some("which building?".into());
    };
    repair_problem(world, r.x as i32, r.y as i32, building_id)
}

/// Gives the resident the repair order; the work happens in later ticks.
pub fn apply_repair(world: &mut WorldState, order: &OrderRequest) {
    let Some(building_id) = str_field(order, "buildingId") else { return };
    let id = str_field(order, "residentId");
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = Some(ResidentOrder::Repair(RepairOrder {
            building_id: building_id.to_string(),
            at: Tile { x: r.x, y: r.y },
        }));
    }
}

#[cfg(test)]
#[path = "repair/tests.rs"]
mod tests;
