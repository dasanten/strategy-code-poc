// Ported from packages/shared/src/carriages.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { storageAt } from './goods.js'
import { GOOD_WEIGHT } from './narrowed.js'
import { canWork, stockWeight } from './stats.js'
import { isDown } from './world.js'
import {
  CARAVAN_ESCORTS,
  CARAVAN_ESCORTS_MAX,
  CARAVAN_ROBBERIES_PER_ESCORT,
  PASSENGER_WEIGHT,
  TRADER_ESCORTS,
  carriageCapacityWith,
} from '@csp/balance'
import type {
  Caravan,
  Carriage,
  CarriageHorse,
  CarriagePlace,
  Good,
  GoodsSpot,
  Horse,
  Resident,
  Stock,
  Trader,
  WorldState,
} from '@csp/shared-types'

export { loadLevel, caravanFoodFor, foodForWay } from '@csp/lang-wasm'

/** World queries about carriages (ADR 0002: the game API orders and scripts share). */

/**
 * Everything the Trade Org runs with a carriage and a crew: its caravans and its wandering traders
 * (`CONTEXT.md`: Caravan, Wandering trader, Caravan crew lost).
 */
export function convoysOf(world: Pick<WorldState, 'caravans' | 'traders'>): (Caravan | Trader)[] {
  return [...world.caravans, ...world.traders]
}

/** The Trade Org caravan or wandering trader a resident drives or escorts, if any. */
export function convoyOf(
  world: Pick<WorldState, 'caravans' | 'traders'>,
  residentId: string,
): Caravan | Trader | undefined {
  return convoysOf(world).find((c) => c.driverId === residentId || c.escortIds.includes(residentId))
}

/** Everyone on a caravan, by id: its driver, if it has one, and its escort. */
export function crewIdsOf(caravan: Pick<Caravan, 'driverId' | 'escortIds'>): string[] {
  return caravan.driverId === null
    ? [...caravan.escortIds]
    : [caravan.driverId, ...caravan.escortIds]
}

/**
 * How many escorts the caravan on the route to trading post `postId` walks with (`CONTEXT.md`:
 * Caravan): `CARAVAN_ESCORTS`, and one more for every `CARAVAN_ROBBERIES_PER_ESCORT` times the
 * route was robbed, up to `CARAVAN_ESCORTS_MAX`.
 */
export function caravanEscortsWanted(
  world: Pick<WorldState, 'routeRobberies'>,
  postId: string,
): number {
  return escortsAfter(CARAVAN_ESCORTS, world.routeRobberies[postId] ?? 0)
}

/**
 * How many escorts a wandering trader walks with (`CONTEXT.md`: Wandering trader): as for a caravan,
 * from `TRADER_ESCORTS`, by how often it was robbed.
 */
export function traderEscortsWanted(trader: Pick<Trader, 'robberies'>): number {
  return escortsAfter(TRADER_ESCORTS, trader.robberies)
}

/** `escorts`, and one more for every `CARAVAN_ROBBERIES_PER_ESCORT` robberies, up to the most. */
function escortsAfter(escorts: number, robberies: number): number {
  const extra = Math.floor(robberies / CARAVAN_ROBBERIES_PER_ESCORT)
  return Math.min(CARAVAN_ESCORTS_MAX, escorts + extra)
}

/** The carriages standing on a tile. */
export function carriagesAt(world: WorldState, x: number, y: number): Carriage[] {
  return world.carriages.filter((k) => k.x === x && k.y === y)
}

/** The carriage a horse is hitched to, if it pulls one. */
export function carriagePulledBy<K extends Pick<Carriage, 'horseId'>>(
  world: { carriages: readonly K[] },
  horse: Pick<Horse, 'id'>,
): K | undefined {
  return world.carriages.find((k) => k.horseId === horse.id)
}

/**
 * The horse that pulls a carriage once it is driven (`CONTEXT.md`: Carriage): the one hitched to
 * it, or else a horse of the carriage's realm (or NPC city) on its tile that pulls no other carriage, which is
 * hitched when the carriage first moves. A horse somebody rides is never hitched (`CONTEXT.md`:
 * Riding), as far as `residents` tell, nor one that is Down (`CONTEXT.md`: Down). Undefined when
 * there is none. It never picks another organization's: only an order that says so steals one
 * (`horseToSteal`, `CONTEXT.md`: Stealing a carriage or horse).
 */
export function horseFor<H extends CarriageHorse>(
  world: {
    horses: readonly H[]
    carriages: readonly CarriagePlace[]
    residents?: readonly Pick<Resident, 'riding'>[]
  },
  carriage: CarriagePlace,
): H | undefined {
  if (carriage.horseId) return world.horses.find((h) => h.id === carriage.horseId)
  return world.horses.find((h) => !hitchHorseProblem(world, carriage, h))
}

/**
 * The horses that can be hitched to a carriage now (`CONTEXT.md`: Hitched horse): those of its
 * realm or NPC city on its tile that pull no carriage, nobody rides and aren't Down.
 */
export function horsesToHitch<H extends CarriageHorse>(
  world: {
    horses: readonly H[]
    carriages: readonly CarriagePlace[]
    residents?: readonly Pick<Resident, 'riding'>[]
  },
  carriage: CarriagePlace,
): H[] {
  return world.horses.filter((h) => !hitchHorseProblem(world, carriage, h))
}

/** Why a horse can't be hitched to a carriage now, or undefined when it can (`horsesToHitch`). */
function hitchHorseProblem(
  world: {
    carriages: readonly CarriagePlace[]
    residents?: readonly Pick<Resident, 'riding'>[]
  },
  carriage: CarriagePlace,
  horse: CarriageHorse,
): string | undefined {
  if (horse.realmId !== carriage.realmId || horse.cityId !== carriage.cityId) {
    return 'not a horse of your realm'
  }
  if (horse.x !== carriage.x || horse.y !== carriage.y) {
    return 'that horse is not on the carriage’s tile'
  }
  if (carriagePulledBy(world, horse)) return 'that horse already pulls a carriage'
  if (world.residents?.some((r) => r.riding === horse.id)) return 'someone rides that horse'
  if (isDown(horse)) return 'that horse is Down'
  return undefined
}

/** The carriage a resident drives, by a drive order or on a haul route, if they drive one. */
export function drivenCarriageId(resident: Pick<Resident, 'order'>): string | undefined {
  const o = resident.order
  return o?.kind === 'drive' || o?.kind === 'haul' ? o.carriageId : undefined
}

/** The resident driving a carriage, if anyone is (`DriveOrder`, `HaulOrder`). */
export function driverOf<R extends Pick<Resident, 'order'>>(
  world: { residents: readonly R[] },
  carriage: Pick<Carriage, 'id'>,
): R | undefined {
  return world.residents.find((r) => drivenCarriageId(r) === carriage.id)
}

/**
 * Whether a carriage stands still with nothing to move it (`CONTEXT.md`: On a carriage under
 * attack): no driver driving it, or its horse Down or dead.
 */
export function standsStill(
  world: {
    horses: readonly CarriageHorse[]
    carriages: readonly CarriagePlace[]
    residents: readonly Pick<Resident, 'order' | 'riding'>[]
  },
  carriage: CarriagePlace & Pick<Carriage, 'id'>,
): boolean {
  if (!driverOf(world, carriage)) return true
  const horse = horseFor(world, carriage)
  return !horse || isDown(horse)
}

/**
 * Whether a carriage's hitched horse lies Down (`CONTEXT.md`: Down): until it wakes or dies nobody
 * can drive the carriage, so the Trade Org's crews give no drive order and count no failed drive.
 */
export function horseLiesDown(
  world: { horses: readonly CarriageHorse[] },
  carriage: Pick<Carriage, 'horseId'>,
): boolean {
  const horse = world.horses.find((h) => h.id === carriage.horseId)
  return horse !== undefined && isDown(horse)
}

/**
 * Where a haul route's stop on tile (x, y) loads and unloads (`CONTEXT.md`: Haul route): the
 * storage there, a stable's included, or else the ground.
 */
export function haulStopSpot(world: WorldState, x: number, y: number): GoodsSpot {
  const storage = storageAt(world, x, y)
  return storage ? { kind: 'storage', storageId: storage.id } : { kind: 'ground' }
}

/**
 * Most weight a carriage holds, in kg (`CONTEXT.md`: Horse stats): by the Strength of the horse
 * that pulls it (`horseFor`), or `CARRIAGE_CAPACITY` while it has none.
 */
export function carriageCapacity(
  world: { horses: readonly CarriageHorse[]; carriages: readonly CarriagePlace[] },
  carriage: CarriagePlace,
): number {
  return carriageCapacityWith(horseFor(world, carriage))
}

/** The residents aboard a carriage as its passengers (`CONTEXT.md`: Passenger). */
export function passengersOf<R extends Pick<Resident, 'aboard'>>(
  world: { residents: readonly R[] },
  carriage: Pick<Carriage, 'id'>,
): R[] {
  return world.residents.filter((r) => r.aboard === carriage.id)
}

/**
 * What a carriage's goods and passengers weigh together, in kg (`CONTEXT.md`: Passenger): each
 * passenger counts as `PASSENGER_WEIGHT`.
 */
export function carriageWeight(world: Pick<WorldState, 'residents'>, carriage: Carriage): number {
  return stockWeight(carriage.load) + passengersOf(world, carriage).length * PASSENGER_WEIGHT
}

/**
 * How much weight of goods a carriage holds with its passengers aboard, in kg: what it holds
 * (`carriageCapacity`) less what its passengers count for (`CONTEXT.md`: Passenger).
 */
export function goodsCapacity(world: WorldState, carriage: Carriage): number {
  return carriageCapacity(world, carriage) - passengersOf(world, carriage).length * PASSENGER_WEIGHT
}

/**
 * How much more weight fits on a carriage, in kg: what it holds (`carriageCapacity`) less its
 * goods and passengers (`carriageWeight`).
 */
export function carriageRoom(world: WorldState, carriage: Carriage): number {
  return goodsCapacity(world, carriage) - stockWeight(carriage.load)
}

/** How many more whole units of a good fit on a carriage (`carriageRoom`). */
export function unitsThatFitCarriage(world: WorldState, carriage: Carriage, good: Good): number {
  return Math.max(0, Math.floor(carriageRoom(world, carriage) / GOOD_WEIGHT[good] + 1e-9))
}

/**
 * Whether a carriage is the resident's to board (`CONTEXT.md`: Passenger): one of their realm,
 * or for a resident of an NPC city one of that city.
 */
export function carriageOfResident(
  carriage: Pick<Carriage, 'realmId' | 'cityId'>,
  resident: Pick<Resident, 'owner' | 'cityId'>,
): boolean {
  if (resident.owner !== null) return carriage.realmId === resident.owner
  return (
    carriage.realmId === null && resident.cityId !== null && carriage.cityId === resident.cityId
  )
}

/**
 * Why a resident can't handle a carriage's horse now, what hitching and unhitching have in common
 * (`CONTEXT.md`: Hitched horse): they must be grown up and of the carriage's realm, standing on
 * its tile.
 */
function handlerProblem(
  resident: Pick<Resident, 'x' | 'y' | 'owner' | 'cityId' | 'bornAt'>,
  carriage: Pick<Carriage, 'x' | 'y' | 'realmId' | 'cityId'>,
  tick: number,
  verb: 'hitch' | 'unhitch',
): string | undefined {
  if (!canWork(resident, tick)) return `children can’t ${verb}`
  if (!carriageOfResident(carriage, resident)) return 'not a carriage of your realm'
  if (carriage.x !== resident.x || carriage.y !== resident.y) {
    return 'that carriage is not on the resident’s tile'
  }
  return undefined
}

/**
 * Why a resident can't unhitch a carriage's horse now, or undefined when they can (`CONTEXT.md`:
 * Hitched horse): they must be able to handle it (`handlerProblem`), and a horse must be hitched.
 */
export function unhitchProblem(
  resident: Pick<Resident, 'x' | 'y' | 'owner' | 'cityId' | 'bornAt'>,
  carriage: Pick<Carriage, 'x' | 'y' | 'realmId' | 'cityId' | 'horseId'> | undefined,
  tick: number,
): string | undefined {
  if (!carriage) return 'no such carriage'
  const problem = handlerProblem(resident, carriage, tick, 'unhitch')
  if (problem) return problem
  if (!carriage.horseId) return 'no horse is hitched to that carriage'
  return undefined
}

/**
 * Why a resident can't board a carriage, room aside (`boardProblem`): what the group card checks
 * of each member before it hands out the seats left (`CONTEXT.md`: Group).
 */
export function boarderProblem(
  resident: Pick<Resident, 'x' | 'y' | 'owner' | 'cityId' | 'order' | 'aboard' | 'riding'>,
  carriage: Pick<Carriage, 'id' | 'x' | 'y' | 'realmId' | 'cityId'>,
): string | undefined {
  if (resident.aboard === carriage.id) return 'already aboard that carriage'
  if (resident.aboard !== undefined) return 'already aboard another carriage'
  if (!carriageOfResident(carriage, resident)) return 'not a carriage of your realm'
  if (carriage.x !== resident.x || carriage.y !== resident.y) {
    return 'that carriage is not on the resident’s tile'
  }
  if (drivenCarriageId(resident) !== undefined) return 'the driver can’t board'
  if (resident.riding !== undefined) return 'dismount first to board'
  return undefined
}

/**
 * How many more passengers fit on a carriage (`CONTEXT.md`: Passenger): its room for weight
 * (what it holds less its goods and passengers) in whole `PASSENGER_WEIGHT`s.
 */
export function seatsLeft(
  world: { horses: readonly CarriageHorse[]; carriages: readonly CarriagePlace[] },
  carriage: CarriagePlace & { load: Stock },
  passengers: number,
): number {
  const room =
    carriageCapacity(world, carriage) - stockWeight(carriage.load) - passengers * PASSENGER_WEIGHT
  return Math.max(0, Math.floor(room / PASSENGER_WEIGHT + 1e-9))
}
