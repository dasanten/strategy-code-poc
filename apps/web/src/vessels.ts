// Vessels for the client (`CONTEXT.md`: Water, Beside a vessel), as the crates' `queries/vessels.rs`
// says them: who stands beside one, whether one is theirs, and what room it has left.

import {
  BOAT_CAPACITY,
  MAP_SIZE,
  PASSENGER_WEIGHT,
  SHIP_CAPACITY,
  SHIP_MIN_CREW,
} from '@csp/balance'
import type { Building, Resident, SeenVessel, VesselKind } from '@csp/shared-types'
import { inContact } from '@csp/lang-wasm'
import { covers } from './footprint.js'
import { stockWeight } from '@csp/lang-wasm'

/** Whether an id names a vessel: the server names each after its kind, as "boat12". */
export function isVesselId(id: string | undefined): boolean {
  return id !== undefined && /^(boat|ship)\d+$/.test(id)
}

/** The buildings in sight, among them the havens ships dock at. */
export type Havens = readonly Pick<Building, 'id' | 'kind' | 'x' | 'y'>[]

/**
 * Whether (x, y) is beside the vessel (`CONTEXT.md`: Beside a vessel): touching a boat's water
 * tile, straight or diagonally, and not the tile itself; for a ship, on the haven it is docked at
 * (`CONTEXT.md`: Docked), found among `buildings`. Nothing is beside a ship at sea.
 */
export function besideVessel(
  v: { x: number; y: number; kind?: VesselKind; dockedAt?: string },
  at: { x: number; y: number },
  size = MAP_SIZE,
  buildings: Havens = [],
): boolean {
  if (v.kind === 'ship') {
    const haven = v.dockedAt === undefined ? undefined : buildings.find((b) => b.id === v.dockedAt)
    return haven !== undefined && covers(haven, at.x, at.y, size)
  }
  return !(v.x === at.x && v.y === at.y) && inContact(size, v, at)
}

/**
 * How many more crew a ship needs aboard to sail (`CONTEXT.md`: Crew: at least `SHIP_MIN_CREW`);
 * 0 once it has them, and for a boat, which its rower moves.
 */
export function crewShort(v: Pick<SeenVessel, 'kind'> & { crewIds?: readonly string[] }): number {
  if (v.kind !== 'ship') return 0
  return Math.max(0, SHIP_MIN_CREW - (v.crewIds?.length ?? 0))
}

/** What a vessel is called: "boat" or "ship". */
export function vesselName(v: { kind?: VesselKind }): string {
  return v.kind === 'ship' ? 'ship' : 'boat'
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
