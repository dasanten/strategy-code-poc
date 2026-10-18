import { Terrain, UNEXPLORED, type BuildingKind, type ResourceKind } from '@csp/shared'

/** Terrain colours from the Main Game Screen design, as 0xRRGGBB. */
export const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Plains]: 0x7e9a52,
  [Terrain.Forest]: 0x3f5e36,
  [Terrain.Hills]: 0x9c8a5e,
  [Terrain.Mountain]: 0x6f6a66,
  [Terrain.Lake]: 0x3a6a8a,
  [Terrain.Sea]: 0x2a4b66,
  [UNEXPLORED]: 0x1a1e22,
}

/** Map background, behind terrain not loaded yet. */
export const VOID_COLOR = 0x0b0d0f

export const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Plains]: 'Plains',
  [Terrain.Forest]: 'Forest',
  [Terrain.Hills]: 'Hills',
  [Terrain.Mountain]: 'Mountain',
  [Terrain.Lake]: 'Lake',
  [Terrain.Sea]: 'Sea',
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
export const BUILDING_COLORS: Record<BuildingKind, number> = {
  house: 0xc7b391,
  storage: 0x8c6a44,
  farm: 0x9db05f,
}
export const HORSE_COLOR = 0x6b4f2e
export const CARRIAGE_COLOR = 0xb79a6e
/** Goods lying on the ground. */
export const PILE_COLOR = 0xd9c27a

export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`
