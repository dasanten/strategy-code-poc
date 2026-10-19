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
  /**
   * A finished road (`CONTEXT.md`: Road). Never stored in the map: roads are built on top of the
   * terrain, and `groundAt` gives this for a tile with a road on it.
   */
  Road: 6,
} as const

export type Terrain = (typeof Terrain)[keyof typeof Terrain]

/**
 * The map's terrain (`CONTEXT.md`: Map): a `size` × `size` grid, row-major
 * (`tiles[y * size + x]`), whose opposite sides join. Every tile exists.
 */
export interface TerrainMap {
  size: number
  tiles: Uint8Array
}

/** A coordinate brought back onto the map: the sides join, so -1 is `size - 1`. */
export function wrap(v: number, size: number): number {
  return ((v % size) + size) % size
}

/** The shortest signed step from `a` to `b` along one direction of the map, the short way round. */
export function wrapDelta(a: number, b: number, size: number): number {
  const d = wrap(b - a, size)
  return d > size / 2 ? d - size : d
}

/** Straight-line distance between two tiles, the short way round. */
export function wrapDistance(
  size: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(wrapDelta(a.x, b.x, size), wrapDelta(a.y, b.y, size))
}

/** The index of a tile in `TerrainMap.tiles`, for any coordinates. */
export function tileIndex(size: number, x: number, y: number): number {
  return wrap(y, size) * size + wrap(x, size)
}

/** The terrain at (x, y); coordinates past a side continue on the other. */
export function terrainAt(map: TerrainMap, x: number, y: number): Terrain {
  return map.tiles[tileIndex(map.size, x, y)] as Terrain
}

/** Lake and Sea can't be entered. */
export function isPassableTerrain(t: number): boolean {
  return (
    t === Terrain.Plains ||
    t === Terrain.Forest ||
    t === Terrain.Hills ||
    t === Terrain.Mountain ||
    t === Terrain.Road
  )
}

/**
 * What is underfoot on (x, y) (`CONTEXT.md`: Road): `Terrain.Road` where `roads` (tile indices,
 * from `roadTiles`) holds a finished road, whatever the terrain beneath; elsewhere the terrain.
 * Speed and food use go by this.
 */
export function groundAt(
  map: TerrainMap,
  roads: ReadonlySet<number>,
  x: number,
  y: number,
): Terrain {
  return roads.has(tileIndex(map.size, x, y)) ? Terrain.Road : terrainAt(map, x, y)
}

/** Terrain is served to clients in square chunks of this many tiles a side (ADR 0006). */
export const CHUNK_SIZE = 32

/** The byte for a tile in a served chunk that the Player hasn't explored. */
export const UNEXPLORED = 254

/** How many chunks fit across the map. Chunk `i` is at `(i % n, ⌊i / n⌋)`. */
export function chunksAcross(size: number): number {
  return Math.ceil(size / CHUNK_SIZE)
}

/** Where the client loads one chunk of explored terrain: `CHUNK_SIZE`² bytes, row-major. */
export function terrainChunkPath(cx: number, cy: number): string {
  return `/api/terrain/${cx}/${cy}`
}
