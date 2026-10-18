import { OFF_MAP, Terrain, UNEXPLORED, type ResourceKind } from '@csp/shared'

/** Terrain colours from the Main Game Screen design, as 0xRRGGBB. */
export const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Plains]: 0x7e9a52,
  [Terrain.Forest]: 0x3f5e36,
  [Terrain.Hills]: 0x9c8a5e,
  [Terrain.Mountain]: 0x6f6a66,
  [Terrain.Lake]: 0x3a6a8a,
  [Terrain.Sea]: 0x2a4b66,
  [UNEXPLORED]: 0x1a1e22,
  [OFF_MAP]: 0x0b0d0f,
}

/** Map background: off the edge of the world. */
export const VOID_COLOR = 0x0b0d0f

export const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Plains]: 'Plains',
  [Terrain.Forest]: 'Forest',
  [Terrain.Hills]: 'Hills',
  [Terrain.Mountain]: 'Mountain',
  [Terrain.Lake]: 'Lake',
  [Terrain.Sea]: 'Sea',
  [UNEXPLORED]: 'Unexplored',
  [OFF_MAP]: 'Edge of the world',
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

export const OWNER_COLORS: Record<string, number> = { red: 0xe0524a, blue: 0x4aa3e0 }

export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`
