//! Gathering by hand (`CONTEXT.md`: Gathering, Patch; Epic 114): a grown resident takes Wood or
//! Food from a Forest tile they stand on, or Stone from a Hills tile, into their hands, with no
//! node and no workplace. Each tile holds a patch of about one load, shared by everyone; used up,
//! the tile is picked over and gives nothing until it has grown back.
//!
//! The patches are kept sparse (`WorldState::patches`): only the tiles that aren't full, each with
//! what it held at the tick it was last taken from. What it holds now grows from there (after a
//! rest), so nothing
//! changes from tick to tick; a patch that has grown back full leaves the list at the turn of the
//! day.

use std::collections::HashSet;

use csp_shared::balance::{GATHER_REACH, PATCH_REGROW_DAYS, PATCH_REST_DAYS, PATCH_SIZE};
use csp_shared::footprint::footprint_tiles;
use csp_shared::terrain::{terrain_at, wrap, wrap_delta, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    GatherOrder, Good, OrderEnded, OrderEndedKind, OrderRequest, Patch, Resident, ResidentOrder,
    SkillName, Tile, WorldState,
};

use crate::invariants::violation;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::queries::balance::{gather_output, skill_of, work_learned};
use crate::queries::building::CARRYING_A_CHILD;
use crate::queries::names::{good_of, placed};
use crate::queries::residents::{can_work, carry_capacity, good_weight, stock_weight};
use crate::queue::field_str as str_field;
use crate::sight::InvariantViolation;
use crate::world_index::resident_index;
use csp_shared::footprint::covers;

/// Why a gather order ended with full hands (`me.orderEnded.reason`).
pub const HANDS_FULL: &str = "hands full";
/// Why a gather order ended on a used-up patch (`me.orderEnded.reason`).
pub const PICKED_OVER: &str = "picked over";

/// The terrain a good is gathered on, and the skill gathering it uses and teaches
/// (`CONTEXT.md`: Gathering): Wood and Food in a Forest (Woodcutting, Farming), Stone in Hills
/// (Mining). `None` for a good that is never gathered.
pub fn gathered_on(good: Good) -> Option<(Terrain, SkillName)> {
    match good {
        Good::Wood => Some((Terrain::Forest, SkillName::Woodcutting)),
        Good::Food => Some((Terrain::Forest, SkillName::Farming)),
        Good::Stone => Some((Terrain::Hills, SkillName::Mining)),
        _ => None,
    }
}

/// Whether a tile of this terrain has a patch at all: Forest and Hills.
pub fn has_patch(terrain: u8) -> bool {
    terrain == Terrain::Forest as u8 || terrain == Terrain::Hills as u8
}

/// What a patch holds at `tick`: what it held when last taken from and, once nobody has gathered
/// there for `PATCH_REST_DAYS`, grown back steadily since, never above full. So a tile being
/// gathered runs out rather than growing as fast as it is used.
pub fn patch_now(p: &Patch, tick: u64) -> f64 {
    let rest = (PATCH_REST_DAYS * TICKS_PER_GAME_DAY) as u64;
    let growing = tick.saturating_sub(p.at.saturating_add(rest)) as f64;
    PATCH_SIZE.min(p.left + growing * PATCH_SIZE / (PATCH_REGROW_DAYS * TICKS_PER_GAME_DAY))
}

/// Where the patch of (x, y) is in the sorted list, or where it would go.
fn patch_slot(world: &WorldState, x: i32, y: i32) -> Result<usize, usize> {
    world.patches.binary_search_by(|p| (p.y, p.x).cmp(&(y, x)))
}

/// What the patch of (x, y) holds now (`CONTEXT.md`: Patch): full for a tile in no entry. Only a
/// Forest or Hills tile has one; the caller checks the terrain.
pub fn patch_left(world: &WorldState, x: i32, y: i32) -> f64 {
    match patch_slot(world, x, y) {
        Ok(i) => patch_now(&world.patches[i], world.tick),
        Err(_) => PATCH_SIZE,
    }
}

/// Whether the tile (x, y) is picked over: its patch is gone (`CONTEXT.md`: Patch).
pub fn picked_over(world: &WorldState, x: i32, y: i32) -> bool {
    patch_left(world, x, y) < 1.0
}

/// Takes `units` from the patch of (x, y), as far as it holds them.
fn take_from_patch(world: &mut WorldState, x: i32, y: i32, units: f64) {
    let tick = world.tick;
    let left = (patch_left(world, x, y) - units).max(0.0);
    let patch = Patch { x, y, left, at: tick };
    match patch_slot(world, x, y) {
        Ok(i) => world.patches[i] = patch,
        Err(i) => world.patches.insert(i, patch),
    }
}

/// At the turn of each game day the patches that have grown back full leave the list, so it holds
/// only the tiles that aren't full.
pub fn step_patches(world: &mut WorldState) {
    if world.tick == 0 || world.tick as f64 % TICKS_PER_GAME_DAY != 0.0 {
        return;
    }
    let tick = world.tick;
    world.patches.retain(|p| patch_now(p, tick) < PATCH_SIZE);
}

/// Whether anything stands on (x, y) that keeps it from being gathered: a building, a
/// construction site or a resource node (`CONTEXT.md`: Gathering). Roads and the sites that share
/// a tile (a carriage's, a boat's) count too.
pub fn tile_taken(world: &WorldState, x: i32, y: i32, size: i32) -> bool {
    world.buildings.iter().any(|b| covers(placed(b), x, y, size))
        || world.nodes.iter().any(|n| n.x as i32 == x && n.y as i32 == y)
}

/// What a Gather task looks for its next tile with (`gatherTile`).
pub struct TileSearch<'a> {
    pub good: Good,
    /// Where the search is around: where the gatherer started.
    pub from: (i32, i32),
    /// Tiles not to pick: those others on the task have taken.
    pub skip: &'a [(i32, i32)],
    /// Whether the Player has explored a tile.
    pub explored: &'a dyn Fn(i32, i32) -> bool,
    /// Whether the side sees a tile now.
    pub in_sight: &'a dyn Fn(i32, i32) -> bool,
}

/// The tile a Gather task goes to next (`CONTEXT.md`: Gather): of the explored tiles within
/// `GATHER_REACH` of `from` whose terrain gives the good, with nothing standing on them and not
/// skipped, the nearest to `from` that isn't picked over as far as the side can tell. A tile out
/// of sight may be picked over all the same: the gatherer finds out there. Ties go to the
/// northernmost, then the westernmost.
pub fn gather_tile(
    world: &WorldState,
    terrain: &TerrainMap,
    s: &TileSearch<'_>,
) -> Option<(i32, i32)> {
    let (on, _) = gathered_on(s.good)?;
    let size = terrain.size;
    let reach = GATHER_REACH as i32;
    // What stands near, worked out once rather than for every tile.
    let mut taken: HashSet<(i32, i32)> = HashSet::new();
    for b in &world.buildings {
        let (dx, dy) =
            (wrap_delta(s.from.0, b.x as i32, size), wrap_delta(s.from.1, b.y as i32, size));
        if dx.abs() <= reach + 8 && dy.abs() <= reach + 8 {
            taken.extend(footprint_tiles(placed(b), size));
        }
    }
    for n in &world.nodes {
        let (dx, dy) =
            (wrap_delta(s.from.0, n.x as i32, size), wrap_delta(s.from.1, n.y as i32, size));
        if dx.abs() <= reach && dy.abs() <= reach {
            taken.insert((n.x as i32, n.y as i32));
        }
    }
    let mut best: Option<(i32, i32, i32)> = None; // distance², y, x
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            let d2 = dx * dx + dy * dy;
            if d2 > reach * reach || best.is_some_and(|(b, _, _)| d2 > b) {
                continue;
            }
            let (x, y) = (wrap(s.from.0 + dx, size), wrap(s.from.1 + dy, size));
            let fits = terrain_at(terrain, x, y) == on as u8
                && (s.explored)(x, y)
                && !taken.contains(&(x, y))
                && !s.skip.contains(&(x, y))
                && !((s.in_sight)(x, y) && picked_over(world, x, y));
            if fits && best.is_none_or(|b| (d2, y, x) < b) {
                best = Some((d2, y, x));
            }
        }
    }
    best.map(|(_, y, x)| (x, y))
}

/// Whether a resident has room in their hands for one more unit of `good`.
fn has_room(r: &Resident, good: Good, tick: f64) -> bool {
    stock_weight(&r.carried) + good_weight(good) <= carry_capacity(r, tick) + 1e-9
}

/// Why the resident can't gather `good` on the tile they stand on, or `None` if they can: it must
/// be a fitting tile with nothing on it and a patch left, and they need room in their hands.
pub fn gather_problem(
    world: &WorldState,
    r: &Resident,
    good: Good,
    terrain: &TerrainMap,
) -> Option<String> {
    let Some((on, _)) = gathered_on(good) else {
        return Some("only wood, stone and food are gathered".into());
    };
    let (x, y) = (r.x as i32, r.y as i32);
    if terrain_at(terrain, x, y) != on as u8 {
        let place = if on == Terrain::Forest { "a forest" } else { "hills" };
        return Some(format!("gather that in {place}"));
    }
    if tile_taken(world, x, y, terrain.size) {
        return Some("something stands on this tile".into());
    }
    if picked_over(world, x, y) {
        return Some(PICKED_OVER.into());
    }
    if !has_room(r, good, world.tick as f64) {
        return Some(HANDS_FULL.into());
    }
    None
}

/// Checks a gather order: one of the sender's grown residents gathers `good` on their tile.
pub fn validate_gather(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let Some(ri) = ordered_resident(world, sender, str_field(order, "residentId")) else {
        return Some("not one of your residents".into());
    };
    let r = &world.residents[ri];
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t gather".into());
    }
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    let Some(good) = str_field(order, "good").and_then(good_of) else {
        return Some("no such good".into());
    };
    let Some(terrain) = terrain else {
        return Some("the map is not loaded".into());
    };
    gather_problem(world, r, good, terrain)
}

/// Sets the resident to gather on their tile.
pub fn apply_gather(world: &mut WorldState, order: &OrderRequest) {
    let Some(good) = str_field(order, "good").and_then(good_of) else { return };
    let id = str_field(order, "residentId");
    let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) else { return };
    r.order = Some(ResidentOrder::Gather(GatherOrder {
        good,
        at: Tile { x: r.x, y: r.y },
        progress: 0.0,
    }));
}

/// Ends the resident's gather order, saying why (`me.orderEnded`); `None` when they left the tile
/// or something now stands on it.
fn end_gather(world: &mut WorldState, ri: usize, reason: Option<&str>) {
    let tick = world.tick as f64;
    let r = &mut world.residents[ri];
    r.order = None;
    if let Some(reason) = reason {
        r.order_ended =
            Some(OrderEnded { kind: OrderEndedKind::Gather, tick, reason: Some(reason.into()) });
    }
}

/// Requests this tick's gathering: the residents with a gather order.
pub fn request_gathering(world: &WorldState) -> Vec<String> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::Gather(_))))
        .map(|r| r.id.clone())
        .collect()
}

/// Resolves gathering (ADR 0002), one resident after another. One who left their tile, or whose
/// tile now has a building, site or node on it, stops. Otherwise a tick's work adds to their share
/// of the next unit and teaches the good's skill; each whole unit comes off the patch into their
/// hands. The order ends once their hands are full or the patch is gone. Returns how many
/// gathered.
pub fn resolve_gathering(world: &mut WorldState, ids: &[String], terrain: &TerrainMap) -> usize {
    let tick = world.tick as f64;
    let mut gathered = 0;
    for id in ids {
        let Some(ri) = resident_index(world, id) else { continue };
        let r = &world.residents[ri];
        let Some(ResidentOrder::Gather(o)) = &r.order else { continue };
        let (good, at) = (o.good, o.at);
        let (x, y) = (r.x as i32, r.y as i32);
        let stays = r.x == at.x && r.y == at.y;
        let fits = gathered_on(good)
            .filter(|(on, _)| terrain_at(terrain, x, y) == *on as u8)
            .map(|(_, skill)| skill);
        let skill = match fits {
            Some(skill) if stays && !tile_taken(world, x, y, terrain.size) => skill,
            _ => {
                end_gather(world, ri, None);
                continue;
            }
        };
        if picked_over(world, x, y) {
            end_gather(world, ri, Some(PICKED_OVER));
            continue;
        }
        if !has_room(r, good, tick) {
            end_gather(world, ri, Some(HANDS_FULL));
            continue;
        }
        gathered += 1;
        let gain = gather_output(r, good, skill, tick);
        let learned = work_learned(r, skill, tick);
        let had = skill_of(r, skill);
        world.residents[ri].skills.insert(skill, had + learned);
        crate::wear::wear_tools(world, ri);
        let Some(ResidentOrder::Gather(o)) = world.residents[ri].order.as_mut() else { continue };
        o.progress += gain;
        while let Some(ResidentOrder::Gather(o)) = world.residents[ri].order.as_mut() {
            if o.progress < 1.0 {
                break;
            }
            o.progress -= 1.0;
            take_from_patch(world, x, y, 1.0);
            *world.residents[ri].carried.entry(good).or_insert(0.0) += 1.0;
            if picked_over(world, x, y) {
                end_gather(world, ri, Some(PICKED_OVER));
            } else if !has_room(&world.residents[ri], good, tick) {
                end_gather(world, ri, Some(HANDS_FULL));
            }
        }
    }
    gathered
}

/// Invariant (`patches-sound`, ADR 0004): every patch holds between nothing and full, was last
/// taken from no later than now, lies on a Forest or Hills tile, and the list is sorted by tile
/// with each tile once.
pub fn patch_problems(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let name = "patches-sound";
    let mut out = Vec::new();
    let mut fail = |m: String| out.push(violation(name, m, &[]));
    for (i, p) in world.patches.iter().enumerate() {
        let tile = format!("the patch of ({}, {})", p.x, p.y);
        if !(0.0..=PATCH_SIZE).contains(&p.left)
            || !(0.0..=PATCH_SIZE).contains(&patch_now(p, world.tick))
        {
            fail(format!("{tile} holds {}, outside 0 to {PATCH_SIZE}", p.left));
        }
        if p.at > world.tick {
            fail(format!("{tile} was taken from at tick {}, after now", p.at));
        }
        let on_map = (0..terrain.size).contains(&p.x) && (0..terrain.size).contains(&p.y);
        if !on_map || !has_patch(terrain_at(terrain, p.x, p.y)) {
            fail(format!("{tile} is on no Forest or Hills tile"));
        }
        if i > 0 && (world.patches[i - 1].y, world.patches[i - 1].x) >= (p.y, p.x) {
            fail(format!("{tile} is out of order"));
        }
    }
    out
}

/// Invariant (`gather-orders-sound`, ADR 0004): a resident gathering is grown, stands where they
/// began on a tile that fits their good, and nothing stands on it: no building, site or node.
pub fn gather_order_problems(world: &WorldState, terrain: &TerrainMap) -> Vec<InvariantViolation> {
    let name = "gather-orders-sound";
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(ResidentOrder::Gather(o)) = &r.order else { continue };
        let (x, y) = (r.x as i32, r.y as i32);
        let mut problems = Vec::new();
        if r.x != o.at.x || r.y != o.at.y {
            problems.push("isn’t where they began".to_string());
        }
        match gathered_on(o.good) {
            Some((on, _)) if terrain_at(terrain, x, y) == on as u8 => {}
            _ => problems.push(format!("gathers {:?} on a tile that doesn’t give it", o.good)),
        }
        if tile_taken(world, x, y, terrain.size) {
            problems.push("gathers on a tile with a building, site or node".into());
        }
        if !can_work(r.born_at, world.tick as f64) {
            problems.push("gathers as a child".into());
        }
        for p in problems {
            out.push(violation(name, format!("resident {} {p}", r.id), &[&r.id]));
        }
    }
    out
}
