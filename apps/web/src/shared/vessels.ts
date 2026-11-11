// Vessels for the client (`CONTEXT.md`: Water, Beside a vessel), as the crates' `queries/vessels.rs`
// says them: who stands beside one, whether one is theirs, and what room it has left.

import { BOAT_CAPACITY, MAP_SIZE, PASSENGER_WEIGHT } from '@csp/balance'
import type { Resident, SeenVessel } from '@csp/shared-types'
import { inContact } from './combat.js'
import { stockWeight } from './stats.js'

/** Whether an id names a vessel: the server names each after its kind, as "boat12". */
export function isVesselId(id: string | undefined): boolean {
  return id !== undefined && /^(boat|ship)\d+$/.test(id)
}

/**
 * Whether (x, y) is beside the vessel (`CONTEXT.md`: Beside a vessel): touching its water tile,
 * straight or diagonally, and not the tile itself.
 */
export function besideVessel(
  v: { x: number; y: number },
  at: { x: number; y: number },
  size = MAP_SIZE,
): boolean {
  return !(v.x === at.x && v.y === at.y) && inContact(size, v, at)
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
export function vesselRoom(v: Pick<SeenVessel, 'load' | 'passengerIds'>): number | undefined {
  if (!v.load) return undefined
  return BOAT_CAPACITY - stockWeight(v.load) - v.passengerIds.length * PASSENGER_WEIGHT
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
