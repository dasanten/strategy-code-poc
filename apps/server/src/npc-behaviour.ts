import {
  MAX_WORKERS,
  NPC_FETCH_UNITS,
  NPC_FOOD_LEFT_AT_WORK,
  NPC_FOOD_SHORT_DAYS,
  NPC_OWN_FOOD,
  RECIPES,
  WORK_OUTPUT_PER_DAY,
  canWork,
  cityFoodUse,
  inCityArea,
  pileAt,
  storedFood,
  workProblem,
  workersOf,
  workplaceGood,
  type Building,
  type City,
  type Good,
  type Resident,
  type ResidentOrder,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { startWork } from './work.js'

/**
 * The orders an NPC city gives its residents: only kinds a Player's order can give too
 * (ADR 0002), so the city does nothing a Player's residents couldn't.
 */
export const NPC_ORDER_KINDS: readonly ResidentOrder['kind'][] = [
  'walkTo',
  'pickUp',
  'drop',
  'workAt',
  'pair',
]

/** Whether a resident is run by an NPC city: they live in one and belong to no realm. */
export function runByNpcCity(world: WorldState, r: Resident): boolean {
  if (r.owner !== null || r.cityId === null) return false
  return world.cities.some((c) => c.id === r.cityId && c.realmId === null)
}

/**
 * One tick of NPC city behaviour (`CONTEXT.md`: NPC city): each city run by the game keeps
 * itself alive. It only gives its residents orders, which request actions like a Player's
 * orders do (ADR 0002); the world resolves them later in the tick. Run before the actions are
 * requested. `size` is the map's.
 */
export function stepNpcCities(world: WorldState, size: number): void {
  const residents = new Map<string, Resident[]>()
  for (const r of world.residents) {
    if (r.owner !== null || r.cityId === null) continue
    const list = residents.get(r.cityId) ?? []
    list.push(r)
    residents.set(r.cityId, list)
  }
  for (const city of world.cities) {
    if (city.realmId !== null) continue
    const people = residents.get(city.id)
    if (people) runCity(world, city, people, size)
  }
}

/**
 * What an NPC city does each tick: puts its idle adults to work on its farms and workplaces,
 * farms first while Food runs short (`NPC_FOOD_SHORT_DAYS`); sends a worker to carry a
 * workplace's output to the storage once `NPC_FETCH_UNITS` of it lie there; and brings idle
 * residents with nothing to do home. Children are left alone: they refill at home.
 */
function runCity(world: WorldState, city: City, people: Resident[], size: number): void {
  const storage = world.buildings.find(
    (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
  )
  const short = storedFood(world, city) < cityFoodUse(world, city, NPC_FOOD_SHORT_DAYS)
  const places = workplaces(world, city, short)
  const adults = people.filter((r) => canWork(r, world.tick))

  if (storage) for (const place of places) fetchOutput(world, place)
  if (short) moveToFarms(world, places)

  for (const r of adults) {
    if (r.order !== null) continue
    const load = storage && haul(r)
    if (storage && load) {
      if (r.x === storage.x && r.y === storage.y) {
        r.order = { kind: 'drop', to: { kind: 'storage', storageId: storage.id }, goods: load }
      } else walkTo(r, storage)
      continue
    }
    const place = places.find((p) => room(world, p) > 0)
    if (place) {
      if (r.x === place.x && r.y === place.y) {
        if (workProblem(world, r) === undefined) startWork(r, place)
      } else walkTo(r, place)
      continue
    }
    const home = npcHome(world, city)
    if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
  }
}

/**
 * The city's finished workplaces that make something from nothing (farms, camps, quarries,
 * mines; not those that process goods), in the order it fills them: farms first while Food runs
 * short, else last.
 */
function workplaces(world: WorldState, city: City, short: boolean): Building[] {
  const places = world.buildings.filter(
    (b) =>
      b.cityId === city.id &&
      !b.site &&
      MAX_WORKERS[b.kind] !== undefined &&
      !RECIPES[b.kind] &&
      workplaceGood(world, b) !== undefined,
  )
  const farmsFirst = (b: Building) => (b.kind === 'farm' ? 0 : 1)
  return places.sort((a, b) => (short ? 1 : -1) * (farmsFirst(a) - farmsFirst(b)))
}

/** Room left at a workplace: its most workers, minus those on it and those walking to it. */
function room(world: WorldState, place: Building): number {
  const coming = world.residents.filter(
    (r) =>
      r.order?.kind === 'walkTo' && r.order.target.x === place.x && r.order.target.y === place.y,
  ).length
  return (MAX_WORKERS[place.kind] ?? 0) - workersOf(world, place).length - coming
}

/**
 * Once `NPC_FETCH_UNITS` of a workplace's good lie in the pile on its tile, one of its workers
 * stops to pick it up, leaving `NPC_FOOD_LEFT_AT_WORK` Food for the others to refill from.
 */
function fetchOutput(world: WorldState, place: Building): void {
  const good = workplaceGood(world, place)
  if (!good) return
  const lying = pileAt(world, place.x, place.y)?.goods[good] ?? 0
  const units = lying - (good === 'food' ? NPC_FOOD_LEFT_AT_WORK : 0)
  if (lying < NPC_FETCH_UNITS || units <= 0) return
  const worker = workersOf(world, place)[0]
  if (worker) worker.order = { kind: 'pickUp', from: { kind: 'ground' }, goods: { [good]: units } }
}

/**
 * Food runs short: one worker of a workplace that isn't a farm stops, so they go to a farm with
 * room, if there is one.
 */
function moveToFarms(world: WorldState, places: Building[]): void {
  if (!places.some((p) => p.kind === 'farm' && room(world, p) > 0)) return
  for (const place of places) {
    if (place.kind === 'farm') continue
    const worker = workersOf(world, place)[0]
    if (worker) {
      worker.order = null
      return
    }
  }
}

/**
 * What a resident carries for the storage: the goods workplaces make, all but `NPC_OWN_FOOD` Food
 * to eat; none if nothing. Weapons and armour stay on them.
 */
function haul(r: Resident): Stock | undefined {
  const load: Stock = {}
  for (const [good, units] of Object.entries(r.carried) as [Good, number][]) {
    if (WORK_OUTPUT_PER_DAY[good] === undefined) continue
    const n = good === 'food' ? units - NPC_OWN_FOOD : units
    if (n > 0) load[good] = n
  }
  return Object.keys(load).length > 0 ? load : undefined
}

/** Gives a resident an order to walk to a tile. */
export function walkTo(r: Resident, to: { x: number; y: number }): void {
  r.order = { kind: 'walkTo', target: { x: to.x, y: to.y }, path: null, progress: 0 }
}

/** Where an NPC city's residents go home to: its finished storage, else its town hall. */
export function npcHome(world: WorldState, city: City): Building | undefined {
  return (
    world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage' && !b.site) ??
    world.buildings.find((b) => b.id === city.townHallId)
  )
}
