//! A new vein elsewhere (`CONTEXT.md`: Running dry; Epic 102): when a node runs dry, a new node
//! of its kind and richness comes into being in the same tick somewhere else, in a region that
//! fits, out of every Player's sight. Nobody is told: a Player who had explored its tile sees no
//! node there until they see the tile again. With no fitting tile anywhere (a tiny map), the node
//! comes back where it was after `VEIN_RETURN_DAYS`. The nodes of each kind and richness stay as
//! many as the world was made with.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, MutexGuard};

use csp_shared::balance::{NEW_VEIN_SPOT_REACH, NODE_MIN_SPACING, VEIN_RETURN_DAYS};
use csp_shared::footprint::footprint_tiles;
use csp_shared::terrain::{wrap, wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    DryNode, NewVein, ResourceKind, ResourceNode, Richness, WaitingVein, WorldState,
};

use crate::explored::ExploredTerrain;
use crate::invariants::violation;
use crate::node_gen::{allowed_in, contested_spots, fits_terrain};
use crate::queries::names::placed;
use crate::random::{hash_str, Mulberry32};
use crate::regions::{RegionKind, Regions};
use crate::sight::{sight_of, Eyes, InvariantViolation, Spot};
use crate::tick::Scratch;
use crate::world_index::world_index;

/// What [`new_vein_tile`] needs to know of the Players: whether a tile is in any Player's sight
/// (theirs or an ally's), and which Players explored it.
pub struct Onlookers<'a> {
    pub in_sight: &'a dyn Fn(i32, i32) -> bool,
    pub explored_by: &'a dyn Fn(i32, i32) -> Vec<u64>,
}

/// How many tiles across the cells are in which the tiles near a contested spot are looked up.
const SPOT_CELL: i32 = 8;

/// A prime the tiles are stepped through by, so every tile is tried once in an order that jumps
/// about the map.
const TILE_STRIDE: u64 = 1_000_003;

/// Where the node that comes into being for `dry` lies (`CONTEXT.md`: Running dry): a tile whose
/// terrain fits its kind, in a region that fits its kind and richness (a rich one on an island or
/// within `NEW_VEIN_SPOT_REACH` of a contested frontier spot, a normal one in the frontier, gold
/// and coal never in a heartland), free of buildings and of nodes that ran dry,
/// `NODE_MIN_SPACING` from every other node and in nobody's sight. Of those, one outside the
/// region `dry` lay in on a tile no Player explored comes first, then one outside it that some
/// explored, then the same in its own region. The tiles are tried in an order drawn from the
/// world's seed, the tick and the node, so a world replays the same. None when no tile fits.
pub fn new_vein_tile(
    world: &WorldState,
    terrain: &TerrainMap,
    regions: &Regions,
    dry: &DryNode,
    onlookers: &Onlookers,
) -> Option<(i32, i32)> {
    let size = terrain.size;
    let fits_region = |region: RegionKind| {
        allowed_in(dry.kind, region)
            && match dry.richness {
                Richness::Rich => matches!(region, RegionKind::Island | RegionKind::Frontier),
                Richness::Normal => region == RegionKind::Frontier,
                Richness::Poor => false,
            }
    };
    let home = regions.id_at(dry.x as i32, dry.y as i32);
    let near_spot = near_spots(size, regions, dry.richness);
    let too_near = spacing(world, size);
    let mut taken: HashSet<(i32, i32)> =
        world.dry_nodes.iter().map(|d| (wrap(d.x as i32, size), wrap(d.y as i32, size))).collect();
    for b in &world.buildings {
        taken.extend(
            footprint_tiles(placed(b), size)
                .into_iter()
                .map(|(x, y)| (wrap(x, size), wrap(y, size))),
        );
    }
    let n = u64::from(size.unsigned_abs()).pow(2);
    if n == 0 {
        return None;
    }
    let mut rng =
        Mulberry32::new(f64::from(hash_str(&format!("{}:{}:{}", world.seed, world.tick, dry.id))));
    let start = (rng.next() * n as f64) as u64 % n;
    let stride = TILE_STRIDE % n;
    let stride = if stride == 0 || gcd(stride, n) != 1 { 1 } else { stride };
    // The best found so far by its rank: 2 for its own region, 1 more for an explored tile.
    let mut best: Option<(u8, (i32, i32))> = None;
    for i in 0..n {
        let t = ((start + i * stride) % n) as usize;
        if !fits_terrain(dry.kind, terrain.tiles[t]) {
            continue;
        }
        let Some(id) = regions.id_of_tile(t) else { continue };
        let Some(region) = regions.region(id).map(|r| r.kind) else { continue };
        if !fits_region(region) {
            continue;
        }
        let (x, y) = ((t as i32) % size, (t as i32) / size);
        if dry.richness == Richness::Rich && region == RegionKind::Frontier && !near_spot(id, x, y)
        {
            continue;
        }
        let own = u8::from(Some(id) == home) * 2;
        if best.is_some_and(|(rank, _)| rank <= own) {
            continue;
        }
        if taken.contains(&(x, y)) || too_near(x, y) || (onlookers.in_sight)(x, y) {
            continue;
        }
        let rank = own + u8::from(!(onlookers.explored_by)(x, y).is_empty());
        if best.is_none_or(|(b, _)| rank < b) {
            best = Some((rank, (x, y)));
            if rank == 0 {
                break;
            }
        }
    }
    best.map(|(_, at)| at)
}

/// Whether a frontier tile of region `id` lies within `NEW_VEIN_SPOT_REACH` of one of its
/// contested spots (`contested_spots`); only worked out for a rich node.
fn near_spots(size: i32, regions: &Regions, richness: Richness) -> impl Fn(u32, i32, i32) -> bool {
    let reach = NEW_VEIN_SPOT_REACH;
    let spots =
        if richness == Richness::Rich { contested_spots(size, regions) } else { HashMap::new() };
    let cells = ((size + SPOT_CELL - 1) / SPOT_CELL).max(1);
    let mut near_cell = vec![false; (cells * cells) as usize];
    let r = (reach as i32 + SPOT_CELL - 1) / SPOT_CELL + 1;
    for &(sx, sy) in spots.values().flatten() {
        let (cx, cy) = (wrap(sx, size) / SPOT_CELL, wrap(sy, size) / SPOT_CELL);
        for dy in -r..=r {
            for dx in -r..=r {
                let c = (cy + dy).rem_euclid(cells) * cells + (cx + dx).rem_euclid(cells);
                near_cell[c as usize] = true;
            }
        }
    }
    move |id, x, y| {
        near_cell[((y / SPOT_CELL) * cells + x / SPOT_CELL) as usize]
            && spots
                .get(&id)
                .into_iter()
                .flatten()
                .any(|&s| wrap_distance(size, (x, y), s) <= reach)
    }
}

/// Whether a tile lies nearer than `NODE_MIN_SPACING` to a node in the world or waiting to come
/// back, measured as the world generator does, across the map's joins.
fn spacing(world: &WorldState, size: i32) -> impl Fn(i32, i32) -> bool {
    let spacing = NODE_MIN_SPACING as i32;
    let cells = ((size + spacing - 1) / spacing).max(1);
    let mut by_cell: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    for (x, y) in world
        .nodes
        .iter()
        .map(|n| (n.x, n.y))
        .chain(world.waiting_veins.iter().map(|w| (w.node.x, w.node.y)))
    {
        let at = (wrap(x as i32, size), wrap(y as i32, size));
        by_cell.entry((at.0 / spacing, at.1 / spacing)).or_default().push(at);
    }
    move |x, y| {
        let (cx, cy) = (x / spacing, y / spacing);
        let wrapped = |v: i32| v.rem_euclid(size).min((-v).rem_euclid(size));
        let mut near = (-1..=1).flat_map(|dy| (-1..=1).map(move |dx| (dx, dy)));
        near.any(|(dx, dy)| {
            let c = ((cx + dx).rem_euclid(cells), (cy + dy).rem_euclid(cells));
            by_cell
                .get(&c)
                .into_iter()
                .flatten()
                .any(|&(nx, ny)| wrapped(nx - x) < spacing && wrapped(ny - y) < spacing)
        })
    }
}

fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}

/// An id no node has had: `n` and one more than the highest number of any node's id so far.
fn next_node_id(world: &WorldState) -> String {
    let number = |id: &str| id.strip_prefix('n').and_then(|n| n.parse::<u64>().ok()).unwrap_or(0);
    let highest = world
        .nodes
        .iter()
        .map(|n| number(&n.id))
        .chain(world.dry_nodes.iter().map(|d| number(&d.id)))
        .chain(world.waiting_veins.iter().map(|w| number(&w.node.id)))
        .max()
        .unwrap_or(0);
    format!("n{}", highest + 1)
}

/// The Players who explored tile (x, y), by the explored terrain; none without it.
fn explorers(land: Option<&ExploredTerrain>, players: &[u64], x: i32, y: i32) -> Vec<u64> {
    let Some(land) = land else { return Vec::new() };
    players.iter().copied().filter(|&u| land.is_explored(u, x, y)).collect()
}

/// Brings into being the nodes of the tick (`CONTEXT.md`: Running dry): for every node that ran
/// dry and has none yet, a new node of its kind and richness at [`new_vein_tile`], or, with no
/// tile fitting, the same node waiting to come back where it was after `VEIN_RETURN_DAYS`; and
/// the waiting nodes whose day came. Nobody is told: a Player who had explored the tile sees no
/// node there until they see the tile again (`new_veins`).
pub fn step_new_veins(world: &mut WorldState, terrain: &TerrainMap, scratch: &mut Scratch) {
    let due = world.waiting_veins.iter().any(|w| w.back_at <= world.tick);
    let dry: Vec<usize> =
        (0..world.dry_nodes.len()).filter(|&i| world.dry_nodes[i].next.is_none()).collect();
    if !due && dry.is_empty() {
        return;
    }
    let shared = scratch.land.clone();
    let mut land: Option<MutexGuard<'_, ExploredTerrain>> =
        shared.as_ref().map(|l| l.lock().unwrap_or_else(|e| e.into_inner()));
    let players: Vec<u64> = world.realms.iter().map(|r| r.user_id).collect();
    if due {
        let (back, wait): (Vec<WaitingVein>, Vec<WaitingVein>) =
            std::mem::take(&mut world.waiting_veins)
                .into_iter()
                .partition(|w| w.back_at <= world.tick);
        world.waiting_veins = wait;
        for w in back {
            let (x, y) = (w.node.x as i32, w.node.y as i32);
            let unseen = explorers(land.as_deref(), &players, x, y);
            scratch.vein_log.push(format!(
                "the {:?} {:?} vein {} came back where it ran dry, at ({x}, {y})",
                w.node.richness, w.node.kind, w.node.id
            ));
            come_into_being(world, land.as_deref_mut(), w.node, unseen);
        }
    }
    if dry.is_empty() {
        return;
    }
    // The regions never change; the map holds them for as long as the game runs.
    let map = land.as_ref().map(|l| Arc::clone(l.map()));
    let made;
    let regions: &Regions = match &map {
        Some(map) => map.regions(world.seed),
        None => {
            made = Regions::of(world.seed, terrain);
            &made
        }
    };
    // Each Player's eyes, theirs and their allies' (`CONTEXT.md`: Sight).
    let index = world_index(&mut scratch.index, world, terrain.size);
    let eyes: Vec<Arc<Eyes>> =
        world.realms.iter().map(|r| sight_of(world, index, &r.id, None)).collect();
    let in_sight =
        |x: i32, y: i32| eyes.iter().any(|e| e.sees(Spot { x: f64::from(x), y: f64::from(y) }));
    for i in dry {
        let d = world.dry_nodes[i].clone();
        let tile = {
            let explored = |x: i32, y: i32| explorers(land.as_deref(), &players, x, y);
            let onlookers = Onlookers { in_sight: &in_sight, explored_by: &explored };
            new_vein_tile(world, terrain, regions, &d, &onlookers)
        };
        let id = next_node_id(world);
        let at = tile.unwrap_or((d.x as i32, d.y as i32));
        let mut node = ResourceNode::new(id.clone(), d.kind, f64::from(at.0), f64::from(at.1));
        node.richness = d.richness;
        node.fill_stock();
        world.dry_nodes[i].next = Some(id);
        if tile.is_some() {
            let unseen = explorers(land.as_deref(), &players, at.0, at.1);
            come_into_being(world, land.as_deref_mut(), node, unseen);
        } else {
            let back_at = world.tick + (VEIN_RETURN_DAYS * TICKS_PER_GAME_DAY) as u64;
            scratch.vein_log.push(format!(
                "no tile fits a new {:?} {:?} vein for {} anywhere else: it comes back at ({}, {}) \
                 at tick {back_at}",
                d.richness, d.kind, d.id, d.x, d.y
            ));
            world.waiting_veins.push(WaitingVein { node, back_at });
        }
    }
}

/// Puts `node` into the world and onto the map's terrain, hidden from the Players in `unseen`, who
/// had explored its tile before it was there.
fn come_into_being(
    world: &mut WorldState,
    land: Option<&mut ExploredTerrain>,
    node: ResourceNode,
    unseen: Vec<u64>,
) {
    let (x, y) = (node.x as i32, node.y as i32);
    if let Some(land) = land {
        for &u in &unseen {
            land.hide_node(u, x, y);
        }
        land.map().add_node(&node);
    }
    if !unseen.is_empty() {
        world.new_veins.push(NewVein {
            id: node.id.clone(),
            x: node.x,
            y: node.y,
            unseen_by: unseen,
        });
    }
    world.nodes.push(node);
}

/// Notes that the Player `user_id` sees the tiles of the new nodes their `eyes` see, so those show
/// on their map from now on (`CONTEXT.md`: Running dry). Returns the tiles they found.
pub fn see_new_veins(world: &mut WorldState, user_id: u64, eyes: &Eyes) -> Vec<(i32, i32)> {
    let mut found = Vec::new();
    for v in &mut world.new_veins {
        if v.unseen_by.contains(&user_id) && eyes.sees(Spot { x: v.x, y: v.y }) {
            v.unseen_by.retain(|&u| u != user_id);
            found.push((v.x as i32, v.y as i32));
        }
    }
    if !found.is_empty() {
        world.new_veins.retain(|v| !v.unseen_by.is_empty());
    }
    found
}

/// Shows the Players the new nodes they found this tick on their maps (`see_new_veins`): their
/// chunks list the node again, and `found_veins` names the chunks their maps load again.
pub fn reveal_new_veins(scratch: &mut Scratch) {
    let found = std::mem::take(&mut scratch.last_seen.revealed_veins);
    scratch.found_veins.clear();
    let Some(land) = scratch.land.clone() else { return };
    if found.is_empty() {
        return;
    }
    let mut land = land.lock().unwrap_or_else(|e| e.into_inner());
    for (user, x, y) in found {
        if let Some(chunk) = land.reveal_node(user, x, y) {
            scratch.found_veins.push((user, chunk));
        }
    }
}

/// Hides the new nodes from the Players who have not seen them yet, as the world says
/// (`new_veins`): run once, when the explored terrain is loaded.
pub fn hide_new_veins(world: &WorldState, land: &mut ExploredTerrain) {
    for v in &world.new_veins {
        for &u in &v.unseen_by {
            land.hide_node(u, v.x as i32, v.y as i32);
        }
    }
}

/// Whether the Player `user_id` has not yet seen the node `id`, which came into being after they
/// explored its tile (`CONTEXT.md`: Running dry): their map and their scripts leave it out.
pub fn vein_unseen_by(world: &WorldState, id: &str, user_id: u64) -> bool {
    world.new_veins.iter().any(|v| v.id == id && v.unseen_by.contains(&user_id))
}

/// The nodes' count check (`CONTEXT.md`: Running dry; ADR 0004): every node that ran dry is
/// followed by one node of its kind and richness (in the world, waiting to come back, or dry by
/// now itself), none follows two, and no id is had by two nodes; so the nodes of each kind and
/// richness, a waiting one counted, are as many as the world was made with. A node hidden from a
/// Player is in the world.
pub fn veins_counted(world: &WorldState) -> Vec<InvariantViolation> {
    let name = "veins-counted";
    let mut out = Vec::new();
    let mut of: HashMap<&str, (ResourceKind, Richness)> = HashMap::new();
    let all = world
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.kind, n.richness))
        .chain(
            world.waiting_veins.iter().map(|w| (w.node.id.as_str(), w.node.kind, w.node.richness)),
        )
        .chain(world.dry_nodes.iter().map(|d| (d.id.as_str(), d.kind, d.richness)));
    for (id, kind, richness) in all {
        if of.insert(id, (kind, richness)).is_some() {
            out.push(violation(name, format!("node {id} is there twice"), &[id]));
        }
    }
    let mut followers: HashSet<&str> = HashSet::new();
    for d in &world.dry_nodes {
        let Some(next) = d.next.as_deref() else {
            let m = format!("node {} ran dry and none came into being for it", d.id);
            out.push(violation(name, m, &[&d.id]));
            continue;
        };
        if !followers.insert(next) {
            out.push(violation(name, format!("node {next} came into being for two"), &[next]));
        }
        if of.get(next) != Some(&(d.kind, d.richness)) {
            let m = format!(
                "node {} ran dry but {next} is no {:?} {:?} node",
                d.id, d.richness, d.kind
            );
            out.push(violation(name, m, &[&d.id]));
        }
    }
    for v in &world.new_veins {
        if !world.nodes.iter().any(|n| n.id == v.id) {
            out.push(violation(name, format!("hidden node {} is not there", v.id), &[&v.id]));
        }
    }
    out
}
