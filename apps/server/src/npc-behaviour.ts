import {
  HOME_FOOD_LOW,
  NPC_BUILDERS,
  OWN_FOOD,
  WORK_OUTPUT_PER_DAY,
  breedersAt,
  breedingPair,
  canWork,
  contractOf,
  inCityArea,
  isArmed,
  isAt,
  putAwayUnits,
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
import { refillSource } from './survival.js'

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
  let planMs = 0
  for (const city of world.cities) {
    if (city.realmId !== null) continue
    const people = residents.get(city.id)
    if (people) planMs += runCity(world, city, people, size, terrain)
  }
  return planMs
}

/**
 * What an NPC city does each tick: plans when its pass is due (`planCity`); stops workers who
 * run low on food where there is none, carriers home with their load stored, builders stuck or
 * out of materials and breeders who are done, so they get their next job; moves a worker whose
 * plan puts them elsewhere; then gives each idle adult what comes first: a resident carrying a
 * child stays at home; one carrying materials the project needs takes them to its site; a load of
 * goods goes into the storage; they take `OWN_FOOD` from the storage before they set out; one of
 * them breeds the city's horses (`breedHorses`); a planned builder takes their part in the project
 * (`takePart`), picking the next one once it is finished; a planned worker runs the game's Work
 * default at their workplace (`runNpcScripts`), which carries the output to the storage
 * (`CONTEXT.md`: Carrying the output); with nothing to do they come home. Its soldiers (armed
 * adults) are put to no work and no building (`stepNpcDefence`). Children are left alone: they
 * refill at home. Returns the milliseconds spent planning.
 */
function runCity(
  world: WorldState,
  city: City,
  people: Resident[],
  size: number,
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
  const adults = people.filter((r) => canWork(r, world.tick))
  const jobs = plan?.jobs ?? {}

  stopBuildersWhoCantGoOn(world, adults, storage)
  for (const r of adults) {
    const o = r.order
    const busy = o?.kind === 'workAt' || o?.kind === 'build' || o?.kind === 'tearDown'
    if (busy && lowOnFood(r) && !refillSource(world, r, size)) stopWork(r)
    // Home at the storage with the load stored, a carrier is free for whatever the city needs
    // most (building, pairing), else back to work.
    const carry = r.script?.scriptId === 0 ? r.script.memory.carry : undefined
    const carrying = typeof carry === 'object' && carry !== null && !Array.isArray(carry)
    if (
      carrying &&
      carry.stored === true &&
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
    // The pass just now put them at another workplace (Food runs short: to a farm). Only then:
    // between passes someone else may have put them to work (a smithy forging their spear).
    const job = jobs[r.id]
    const at = workplaceOf(r)
    const moved = job?.buildingId !== undefined && at !== undefined && at !== job.buildingId
    if (moved && plan?.plannedAt === world.tick) stopWork(r)
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
      const next =
        cityGrows(world, city, adults) && !foodShort(world, city)
          ? cityProject(world, city, home, terrain)
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
      if (p && takePart(world, r, p, storage, true)) {
        free--
        continue
      }
    }
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
    const job = jobs[r.id]
    const soldier = isArmed(r) || job?.kind === 'soldier'
    if (!soldier && breedHorses(world, city, r)) continue
    if (!soldier && job?.kind === 'build' && free > 0) {
      const p = project()
      if (p && takePart(world, r, p, storage, false)) {
        free--
        continue
      }
    }
    if (!soldier && job?.buildingId !== undefined) {
      const place = world.buildings.find((b) => b.id === job.buildingId)
      if (place && !place.site && held.room(place) > 0) {
        putToWork(r, place)
        held.take(place)
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
