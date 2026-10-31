import {
  HOME_FOOD_LOW,
  MAX_WORKERS,
  NPC_FOOD_SHORT_DAYS,
  OWN_FOOD,
  RECIPES,
  WALK_TICKS_PER_TILE,
  WORK_OUTPUT_PER_DAY,
  breedersAt,
  breedingPair,
  canWork,
  cityFoodUse,
  contractOf,
  hasFoodSurplus,
  inCityArea,
  isArmed,
  isAt,
  punishers,
  putAwayUnits,
  setOutFood,
  storedFood,
  unitsThatFit,
  workersOf,
  workplaceGood,
  wrapDistance,
  type Building,
  type City,
  type Good,
  type Resident,
  type ResidentOrder,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { cityGrowth } from './npc-growth.js'
import { refillSource } from './survival.js'
import { caravanCrew } from './caravans.js'
import { walkTime } from './walk-time.js'

/**
 * The orders an NPC city gives its residents: only kinds a Player's order can give too
 * (ADR 0002), so the city does nothing a Player's residents couldn't.
 */
export const NPC_ORDER_KINDS: readonly ResidentOrder['kind'][] = [
  'walkTo',
  'pickUp',
  'drop',
  'store',
  'fetch',
  'workAt',
  'build',
  'tearDown',
  'breed',
  'attack',
]

/**
 * Whether a resident is run by an NPC city: they live in one and belong to no realm, and no
 * mercenary contract rents them out (`CONTEXT.md`: Trade Org army).
 */
export function runByNpcCity(world: WorldState, r: Resident): boolean {
  if (r.owner !== null || r.cityId === null || contractOf(world, r.id)) return false
  return world.cities.some((c) => c.id === r.cityId && c.realmId === null)
}

/**
 * One tick of NPC city behaviour (`CONTEXT.md`: NPC city): each city run by the game keeps
 * itself alive. It only gives its residents orders, which request actions like a Player's
 * orders do (ADR 0002); the world resolves them later in the tick. Run before the actions are
 * requested. `size` is the map's. With `terrain` the cities also grow (`cityGrowth`).
 */
export function stepNpcCities(world: WorldState, size: number, terrain?: TerrainMap): void {
  const residents = new Map<string, Resident[]>()
  // A caravan's crew is run by its caravan (`stepCaravans`), a hired-out resident by the hirer, a
  // punisher by its punishment (`stepPunishments`).
  const crew = caravanCrew(world)
  const away = punishers(world)
  for (const r of world.residents) {
    if (r.owner !== null || r.cityId === null) continue
    if (crew.has(r.id) || away.has(r.id) || contractOf(world, r.id)) {
      // Nor do they go on with the city's Work default.
      if (r.script?.scriptId === 0) delete r.script
      continue
    }
    const list = residents.get(r.cityId) ?? []
    list.push(r)
    residents.set(r.cityId, list)
  }
  for (const city of world.cities) {
    if (city.realmId !== null) continue
    const people = residents.get(city.id)
    if (people) runCity(world, city, people, size, terrain)
  }
}

/**
 * What an NPC city does each tick: puts its idle adults to work on its farms and workplaces,
 * farms first until it has a food surplus; moves workers to its farms while Food runs short
 * (`NPC_FOOD_SHORT_DAYS`); has its workers run the game's Work default, which carries the
 * output to the storage (`CONTEXT.md`: Carrying the output; run right after, `runNpcScripts`);
 * sends workers who
 * run low on food where there is none to refill from home, and has residents take `OWN_FOOD`
 * from the storage before they set out, and one sent to a workplace the Food for the walk and
 * their first days there (`takeSetOutFood`); gives idle adults their part in the city's growth
 * (`cityGrowth`); and brings idle residents with nothing to do home. Its soldiers (armed adults)
 * are put to no work and no building (`stepNpcDefence`). Children are left alone:
 * they refill at home. A resident carrying a child gets no work and goes home.
 */
function runCity(
  world: WorldState,
  city: City,
  people: Resident[],
  size: number,
  terrain?: TerrainMap,
): void {
  const storage = world.buildings.find(
    (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
  )
  const short = storedFood(world, city) < cityFoodUse(world, city, NPC_FOOD_SHORT_DAYS)
  const places = workplaces(world, city, !hasFoodSurplus(world, city))
  const adults = people.filter((r) => canWork(r, world.tick))

  if (short) moveToFarms(world, places)
  for (const r of adults) {
    const o = r.order
    const busy = o?.kind === 'workAt' || o?.kind === 'build' || o?.kind === 'tearDown'
    if (busy && lowOnFood(r) && !refillSource(world, r, size)) stopWork(r)
    // Home at the storage with the load stored, a carrier is free for whatever the city needs
    // most (building, pairing), else back to work; one bringing the crew's Food back
    // (`CONTEXT.md`: Crew food) goes back by the Work default.
    const carry = r.script?.scriptId === 0 ? r.script.memory.carry : undefined
    const carrying = typeof carry === 'object' && carry !== null && !Array.isArray(carry)
    const bringsCrewFood = carrying && typeof carry.crewFood === 'number' && carry.crewFood >= 1
    if (
      carrying &&
      carry.stored === true &&
      !bringsCrewFood &&
      r.order?.kind !== 'store' &&
      storage &&
      isAt(r, storage, size)
    ) {
      stopWork(r)
    }
    // Stuck in the Build default (the site out of reach), a builder is free; built or gone, the
    // script ended itself.
    const built = r.script?.scriptId === 0 && r.script.task === 'build' ? r.script.memory : null
    if (built && built.stuck === true) stopWork(r)
    // Done breeding (a foal born, or the breeding stopped), a breeder is free too.
    const bred = r.script?.scriptId === 0 && r.script.task === 'breed' ? r.script.memory : null
    if (bred && bred.done === true) stopWork(r)
  }
  const home = npcHome(world, city)
  const growth = terrain && home && cityGrowth(world, city, home, adults, terrain, short)

  for (const r of adults) {
    if (r.order !== null || r.script) continue
    // Carrying a child, they get no work and stay at home, where they take their meals.
    if (r.carrying) {
      if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
      continue
    }
    if (growth && growth.assign(r, true)) continue
    const load = storage && haul(r)
    if (storage && load) {
      if (isAt(r, storage, size)) {
        r.order = { kind: 'drop', to: { kind: 'storage', storageId: storage.id }, goods: load }
      } else walkTo(r, storage)
      continue
    }
    const food = storage?.stock?.food ?? 0
    if (storage && food > 0 && (r.carried.food ?? 0) < OWN_FOOD) {
      if (isAt(r, storage, size)) {
        const units = Math.min(food, OWN_FOOD - (r.carried.food ?? 0))
        const from = { kind: 'storage' as const, storageId: storage.id }
        r.order = { kind: 'pickUp', from, goods: { food: units } }
      } else walkTo(r, storage)
      continue
    }
    const soldier = isArmed(r)
    if (!soldier && breedHorses(world, city, r)) continue
    if (!soldier && growth && growth.assign(r)) continue
    const place = !soldier && places.find((p) => room(world, p) > 0)
    if (place) {
      if (!storage || takeSetOutFood(world, r, place, storage, size, terrain)) putToWork(r, place)
      continue
    }
    if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
  }
}

/**
 * Has one of the city's residents breed its horses (`CONTEXT.md`: Breeding, NPC city): at the
 * first of its finished stables with two fed horses of the city in it, room for a foal and nobody
 * breeding there yet, they run the game's Breed horses default for that pair, which walks them
 * there. Whether they were given it.
 */
function breedHorses(world: WorldState, city: City, r: Resident): boolean {
  for (const stable of world.buildings) {
    if (stable.kind !== 'stable' || stable.site || stable.cityId !== city.id) continue
    const tending = world.residents.some(
      (x) => x.script?.task === 'breed' && x.script.memory.stableId === stable.id,
    )
    if (tending || breedersAt(world.residents, stable).length > 0) continue
    const pair = breedingPair(world, stable, { cityId: city.id })
    if (!pair) continue
    const memory = { stableId: stable.id, horseIds: pair.map((h) => h.id) }
    r.script = { scriptId: 0, task: 'breed', memory }
    return true
  }
  return false
}

/**
 * The city's finished workplaces that make something from nothing (farms, camps, quarries,
 * mines; not those that process goods), its farms and those in its `workplaceIds`, in the order
 * it fills them: farms first until the city has a food surplus, else last.
 */
function workplaces(world: WorldState, city: City, farmsFirst: boolean): Building[] {
  const own = new Set(city.workplaceIds)
  const places = world.buildings.filter(
    (b) =>
      (b.cityId === city.id || own.has(b.id)) &&
      !b.site &&
      MAX_WORKERS[b.kind] !== undefined &&
      !RECIPES[b.kind] &&
      workplaceGood(world, b) !== undefined,
  )
  const farm = (b: Building) => (b.kind === 'farm' ? 0 : 1)
  return places.sort((a, b) => (farmsFirst ? 1 : -1) * (farm(a) - farm(b)))
}

/**
 * Room left at a workplace: its most workers, minus those working it by its Work default (there,
 * on their way or away carrying), on it by a bare work-at order, or walking to it.
 */
function room(world: WorldState, place: Building): number {
  return (MAX_WORKERS[place.kind] ?? 0) - takenPlaces(world, place)
}

/** Residents working a workplace by its Work default or a bare work-at order, or walking to it. */
export function takenPlaces(world: WorldState, place: Building): number {
  return world.residents.filter(
    (r) =>
      r.script?.memory.workplaceId === place.id ||
      (r.order?.kind === 'workAt' && r.order.buildingId === place.id) ||
      (r.order?.kind === 'walkTo' && r.order.target.x === place.x && r.order.target.y === place.y),
  ).length
}

/**
 * Before a resident sets out for a workplace, they take the Food for the walk there and back and
 * their first days of work (`setOutFood`; `CONTEXT.md`: Crew food, NPC city) from the storage
 * while it has Food and they carry less: at it, a pick-up of what they lack, as much as fits,
 * which the Work default given the same tick waits for (so an idle resident never puts the
 * surplus back, `haul`); away from it, the walk there first. The walk is reckoned from where they
 * stand, by the terrain when given, else by tiles. Whether they set out now, rather than walking
 * to the storage first.
 */
function takeSetOutFood(
  world: WorldState,
  r: Resident,
  place: Building,
  storage: Building,
  size: number,
  terrain?: TerrainMap,
): boolean {
  const food = storage.stock?.food ?? 0
  if (food <= 0) return true
  const walk = terrain
    ? walkTime(world, terrain, () => true, r, r, place)
    : wrapDistance(size, r, place) * WALK_TICKS_PER_TILE
  const short = setOutFood(walk) - (r.carried.food ?? 0)
  if (short <= 1e-9) return true
  if (!isAt(r, storage, size)) {
    walkTo(r, storage)
    return false
  }
  const units = Math.min(food, short, unitsThatFit(r, 'food', world.tick))
  if (units <= 0) return true
  const from = { kind: 'storage' as const, storageId: storage.id }
  r.order = { kind: 'pickUp', from, goods: { food: units } }
  return true
}

/**
 * Puts one of the city's residents to work a workplace: they run the game's Work default for it
 * (`runNpcScripts`), which walks them there.
 */
export function putToWork(r: Resident, place: Building): void {
  const at = { x: place.x, y: place.y }
  r.script = { scriptId: 0, task: 'work', memory: { workplaceId: place.id, at } }
}

/** Ends a resident's work: their order, and the Work default they run, if any. */
export function stopWork(r: Resident): void {
  r.order = null
  delete r.script
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
      stopWork(worker)
      return
    }
  }
}

/**
 * What a resident carries for the storage: the goods workplaces make, all but `OWN_FOOD` Food
 * to eat; none if nothing. Weapons and armour stay on them.
 */
function haul(r: Resident): Stock | undefined {
  const load: Stock = {}
  for (const [good, units] of Object.entries(r.carried) as [Good, number][]) {
    if (WORK_OUTPUT_PER_DAY[good] === undefined) continue
    const n = putAwayUnits(good, units)
    if (n > 0) load[good] = n
  }
  return Object.keys(load).length > 0 ? load : undefined
}

/** Whether a resident carries less food than a resident at home takes meals at (`HOME_FOOD_LOW`). */
const lowOnFood = (r: Resident) => (r.carried.food ?? 0) < HOME_FOOD_LOW

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
