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

/** How far a diagonal step is next to a straight one (`CONTEXT.md`: Step). */
export const DIAGONAL_STEP = Math.SQRT2

/**
 * How far the step from (ax, ay) to (bx, by) is, the short way round (`CONTEXT.md`: Step): 1
 * straight, `DIAGONAL_STEP` diagonal, and 0 when (bx, by) isn't one of the eight tiles around.
 */
export function stepLength(size: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(wrapDelta(ax, bx, size))
  const dy = Math.abs(wrapDelta(ay, by, size))
  if (dx > 1 || dy > 1 || dx + dy === 0) return 0
  return dx + dy === 2 ? DIAGONAL_STEP : 1
}

/**
 * The two straight tiles beside the diagonal step from (ax, ay) to (bx, by), as tile indices:
 * the step can't squeeze between two corners, so both must be steppable too (`CONTEXT.md`: Step).
 * None for a straight step.
 */
export function besideStep(size: number, ax: number, ay: number, bx: number, by: number): number[] {
  if (stepLength(size, ax, ay, bx, by) !== DIAGONAL_STEP) return []
  return [tileIndex(size, bx, ay), tileIndex(size, ax, by)]
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

/**
 * Where an admin loads any chunk of terrain, explored or not (`CONTEXT.md`: admin map): the same
 * format as `terrainChunkPath`, with every tile and every resource node in it.
 */
export function adminTerrainChunkPath(cx: number, cy: number): string {
  return `/api/admin/terrain/${cx}/${cy}`
}

/** Tiles a side that one byte of the admin terrain overview stands for. */
export const OVERVIEW_SCALE = 8

/** How many overview bytes fit across the map. */
export function overviewAcross(size: number): number {
  return Math.ceil(size / OVERVIEW_SCALE)
}

/**
 * Where an admin loads the whole map's terrain for the far zoom: `overviewAcross(size)`² bytes,
 * row-major, each the most common terrain of its `OVERVIEW_SCALE`² tiles.
 */
export const ADMIN_TERRAIN_OVERVIEW_PATH = '/api/admin/terrain/overview'
