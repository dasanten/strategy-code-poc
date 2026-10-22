import { Terrain, UNEXPLORED, type BuildingKind, type ResourceKind } from '@csp/shared'

/** Roads, wide and light over the terrain (ADR 0008). */
export const ROAD_COLOR = 0xe8cf97

/** The painted board-game terrain colours (ADR 0008), as 0xRRGGBB. */
export const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Plains]: 0x93c45a,
  [Terrain.Forest]: 0x3f8c3c,
  [Terrain.Hills]: 0xc9a65c,
  [Terrain.Mountain]: 0x938f8a,
  [Terrain.Lake]: 0x45aee0,
  [Terrain.Sea]: 0x2f80c6,
  /** Never in a chunk: roads are drawn over the terrain, in this colour. */
  [Terrain.Road]: ROAD_COLOR,
  [UNEXPLORED]: 0x1a1e22,
}

/** The small dark marks on the terrain (trees, hill arcs, peaks, waves, tufts), and how strong. */
export const TERRAIN_MARK_COLOR = 0x1f3d17
export const TERRAIN_MARK_ALPHA = 0.5

/** Map background, behind terrain not loaded yet. */
export const VOID_COLOR = 0x0b0d0f

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
}

export const NODE_NAMES: Record<ResourceKind, string> = {
  forest: 'Forest node',
  stone: 'Stone',
  ironOre: 'Iron ore',
  goldOre: 'Gold ore',
}

/** Residents: your Leader, your other residents, everyone else. */
export const LEADER_COLOR = 0xe8a33d
export const OWN_COLOR = 0xf2eee3
export const OTHER_COLOR = 0xe0524a

/** City walls and buildings, from the design. */
export const WALL_COLOR = 0x8a5a2b
/** A city's area, laid faintly over the terrain. */
export const CITY_AREA_COLOR = 0xf2e3b8
export const BUILDING_COLORS: Record<BuildingKind, number> = {
  townHall: 0xd8c08a,
  wall: WALL_COLOR,
  gate: 0xb88a55,
  house: 0xc7b391,
  storage: 0x8c6a44,
  warehouse: 0x6e5236,
  farm: 0x9db05f,
  stable: 0xa0703f,
  mine: 0x5e5a57,
  quarry: 0xb3ada3,
  lumberCamp: 0x6b7f3c,
  smelter: 0x9a4a2f,
  mint: 0xc9a227,
  smithy: 0x4a4e57,
  road: ROAD_COLOR,
}

export const BUILDING_NAMES: Record<BuildingKind, string> = {
  townHall: 'Town hall',
  wall: 'Wall',
  gate: 'Gate',
  house: 'House',
  storage: 'Storage',
  warehouse: 'Warehouse',
  farm: 'Farm',
  stable: 'Stable',
  mine: 'Mine',
  quarry: 'Quarry',
  lumberCamp: 'Lumber camp',
  smelter: 'Smelter',
  mint: 'Mint',
  smithy: 'Smithy',
  road: 'Road',
}
export const HORSE_COLOR = 0x6b4f2e
export const CARRIAGE_COLOR = 0xb79a6e
/** A Trade Org caravan's carriage and crew (`CONTEXT.md`: Caravan). */
export const CARAVAN_COLOR = 0x3fb4c9
/** Goods lying on the ground. */
export const PILE_COLOR = 0xd9c27a

export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`
