// Carriages, their horses and drivers, as the client shows them. Its rules with a Rust original are
// twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client asks
// them per frame or per row.

import { stockWeight } from '@csp/lang-wasm'
import { isDown } from './world.js'
import { PASSENGER_WEIGHT, carriageCapacityWith } from '@csp/balance'
import type {
  Caravan,
  Carriage,
  CarriageHorse,
  CarriagePlace,
  Horse,
  Resident,
  Stock,
} from '@csp/shared-types'

/** World queries about carriages (ADR 0002: the game API orders and scripts share). */

/** Everyone on a caravan, by id: its driver, if it has one, and its escort. */
export function crewIdsOf(caravan: Pick<Caravan, 'driverId' | 'escortIds'>): string[] {
  return caravan.driverId === null
    ? [...caravan.escortIds]
    : [caravan.driverId, ...caravan.escortIds]
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
export function hitchHorseProblem(
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
