import { GOOD_WEIGHT, OWN_FOOD, carryCapacity, stockWeight } from './balance.js'
import { KEEPS_GOODS } from './building.js'
import type { Building, Good, GoodsSpot, Pile, Resident, Stock, WorldState } from './world.js'

/** World queries about where goods are (ADR 0002: the game API orders and scripts share). */

/** The pile on a tile, if goods lie there. */
export function pileAt(world: WorldState, x: number, y: number): Pile | undefined {
  return world.piles.find((p) => p.x === x && p.y === y)
}

/**
 * The finished building with a storage standing on a tile, if there is one: a storage, or a
 * stable's storage for its horses' Food (`KEEPS_GOODS`).
 */
export function storageAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find(
    (b) => KEEPS_GOODS.includes(b.kind) && !b.site && b.x === x && b.y === y,
  )
}

/**
 * The construction site `siteId` if it is on the tile. A tile can hold two sites: a building's
 * and a road's (`CONTEXT.md`: Road).
 */
export function siteAt(
  world: WorldState,
  x: number,
  y: number,
  siteId: string,
): Building | undefined {
  return world.buildings.find((b) => b.id === siteId && b.site && b.x === x && b.y === y)
}

/**
 * The goods at a spot on the tile (x, y): the pile's, the storage's, the materials delivered
 * to the construction site or the carriage's load. Undefined when the spot is not there: no pile
 * on the ground, or no such storage, site or carriage on that tile.
 */
export function goodsAtSpot(
  world: WorldState,
  x: number,
  y: number,
  spot: GoodsSpot,
): Stock | undefined {
  if (spot.kind === 'ground') return pileAt(world, x, y)?.goods
  if (spot.kind === 'carriage') {
    const carriage = world.carriages.find((k) => k.id === spot.carriageId)
    return carriage?.x === x && carriage.y === y ? carriage.load : undefined
  }
  if (spot.kind === 'site') {
    return siteAt(world, x, y, spot.siteId)?.site!.delivered
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

/**
 * How many of a carried good a resident puts away (stores, drops, loads, delivers) unless asked
 * for an exact amount: all of it, but Food only beyond their own food (`CONTEXT.md`: Own food).
 */
export function putAwayUnits(good: Good, carried: number): number {
  return good === 'food' ? Math.max(0, carried - OWN_FOOD) : carried
}
