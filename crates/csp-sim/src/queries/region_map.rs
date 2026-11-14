//! The Region map (`CONTEXT.md`: Region map): territory over a Player's explored terrain, by
//! holder, as the server sends it. It travels per chunk as runs of one holder along the rows, and
//! after the first copy only the chunks where it changed (ADR 0034).

use std::collections::{BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};

use csp_shared::chunks::{chunks_across, CHUNK_SIZE};
use csp_shared::world::WorldState;
use serde::Serialize;
use ts_rs::TS;

use super::alliance::alliance_of;
use super::npc_trade::locale_compare;
use super::territory::{Territory, TRADE_ORGANIZATION};
use crate::queries::alliance::realm_name;
use crate::queries::standing::TRADE_ORG_NAME;

/// An alliance a holder shows as part of.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct RegionAlliance {
    pub id: String,
    pub name: String,
}

/// An Organization holding territory on the Region map (`RegionHolder`).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct RegionHolder {
    pub id: String,
    pub name: String,
    pub alliance: Option<RegionAlliance>,
}

/// One chunk of the Region map as a Player may see it. Its tiles, row by row within the chunk
/// (`CHUNK_SIZE` across, fewer at the map's edge), go as runs `[length, holder, length, holder,
/// …]`: `holder` is an index into the update's `holders`, or -1 for nobody. Tiles after the last
/// run are held by nobody.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct RegionChunk {
    pub chunk: i32,
    pub runs: Vec<i32>,
}

/// A Region map update (`RegionMap`). `whole` replaces the client's copy with these chunks;
/// otherwise each chunk in `chunks` replaces that chunk, and each in `gone` lost all its
/// territory. `holders` lists, once, every holder the runs name, and any holder whose name or
/// alliance changed.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct RegionMap {
    /// The tick the territory was worked out at.
    pub tick: u64,
    pub whole: bool,
    pub holders: Vec<RegionHolder>,
    pub chunks: Vec<RegionChunk>,
    pub gone: Vec<i32>,
}

/// How an Organization is called on the Region map (`organizationName`): a realm by its realm
/// name, a city by its name, the Trade Organization by its own.
pub fn organization_name(world: &WorldState, org_id: &str) -> String {
    if org_id == TRADE_ORGANIZATION {
        return TRADE_ORG_NAME.to_string();
    }
    if world.realms.iter().any(|r| r.id == org_id) {
        return realm_name(world, org_id);
    }
    world
        .cities
        .iter()
        .find(|c| c.id == org_id)
        .map_or_else(|| "a lost city".to_string(), |c| c.name.clone())
}

/// A holder as the Region map shows it: its name and its alliance.
fn holder_of(world: &WorldState, id: &str) -> RegionHolder {
    let alliance =
        alliance_of(world, id).map(|a| RegionAlliance { id: a.id.clone(), name: a.name.clone() });
    RegionHolder { id: id.to_string(), name: organization_name(world, id), alliance }
}

/// The corner and the width and height of a chunk, clipped to the map.
pub(crate) fn chunk_box(chunk: i32, size: i32) -> (i32, i32, i32, i32) {
    let across = chunks_across(size);
    let (x0, y0) = ((chunk % across) * CHUNK_SIZE, (chunk / across) * CHUNK_SIZE);
    (x0, y0, CHUNK_SIZE.min(size - x0), CHUNK_SIZE.min(size - y0))
}

/// One working-out of territory sorted by chunk, worked out once for every client: each chunk's
/// held tiles, a signature of each chunk's territory to find what changed, and every holder as
/// the Region map shows it.
pub struct RegionIndex {
    pub tick: u64,
    size: i32,
    /// Every holder, by slot.
    holders: Vec<RegionHolder>,
    slots: HashMap<String, u32>,
    /// Each chunk's held tiles, as (index within the chunk row by row, holder slot), in order.
    chunks: HashMap<i32, Vec<(u16, u32)>>,
    /// A signature of each chunk's territory, holders by id.
    signatures: HashMap<i32, u64>,
}

impl RegionIndex {
    pub fn new(world: &WorldState, territory: &Territory, size: i32) -> Self {
        let mut holders: Vec<RegionHolder> = Vec::new();
        let mut slots: HashMap<String, u32> = HashMap::new();
        let mut chunks: HashMap<i32, Vec<(u16, u32)>> = HashMap::new();
        let across = chunks_across(size);
        for (&tile, owner) in &territory.owners {
            let slot = *slots.entry(owner.clone()).or_insert_with(|| {
                holders.push(holder_of(world, owner));
                (holders.len() - 1) as u32
            });
            let (x, y) = ((tile as i32) % size, (tile as i32) / size);
            let chunk = (y / CHUNK_SIZE) * across + x / CHUNK_SIZE;
            let (x0, y0, w, _) = chunk_box(chunk, size);
            chunks.entry(chunk).or_default().push((((y - y0) * w + (x - x0)) as u16, slot));
        }
        let mut signatures = HashMap::with_capacity(chunks.len());
        for (&chunk, tiles) in &mut chunks {
            tiles.sort_unstable();
            let mut h = DefaultHasher::new();
            for &(at, slot) in tiles.iter() {
                (at, &holders[slot as usize].id).hash(&mut h);
            }
            signatures.insert(chunk, h.finish());
        }
        RegionIndex { tick: territory.tick, size, holders, slots, chunks, signatures }
    }

    /// The chunks whose territory differs from `before`'s: changed, new or gone.
    pub fn changed_since(&self, before: &RegionIndex) -> BTreeSet<i32> {
        let mut out: BTreeSet<i32> = self
            .signatures
            .iter()
            .filter(|(c, sig)| before.signatures.get(c) != Some(sig))
            .map(|(&c, _)| c)
            .collect();
        out.extend(before.signatures.keys().filter(|c| !self.signatures.contains_key(c)));
        out
    }

    /// The runs of one chunk a Player may see: (length, holder slot or none), the last one held.
    /// Empty when they see no territory there.
    fn visible_runs(
        &self,
        chunk: i32,
        is_explored: &dyn Fn(i32, i32) -> bool,
    ) -> Vec<(u32, Option<u32>)> {
        let Some(tiles) = self.chunks.get(&chunk) else { return Vec::new() };
        let (x0, y0, w, _) = chunk_box(chunk, self.size);
        let mut runs: Vec<(u32, Option<u32>)> = Vec::new();
        let mut at = 0u32;
        for &(i, slot) in tiles {
            let (x, y) = (x0 + i32::from(i) % w, y0 + i32::from(i) / w);
            if !is_explored(x, y) {
                continue;
            }
            let i = u32::from(i);
            if i > at {
                runs.push((i - at, None));
            }
            match runs.last_mut() {
                Some((len, Some(s))) if *s == slot => *len += 1,
                _ => runs.push((1, Some(slot))),
            }
            at = i + 1;
        }
        runs
    }
}

/// What one client was last sent of the Region map: the territory's tick, a signature of each
/// chunk as they saw it, and each holder as they know it.
#[derive(Debug, Default)]
pub struct RegionSent {
    tick: Option<u64>,
    chunks: HashMap<i32, u64>,
    holders: HashMap<String, RegionHolder>,
}

impl RegionSent {
    /// The territory's tick the last update was of; none before the first.
    pub fn tick(&self) -> Option<u64> {
        self.tick
    }
}

/// What changed between the client's last territory and `index`: the territory's tick it changed
/// from, and the chunks that changed.
pub struct RegionChanges<'a> {
    pub from: u64,
    pub chunks: &'a BTreeSet<i32>,
}

/// The Region map update a client is due, if any (`regionFor`). Their first one is whole: every
/// chunk with territory they may see. After that, only the chunks where what they may see differs
/// from what they were sent, among those `changes` names (when it starts from their last
/// territory) and `grown`, where their explored terrain grew; chunks whose territory they no
/// longer see are named as gone. None when nothing they may see changed.
pub fn region_update(
    index: &RegionIndex,
    changes: Option<RegionChanges<'_>>,
    grown: &[i32],
    sent: &mut RegionSent,
    is_explored: &dyn Fn(i32, i32) -> bool,
) -> Option<RegionMap> {
    let whole = sent.tick.is_none();
    let fresh = sent.tick != Some(index.tick);
    if !fresh && grown.is_empty() {
        return None;
    }
    let mut candidates: BTreeSet<i32> = grown.iter().copied().collect();
    if whole {
        candidates.extend(index.chunks.keys());
        sent.chunks.clear();
        sent.holders.clear();
    } else if fresh {
        match changes {
            Some(c) if Some(c.from) == sent.tick => candidates.extend(c.chunks),
            // The client missed a working-out: compare all it holds and all there is.
            _ => {
                candidates.extend(sent.chunks.keys());
                candidates.extend(index.chunks.keys());
            }
        }
    }
    let mut out = RegionMap {
        tick: index.tick,
        whole,
        holders: Vec::new(),
        chunks: Vec::new(),
        gone: Vec::new(),
    };
    let mut named: HashMap<u32, i32> = HashMap::new();
    let mut name = |slot: u32, holders: &mut Vec<RegionHolder>| {
        *named.entry(slot).or_insert_with(|| {
            holders.push(index.holders[slot as usize].clone());
            (holders.len() - 1) as i32
        })
    };
    for chunk in candidates {
        let runs = index.visible_runs(chunk, is_explored);
        if runs.is_empty() {
            if sent.chunks.remove(&chunk).is_some() {
                out.gone.push(chunk);
            }
            continue;
        }
        let mut h = DefaultHasher::new();
        for &(len, slot) in &runs {
            (len, slot.map(|s| &index.holders[s as usize].id)).hash(&mut h);
        }
        let signature = h.finish();
        if sent.chunks.insert(chunk, signature) == Some(signature) {
            continue;
        }
        let mut encoded = Vec::with_capacity(runs.len() * 2);
        for (len, slot) in runs {
            encoded.push(len as i32);
            encoded.push(slot.map_or(-1, |s| name(s, &mut out.holders)));
        }
        out.chunks.push(RegionChunk { chunk, runs: encoded });
    }
    // A holder the client knows that was renamed or changed alliance, though its tiles did not.
    if fresh && !whole {
        let mut renamed: Vec<u32> = sent
            .holders
            .iter()
            .filter_map(|(id, known)| {
                let slot = *index.slots.get(id)?;
                (index.holders[slot as usize] != *known).then_some(slot)
            })
            .collect();
        renamed.sort_unstable();
        for slot in renamed {
            name(slot, &mut out.holders);
        }
    }
    for h in &out.holders {
        sent.holders.insert(h.id.clone(), h.clone());
    }
    sent.tick = Some(index.tick);
    if !whole && out.chunks.is_empty() && out.gone.is_empty() && out.holders.is_empty() {
        return None;
    }
    Some(by_holder_id(out))
}

/// The update with its holders in order of id, and the runs numbering them in that order.
fn by_holder_id(mut map: RegionMap) -> RegionMap {
    let mut order: Vec<usize> = (0..map.holders.len()).collect();
    order.sort_by(|&a, &b| locale_compare(&map.holders[a].id, &map.holders[b].id));
    let mut new_index = vec![0i32; order.len()];
    for (new, &old) in order.iter().enumerate() {
        new_index[old] = new as i32;
    }
    for c in &mut map.chunks {
        for holder in c.runs.iter_mut().skip(1).step_by(2) {
            if *holder >= 0 {
                *holder = new_index[*holder as usize];
            }
        }
    }
    let mut holders: Vec<Option<RegionHolder>> = map.holders.into_iter().map(Some).collect();
    map.holders = order.iter().map(|&old| holders[old].take().expect("each once")).collect();
    map
}

/// The whole Region map a Player sees (`regionMapFor`): every chunk with territory on the tiles
/// they explored.
pub fn region_map_for(
    world: &WorldState,
    territory: &Territory,
    size: i32,
    is_explored: &dyn Fn(i32, i32) -> bool,
) -> RegionMap {
    let index = RegionIndex::new(world, territory, size);
    region_update(&index, None, &[], &mut RegionSent::default(), is_explored)
        .expect("a first update is always sent")
}

/// Every tile an update names, as (tile `y * size + x`, holder index or -1 for nobody), chunk by
/// chunk; and what is wrong with its runs: one running past its chunk, or a holder index the
/// update does not list.
pub fn region_tiles(region: &RegionMap, size: i32) -> (Vec<(usize, i32)>, Vec<String>) {
    let mut tiles = Vec::new();
    let mut problems = Vec::new();
    for c in &region.chunks {
        let (x0, y0, w, h) = chunk_box(c.chunk, size);
        let mut at = 0i32;
        for pair in c.runs.chunks(2) {
            let (len, holder) = (pair[0], pair.get(1).copied().unwrap_or(-1));
            if holder < -1 || holder >= region.holders.len() as i32 {
                problems.push(format!(
                    "chunk {} names holder {holder}, which it does not list",
                    c.chunk
                ));
            }
            for i in at..at + len {
                if i >= w * h {
                    problems.push(format!("chunk {} runs past its {} tiles", c.chunk, w * h));
                    break;
                }
                let (x, y) = (x0 + i % w, y0 + i / w);
                tiles.push(((y * size + x) as usize, holder));
            }
            at += len;
        }
    }
    (tiles, problems)
}
