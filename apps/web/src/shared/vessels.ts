// Vessels for the client (`CONTEXT.md`: Water, Beside a vessel), as the crates' `queries/vessels.rs`
// says them: who stands beside one, whether one is theirs, and what room it has left.

import { BOAT_CAPACITY, MAP_SIZE, PASSENGER_WEIGHT, SHIP_CAPACITY } from '@csp/balance'
import type { Resident, SeenVessel, VesselKind } from '@csp/shared-types'
import type { StealingResident } from './carriages.js'
import { guardedBy } from './city.js'
import { inContact } from './combat.js'
import { canWork, stockWeight } from './stats.js'

/** Whether an id names a vessel: the server names each after its kind, as "boat12". */
export function isVesselId(id: string | undefined): boolean {
  return id !== undefined && /^(boat|ship)\d+$/.test(id)
}

/**
 * Whether (x, y) is beside the vessel (`CONTEXT.md`: Beside a vessel): touching its water tile,
 * straight or diagonally, and not the tile itself. Nothing is beside a ship yet: for a ship it
 * means at the haven it is docked at (`CONTEXT.md`: Docked), as the server will say with T91.2.
 */
export function besideVessel(
  v: { x: number; y: number; kind?: VesselKind },
  at: { x: number; y: number },
  size = MAP_SIZE,
): boolean {
  if (v.kind === 'ship') return false
  return !(v.x === at.x && v.y === at.y) && inContact(size, v, at)
}

/** Most weight a vessel carries, in kg (`CONTEXT.md`: Boat, Ship). */
export function vesselCapacity(kind: VesselKind | undefined): number {
  return kind === 'ship' ? SHIP_CAPACITY : BOAT_CAPACITY
}

/** Whether the vessel is of the resident's realm; one of nobody is no one's. */
export function vesselOfResident(
  v: Pick<SeenVessel, 'realmId'>,
  r: Pick<Resident, 'owner'>,
): boolean {
  return r.owner !== null && v.realmId === r.owner
}

/**
 * What the vessel still holds in kg, when its load is seen (`CONTEXT.md`: Beside a vessel): what
 * it can carry less its goods and a fixed weight for each passenger.
 */
export function vesselRoom(
  v: Pick<SeenVessel, 'load' | 'passengerIds'> & { kind?: VesselKind },
): number | undefined {
  if (!v.load) return undefined
  return vesselCapacity(v.kind) - stockWeight(v.load) - v.passengerIds.length * PASSENGER_WEIGHT
}

/**
 * Why a resident can't board the vessel now, if so (`CONTEXT.md`: Beside a vessel, What vessels
 * carry): only beside it, a rider dismounts first (no horse goes aboard), the driver can't, and it
 * must have room for one more.
 */
export function boardBoatProblem(
  r: { x: number; y: number; riding?: string; aboard?: string; driving?: boolean },
  v: Pick<SeenVessel, 'x' | 'y' | 'load' | 'passengerIds'>,
): string | undefined {
  if (r.aboard !== undefined) return 'already aboard'
  if (!besideVessel(v, r)) return 'not beside the boat'
  if (r.driving) return 'the driver can’t board'
  if (r.riding !== undefined) return 'no horse goes aboard: dismount first'
  const room = vesselRoom(v)
  if (room !== undefined && room < PASSENGER_WEIGHT - 1e-9) return 'the boat is full'
  return undefined
}

/**
 * Why a resident can't row off in another organization's boat (or nobody's) for the realm
 * `realmId` now, or undefined when they can (`CONTEXT.md`: Stealing a carriage or horse, its
 * vessel part): grown, beside it and aboard nothing, on no horse and driving nothing; nobody may
 * row it or be aboard; and it mustn't be guarded: an armed resident of its owner beside it and none
 * of the thief's realm, the thief themselves included. `size` is the map's.
 */
export function rowOffProblem<R extends StealingResident>(
  world: { tick: number; residents: readonly R[] },
  thief: R,
  v: Pick<SeenVessel, 'id' | 'x' | 'y' | 'realmId' | 'passengerIds' | 'rowerId'>,
  realmId: string,
  size = MAP_SIZE,
): string | undefined {
  if (!canWork(thief, world.tick)) return 'children can’t steal'
  if (thief.aboard !== undefined) return 'aboard another carriage or boat'
  if (!besideVessel(v, thief, size)) return 'that boat is not beside the resident'
  if (thief.order?.kind === 'drive' || thief.order?.kind === 'haul') return 'the driver can’t row'
  if (thief.riding !== undefined) return 'no horse goes aboard: dismount first'
  if (v.rowerId !== undefined) return 'someone is rowing that boat'
  if (v.passengerIds.length > 0) return 'someone is aboard that boat'
  const guarded = guardedBy(
    world.residents,
    (r) => r.aboard !== v.id && besideVessel(v, r, size),
    (r) => vesselOfResident(v, r),
    (r) => r.id === thief.id || r.owner === realmId,
  )
  return guarded ? 'an armed resident guards that boat' : undefined
}
