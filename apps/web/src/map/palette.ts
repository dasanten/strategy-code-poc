import { BUILDING_KINDS, BUILDING_SPECS } from '@csp/balance'
import { Terrain, UNEXPLORED } from '../shared/terrain.js'
import type { BuildingKind, ResourceKind } from '@csp/shared-types'
import { THEME, hex, type Relationship } from '../theme.js'

/** Roads, wide and light over the terrain (ADR 0008). */
export const ROAD_COLOR = hex(THEME.terrain.road)

/** A ruin's painted art, greyed (`CONTEXT.md`: Ruin). */
export const RUIN_TINT = 0x8c8680

/** Terrain colours from the theme (ADR 0008), as 0xRRGGBB. */
export const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Plains]: hex(THEME.terrain.plains),
  [Terrain.Forest]: hex(THEME.terrain.forest),
  [Terrain.Hills]: hex(THEME.terrain.hills),
  [Terrain.Mountain]: hex(THEME.terrain.mountain),
  [Terrain.Lake]: hex(THEME.terrain.lake),
  [Terrain.Sea]: hex(THEME.terrain.sea),
  /** Never in a chunk: roads are drawn over the terrain, in this colour. */
  [Terrain.Road]: ROAD_COLOR,
  [UNEXPLORED]: hex(THEME.terrain.unexplored),
}

/** The small dark marks on the terrain (trees, hill arcs, peaks, waves, tufts), and how strong. */
export const TERRAIN_MARK_COLOR = 0x1f3d17
export const TERRAIN_MARK_ALPHA = 0.5

/** Map background, where nothing is explored. */
export const VOID_COLOR = hex(THEME.terrain.void)

/** Explored chunks on screen that haven't loaded yet (`ChunkStore.waiting`). */
export const LOADING_COLOR = hex(THEME.terrain.loading)

/** Who a token belongs to, seen from the Player (ADR 0008), as 0xRRGGBB. */
export const RELATIONSHIP_COLORS = Object.fromEntries(
  Object.entries(THEME.relationship).map(([k, v]) => [k, hex(v)]),
) as Record<Relationship, number>

export const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Plains]: 'Plains',
  [Terrain.Forest]: 'Forest',
  [Terrain.Hills]: 'Hills',
  [Terrain.Mountain]: 'Mountain',
  [Terrain.Lake]: 'Lake',
  [Terrain.Sea]: 'Sea',
  [Terrain.Road]: 'Road',
  [UNEXPLORED]: 'Unexplored',
}

export const NODE_COLORS: Record<ResourceKind, number> = {
  forest: 0x6fa05a,
  stone: 0xc9c2b0,
  ironOre: 0xb5653e,
  goldOre: 0xe2b93b,
  coal: 0x6e7480,
}

export const NODE_NAMES: Record<ResourceKind, string> = {
  forest: 'Forest node',
  stone: 'Stone',
  ironOre: 'Iron ore',
  goldOre: 'Gold ore',
  coal: 'Coal',
}

/** The selection ring and a selected resident's way. */
export const LEADER_COLOR = RELATIONSHIP_COLORS.own

/** City walls and buildings, from the design. */
export const WALL_COLOR = 0x8a5a2b
/** A city's area, laid faintly over the terrain. */
export const CITY_AREA_COLOR = 0xf2e3b8
export const BUILDING_COLORS: Record<BuildingKind, number> = {
  townHall: 0xd8c08a,
  wall: WALL_COLOR,
  gate: 0xb88a55,
  tower: WALL_COLOR,
  house: 0xc7b391,
  storage: 0x8c6a44,
  warehouse: 0x6e5236,
  farm: 0x9db05f,
  stable: 0xa0703f,
  mine: 0x5e5a57,
  quarry: 0xb3ada3,
  lumberCamp: 0x6b7f3c,
  smelter: 0x9a4a2f,
  kiln: 0x8a3a1f,
  mint: 0xc9a227,
  smithy: 0x4a4e57,
  trainingGround: 0xb8925a,
  road: ROAD_COLOR,
  carriage: 0xa0703f,
  boat: 0x8a6a45,
  ship: 0x6b5236,
  ram: 0x7a5a3a,
  catapult: 0x6e5a44,
  ballista: 0x6e5a44,
  haven: 0x5f8fa8,
}

/** What the game calls each kind of building (its spec's label). */
export const BUILDING_NAMES: Record<BuildingKind, string> = Object.fromEntries(
  BUILDING_KINDS.map((kind) => [kind, BUILDING_SPECS[kind].label]),
) as Record<BuildingKind, string>
/** A Trade Org caravan's carriage and crew (`CONTEXT.md`: Caravan). */
export const CARAVAN_COLOR = RELATIONSHIP_COLORS.tradeOrg
/** Goods lying on the ground. */
export const PILE_COLOR = 0xd9c27a

/** Bare soil washed over a tile gathered bare (`CONTEXT.md`: Patch), up close. */
export const PICKED_OVER_COLOR = 0x8a6f4a

export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`

/** The Player's waypoints (`CONTEXT.md`: Waypoint), on the map and the minimap: no relationship's colour. */
export const WAYPOINT_COLOR = 0xd36cf0

/** The darkest tone of the palette: outlines of marks and pins, and the pills behind labels. */
export const INK_COLOR = hex(THEME.palette.ink)
/** The palette's lightest parchment: a ring that must show on any colour. */
export const PAPER_COLOR = hex(THEME.palette.paper)
/** What doesn't fit, in a pick's preview: a footprint where it can't go, a line too long. */
export const REFUSED_COLOR = hex(THEME.palette.red)
