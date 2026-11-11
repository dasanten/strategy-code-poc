// Ported from packages/shared/src/goods.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { KEEPS_GOODS, pileTile } from './building.js'
import { covers } from './footprint.js'
import { GOOD_WEIGHT } from './narrowed.js'
import { stockWeight } from './stats.js'
import { besideVessel } from './vessels.js'
import { isDown, type WorldState } from './world.js'
import { OWN_FOOD, carryCapacity } from '@csp/balance'
import type { Building, Good, GoodsSpot, Pile, Resident, Stock } from '@csp/shared-types'

/** World queries about where goods are (ADR 0002: the game API orders and scripts share). */

/**
 * The pile reached from a tile, if goods lie there: on a building's footprint the building's one
 * pile (`CONTEXT.md`: A building's pile), elsewhere the goods on the tile.
 */
export function pileAt(world: WorldState, x: number, y: number): Pile | undefined {
  const at = pileTile(world, x, y)
  return world.piles.find((p) => p.x === at.x && p.y === at.y)
}

/**
 * The finished building with a storage whose footprint covers a tile, if there is one: a
 * storage, or a stable's storage for its horses' Food (`KEEPS_GOODS`).
 */
export function storageAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => KEEPS_GOODS.includes(b.kind) && !b.site && covers(b, x, y))
}

/**
 * The construction site `siteId` if a tile is on its footprint. A tile can hold two sites: a
 * building's and a road's (`CONTEXT.md`: Road).
 */
export function siteAt(
  world: WorldState,
  x: number,
  y: number,
  siteId: string,
): Building | undefined {
  return world.buildings.find((b) => b.id === siteId && b.site && covers(b, x, y))
}

/**
 * The goods at a spot reached from the tile (x, y): the pile's, the storage's, the materials
 * delivered to the construction site, the carriage's load or what a Down resident carries.
 * Undefined when the spot is not there: no pile on the ground, no such storage or site there, no
 * such carriage on that tile, or nobody of that id lying Down on it.
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
  if (spot.kind === 'resident') return downOn(world, x, y, spot.residentId)?.carried
  if (spot.kind === 'vessel') {
    // From beside it (`CONTEXT.md`: Beside a vessel).
    const v = world.vessels?.find((b) => b.id === spot.vesselId)
    return v && besideVessel(v, { x, y }) ? v.load : undefined
  }
  const storage = storageAt(world, x, y)
  if (!storage || storage.id !== spot.storageId) return undefined
  return storage.stock ?? {}
}

/**
 * The resident `residentId` if they lie Down on the tile (x, y): anyone there can take what they
 * carry, as from a pile (`CONTEXT.md`: Down).
 */
export function downOn(
  world: WorldState,
  x: number,
  y: number,
  residentId: string,
): Resident | undefined {
  const r = world.residents.find((d) => d.id === residentId)
  return r && isDown(r) && r.x === x && r.y === y ? r : undefined
}

/** How many more whole units of a good fit in what the resident carries, at the given tick. */
export function unitsThatFit(resident: Resident, good: Good, tick: number): number {
  const room = carryCapacity(resident, tick) - stockWeight(resident.carried)
  return Math.max(0, Math.floor(room / GOOD_WEIGHT[good] + 1e-9))
}

/**
 * How many of a carried good a resident puts away (stores, drops, loads, delivers) unless asked
 * for an exact amount: all of it, but Food only beyond their own food (`CONTEXT.md`: Own food),
 * `ownFood` units: `OWN_FOOD` unless a store order asks to keep another amount.
 */
export function putAwayUnits(good: Good, carried: number, ownFood = OWN_FOOD): number {
  return good === 'food' ? Math.max(0, carried - ownFood) : carried
}
