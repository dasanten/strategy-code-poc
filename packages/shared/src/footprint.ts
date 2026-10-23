import { MAP_SIZE } from './balance.js'
import { wrap, wrapDelta } from './terrain.js'
import type { Building, BuildingKind } from './world.js'

/**
 * Footprints (`CONTEXT.md`: Footprint, At a building): the square of tiles a building covers. A
 * building's `x`, `y` is the north-west tile of its footprint; the footprint runs east and south
 * from there, across the map's joins like everything else, and is never turned.
 */

/** Tiles along each side of each kind's footprint (`CONTEXT.md`: Footprint). */
export const FOOTPRINT: Record<BuildingKind, number> = {
  wall: 1,
  gate: 1,
  road: 1,
  house: 2,
  storage: 2,
  smelter: 2,
  mint: 2,
  smithy: 2,
  mine: 2,
  quarry: 2,
  lumberCamp: 2,
  townHall: 3,
  warehouse: 3,
  stable: 3,
  farm: 4,
}

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

/**
 * How many steps a tile is from a footprint along each direction, the short way round: 0 along a
 * direction where it is in line with the footprint, 1 right next to it.
 */
export function gapTo(b: Placed, p: { x: number; y: number }, size = MAP_SIZE): [number, number] {
  const side = FOOTPRINT[b.kind]
  const along = (from: number, to: number) => {
    const d = wrapDelta(from, to, size)
    return d < 0 ? -d : Math.max(0, d - (side - 1))
  }
  return [along(b.x, p.x), along(b.y, p.y)]
}

/**
 * Whether a tile lies within `reach` tiles of a footprint along each direction (0: on it), the
 * short way round.
 */
export function nearFootprint(
  b: Placed,
  p: { x: number; y: number },
  reach: number,
  size = MAP_SIZE,
): boolean {
  const [gx, gy] = gapTo(b, p, size)
  return gx <= reach && gy <= reach
}

/**
 * Whether two footprints come within `reach` steps of each other along each direction, from the
 * edge of one to the edge of the other (0: they overlap or are in line, 1: they touch), the short
 * way round.
 */
export function footprintsNear(a: Placed, b: Placed, reach: number, size = MAP_SIZE): boolean {
  const sa = FOOTPRINT[a.kind]
  const sb = FOOTPRINT[b.kind]
  const along = (from: number, to: number) => {
    const d = wrapDelta(from, to, size)
    return d < 0 ? Math.max(0, -d - (sb - 1)) : Math.max(0, d - (sa - 1))
  }
  return along(a.x, b.x) <= reach && along(a.y, b.y) <= reach
}

/** The tile in the middle of a footprint, rounded to the north-west: where to aim at it. */
export function middleOf(b: Placed, size = MAP_SIZE): { x: number; y: number } {
  const half = Math.floor((FOOTPRINT[b.kind] - 1) / 2)
  return { x: wrap(b.x + half, size), y: wrap(b.y + half, size) }
}
