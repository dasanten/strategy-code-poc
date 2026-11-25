//! The land: terrain, regions, islands, resource nodes, veins and starting sites.

use serde::Serialize;
use serde_json::{json, Map, Value};

use super::*;
use crate::terrain::Terrain;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainShares {
    /// Inland water, a few scattered lakes, as a share of the mainland (lakes included).
    pub lake: f64,
    /// In ranges.
    pub mountain: f64,
    /// Mostly around the ranges.
    pub hills: f64,
    pub forest: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandRadius {
    /// Share of the map's side.
    pub min: f64,
    /// Share of the map's side.
    pub max: f64,
    /// Tiles, at least, whatever the map's size: room for a haven and a mine or two.
    pub min_tiles: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionTerrain {
    pub mountain: f64,
    pub hills: f64,
    pub forest: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDensity {
    pub forest: TerrainTable,
    pub stone: TerrainTable,
    pub iron_ore: TerrainTable,
    pub gold_ore: TerrainTable,
    /// Only outside a heartland (`CONTEXT.md`: Rare goods): `place_resource_nodes_by_region`
    /// places none there.
    pub coal: TerrainTable,
}

/// What a worker's output is multiplied by on a node of each richness (`CONTEXT.md`: Richness).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct RichnessFactor {
    pub poor: f64,
    pub normal: f64,
    pub rich: f64,
}

/// The shape of `VEIN_CREW_DAYS`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct VeinCrewDays {
    pub normal: f64,
    pub rich: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartingSiteWalk {
    /// Real minutes an unloaded walk from a starting site to the nearest other one takes, at least.
    pub min_minutes: f64,
    /// And at most.
    pub max_minutes: f64,
    /// How far a site is placed from the nearest other one, in tiles, straight, at least: a little
    /// over the shortest walk on Plains (a Plains tile takes `WALK_TICKS_PER_TILE` seconds).
    pub min_tiles: f64,
    /// And at most, so the walk over Forest and round lakes still fits.
    pub max_tiles: f64,
}

balance! {
/// Tiles along each side of the map: once around is a ~12 h walk at ~7.5 s per plains tile.
pub const MAP_SIZE: i32 = 5760;

/// Share of the land's tiles (the mainland and the islands, `CONTEXT.md`: The land) each terrain
/// covers in a freshly generated map. Plains take the rest; the Sea is everything off the land
/// (`MAINLAND_SHARE`, `ISLAND_COUNT`). The generator hits these closely; the map test checks them.
pub const TERRAIN_SHARES: TerrainShares =
    TerrainShares { lake: 0.03, mountain: 0.08, hills: 0.15, forest: 0.28 };

/// Share of the map's tiles the mainland covers (`CONTEXT.md`: The land): one joined land in the
/// middle of the map with Sea all around, so the map's joins cross only water. A little less than
/// half the map, so its coast stays well clear of the joins and islands fit off it.
pub const MAINLAND_SHARE: f64 = 0.42;

/// How much longer the mainland is than wide, at most: each seed picks a stretch up to this and a
/// direction, so mainlands differ in shape before their coasts are made ragged.
pub const MAINLAND_STRETCH: f64 = 1.2;

/// Share of the map's side kept Sea along each of the map's joins: no land within it.
pub const JOIN_SEA_SHARE: f64 = 0.03;

/// Islands the generator tries to place off the mainland's coast (`CONTEXT.md`: Island); on a
/// small map fewer fit.
pub const ISLAND_COUNT: f64 = 12.0;

/// How far an island reaches from its middle before its coast is made ragged: each island picks a
/// radius between `min` and `max`, small ones more often. On a full-size map about 35 to 170
/// tiles: from a rock with room for a haven and a mine to an island that holds a city.
pub const ISLAND_RADIUS: IslandRadius = IslandRadius { min: 0.006, max: 0.03, min_tiles: 6.0 };

/// The narrowest strait (`CONTEXT.md`: Island): at least this many tiles of water lie between an
/// island and the mainland, and between two islands, so no walk reaches one; a short row.
pub const NARROWEST_STRAIT: i32 = 16;

/// Share of the map's side an island lies from the mainland, at most (about 350 tiles on a
/// full-size map): near enough that a boat reaches it from the coast.
pub const ISLAND_OFFSHORE_SHARE: f64 = 0.06;

/// Heartlands on the mainland (`CONTEXT.md`: Heartland, Region): good farmland where Players
/// start, in the middle of the mainland, none touching another where that can be helped.
pub const HEARTLAND_COUNT: f64 = 3.0;

/// Frontier regions on the mainland (`CONTEXT.md`: Frontier): the rest of the mainland, cut into
/// regions of roughly even size with the heartlands (about 1,100 tiles across on a full-size map).
pub const FRONTIER_REGION_COUNT: f64 = 9.0;

/// Below this share of `MAP_SIZE`'s side a map is a small test world (`CONTEXT.md`: Creative mode,
/// Test worlds; under 864 tiles across): made by the same generator, with fewer regions
/// (`SMALL_WORLD_HEARTLANDS`, `SMALL_WORLD_FRONTIERS`) and its NPC cities and trading posts closer
/// together, so each region keeps room for a city.
pub const SMALL_WORLD_SHARE: f64 = 0.15;

/// The narrowest small test world, in tiles (`SMALL_WORLD_SHARE`): below it the Trade Org HQ's
/// wide square seldom finds room on the frontier. Narrower maps are only made by tests, which keep
/// the full region counts.
pub const SMALL_WORLD_MIN_SIZE: i32 = 640;

/// Heartlands on a small test world's mainland (`SMALL_WORLD_SHARE`).
pub const SMALL_WORLD_HEARTLANDS: f64 = 1.0;

/// Frontier regions on a small test world's mainland (`SMALL_WORLD_SHARE`).
pub const SMALL_WORLD_FRONTIERS: f64 = 3.0;

/// How wide the Mountain range or arm of the Sea along a border between two mainland regions is,
/// in tiles, both sides together (`CONTEXT.md`: Region). A smaller map gets a narrower one.
pub const REGION_BORDER_WIDTH: i32 = 12;

/// How wide a pass or a land bridge is along its border, in tiles (`CONTEXT.md`: Region): room for
/// a carriage, and for a realm to hold it. A smaller map gets a narrower one.
pub const PASS_WIDTH: i32 = 8;

/// Share of the borders between two mainland regions that are arms of the Sea rather than
/// Mountain ranges (`CONTEXT.md`: Region): crossed by land bridges instead of passes. Only a
/// border that reaches the coast can be one; the rest of an arm, cut off from the open Sea, is a
/// range. So about this share of the borders that reach the coast are arms.
pub const SEA_ARM_SHARE: f64 = 0.6;

/// Share of the borders between two mainland regions with two ways through instead of one.
pub const SECOND_WAY_SHARE: f64 = 0.4;

/// Share of a heartland's land each terrain covers before its borders are raised (`CONTEXT.md`:
/// Heartland): mostly Plains, with some Forest and Hills. The rest of the land makes up the
/// `TERRAIN_SHARES` of the whole, so frontier regions and islands have more Hills and Mountain.
/// The Mountain range along a border comes on top.
pub const HEARTLAND_TERRAIN: RegionTerrain =
    RegionTerrain { mountain: 0.01, hills: 0.08, forest: 0.18 };

/// Groves in a heartland (`CONTEXT.md`: Heartland, Starting site; Epic 113): a heartland's Forest
/// lies in wide patches, so on a grid of this many tiles a small grove of Forest grows on Plains
/// wherever no Forest lies within `HEARTLAND_GROVE_GAP`. So Forest is never far, and every starting
/// site can have its forest node within `STARTING_SITE_FOREST_REACH`.
pub const HEARTLAND_GROVE_SPACING: f64 = 64.0;

/// Tiles from a grove's middle to its edge: a disc of about 13 tiles of Forest.
pub const HEARTLAND_GROVE_RADIUS: f64 = 2.0;

/// A grove grows only where no Forest lies within this many tiles of it: near enough that every
/// starting site finds Forest within `STARTING_SITE_FOREST_REACH`, far enough that the Plains
/// between groves still hold a trading post's or NPC village's all-Plains square.
pub const HEARTLAND_GROVE_GAP: f64 = 28.0;

/// How much higher an island's land lies than a frontier region's: the generator's relief on an
/// island is multiplied by this before Mountain and Hills are cut (`CONTEXT.md`: Island).
pub const ISLAND_RELIEF: f64 = 1.25;

/// Resource nodes per tile of each terrain they lie on, when the world is created: as many per
/// area as on the old 40 m grid, so a sixteenth per tile. Ore is denser in Mountain than in Hills;
/// gold is rare. Coal is about as common as iron ore, a little more of it in Hills.
pub const NODE_DENSITY: NodeDensity = NodeDensity {
    forest: TerrainTable(&[(Terrain::Forest as u8, 1.0 / 4800.0)]),
    stone: TerrainTable(&[(Terrain::Hills as u8, 1.0 / 4000.0)]),
    iron_ore: TerrainTable(&[
        (Terrain::Hills as u8, 1.0 / 24000.0),
        (Terrain::Mountain as u8, 1.0 / 4800.0),
    ]),
    gold_ore: TerrainTable(&[
        (Terrain::Hills as u8, 1.0 / 240000.0),
        (Terrain::Mountain as u8, 1.0 / 48000.0),
    ]),
    coal: TerrainTable(&[
        (Terrain::Hills as u8, 1.0 / 16000.0),
        (Terrain::Mountain as u8, 1.0 / 4800.0),
    ]),
};

/// No two resource nodes lie closer than this many tiles (in either direction).
pub const NODE_MIN_SPACING: f64 = 16.0;

/// How many times `NODE_DENSITY` a frontier region holds (`CONTEXT.md`: Frontier): more nodes than
/// a heartland, worth going out for.
pub const FRONTIER_NODE_DENSITY: f64 = 1.5;

/// How many times `NODE_DENSITY` an island holds (`CONTEXT.md`: Island): the densest land.
pub const ISLAND_NODE_DENSITY: f64 = 2.0;

/// A mine's, quarry's or lumber camp's output per worker on a poor, normal and rich node
/// (`CONTEXT.md`: Richness): a heartland's poor nodes make well under a frontier's, an island's
/// rich ones half again as much.
pub const RICHNESS_FACTOR: RichnessFactor = RichnessFactor { poor: 0.6, normal: 1.0, rich: 1.5 };

/// How many of a frontier region's nodes are rich (`CONTEXT.md`: Richness): those nearest its
/// passes, land bridges and borders with other frontier regions.
pub const FRONTIER_RICH_NODES: f64 = 3.0;

/// How much farther a richer node may lie than a poorer one and still be picked by an NPC city or
/// the Trade Organization (`CONTEXT.md`: Richness): each richness step counts as this share of
/// the distance.
pub const RICHER_NODE_REACH: f64 = 0.25;

/// How many times its region's density gold ore has in the frontier and on islands
/// (`CONTEXT.md`: Rare goods): it has no nodes in a heartland, so the land out there holds more.
pub const GOLD_NODE_DENSITY: f64 = 2.0;

/// How many game days a full crew of average workers (Strength `WORK_STRENGTH_AVERAGE`, no
/// skill) takes to empty a normal and a rich vein (`CONTEXT.md`: Running dry): a real week is 420
/// game days, so three real weeks for a rich vein and two for a normal one. A skilled crew empties
/// it in down to half that.
pub const VEIN_CREW_DAYS: VeinCrewDays = VeinCrewDays { normal: 840.0, rich: 1260.0 };

/// `vein_stock` of every ore node kind, normal and rich, as the client reads it (the Wiki).
export VEIN_STOCK = vein_stock_json();

/// How a vein stands for whoever works it (`CONTEXT.md`: Running dry), from the share of its
/// first stock that is left: "thinning" at or below `VEIN_THINNING`, "nearly gone" at or below
/// `VEIN_NEARLY_GONE`, "plenty" above. A full crew of average workers on a rich vein so has about
/// 190 game days (three real days) of warning before it runs dry.
pub const VEIN_THINNING: f64 = 0.5;

pub const VEIN_NEARLY_GONE: f64 = 0.15;

/// How far, in tiles, from a pass, a land bridge or a border with another frontier region a rich
/// node that comes into being in the frontier lies at most (`CONTEXT.md`: Running dry, Richness):
/// a spot worth fighting over, as the frontier's rich nodes are at generation.
pub const NEW_VEIN_SPOT_REACH: f64 = 32.0;

/// How many game days a node that ran dry waits to come back where it was, when no fitting tile
/// for it is found anywhere else (`CONTEXT.md`: Running dry; a tiny map). About a real hour.
pub const VEIN_RETURN_DAYS: f64 = 2.5;

/// Starting sites in each heartland (`CONTEXT.md`: Starting site): room for this many Players'
/// starting cities before the next heartland opens.
pub const STARTING_SITES_PER_HEARTLAND: f64 = 10.0;

/// How far a starting site lies from the nearest other one (`CONTEXT.md`: Starting site): a walk
/// of 20 to 40 real minutes, placed 170 to 300 tiles apart straight. A smaller map scales the tiles and
/// the minutes with its side.
pub const STARTING_SITE_WALK: StartingSiteWalk =
    StartingSiteWalk { min_minutes: 20.0, max_minutes: 40.0, min_tiles: 170.0, max_tiles: 300.0 };

/// How far a starting site's middle lies from every pass and land bridge of its heartland, at
/// least, in tiles (about 20 minutes' walk): the way in is nobody's doorstep.
pub const STARTING_SITE_WAY_DISTANCE: f64 = 120.0;

/// How far from a starting site's middle its stone and iron node lie, at most, in tiles (about 15
/// minutes' walk; Hills and Forest lie a median 80 to 100 tiles from a heartland's Plains). Where
/// the land holds none that near, one is placed. The same on a map of any size.
pub const STARTING_SITE_NODE_REACH: f64 = 160.0;

/// How far from a starting site's middle its forest node lies, at most, in tiles (`CONTEXT.md`:
/// Starting site; Epic 113): a short walk, about 5 minutes on Plains, so a new Player has Wood
/// close by. A site is only picked where Forest lies that near, and a forest node is placed on it
/// where none is. The same on a map of any size.
pub const STARTING_SITE_FOREST_REACH: f64 = 40.0;

/// How fast an unloaded resident crosses each terrain, relative to Plains (`CONTEXT.md`:
/// Terrain). Agility softens the penalty (`walkSpeed`).
pub const TERRAIN_SPEED: TerrainTable = TerrainTable(&[
    (Terrain::Plains as u8, 1.0),
    (Terrain::Forest as u8, 0.7),
    (Terrain::Hills as u8, 0.7),
    (Terrain::Mountain as u8, 0.35),
    // A road, whatever the terrain beneath (`CONTEXT.md`: Road).
    (Terrain::Road as u8, 1.3),
]);
}

/// Whether a map of `size` tiles across is a small test world (`SMALL_WORLD_SHARE`,
/// `SMALL_WORLD_MIN_SIZE`).
pub fn is_small_world(size: i32) -> bool {
    size >= SMALL_WORLD_MIN_SIZE && f64::from(size) < SMALL_WORLD_SHARE * f64::from(MAP_SIZE)
}

/// The stock a node of `kind` and `richness` comes into being with (`CONTEXT.md`: Running dry):
/// what a full crew of average workers makes there in `VEIN_CREW_DAYS`. None for a node that
/// never runs dry (forest, stone, a poor node).
pub fn vein_stock(
    kind: crate::world::ResourceKind,
    richness: crate::world::Richness,
) -> Option<f64> {
    use crate::world::{ResourceKind, Richness};
    let good = match kind {
        ResourceKind::IronOre => "ironOre",
        ResourceKind::GoldOre => "goldOre",
        ResourceKind::Coal => "coal",
        ResourceKind::Forest | ResourceKind::Stone => return None,
    };
    let days = match richness {
        Richness::Poor => return None,
        Richness::Normal => VEIN_CREW_DAYS.normal,
        Richness::Rich => VEIN_CREW_DAYS.rich,
    };
    let per_day = WORK_OUTPUT_PER_DAY.get(good)? * richness.factor();
    Some((per_day * WORKPLACE_MAX_WORKERS.get("mine")? * days).round())
}

/// `vein_stock` of every ore node kind, normal and rich, as the client reads it (the Wiki).
fn vein_stock_json() -> Value {
    use crate::world::{ResourceKind, Richness};
    let mut m = Map::new();
    for (name, kind) in [
        ("ironOre", ResourceKind::IronOre),
        ("goldOre", ResourceKind::GoldOre),
        ("coal", ResourceKind::Coal),
    ] {
        m.insert(
            name.into(),
            json!({
                "normal": vein_stock(kind, Richness::Normal),
                "rich": vein_stock(kind, Richness::Rich),
            }),
        );
    }
    Value::Object(m)
}
