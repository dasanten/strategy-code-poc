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
import type { StealingResident } from './carriages.js'
import { guardedBy } from './city.js'
import { inContact } from './combat.js'
import { covers } from './footprint.js'
import { canWork, stockWeight } from './stats.js'

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

/**
 * Why a resident can't board the vessel now, if so (`CONTEXT.md`: Beside a vessel, What vessels
 * carry, Docked, Crew): only beside it (a ship only docked, from its haven), a rider dismounts
 * first (no horse goes aboard), the driver can't, and it must have room for one more passenger.
 * As crew (`asCrew`), only a ship and only grown (`child` says they aren't), taking no room.
 */
export function boardBoatProblem(
  r: { x: number; y: number; riding?: string; aboard?: string; driving?: boolean },
  v: Pick<SeenVessel, 'x' | 'y' | 'load' | 'passengerIds'> & {
    kind?: VesselKind
    dockedAt?: string
  },
  opts: { buildings?: Havens; size?: number; asCrew?: boolean; child?: boolean } = {},
): string | undefined {
  const name = vesselName(v)
  if (r.aboard !== undefined) return 'already aboard'
  if (opts.asCrew && v.kind !== 'ship') return 'only a ship takes a crew'
  if (v.kind === 'ship' && v.dockedAt === undefined) return 'the ship is not docked at a haven'
  if (!besideVessel(v, r, opts.size, opts.buildings))
    return v.kind === 'ship' ? 'not at the haven the ship is docked at' : 'not beside the boat'
  if (r.driving) return 'the driver can’t board'
  if (r.riding !== undefined) return 'no horse goes aboard: dismount first'
  if (opts.asCrew) return opts.child ? 'children can’t crew a ship' : undefined
  const room = vesselRoom(v)
  if (room !== undefined && room < PASSENGER_WEIGHT - 1e-9) return `the ${name} is full`
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
  v: Pick<SeenVessel, 'id' | 'x' | 'y' | 'realmId' | 'passengerIds' | 'rowerId'> & {
    kind?: VesselKind
  },
  realmId: string,
  size = MAP_SIZE,
): string | undefined {
  // A ship is stolen by sailing it off with a crew, never rowed (`CONTEXT.md`: Sailing).
  if (v.kind === 'ship') return 'a ship is sailed, not rowed'
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
