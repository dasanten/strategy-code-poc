//! The Region map of `packages/shared/src/region-map.ts` (`CONTEXT.md`: Region map): territory
//! over a Player's explored terrain, by holder, as the server sends it.

use csp_shared::chunks::{chunks_across, CHUNK_SIZE};
use csp_shared::world::WorldState;
use indexmap::IndexMap;
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

/// An Organization holding territory on the Region map (`RegionHolder`), with the tiles it holds
/// in what this update covers, as `y * size + x`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct RegionHolder {
    pub id: String,
    pub name: String,
    pub alliance: Option<RegionAlliance>,
    pub tiles: Vec<usize>,
}

/// The Region map, or the chunks of it in `chunks` (`RegionMap`); `chunks` None replaces the whole.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct RegionMap {
    pub tick: u64,
    pub chunks: Option<Vec<i32>>,
    pub holders: Vec<RegionHolder>,
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

/// The Region map a Player sees (`regionMapFor`): the territory on the tiles they explored, by
/// holder, with each realm's alliance. With `chunks`, only the tiles in those chunks.
pub fn region_map_for(
    world: &WorldState,
    territory: &Territory,
    size: i32,
    is_explored: &dyn Fn(i32, i32) -> bool,
    chunks: Option<Vec<i32>>,
) -> RegionMap {
    let mut tiles: IndexMap<String, Vec<usize>> = IndexMap::new();
    let mut add = |owner: &str, x: i32, y: i32| {
        if is_explored(x, y) {
            tiles.entry(owner.to_string()).or_default().push((y * size + x) as usize);
        }
    };
    match &chunks {
        None => {
            for (&i, owner) in &territory.owners {
                let i = i as i32;
                add(owner, i % size, i / size);
            }
        }
        Some(chunks) => {
            let across = chunks_across(size);
            for c in chunks {
                let (x0, y0) = ((c % across) * CHUNK_SIZE, (c / across) * CHUNK_SIZE);
                for y in y0..size.min(y0 + CHUNK_SIZE) {
                    for x in x0..size.min(x0 + CHUNK_SIZE) {
                        if let Some(owner) = territory.owners.get(&((y * size + x) as usize)) {
                            add(owner, x, y);
                        }
                    }
                }
            }
        }
    }
    let mut holders: Vec<RegionHolder> = tiles
        .into_iter()
        .map(|(id, mut held)| {
            held.sort_unstable();
            let alliance = alliance_of(world, &id)
                .map(|a| RegionAlliance { id: a.id.clone(), name: a.name.clone() });
            RegionHolder { name: organization_name(world, &id), id, alliance, tiles: held }
        })
        .collect();
    holders.sort_by(|a, b| locale_compare(&a.id, &b.id));
    RegionMap { tick: territory.tick, chunks, holders }
}
