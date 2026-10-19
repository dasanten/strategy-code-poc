import { CARRIAGE_CAPACITY, GOOD_WEIGHT, canWork, stockWeight } from './balance.js'
import { storageAt } from './goods.js'
import {
  type Carriage,
  type Good,
  type GoodsSpot,
  type Horse,
  type Resident,
  type WorldState,
} from './world.js'

/** World queries about carriages (ADR 0002: the game API orders and scripts share). */

/** The carriages standing on a tile. */
export function carriagesAt(world: WorldState, x: number, y: number): Carriage[] {
  return world.carriages.filter((k) => k.x === x && k.y === y)
}

/** The carriage a horse is hitched to, if it pulls one. */
export function carriagePulledBy(world: WorldState, horse: Horse): Carriage | undefined {
  return world.carriages.find((k) => k.horseId === horse.id)
}

/**
 * The horse that pulls a carriage once it is driven (`CONTEXT.md`: Carriage): the one hitched to
 * it, or else a horse of the carriage's realm on its tile that pulls no other carriage, which is
 * hitched when the carriage first moves. Undefined when there is none.
 */
export function horseFor(world: WorldState, carriage: Carriage): Horse | undefined {
  if (carriage.horseId) return world.horses.find((h) => h.id === carriage.horseId)
  return world.horses.find(
    (h) =>
      h.x === carriage.x &&
      h.y === carriage.y &&
      h.realmId === carriage.realmId &&
      !carriagePulledBy(world, h),
  )
}

/** The carriage a resident drives, by a drive order or on a haul route, if they drive one. */
export function drivenCarriageId(resident: Resident): string | undefined {
  const o = resident.order
  return o?.kind === 'drive' || o?.kind === 'haul' ? o.carriageId : undefined
}

/** The resident driving a carriage, if anyone is (`DriveOrder`, `HaulOrder`). */
export function driverOf(world: WorldState, carriage: Carriage): Resident | undefined {
  return world.residents.find((r) => drivenCarriageId(r) === carriage.id)
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
 * Why a resident can't drive a carriage now, or undefined when they can (`CONTEXT.md`:
 * Carriage): they must be grown up and on its tile, it must have a horse to pull it, and nobody
 * else may be driving it.
 */
export function driveProblem(
  world: WorldState,
  resident: Resident,
  carriage: Carriage,
): string | undefined {
  if (!canWork(resident, world.tick)) return 'children can’t drive'
  if (carriage.x !== resident.x || carriage.y !== resident.y) {
    return 'that carriage is not on the resident’s tile'
  }
  const horse = horseFor(world, carriage)
  if (!horse || horse.x !== carriage.x || horse.y !== carriage.y) {
    return 'no horse here to pull that carriage'
  }
  const driver = driverOf(world, carriage)
  if (driver && driver !== resident) return 'someone else is driving that carriage'
  return undefined
}

/** How many more whole units of a good fit on a carriage (`CARRIAGE_CAPACITY`). */
export function unitsThatFitCarriage(carriage: Carriage, good: Good): number {
  const room = CARRIAGE_CAPACITY - stockWeight(carriage.load)
  return Math.max(0, Math.floor(room / GOOD_WEIGHT[good] + 1e-9))
}
