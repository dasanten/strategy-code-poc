import { GOOD_WEIGHT, carryCapacity, stockWeight } from './balance.js'
import type { Building, Good, GoodsSpot, Pile, Resident, Stock, WorldState } from './world.js'

/** World queries about where goods are (ADR 0002: the game API orders and scripts share). */

/** The pile on a tile, if goods lie there. */
export function pileAt(world: WorldState, x: number, y: number): Pile | undefined {
  return world.piles.find((p) => p.x === x && p.y === y)
}

/** The finished storage standing on a tile, if there is one. */
export function storageAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => b.kind === 'storage' && !b.site && b.x === x && b.y === y)
}

/** The construction site on a tile, if there is one. */
export function siteAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => b.site && b.x === x && b.y === y)
}

/**
 * The goods at a spot on the tile (x, y): the pile's, the storage's or the materials delivered
 * to the construction site. Undefined when the spot is not there: no pile on the ground, or no
 * such storage or site on that tile.
 */
export function goodsAtSpot(
  world: WorldState,
  x: number,
  y: number,
  spot: GoodsSpot,
): Stock | undefined {
  if (spot.kind === 'ground') return pileAt(world, x, y)?.goods
  if (spot.kind === 'site') {
    const site = siteAt(world, x, y)
    return site?.id === spot.siteId ? site.site!.delivered : undefined
  }
  const storage = storageAt(world, x, y)
  if (!storage || storage.id !== spot.storageId) return undefined
  return storage.stock ?? {}
}

/** How many more whole units of a good fit in what the resident carries, at the given tick. */
export function unitsThatFit(resident: Resident, good: Good, tick: number): number {
  const room = carryCapacity(resident, tick) - stockWeight(resident.carried)
  return Math.max(0, Math.floor(room / GOOD_WEIGHT[good] + 1e-9))
}
