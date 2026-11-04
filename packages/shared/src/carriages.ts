import {
  CARAVAN_ESCORTS,
  CARAVAN_ESCORTS_MAX,
  CARAVAN_FOOD,
  CARAVAN_FOOD_PER_ESCORT,
  CARAVAN_ROBBERIES_PER_ESCORT,
  CARRIAGE_HALF_LOAD,
  CARRIAGE_LIGHT_LOAD,
  CARAVAN_GUARD_RANGE,
  GOOD_WEIGHT,
  MAP_SIZE,
  PASSENGER_WEIGHT,
  canWork,
  carriageCapacityWith,
  isArmed,
  stockWeight,
} from './balance.js'
import { guardedBy, type GuardResident } from './city.js'
import { storageAt } from './goods.js'
import { wrapDistance } from './terrain.js'
import {
  type Caravan,
  type Carriage,
  type Good,
  type GoodsSpot,
  type Horse,
  type Resident,
  type Stock,
  type WorldState,
  isDown,
} from './world.js'

/** World queries about carriages (ADR 0002: the game API orders and scripts share). */

/** The Trade Org caravan a resident drives or escorts, if any (`CONTEXT.md`: Caravan). */
export function caravanOf(
  world: Pick<WorldState, 'caravans'>,
  residentId: string,
): Caravan | undefined {
  return world.caravans.find((c) => c.driverId === residentId || c.escortIds.includes(residentId))
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
export type CarriageHorse = Omit<Horse, 'hunger' | 'health'> & { down?: true }

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
  return world.horses.find(
    (h) =>
      h.x === carriage.x &&
      h.y === carriage.y &&
      h.realmId === carriage.realmId &&
      h.cityId === carriage.cityId &&
      !carriagePulledBy(world, h) &&
      !isDown(h) &&
      !world.residents?.some((r) => r.riding === h.id),
  )
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
 * a horse to pull it that isn't Down (`CONTEXT.md`: Down), and nobody else may be driving it.
 */
export function driveProblem<R extends Pick<Resident, 'order' | 'riding' | 'x' | 'y' | 'bornAt'>>(
  world: {
    tick: number
    residents: readonly R[]
    horses: readonly CarriageHorse[]
    carriages: readonly CarriagePlace[]
  },
  resident: R,
  carriage: CarriagePlace & Pick<Carriage, 'id'>,
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
  if (isDown(horse)) return 'its horse is Down'
  const driver = driverOf(world, carriage)
  if (driver && driver !== resident) return 'someone else is driving that carriage'
  return undefined
}

/** What of a resident the stealing checks look at: all a Player sees of anyone in sight. */
export type StealingResident = GuardResident &
  Pick<Resident, 'id' | 'x' | 'y' | 'owner' | 'cityId' | 'bornAt' | 'order' | 'riding' | 'aboard'>

/**
 * Why a resident can't take the carriage or horse `thing` of another organization for the realm
 * `realmId` now, what has them all in common (`CONTEXT.md`: Stealing a carriage or horse): they
 * must be grown up and on its tile, and it mustn't be guarded: an armed resident of its owner
 * stands on the tile and none of the thief's realm does, the thief themselves included. `what`
 * names the thing in the reason.
 */
export function takeProblem<R extends StealingResident>(
  world: { tick: number; residents: readonly R[] },
  thief: R,
  thing: Pick<Carriage, 'x' | 'y' | 'realmId' | 'cityId'>,
  realmId: string,
  what: 'carriage' | 'horse',
): string | undefined {
  if (!canWork(thief, world.tick)) return 'children can’t steal'
  if (thing.x !== thief.x || thing.y !== thief.y) {
    return `that ${what} is not on the resident’s tile`
  }
  const guarded = guardedBy(
    world.residents,
    (r) => r.x === thing.x && r.y === thing.y,
    (r) => carriageOfResident(thing, r),
    (r) => r.id === thief.id || r.owner === realmId,
  )
  return guarded ? `an armed resident guards that ${what}` : undefined
}

/** What of the world the checks on driving off with something stolen look at: all a Player sees. */
interface StealingWorld<R, H extends CarriageHorse = CarriageHorse> {
  tick: number
  residents: readonly R[]
  horses: readonly H[]
  carriages: readonly CarriagePlace[]
}

/**
 * The horse of another organization a driver of the realm `realmId` would steal by driving off in
 * the carriage (`CONTEXT.md`: Stealing a carriage or horse), which then is hitched: only with no
 * horse hitched and no free horse of the realm's on its tile, which comes first (`horseFor`). Of
 * the free ones there it is one they can take, the carriage's owner's first; `named` keeps to that
 * horse. Undefined when there is none.
 */
export function horseToSteal<R extends StealingResident, H extends CarriageHorse>(
  world: StealingWorld<R, H>,
  driver: R,
  carriage: CarriagePlace,
  realmId: string,
  named?: string,
): H | undefined {
  if (carriage.horseId) return undefined
  if (horseFor(world, { ...carriage, realmId, cityId: null })) return undefined
  const free = world.horses.filter(
    (h) =>
      (named === undefined || h.id === named) &&
      h.x === carriage.x &&
      h.y === carriage.y &&
      h.realmId !== realmId &&
      !carriagePulledBy(world, h) &&
      !isDown(h) &&
      !world.residents.some((r) => r.riding === h.id),
  )
  const open = free.filter((h) => !takeProblem(world, driver, h, realmId, 'horse'))
  const sameOwner = (h: H) => h.realmId === carriage.realmId && h.cityId === carriage.cityId
  return open.find(sameOwner) ?? open[0] ?? free[0]
}

/**
 * Why a resident can't drive a carriage of their realm `carriage.realmId` off, stealing the horse
 * to pull it if there is one to steal (`horseToSteal`), or undefined when they can (`CONTEXT.md`:
 * Stealing a carriage or horse). With a horse of the realm's there, that one pulls it and nothing
 * is stolen. `named` keeps to that horse.
 */
export function hitchOffProblem<R extends StealingResident>(
  world: StealingWorld<R>,
  driver: R,
  carriage: CarriagePlace & Pick<Carriage, 'id'> & { realmId: string },
  named?: string,
): string | undefined {
  const horse = horseToSteal(world, driver, carriage, carriage.realmId, named)
  if (!horse) return driveProblem(world, driver, carriage)
  return (
    takeProblem(world, driver, horse, carriage.realmId, 'horse') ??
    driveProblem(world, driver, { ...carriage, horseId: horse.id })
  )
}

/**
 * Why a caravan's crew keep its carriage from being taken, on a map of `size` tiles (`CONTEXT.md`:
 * Caravan crew lost): its driver or an armed escort is up and within `CARAVAN_GUARD_RANGE` of it.
 * They have to be beaten or gone, however many of the thief's realm stand there; one still walking
 * out doesn't count until they are that near.
 */
function crewHolds<R extends StealingResident>(
  residents: readonly R[],
  caravan: Pick<Caravan, 'driverId' | 'escortIds'>,
  carriage: Pick<Carriage, 'x' | 'y'>,
  size: number,
): string | undefined {
  const near = (id: string | null, armed: boolean) =>
    residents.some(
      (r) =>
        r.id === id &&
        (r.health ?? 1) > 0 &&
        !isDown(r) &&
        (!armed || isArmed(r)) &&
        wrapDistance(size, r, carriage) <= CARAVAN_GUARD_RANGE,
    )
  if (near(caravan.driverId, false)) return 'its driver is still with that caravan’s carriage'
  if (caravan.escortIds.some((id) => near(id, true))) {
    return 'its escort guards that caravan’s carriage'
  }
  return undefined
}

/**
 * Why a resident can't drive off in another organization's carriage for the realm `realmId` now,
 * or undefined when they can (`CONTEXT.md`: Stealing a carriage or horse): nobody may drive it or
 * be aboard, a caravan's crew mustn't hold it (`crewHolds`), it mustn't be guarded
 * (`takeProblem`), and they must be able to drive it as if it were their realm's already, so with
 * its hitched horse, a free one of that realm on its tile, or else one they steal with it
 * (`hitchOffProblem`). `size` is the map's.
 */
export function driveOffProblem<R extends StealingResident>(
  world: {
    tick: number
    residents: readonly R[]
    horses: readonly CarriageHorse[]
    carriages: readonly CarriagePlace[]
    caravans: readonly Pick<Caravan, 'carriageId' | 'driverId' | 'escortIds'>[]
  },
  thief: R,
  carriage: CarriagePlace & Pick<Carriage, 'id'>,
  realmId: string,
  size = MAP_SIZE,
): string | undefined {
  if (driverOf(world, carriage)) return 'someone is driving that carriage'
  if (passengersOf(world, carriage).length > 0) return 'someone is aboard that carriage'
  const caravan = world.caravans.find((c) => c.carriageId === carriage.id)
  const held = caravan && crewHolds(world.residents, caravan, carriage, size)
  if (held) return held
  return (
    takeProblem(world, thief, carriage, realmId, 'carriage') ??
    hitchOffProblem(world, thief, { ...carriage, realmId, cityId: null })
  )
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
 * Why a resident can't unhitch a carriage's horse now, or undefined when they can (`CONTEXT.md`:
 * Hitched horse): they must be grown up and of the carriage's realm, standing on its tile, and a
 * horse must be hitched to it.
 */
export function unhitchProblem(
  resident: Pick<Resident, 'x' | 'y' | 'owner' | 'cityId' | 'bornAt'>,
  carriage: Pick<Carriage, 'x' | 'y' | 'realmId' | 'cityId' | 'horseId'> | undefined,
  tick: number,
): string | undefined {
  if (!carriage) return 'no such carriage'
  if (!canWork(resident, tick)) return 'children can’t unhitch'
  if (!carriageOfResident(carriage, resident)) return 'not a carriage of your realm'
  if (carriage.x !== resident.x || carriage.y !== resident.y) {
    return 'that carriage is not on the resident’s tile'
  }
  if (!carriage.horseId) return 'no horse is hitched to that carriage'
  return undefined
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
  const problem = boarderProblem(resident, carriage)
  if (problem) return problem
  if (carriageRoom(world, carriage) < PASSENGER_WEIGHT - 1e-9) return 'the carriage is full'
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
