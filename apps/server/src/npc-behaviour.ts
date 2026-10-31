import {
  GOOD_WEIGHT,
  HOME_FOOD_LOW,
  NPC_SMITHY_WEAPON,
  RECIPES,
  carryCapacity,
  hasInput,
  recipeFor,
  stockWeight,
  type CityJob,
  type ScriptMemory,
  NPC_BUILDERS,
  OWN_FOOD,
  WALK_TICKS_PER_TILE,
  WORK_OUTPUT_PER_DAY,
  breedersAt,
  breedingPair,
  canWork,
  contractOf,
  inCityArea,
  isArmed,
  isAt,
  putAwayUnits,
  setOutFood,
  unitsThatFit,
  wrapDistance,
  type Building,
  type City,
  type CityPlan,
  type Good,
  type Resident,
  type ResidentOrder,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import {
  cityGrows,
  cityProject,
  isBuilder,
  stopBuildersWhoCantGoOn,
  takePart,
} from './npc-growth.js'
import {
  Places,
  foodShort,
  planCity,
  planDue,
  projectDone,
  runResidents,
  workplaceOf,
} from './npc-plan.js'
import { chainStore, holdsBatch, warehouseFor } from './npc-chain.js'
import { refillSource } from './survival.js'
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
 * requested. `size` is the map's. A city whose planning pass is due plans (`planCity`, ADR 0016),
 * with `terrain` picking its project too; the others go by their plan. Plans of cities the game
 * no longer runs are dropped. Returns the milliseconds spent planning, for the tick health.
 */
export function stepNpcCities(world: WorldState, size: number, terrain?: TerrainMap): number {
  const cities = new Map(world.cities.map((c) => [c.id, c]))
  for (const id of Object.keys(world.cityPlans)) {
    const city = cities.get(id)
    if (!city || city.realmId !== null) delete world.cityPlans[id]
  }
  const residents = runResidents(world)
  const buildings = new Map(world.buildings.map((b) => [b.id, b]))
  let planMs = 0
  for (const city of world.cities) {
    if (city.realmId !== null) continue
    const people = residents.get(city.id)
    if (people) planMs += runCity(world, city, people, size, buildings, terrain)
  }
  return planMs
}

/**
 * What an NPC city does each tick: plans when its pass is due (`planCity`); stops workers who
 * run low on food where there is none, carriers home with their load stored, builders stuck or
 * out of materials, breeders who are done and workers at a smelter or smithy with nothing left to
 * process, so they get their next job; moves a worker whose plan puts them elsewhere, or nowhere;
 * then gives each idle adult what comes first: a resident carrying a child stays at home; one
 * carrying materials the project needs takes them to its site; a load of goods goes into the
 * storage; they take `OWN_FOOD` from the storage before they set out; one of them breeds the
 * city's horses (`breedHorses`); a planned builder takes their part in the project (`takePart`),
 * picking the next one once it is finished; a planned worker at a workplace that processes goods
 * first takes its input from the storage (`takeInput`), and waits at home while the storage holds
 * none; a planned worker runs the game's Work default at their workplace (`runNpcScripts`), which
 * carries the output to the storage
 * (`CONTEXT.md`: Carrying the output), taking the Food for the walk and their first days there
 * from the storage first (`takeSetOutFood`); with nothing to do they come home. Its soldiers (armed
 * adults) are put to no work and no building (`stepNpcDefence`). Children are left alone: they
 * refill at home. Returns the milliseconds spent planning.
 */
function runCity(
  world: WorldState,
  city: City,
  people: Resident[],
  size: number,
  buildings: Map<string, Building>,
  terrain?: TerrainMap,
): number {
  let planMs = 0
  let plan: CityPlan | undefined = world.cityPlans[city.id]
  if (planDue(world, city)) {
    const start = performance.now()
    plan = planCity(world, city, terrain, people)
    planMs += performance.now() - start
  }
  const storage = world.buildings.find(
    (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
  )
  // Materials and a smith's input: a Trade Org city's from its warehouse (`chainStore`).
  const store = chainStore(world, city)
  const adults = people.filter((r) => canWork(r, world.tick))
  const jobs = plan?.jobs ?? {}

  stopBuildersWhoCantGoOn(world, adults, store)
  for (const r of adults) {
    sendToWarehouse(world, city, r)
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
    // The pass just now put them at another workplace, or to building, or let them go. Only
    // then: between passes someone else may have put them to work (a smithy forging their spear).
    const job = jobs[r.id]
    const at = workplaceOf(r)
    const moved =
      job !== undefined && job.kind !== 'soldier' && at !== undefined && at !== job.buildingId
    if (moved && !r.carrying && plan?.plannedAt === world.tick) stopWork(r)
    // At a workplace that processes goods with nothing left to process, they fetch more.
    const place = at !== undefined && r.order?.kind === 'workAt' ? buildings.get(at) : undefined
    if (place && RECIPES[place.kind] && !inputLeft(world, place, r)) stopWork(r)
  }

  const home = npcHome(world, city)
  const held = new Places(people)
  let free = NPC_BUILDERS - adults.filter(isBuilder).length
  // The project, picked anew once the planned one is finished: a site search, so once a tick at most.
  let checked = false
  const project = () => {
    if (!plan || !terrain || !home) return undefined
    if (!checked && plan.project && projectDone(world, plan.project)) {
      const start = performance.now()
      const next = !foodShort(world, city)
        ? cityProject(world, city, home, terrain, cityGrows(world, city, adults))
        : undefined
      if (next) plan.project = next
      else delete plan.project
      planMs += performance.now() - start
    }
    checked = true
    return plan.project
  }

  for (const r of adults) {
    if (r.order !== null || r.script) continue
    // Carrying a child, they get no work and stay at home, where they take their meals.
    if (r.carrying) {
      if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
      continue
    }
    if (free > 0 && carriesMaterials(r)) {
      const p = project()
      if (p && takePart(world, r, p, store, true)) {
        free--
        continue
      }
    }
    const load = storage && haul(r, inputOf(buildings, jobs[r.id]))
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
    const job = jobs[r.id]
    const soldier = isArmed(r) || job?.kind === 'soldier'
    if (!soldier && breedHorses(world, city, r)) continue
    if (!soldier && job?.kind === 'build' && free > 0) {
      const p = project()
      if (p && takePart(world, r, p, store, false)) {
        free--
        continue
      }
    }
    if (!soldier && job?.buildingId !== undefined) {
      const place = world.buildings.find((b) => b.id === job.buildingId)
      if (place && !place.site && held.room(place) > 0) {
        const input = inputOf(buildings, job)
        if (input && !takeInput(world, r, input, store, size)) {
          if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
          continue
        }
        if (r.order !== null) continue
        if (!storage || takeSetOutFood(world, r, place, storage, size, terrain)) {
          putToWork(r, place)
          held.take(place)
        }
        continue
      }
    }
    if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
  }
  return planMs
}

/** Whether a resident carries goods a site could take: anything workplaces make but Food. */
function carriesMaterials(r: Resident): boolean {
  return (Object.entries(r.carried) as [Good, number][]).some(
    ([good, units]) => good !== 'food' && units > 0 && WORK_OUTPUT_PER_DAY[good] !== undefined,
  )
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
 * A Trade Org city's carrier takes the load to the warehouse that keeps it (`warehouseFor`;
 * `CONTEXT.md`: Trading post, Trade Org HQ), so less of its stock comes from the floor: the Work
 * default picked the nearest storage, and before it stores the load the city names the warehouse
 * instead, as a Player names one by its storage param. A load of Food stays for the storage.
 */
function sendToWarehouse(world: WorldState, city: City, r: Resident): void {
  if (!city.tradeOrg || r.script?.scriptId !== 0) return
  const carry = r.script.memory.carry
  if (typeof carry !== 'object' || carry === null || Array.isArray(carry)) return
  if (carry.stored === true || !Array.isArray(carry.goods)) return
  const warehouse = warehouseFor(world, city, carry.goods as Good[])
  if (warehouse) carry.storageId = warehouse.id
}

/**
 * Puts one of the city's residents to work a workplace: they run the game's Work default for it
 * (`runNpcScripts`), which walks them there.
 */
export function putToWork(r: Resident, place: Building): void {
  const at = { x: place.x, y: place.y }
  const memory: ScriptMemory = { workplaceId: place.id, at }
  if (place.kind === 'smithy') memory.makes = NPC_SMITHY_WEAPON
  r.script = { scriptId: 0, task: 'work', memory }
}

/**
 * What one batch uses up at the workplace that processes goods a job is at (`RECIPES`; a smithy,
 * the city's weapon's); undefined for any other job.
 */
function inputOf(buildings: Map<string, Building>, job: CityJob | undefined): Stock | undefined {
  const place = job?.buildingId !== undefined ? buildings.get(job.buildingId) : undefined
  if (!place || !RECIPES[place.kind]) return undefined
  return recipeFor(place.kind, place.kind === 'smithy' ? NPC_SMITHY_WEAPON : undefined)?.input
}

/**
 * Whether a worker at a workplace that processes goods can go on (`CONTEXT.md`: Smelter,
 * Smithy): it has the input of a batch (`hasInput`), or they carry some of it still.
 */
function inputLeft(world: WorldState, place: Building, r: Resident): boolean {
  const recipe = recipeFor(place.kind, place.kind === 'smithy' ? NPC_SMITHY_WEAPON : undefined)
  if (!recipe || hasInput(world, place, recipe)) return true
  return Object.keys(recipe.input).some((g) => (r.carried[g as Good] ?? 0) > 0)
}

/**
 * Before a resident sets out for a workplace that processes goods, they take its `input` from
 * the storage, as many batches as fit beside the Food they set out with (`setOutFood` aside, a
 * game day's): at it, a pick-up; away from it, the walk there first. Whether they carry a batch,
 * or have just been given the pick-up (`r.order`); false while the storage holds no batch.
 */
function takeInput(
  world: WorldState,
  r: Resident,
  input: Stock,
  storage: Building | undefined,
  size: number,
): boolean {
  if (holdsBatch(r.carried, input)) return true
  if (!storage || !holdsBatch(storage.stock, input)) return false
  if (!isAt(r, storage, size)) {
    walkTo(r, storage)
    return true
  }
  const batch = stockWeight(input)
  const room = carryCapacity(r, world.tick) - stockWeight(r.carried) - OWN_FOOD * GOOD_WEIGHT.food
  let batches = Math.floor(room / batch)
  for (const [g, n] of Object.entries(input) as [Good, number][]) {
    batches = Math.min(batches, Math.floor((storage.stock?.[g] ?? 0) / n))
  }
  if (batches < 1) return false
  const goods: Stock = {}
  for (const [g, n] of Object.entries(input) as [Good, number][]) goods[g] = n * batches
  r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
  return true
}

/** Ends a resident's work: their order, and the Work default they run, if any. */
export function stopWork(r: Resident): void {
  r.order = null
  delete r.script
}

/**
 * What a resident carries for the storage: the goods workplaces make, all but `OWN_FOOD` Food
 * to eat and the `input` of the workplace they go to process at; none if nothing. Weapons and
 * armour stay on them.
 */
function haul(r: Resident, input?: Stock): Stock | undefined {
  const load: Stock = {}
  for (const [good, units] of Object.entries(r.carried) as [Good, number][]) {
    if (WORK_OUTPUT_PER_DAY[good] === undefined || input?.[good] !== undefined) continue
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
