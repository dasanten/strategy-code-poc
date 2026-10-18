/**
 * Terrain types (`CONTEXT.md`: Terrain) as the byte stored per tile. These codes are persisted,
 * so never renumber them; only add new ones.
 */
export const Terrain = {
  Plains: 0,
  Forest: 1,
  Hills: 2,
  Mountain: 3,
  Lake: 4,
  Sea: 5,
} as const

export type Terrain = (typeof Terrain)[keyof typeof Terrain]

/** The byte for a grid cell outside the disc. Only tiles inside the disc exist. */
export const OFF_MAP = 255

/**
 * The map's terrain: a square grid of `diameter` × `diameter` bytes around the disc, row-major
 * (`tiles[y * diameter + x]`). Cells outside the disc hold `OFF_MAP`.
 */
export interface TerrainMap {
  diameter: number
  tiles: Uint8Array
}

/** Whether the tile at (x, y) lies inside a disc of the given diameter. */
export function isInsideDisc(diameter: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= diameter || y >= diameter) return false
  const r = diameter / 2
  const dx = x + 0.5 - r
  const dy = y + 0.5 - r
  return dx * dx + dy * dy <= r * r
}

/** The terrain at (x, y), or `OFF_MAP` for anything outside the disc. */
export function terrainAt(map: TerrainMap, x: number, y: number): Terrain | typeof OFF_MAP {
  if (!isInsideDisc(map.diameter, x, y)) return OFF_MAP
  return map.tiles[y * map.diameter + x] as Terrain
}

/** Lake and Sea can't be entered; neither can anything outside the disc. */
export function isPassableTerrain(t: Terrain | typeof OFF_MAP): boolean {
  return (
    t === Terrain.Plains || t === Terrain.Forest || t === Terrain.Hills || t === Terrain.Mountain
  )
}

/** Terrain is served to clients in square chunks of this many tiles a side (ADR 0006). */
export const CHUNK_SIZE = 32

/** The byte for a tile in a served chunk that the Player hasn't explored. */
export const UNEXPLORED = 254

/** How many chunks fit across a map of the given diameter. Chunk `i` is at `(i % n, ⌊i / n⌋)`. */
export function chunksAcross(diameter: number): number {
  return Math.ceil(diameter / CHUNK_SIZE)
}

/** Where the client loads one chunk of explored terrain: `CHUNK_SIZE`² bytes, row-major. */
export function terrainChunkPath(cx: number, cy: number): string {
  return `/api/terrain/${cx}/${cy}`
}
