// Ported from packages/shared/src/terrain.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { Terrain as TerrainCodes } from '@csp/balance'
import type { Terrain as TerrainCode } from '@csp/shared-types'
import { DIAGONAL_STEP } from '@csp/balance'

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
  return tiles.some(([x, y]) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && isWater(at(wrap(x + dx, size), wrap(y + dy, size)))) return true
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

/** Terrain is served to clients in square chunks of this many tiles a side (ADR 0006). */
export const CHUNK_SIZE = 32

/** The byte for a tile in a served chunk that the Player hasn't explored. */
export const UNEXPLORED = 254

/** How many chunks fit across the map. Chunk `i` is at `(i % n, ⌊i / n⌋)`. */
export function chunksAcross(size: number): number {
  return Math.ceil(size / CHUNK_SIZE)
}

/**
 * Where the client loads many chunks of explored terrain in one request: a `POST` whose JSON body
 * is `{ chunks: number[] }`, chunk indices as in `chunksAcross`, at most `TERRAIN_BATCH_MAX` of
 * them. The answer is `encodeChunkBatch`: the explored ones among them, unexplored ones left out.
 */
export const TERRAIN_BATCH_PATH = '/api/terrain/chunks'

/** The most chunks one `TERRAIN_BATCH_PATH` request may ask for. */
export const TERRAIN_BATCH_MAX = 64

/**
 * The coarsest level explored terrain is served at (ADR 0034). At level `k` one byte stands for a
 * square of `2^k × 2^k` tiles, the most common terrain the Player explored in it, and a chunk is
 * `CHUNK_SIZE × CHUNK_SIZE` squares; level 0 is one byte a tile. A `TERRAIN_BATCH_PATH` request
 * names its level as `level`, 0 if none.
 */
export const TERRAIN_LEVEL_MAX = 5

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

/** Tiles a side that one byte of the admin terrain overview stands for. */
export const OVERVIEW_SCALE = 8

/**
 * Where an admin loads the whole map's terrain for the far zoom: `overviewAcross(size)`² bytes,
 * row-major, each the most common terrain of its `OVERVIEW_SCALE`² tiles.
 */
export const ADMIN_TERRAIN_OVERVIEW_PATH = '/api/admin/terrain/overview'
