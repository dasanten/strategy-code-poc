// Ported from packages/shared/src/terrain.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { Terrain as TerrainCodes } from '@csp/balance'
import type { Terrain as TerrainCode } from '@csp/shared-types'
import { DIAGONAL_STEP } from '@csp/balance'
import { CHUNK_SIZE, TERRAIN_BATCH_PATH, OVERVIEW_SCALE } from '@csp/shared-types'

export {
  CHUNK_SIZE,
  UNEXPLORED,
  TERRAIN_BATCH_PATH,
  TERRAIN_BATCH_MAX,
  LAND_PATH,
  TERRAIN_LEVEL_MAX,
  OVERVIEW_SCALE,
  ADMIN_TERRAIN_OVERVIEW_PATH,
} from '@csp/shared-types'

/**
 * The terrain codes by name, as the game stores them: `Terrain.Plains` is 0. The numbers are
 * Rust's (`@csp/balance`); the cast gives each its literal type.
 */
export const Terrain = TerrainCodes as {
  readonly Plains: 0
  readonly Forest: 1
  readonly Hills: 2
  readonly Mountain: 3
  readonly Lake: 4
  readonly Sea: 5
  readonly Road: 6
}

export type Terrain = TerrainCode

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

/** Whether the terrain is water (`CONTEXT.md`: Water): Lake or Sea, where only vessels go. */
export function isWater(t: number): boolean {
  return t === Terrain.Lake || t === Terrain.Sea
}

/**
 * Whether one of `tiles` touches water, straight or diagonally (`CONTEXT.md`: Haven): a Lake or
 * Sea tile among the eight around it. `at` gives a tile's terrain.
 */
export function touchesWater(
  tiles: readonly (readonly [number, number])[],
  size: number,
  at: (x: number, y: number) => number,
): boolean {
  return touches(tiles, size, at, isWater)
}

/** Whether the terrain is Sea (`CONTEXT.md`: Ship: it sails only on Sea, never onto Lake). */
export function isSea(t: number): boolean {
  return t === Terrain.Sea
}

/** Whether one of `tiles` touches Sea, straight or diagonally (`CONTEXT.md`: Building a ship). */
export function touchesSea(
  tiles: readonly (readonly [number, number])[],
  size: number,
  at: (x: number, y: number) => number,
): boolean {
  return touches(tiles, size, at, isSea)
}

/** Whether one of `tiles` has a tile of terrain `what` among the eight around it. */
function touches(
  tiles: readonly (readonly [number, number])[],
  size: number,
  at: (x: number, y: number) => number,
  what: (t: number) => boolean,
): boolean {
  return tiles.some(([x, y]) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && what(at(wrap(x + dx, size), wrap(y + dy, size)))) return true
      }
    }
    return false
  })
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

/** How many chunks fit across the map. Chunk `i` is at `(i % n, ⌊i / n⌋)`. */
export function chunksAcross(size: number): number {
  return Math.ceil(size / CHUNK_SIZE)
}

/**
 * How many chunks of `level` fit across a map `across` level-0 chunks wide. Chunk `i` of a level
 * is at `(i % n, ⌊i / n⌋)`; squares past the map's side are padding.
 */
export function levelChunksAcross(across: number, level: number): number {
  return Math.ceil(across / 2 ** level)
}

/** The chunk of `level` that holds level-0 chunk `i`, on a map `across` level-0 chunks wide. */
export function coarseChunkOf(i: number, across: number, level: number): number {
  const [cx, cy] = [i % across, Math.floor(i / across)]
  return (cy >> level) * levelChunksAcross(across, level) + (cx >> level)
}

/**
 * Where an admin loads any chunk of terrain, explored or not (`CONTEXT.md`: admin map): the same
 * format as `terrainChunkPath`, with every tile and every resource node in it.
 */
export function adminTerrainChunkPath(cx: number, cy: number): string {
  return `/api/admin/terrain/${cx}/${cy}`
}
