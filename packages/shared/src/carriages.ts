import {
  CARAVAN_ESCORTS,
  CARAVAN_ESCORTS_MAX,
  CARAVAN_FOOD,
  CARAVAN_FOOD_PER_ESCORT,
  CARAVAN_ROBBERIES_PER_ESCORT,
  CARRIAGE_HALF_LOAD,
  CARRIAGE_LIGHT_LOAD,
  GOOD_WEIGHT,
  PASSENGER_WEIGHT,
  canWork,
  carriageCapacityWith,
  stockWeight,
} from './balance.js'
import { storageAt } from './goods.js'
import {
  type Caravan,
  type Carriage,
  type Good,
  type GoodsSpot,
  type Horse,
  type Resident,
  type Stock,
  type WorldState,
} from './world.js'

/** World queries about carriages (ADR 0002: the game API orders and scripts share). */

/** The Trade Org caravan a resident drives or escorts, if any (`CONTEXT.md`: Caravan). */
export function caravanOf(
  world: Pick<WorldState, 'caravans'>,
  residentId: string,
): Caravan | undefined {
  return world.caravans.find((c) => c.driverId === residentId || c.escortIds.includes(residentId))
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
  const extra = Math.floor((world.routeRobberies[postId] ?? 0) / CARAVAN_ROBBERIES_PER_ESCORT)
  return Math.min(CARAVAN_ESCORTS_MAX, CARAVAN_ESCORTS + extra)
}

/**
 * The Food a caravan keeps on board for a crew with `escorts` escorts (`CONTEXT.md`: Caravan):
 * `CARAVAN_FOOD`, and `CARAVAN_FOOD_PER_ESCORT` more for each escort beyond `CARAVAN_ESCORTS`.
 */
export function caravanFoodFor(escorts: number): number {
  return CARAVAN_FOOD + CARAVAN_FOOD_PER_ESCORT * Math.max(0, escorts - CARAVAN_ESCORTS)
}

/** The carriages standing on a tile. */
export function carriagesAt(world: WorldState, x: number, y: number): Carriage[] {
  return world.carriages.filter((k) => k.x === x && k.y === y)
}

/** What of a horse the carriage queries need: all a Player sees of any horse (`SeenHorse`). */
export type CarriageHorse = Omit<Horse, 'hunger' | 'health'>

/** What of a carriage the queries about its horse need: all a Player sees of any carriage. */
export type CarriagePlace = Pick<Carriage, 'horseId' | 'x' | 'y' | 'realmId' | 'cityId'>

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
 * Riding), as far as `residents` tell. Undefined when there is none.
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
  return world.horses.find(
    (h) =>
      h.x === carriage.x &&
      h.y === carriage.y &&
      h.realmId === carriage.realmId &&
      h.cityId === carriage.cityId &&
      !carriagePulledBy(world, h) &&
      !world.residents?.some((r) => r.riding === h.id),
  )
}

/** The carriage a resident drives, by a drive order or on a haul route, if they drive one. */
export function drivenCarriageId(resident: Pick<Resident, 'order'>): string | undefined {
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
 * Carriage): they must be grown up, on foot (`CONTEXT.md`: Riding) and on its tile, it must have
 * a horse to pull it, and nobody else may be driving it.
 */
export function driveProblem(
  world: WorldState,
  resident: Resident,
  carriage: Carriage,
): string | undefined {
  if (!canWork(resident, world.tick)) return 'children can’t drive'
  if (resident.riding !== undefined) return 'dismount first to drive'
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
 * Why a resident can't board a carriage now, or undefined when they can (`CONTEXT.md`:
 * Passenger): it must be of their realm and on their tile, with room for one more passenger;
 * they must be aboard no carriage, on foot (`CONTEXT.md`: Riding) and drive none.
 */
export function boardProblem(
  world: WorldState,
  resident: Resident,
  carriage: Carriage | undefined,
): string | undefined {
  if (!carriage) return 'no such carriage'
  if (resident.aboard === carriage.id) return 'already aboard that carriage'
  if (resident.aboard !== undefined) return 'already aboard another carriage'
  if (!carriageOfResident(carriage, resident)) return 'not a carriage of your realm'
  if (carriage.x !== resident.x || carriage.y !== resident.y) {
    return 'that carriage is not on the resident’s tile'
  }
  if (drivenCarriageId(resident) !== undefined) return 'the driver can’t board'
  if (resident.riding !== undefined) return 'dismount first to board'
  if (carriageRoom(world, carriage) < PASSENGER_WEIGHT - 1e-9) return 'the carriage is full'
  return undefined
}

/**
 * How heavily a carriage looks loaded to a Player who can't see its load (`CONTEXT.md`: Seeing
 * inside a storage).
 */
export type LoadLevel = 'empty' | 'light' | 'half' | 'heavy' | 'full'

/** How heavily a load looks, by its weight against what its carriage holds (`carriageCapacity`). */
export function loadLevel(load: Stock, capacity: number): LoadLevel {
  const share = stockWeight(load) / capacity
  if (share <= 0) return 'empty'
  if (share <= CARRIAGE_LIGHT_LOAD) return 'light'
  if (share <= CARRIAGE_HALF_LOAD) return 'half'
  return share < 1 - 1e-9 ? 'heavy' : 'full'
}
