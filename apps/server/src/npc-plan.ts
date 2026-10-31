import {
  FOOD_PER_DAY,
  MAP_SIZE,
  MAX_WORKERS,
  NPC_BUILDERS,
  NPC_FOOD_SHORT_DAYS,
  NPC_PLAN_TICKS,
  RECIPES,
  buildingAt,
  canWork,
  cityFoodUse,
  cityResidents,
  contractOf,
  hasFoodSurplus,
  isArmed,
  materialsNeeded,
  punishers,
  storedFood,
  workplaceGood,
  WORK_OUTPUT_PER_DAY,
  type Good,
  type Building,
  type City,
  type CityJob,
  type CityPlan,
  type CityProject,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { caravanCrew } from './caravans.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { cityGrows, cityProject, endPairs, isBuilder, pairAdults } from './npc-growth.js'
import {
  chainGood,
  chainInput,
  chainStore,
  holdsBatch,
  ownWorkplaces,
  shortGoods,
} from './npc-chain.js'
import { planTrader, traderOut } from './npc-trader.js'
import { hash } from './residents.js'

/*
 * How a city the game runs thinks (`CONTEXT.md`: NPC city; ADR 0016): once a game hour
 * (`NPC_PLAN_TICKS`), staggered by its id so about one city plans per tick, a planning pass
 * decides everything that takes thought and keeps the result in the city's plan
 * (`WorldState.cityPlans`): pairs, the next project, and a job for every adult. Between passes
 * the city only hands idle residents their planned job (`stepNpcCities`), and a worker stays where
 * the plan put them until the next pass moves them. A city shares its adults out by its reserve
 * (`shareOut`): an NPC city by its NPC reserve, the Trade Organization's cities by their
 * warehouses' stock floor (`tradeOrgReserve`). Neither the HQ nor a trading post ever sends a
 * trader or founds a city (`tradeOrgSendsNoOne`).
 */

/** Whether a city's planning pass is due this tick: once every `NPC_PLAN_TICKS`, staggered by id. */
export function planDue(world: WorldState, city: City): boolean {
  return (world.tick + hash(city.id)) % NPC_PLAN_TICKS === 0
}

/**
 * The residents each city the game runs gives orders to, by city id: those living there who
 * belong to no realm, except a caravan's crew (run by its caravan, `stepCaravans`), a hired-out
 * resident (run by the hirer) and a punisher (run by its punishment, `stepPunishments`). Those
 * three don't go on with the city's Work default either.
 */
export function runResidents(world: WorldState): Map<string, Resident[]> {
  const residents = new Map<string, Resident[]>()
  const crew = caravanCrew(world)
  const away = punishers(world)
  for (const r of world.residents) {
    if (r.owner !== null || r.cityId === null) continue
    if (crew.has(r.id) || away.has(r.id) || contractOf(world, r.id)) {
      if (r.script?.scriptId === 0) delete r.script
      continue
    }
    const list = residents.get(r.cityId) ?? []
    list.push(r)
    residents.set(r.cityId, list)
  }
  return residents
}

/**
 * Whether a city's Food runs short (`CONTEXT.md`: NPC city): its storages hold less than its
 * residents eat in `NPC_FOOD_SHORT_DAYS`.
 */
export function foodShort(world: WorldState, city: City): boolean {
  return storedFood(world, city) < cityFoodUse(world, city, NPC_FOOD_SHORT_DAYS)
}

/**
 * The city's finished workplaces that make something from nothing (farms, camps, quarries,
 * mines; not those that process goods), its farms and those in its `workplaceIds`, in the order
 * it fills them: farms first until the city has a food surplus, else last.
 */
export function workplaces(world: WorldState, city: City): Building[] {
  const farmsFirst = !hasFoodSurplus(world, city)
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
 * Who holds the places at the city's workplaces, from its residents indexed once: those working
 * one by its Work default (there, on their way or away carrying), on it by a bare work-at order,
 * or walking to its tile.
 */
export class Places {
  private readonly byWorkplace = new Map<string, number>()
  private readonly byTile = new Map<string, number>()

  constructor(people: Resident[]) {
    for (const r of people) {
      const id = workplaceOf(r)
      if (id !== undefined) this.byWorkplace.set(id, (this.byWorkplace.get(id) ?? 0) + 1)
      const o = r.order
      if (o?.kind === 'walkTo') {
        const key = `${o.target.x},${o.target.y}`
        this.byTile.set(key, (this.byTile.get(key) ?? 0) + 1)
      }
    }
  }

  /** Places taken at a workplace. */
  taken(place: Building): number {
    return (this.byWorkplace.get(place.id) ?? 0) + (this.byTile.get(`${place.x},${place.y}`) ?? 0)
  }

  /** Room left at a workplace: its most workers, minus the places taken. */
  room(place: Building): number {
    return (MAX_WORKERS[place.kind] ?? 0) - this.taken(place)
  }

  /** One more resident is going to a workplace. */
  take(place: Building): void {
    this.byWorkplace.set(place.id, (this.byWorkplace.get(place.id) ?? 0) + 1)
  }

  /** A resident left a workplace. */
  leave(place: Building): void {
    this.byWorkplace.set(place.id, (this.byWorkplace.get(place.id) ?? 0) - 1)
  }
}

/** The workplace a resident works, by its Work default or a bare work-at order, if any. */
export function workplaceOf(r: Resident): string | undefined {
  const id = r.script?.memory.workplaceId
  if (typeof id === 'string') return id
  return r.order?.kind === 'workAt' ? r.order.buildingId : undefined
}

/**
 * A city's planning pass (`CONTEXT.md`: NPC city; ADR 0016): makes or remakes its plan from what
 * it has now. Ends its pairs with no child on the way while Food runs short, else pairs adults
 * while it has a food surplus, if it grows (`cityGrows`); picks its project (`cityProject`) while
 * Food isn't short; and gives every adult a job: soldiers (armed adults) stand as soldiers; one
 * carrying a child does nothing; builders go on building; a worker stays at their workplace,
 * except that while Food runs short workers off the farms move to farms with room. It shares out
 * the rest by its reserve (`shareOut`). Without `terrain` the city picks no project.
 * `people` are the residents the city gives orders to (`runResidents`).
 */
export function planCity(
  world: WorldState,
  city: City,
  terrain?: TerrainMap,
  people: Resident[] = runResidents(world).get(city.id) ?? [],
): CityPlan {
  const plan = (world.cityPlans[city.id] ??= { plannedAt: world.tick, jobs: {} })
  plan.plannedAt = world.tick
  const adults = people.filter((r) => canWork(r, world.tick))
  const short = foodShort(world, city)
  const grows = cityGrows(world, city, adults)
  if (grows) {
    if (short) endPairs(world, adults)
    else pairAdults(world, city, adults)
  }
  const home = npcHome(world, city)
  const project =
    !short && terrain && home ? cityProject(world, city, home, terrain, grows) : undefined
  if (project) plan.project = project
  else delete plan.project

  const places = workplaces(world, city)
  const placeById = new Map(places.map((p) => [p.id, p]))
  const held = new Places(people)
  const jobs: Record<string, CityJob> = {}
  const builders = adults.filter(isBuilder).length
  const spare: Resident[] = []
  // The trader out on their run (`CONTEXT.md`: NPC trader) is nobody's spare hand.
  const trader = city.tradeOrg ? undefined : traderOut(world, plan)
  for (const r of adults) {
    const at = workplaceOf(r)
    if (r.id === trader) jobs[r.id] = { kind: 'trade' }
    else if (isArmed(r)) jobs[r.id] = { kind: 'soldier' }
    else if (r.carrying) jobs[r.id] = { kind: 'idle' }
    else if (isBuilder(r)) jobs[r.id] = { kind: 'build' }
    else if (at !== undefined) jobs[r.id] = workJob(placeById.get(at) ?? at)
    else spare.push(r)
  }
  if (short) {
    // Food runs short: workers off the farms go to the farms with room.
    const farms = places.filter((p) => p.kind === 'farm')
    for (const farm of farms) {
      while (held.room(farm) > 0) {
        const worker = adults.find((r) => {
          const job = jobs[r.id]
          return (
            job?.kind === 'work' && job.buildingId !== undefined && placeById.has(job.buildingId)
          )
        })
        if (!worker) break
        held.leave(placeById.get(jobs[worker.id]!.buildingId!)!)
        jobs[worker.id] = workJob(farm)
        held.take(farm)
      }
    }
  }
  shareOut(world, city, adults, jobs, held, spare, plan.project, builders, short)
  // The Trade Organization sends no trader (`tradeOrgSendsNoOne`).
  if (!city.tradeOrg && !trader) {
    planTrader(world, city, plan, adults, jobs, short, terrain?.size ?? MAP_SIZE)
  }
  plan.jobs = jobs
  return plan
}

/**
 * How many farmers an NPC city keeps (`CONTEXT.md`: NPC city): as many as feed all its residents
 * (`FOOD_PER_DAY` each, a farmer making `WORK_OUTPUT_PER_DAY.food`), and one more while it has no
 * food surplus.
 */
export function farmersWanted(world: WorldState, city: City): number {
  return feeders(cityResidents(world, city).length) + (hasFoodSurplus(world, city) ? 0 : 1)
}

/** Farmers who feed `residents`, rounded up. */
const feeders = (residents: number) =>
  Math.ceil((residents * FOOD_PER_DAY) / (WORK_OUTPUT_PER_DAY.food ?? 1) - 1e-9)

/**
 * How an NPC city shares out its adults beyond its soldiers and those carrying a child
 * (`CONTEXT.md`: NPC city, NPC reserve). Workers stay where they are, except that the workers of a
 * workplace that processes goods the city isn't short of become spare hands, as do farmers beyond
 * those it keeps (`farmersWanted`). Then: spare hands, and after them workers off the farms, farm
 * until it has its farmers, while a farm has room; up to `NPC_BUILDERS` build the project; the
 * rest go to the workplace of the good shortest of the reserve (`chainPlace`), filling its crew
 * before the next. A spare hand with nowhere to go is idle; a farmer let go goes back to farming.
 */
function shareOut(
  world: WorldState,
  city: City,
  adults: Resident[],
  jobs: Record<string, CityJob>,
  held: Places,
  spare: Resident[],
  project: CityProject | undefined,
  builders: number,
  foodShort: boolean,
): void {
  const own = ownWorkplaces(world, city).filter((b) => !b.site)
  const byId = new Map(own.map((b) => [b.id, b]))
  const placeOf = (r: Resident) => byId.get(jobs[r.id]?.buildingId ?? '')
  const farms = own.filter((b) => b.kind === 'farm')
  const short = shortGoods(world, city, project)
  const shortOf = new Set(short)
  const kept = new Map<string, CityJob>()
  const release = (r: Resident, keep: boolean) => {
    const place = placeOf(r)
    if (place) held.leave(place)
    if (keep) kept.set(r.id, jobs[r.id]!)
    delete jobs[r.id]
    spare.push(r)
  }
  for (const r of adults) {
    const place = placeOf(r)
    const good = place && RECIPES[place.kind] && chainGood(world, place)
    if (good && !shortOf.has(good)) release(r, false)
  }
  const wanted = farmersWanted(world, city)
  const farmers = adults.filter((r) => jobs[r.id]?.kind === 'farm')
  if (!foodShort) for (const r of farmers.slice(wanted).reverse()) release(r, true)
  let farming = foodShort ? farmers.length : Math.min(farmers.length, wanted)
  const toFarm = (r: Resident) => {
    const farm = farms.find((f) => held.room(f) > 0)
    if (!farm) return false
    const place = placeOf(r)
    if (place) held.leave(place)
    jobs[r.id] = workJob(farm)
    held.take(farm)
    farming++
    return true
  }
  const rest = spare.filter((r) => farming >= wanted || !toFarm(r))
  for (const r of adults) {
    if (farming >= wanted) break
    if (jobs[r.id]?.kind === 'work' && !toFarm(r)) break
  }
  const storage = chainStore(world, city)
  for (const r of rest) {
    if (project && builders < NPC_BUILDERS && canTakePart(world, city, r, project)) {
      jobs[r.id] = { kind: 'build' }
      builders++
      continue
    }
    const place = chainPlace(world, short, own, held, storage)
    const back = kept.get(r.id)
    const backTo = back && byId.get(back.buildingId ?? '')
    if (place) {
      jobs[r.id] = workJob(place)
      held.take(place)
    } else if (back && backTo && held.room(backTo) > 0) {
      jobs[r.id] = back
      held.take(backTo)
    } else jobs[r.id] = { kind: 'idle' }
  }
}

/**
 * The workplace a spare hand goes to (`CONTEXT.md`: NPC city): of the city's finished `own`
 * workplaces, one with room that makes the first good of `short` it can work on. For a good a
 * workplace processes, only while the storage holds a batch of its input; else the workplace of
 * an input it lacks, so the ore is dug before it is smelted.
 */
function chainPlace(
  world: WorldState,
  short: Good[],
  own: Building[],
  held: Places,
  storage: Building | undefined,
): Building | undefined {
  const seen = new Set<Good>()
  const workFor = (good: Good): Building | undefined => {
    if (seen.has(good)) return undefined
    seen.add(good)
    const input = chainInput(good)
    if (input && !holdsBatch(storage?.stock, input)) {
      for (const [g, n] of Object.entries(input) as [Good, number][]) {
        if ((storage?.stock?.[g] ?? 0) >= n) continue
        const place = workFor(g)
        if (place) return place
      }
      return undefined
    }
    return own.find((b) => chainGood(world, b) === good && held.room(b) > 0)
  }
  for (const good of short) {
    seen.clear()
    const place = workFor(good)
    if (place) return place
  }
  return undefined
}

/**
 * The job of working a workplace: `farm` for a farm, `work` for the rest, and for a workplace the
 * city doesn't fill itself (a smelter, say), given by id, `work` too: whoever works it stays.
 */
function workJob(place: Building | string): CityJob {
  if (typeof place === 'string') return { kind: 'work', buildingId: place }
  return { kind: place.kind === 'farm' ? 'farm' : 'work', buildingId: place.id }
}

/**
 * Whether a resident could help with a project now (`takePart`): anything but a site that needs
 * materials neither they carry nor the storage holds.
 */
function canTakePart(world: WorldState, city: City, r: Resident, project: CityProject): boolean {
  if (project.kind === 'tearDown') return world.buildings.some((b) => b.id === project.buildingId)
  const site = buildingAt(world, project.x, project.y)
  if (!site?.site) return true
  const need = materialsNeeded(site)
  const goods = Object.keys(need) as (keyof typeof need)[]
  if (goods.length === 0) return true
  const storage = chainStore(world, city)
  return goods.some((g) => (r.carried[g] ?? 0) > 0 || (storage?.stock?.[g] ?? 0) > 0)
}

/**
 * Whether a city's project is finished, or can't go on: the building to tear down is gone; at the
 * site something stands finished, or something else than planned.
 */
export function projectDone(world: WorldState, project: CityProject): boolean {
  if (project.kind === 'tearDown') return !world.buildings.some((b) => b.id === project.buildingId)
  const b = buildingAt(world, project.x, project.y)
  return b !== undefined && (b.kind !== project.building || !b.site)
}

/**
 * The city plans hold together (ADR 0016; ADR 0004): every plan is a city's that exists and the
 * game runs, made no later than now; a planned farm or workplace that still stands is a finished
 * workplace of the city (its own by `cityId` or `workplaceIds`). A planned building that is gone, and a job of a resident who died, are stale until
 * the next pass and not wrong.
 */
export const cityPlansSound: Invariant = {
  name: 'city-plans-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const cities = new Map(world.cities.map((c) => [c.id, c]))
    const buildings = new Map(world.buildings.map((b) => [b.id, b]))
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const city = cities.get(cityId)
      if (!city || city.realmId !== null) {
        out.push({
          invariant: this.name,
          message: `a plan for ${cityId}, ${city ? `a city of realm ${city.realmId}` : 'no city'}`,
          entityIds: [cityId],
        })
        continue
      }
      if (plan.plannedAt > world.tick) {
        out.push({
          invariant: this.name,
          message: `${cityId} planned at tick ${plan.plannedAt}, after now`,
          entityIds: [cityId],
        })
      }
      for (const [residentId, job] of Object.entries(plan.jobs)) {
        if (job.buildingId === undefined) continue
        const b = buildings.get(job.buildingId)
        if (b && (MAX_WORKERS[b.kind] === undefined || b.site)) {
          out.push({
            invariant: this.name,
            message: `${cityId} plans ${residentId} to work ${b.id}, a ${b.site ? 'site of a ' : ''}${b.kind}`,
            entityIds: [cityId, residentId, b.id],
          })
        } else if (b && b.cityId !== cityId && !city.workplaceIds?.includes(b.id)) {
          out.push({
            invariant: this.name,
            message: `${cityId} plans ${residentId} to work ${b.id}, not one of its workplaces`,
            entityIds: [cityId, residentId, b.id],
          })
        }
      }
    }
    return out
  },
}

/**
 * An NPC city keeps its farmers (`CONTEXT.md`: NPC city; ADR 0004): in the plan its pass made
 * this tick, while it plans fewer farmers than feed all its residents (`farmersWanted` without
 * the one more) and one of its farms has room, no adult it could send there is idle or working
 * elsewhere (soldiers, builders and those carrying a child aside). Residents born this tick don't
 * count. The Trade Organization's cities keep theirs the same way.
 */
export const npcFarmersKept: Invariant = {
  name: 'npc-farmers-kept',
  check(world) {
    const out: InvariantViolation[] = []
    const residents = new Map(world.residents.map((r) => [r.id, r]))
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const city = world.cities.find((c) => c.id === cityId)
      if (!city || plan.plannedAt !== world.tick) continue
      const wanted = feeders(cityResidents(world, city).filter((r) => r.bornAt < world.tick).length)
      const jobs = Object.values(plan.jobs)
      const farmers = jobs.filter((j) => j.kind === 'farm').length
      if (farmers >= wanted) continue
      const planned = (f: Building) => jobs.filter((j) => j.buildingId === f.id).length
      const room = ownWorkplaces(world, city).some(
        (f) => f.kind === 'farm' && !f.site && planned(f) < (MAX_WORKERS.farm ?? 0),
      )
      if (!room) continue
      for (const [residentId, job] of Object.entries(plan.jobs)) {
        const r = residents.get(residentId)
        if (!r || r.health <= 0 || r.carrying || isArmed(r)) continue
        if (job.kind !== 'work' && job.kind !== 'idle') continue
        out.push({
          invariant: this.name,
          message: `${cityId} plans ${farmers} of ${wanted} farmers, and ${residentId} ${job.kind === 'idle' ? 'idle' : `at ${job.buildingId}`}`,
          entityIds: [cityId, residentId],
        })
      }
    }
    return out
  },
}

/**
 * The Trade Organization sends no trader and founds nothing (`CONTEXT.md`: Trade Org HQ, Trading
 * post; ADR 0004): no plan of the HQ or a trading post gives anyone a `trade` or `found` job.
 */
export const tradeOrgSendsNoOne: Invariant = {
  name: 'trade-org-sends-no-one',
  check(world) {
    const out: InvariantViolation[] = []
    for (const city of world.cities) {
      if (!city.tradeOrg) continue
      for (const [residentId, job] of Object.entries(world.cityPlans[city.id]?.jobs ?? {})) {
        if (job.kind !== 'trade' && job.kind !== 'found') continue
        out.push({
          invariant: this.name,
          message: `${city.id}, of the Trade Organization, gives ${residentId} a ${job.kind} job`,
          entityIds: [city.id, residentId],
        })
      }
    }
    return out
  },
}
