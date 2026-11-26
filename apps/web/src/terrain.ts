// Ported from packages/shared/src/terrain.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { Terrain as TerrainCodes } from '@csp/balance'
import type { Terrain as TerrainCode } from '@csp/shared-types'
import { CHUNK_SIZE } from '@csp/shared-types'

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
