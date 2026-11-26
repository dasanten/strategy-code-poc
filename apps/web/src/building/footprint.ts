// Footprints (`CONTEXT.md`: Footprint): the tiles a building covers. Its rules with a Rust original
// are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client
// asks them per frame or per row.

import { wrap } from '../world/terrain.js'
import { BUILDING_KINDS, BUILDING_SPECS, MAP_SIZE } from '@csp/balance'
import type { Building, BuildingKind } from '@csp/shared-types'

/**
 * Footprints (`CONTEXT.md`: Footprint, At a building): the square of tiles a building covers. A
 * building's `x`, `y` is the north-west tile of its footprint; the footprint runs east and south
 * from there, across the map's joins like everything else, and is never turned. Reach between
 * footprints (`footprintsNear`) is asked of the rules module with its callers (T122.8).
 */

/** Tiles along each side of each kind's footprint (`CONTEXT.md`: Footprint). */
export const FOOTPRINT: Record<BuildingKind, number> = Object.fromEntries(
  BUILDING_KINDS.map((kind) => [kind, BUILDING_SPECS[kind].footprint]),
) as Record<BuildingKind, number>

/** What a footprint is worked out from: a building's kind and its north-west tile. */
export type Placed = Pick<Building, 'kind' | 'x' | 'y'>

/**
 * Whether the footprint of `b` covers tile (x, y) (`CONTEXT.md`: Footprint). `size` is the map's;
 * it only matters for a footprint across a join.
 */
export function covers(b: Placed, x: number, y: number, size = MAP_SIZE): boolean {
  const side = FOOTPRINT[b.kind]
  return wrap(x - b.x, size) < side && wrap(y - b.y, size) < side
}

/** Whether `p` stands at the building `b`: on any tile of its footprint (`CONTEXT.md`: At a building). */
export function isAt(p: { x: number; y: number }, b: Placed, size = MAP_SIZE): boolean {
  return covers(b, p.x, p.y, size)
}

/** The tiles a footprint covers, north-west first and then row by row. */
export function footprintTiles(b: Placed, size = MAP_SIZE): [number, number][] {
  const side = FOOTPRINT[b.kind]
  const out: [number, number][] = []
  for (let dy = 0; dy < side; dy++) {
    for (let dx = 0; dx < side; dx++) out.push([wrap(b.x + dx, size), wrap(b.y + dy, size)])
  }
  return out
}

/** The footprint's tiles as "x,y" keys. */
export function footprintKeys(b: Placed, size = MAP_SIZE): string[] {
  return footprintTiles(b, size).map(([x, y]) => `${x},${y}`)
}
