//! Lookups the server builds once a tick instead of scanning the world's lists inside
//! per-resident and per-action loops (`apps/server/src/world-index.ts`, Epic 49). Scratch memory
//! like the pathfinder's: never saved, never world state (ADR 0006). Each lookup gives the same
//! answer as the scan it replaces.
//!
//! The index holds no reference to the world (ADR 0030: no entity holds a reference to another),
//! only positions in its lists, so the tick can keep it while it changes the world: every lookup
//! takes the world, and an id lookup checks the id at the position it remembers, scanning when
//! the list has changed under it. What it was built from is its [`Revision`]; the tick builds a
//! new index when that changes ([`world_index`]), as `worldIndex` does in the TypeScript.

use std::cell::{OnceCell, RefCell};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use csp_shared::footprint::footprint_tiles;
use csp_shared::terrain::tile_index;
use csp_shared::world::{Building, Carriage, Horse, Resident, WorldState};

use crate::queries::building::{road_tiles, SHARES_A_TILE};
use crate::queries::names::placed;

/// What an index was built from (`revisionOf`): the tick, the length of each list it reads, and
/// each alliance's leader and army and each contract's hirer, residents and start. The
/// TypeScript also notices a list replaced by one of the same length (by identity); a step that
/// filters a list here and pushes to it within the same tick builds the index again itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Revision(u64);

impl Revision {
    /// The world's revision now.
    pub fn of(world: &WorldState) -> Self {
        let mut h = DefaultHasher::new();
        world.tick.hash(&mut h);
        for n in [
            world.residents.len(),
            world.buildings.len(),
            world.carriages.len(),
            world.horses.len(),
            world.alliances.len(),
            world.contracts.len(),
        ] {
            n.hash(&mut h);
        }
        for a in &world.alliances {
            a.leader_id.hash(&mut h);
            for p in &a.army {
                p.id.hash(&mut h);
            }
            a.army.len().hash(&mut h);
        }
        for c in &world.contracts {
            c.started_at.map(f64::to_bits).hash(&mut h);
            c.hirer_id.hash(&mut h);
            c.resident_ids.hash(&mut h);
        }
        Revision(h.finish())
    }
}

/// The world's entities by id and by tile, who commands each resident and the finished roads,
/// as of when it was built (`WorldIndex`). Parts are built the first time they are asked for.
#[derive(Debug)]
pub struct WorldIndex {
    size: i32,
    revision: Revision,
    carriages: OnceCell<HashMap<String, usize>>,
    horses: OnceCell<HashMap<String, usize>>,
    commanders: OnceCell<HashMap<String, String>>,
    tiles: OnceCell<HashMap<usize, usize>>,
    roads: RefCell<Option<Rc<HashSet<usize>>>>,
}

/// Positions by id; the first with an id wins, as `find` would.
fn by_id<'a>(ids: impl Iterator<Item = &'a String>) -> HashMap<String, usize> {
    let mut out = HashMap::new();
    for (i, id) in ids.enumerate() {
        out.entry(id.clone()).or_insert(i);
    }
    out
}

/// The item at the remembered position if it still has the id; else, the list having changed
/// under the index or the id being nobody's, the first with it.
fn lookup<'w, T>(
    list: &'w [T],
    positions: &HashMap<String, usize>,
    id: &str,
    id_of: impl Fn(&T) -> &str,
) -> Option<&'w T> {
    match positions.get(id).and_then(|&i| list.get(i)) {
        Some(x) if id_of(x) == id => Some(x),
        _ => list.iter().find(|x| id_of(x) == id),
    }
}

impl WorldIndex {
    /// An index of `world` on a map `size` tiles across, its parts built when first asked for.
    pub fn new(world: &WorldState, size: i32) -> Self {
        WorldIndex {
            size,
            revision: Revision::of(world),
            carriages: OnceCell::new(),
            horses: OnceCell::new(),
            commanders: OnceCell::new(),
            tiles: OnceCell::new(),
            roads: RefCell::new(None),
        }
    }

    /// Whether the world is as the index was built from it (`sameRevision`).
    pub fn is_current(&self, world: &WorldState) -> bool {
        self.revision == Revision::of(world)
    }

    /// The map's size the index was built for.
    pub fn size(&self) -> i32 {
        self.size
    }

    /// The resident with this id (`residentById`): through the positions kept across ticks
    /// ([`resident_index`]), not a map of every id built again each tick (T89.6).
    pub fn resident_by_id<'w>(&self, world: &'w WorldState, id: &str) -> Option<&'w Resident> {
        resident_index(world, id).map(|i| &world.residents[i])
    }

    /// The building with this id (`buildingById`), as [`building_by_id`] finds it.
    pub fn building_by_id<'w>(&self, world: &'w WorldState, id: &str) -> Option<&'w Building> {
        building_by_id(world, id)
    }

    /// The carriage with this id (`carriageById`).
    pub fn carriage_by_id<'w>(&self, world: &'w WorldState, id: &str) -> Option<&'w Carriage> {
        let positions = self.carriages.get_or_init(|| by_id(world.carriages.iter().map(|k| &k.id)));
        lookup(&world.carriages, positions, id, |k| &k.id)
    }

    /// The horse with this id (`horseById`).
    pub fn horse_by_id<'w>(&self, world: &'w WorldState, id: &str) -> Option<&'w Horse> {
        let positions = self.horses.get_or_init(|| by_id(world.horses.iter().map(|h| &h.id)));
        lookup(&world.horses, positions, id, |h| &h.id)
    }

    /// The building standing on (x, y), as `buildingAt` finds it: the first in the world's order
    /// whose footprint covers the tile, roads and carriage sites aside.
    pub fn building_at<'w>(&self, world: &'w WorldState, x: i32, y: i32) -> Option<&'w Building> {
        let size = self.size;
        let tiles = self.tiles.get_or_init(|| {
            let mut tiles = HashMap::new();
            for (i, b) in world.buildings.iter().enumerate() {
                if SHARES_A_TILE.contains(&b.kind) {
                    continue;
                }
                for (tx, ty) in footprint_tiles(placed(b), size) {
                    tiles.entry(tile_index(size, tx, ty)).or_insert(i);
                }
            }
            tiles
        });
        tiles.get(&tile_index(size, x, y)).and_then(|&i| world.buildings.get(i))
    }

    /// The realm whose orders the resident takes, as `commanderOf` answers it: the alliance
    /// leader's while handed over to its army, the hirer's while a started contract rents them
    /// out, their own realm's otherwise. The armies and contracts are gone through once; the
    /// owner is read live.
    pub fn commander_of(
        &self,
        world: &WorldState,
        id: &str,
        owner: Option<&str>,
    ) -> Option<String> {
        self.commander_ref(world, id, owner).map(str::to_string)
    }

    /// [`Self::commander_of`] without copying the id, for a check made of every resident.
    pub fn commander_ref<'a>(
        &'a self,
        world: &WorldState,
        id: &str,
        owner: Option<&'a str>,
    ) -> Option<&'a str> {
        let commanders = self.commanders.get_or_init(|| {
            // An alliance army before a contract, and the first of each, as `commanderOf` finds
            // them.
            let mut commanders = HashMap::new();
            for a in &world.alliances {
                for p in &a.army {
                    commanders.entry(p.id.clone()).or_insert_with(|| a.leader_id.clone());
                }
            }
            for c in &world.contracts {
                if c.started_at.is_some() {
                    for id in &c.resident_ids {
                        commanders.entry(id.clone()).or_insert_with(|| c.hirer_id.clone());
                    }
                }
            }
            commanders
        });
        commanders.get(id).map(String::as_str).or(owner)
    }

    /// The tiles with a finished road, as `roadTiles` gives them. Road sites finish only as the
    /// world resolves building, after everyone has walked, and the tick turns right after:
    /// within one tick the roads asked for before then stay true.
    pub fn roads(&self, world: &WorldState) -> Rc<HashSet<usize>> {
        self.roads.borrow_mut().get_or_insert_with(|| Rc::new(road_tiles(world, self.size))).clone()
    }
}

/// Where each id was last found in one of the world's lists. Scratch like the index above: it
/// holds positions, never the world, and every answer is checked against the list it is asked
/// about, so a list that changed under it, or another world on the same thread, only costs a scan.
#[derive(Default)]
struct Positions {
    at: rustc_hash::FxHashMap<Box<str>, usize>,
}

thread_local! {
    static BUILDING_POSITIONS: RefCell<Positions> = RefCell::default();
    static RESIDENT_POSITIONS: RefCell<Positions> = RefCell::default();
}

/// The position of the item with this id, as `list.iter().position(|x| x.id == id)` finds it
/// (T89.6): the remembered position if the item there still has the id, else the scan, which is
/// then remembered. Ids are unique in each list (they come from `nextId`), so the item at a
/// remembered position with the id is the first with it.
fn position_by_id<T>(
    positions: &'static std::thread::LocalKey<RefCell<Positions>>,
    list: &[T],
    id: &str,
    id_of: impl Fn(&T) -> &str,
) -> Option<usize> {
    positions.with(|p| {
        let mut p = p.borrow_mut();
        if let Some(&i) = p.at.get(id) {
            if list.get(i).is_some_and(|x| id_of(x) == id) {
                return Some(i);
            }
        }
        let i = list.iter().position(|x| id_of(x) == id)?;
        // Ids of what is long gone are let go now and then.
        if p.at.len() > 2 * list.len() + 64 {
            p.at.clear();
        }
        match p.at.get_mut(id) {
            Some(at) => *at = i,
            None => {
                p.at.insert(id.into(), i);
            }
        }
        Some(i)
    })
}

/// Where the building with this id is in `world.buildings`, as scanning for it would find it,
/// without comparing every building's id each time.
pub fn building_index(world: &WorldState, id: &str) -> Option<usize> {
    position_by_id(&BUILDING_POSITIONS, &world.buildings, id, |b| &b.id)
}

/// The building with this id, as `world.buildings.iter().find(|b| b.id == id)` finds it.
pub fn building_by_id<'w>(world: &'w WorldState, id: &str) -> Option<&'w Building> {
    building_index(world, id).map(|i| &world.buildings[i])
}

/// Where the resident with this id is in `world.residents`, as scanning for them would find it.
pub fn resident_index(world: &WorldState, id: &str) -> Option<usize> {
    position_by_id(&RESIDENT_POSITIONS, &world.residents, id, |r| &r.id)
}

/// The world's index, built again only when its revision has changed since it was last built
/// (`worldIndex`), so nobody has to remember to throw it away. `slot` is the tick's scratch.
pub fn world_index<'s>(
    slot: &'s mut Option<WorldIndex>,
    world: &WorldState,
    size: i32,
) -> &'s WorldIndex {
    let stale = slot.as_ref().is_none_or(|i| i.size != size || !i.is_current(world));
    if stale {
        *slot = Some(WorldIndex::new(world, size));
    }
    slot.as_ref().expect("just built")
}
