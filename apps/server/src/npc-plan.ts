import {
  MAX_WORKERS,
  NPC_BUILDERS,
  NPC_FOOD_SHORT_DAYS,
  NPC_PLAN_TICKS,
  RECIPES,
  buildingAt,
  canWork,
  cityFoodUse,
  contractOf,
  hasFoodSurplus,
  isArmed,
  materialsNeeded,
  punishers,
  storedFood,
  workplaceGood,
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
import { hash } from './residents.js'

/*
 * How a city the game runs thinks (`CONTEXT.md`: NPC city; ADR 0016): once a game hour
 * (`NPC_PLAN_TICKS`), staggered by its id so about one city plans per tick, a planning pass
 * decides everything that takes thought and keeps the result in the city's plan
 * (`WorldState.cityPlans`): pairs, the next project, and a job for every adult. Between passes
 * the city only hands idle residents their planned job (`stepNpcCities`), and a worker stays where
 * the plan put them until the next pass moves them. The pass decides as the city did when it
 * decided every tick: farms first until it has a food surplus, soldiers put to no work, at most
 * `NPC_BUILDERS` building, everyone else at the first workplace with room.
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
 * while it has a food surplus; picks its project (`cityProject`), if it grows and Food isn't
 * short; and gives every adult a job: soldiers (armed adults) stand as soldiers; one carrying a
 * child does nothing; builders go on building; a worker stays at their workplace, except that
 * while Food runs short workers off the farms move to farms with room; the rest build the
 * project while fewer than `NPC_BUILDERS` do, else take the first workplace with room, farms first
 * until the city has a food surplus, else are idle. Without `terrain` the city picks no project.
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
    grows && !short && terrain && home ? cityProject(world, city, home, terrain) : undefined
  if (project) plan.project = project
  else delete plan.project

  const places = workplaces(world, city)
  const placeById = new Map(places.map((p) => [p.id, p]))
  const held = new Places(people)
  const jobs: Record<string, CityJob> = {}
  let builders = adults.filter(isBuilder).length
  const spare: Resident[] = []
  for (const r of adults) {
    const at = workplaceOf(r)
    if (isArmed(r)) jobs[r.id] = { kind: 'soldier' }
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
  for (const r of spare) {
    if (plan.project && builders < NPC_BUILDERS && canTakePart(world, city, r, plan.project)) {
      jobs[r.id] = { kind: 'build' }
      builders++
      continue
    }
    const place = places.find((p) => held.room(p) > 0)
    if (place) {
      jobs[r.id] = workJob(place)
      held.take(place)
    } else jobs[r.id] = { kind: 'idle' }
  }
  plan.jobs = jobs
  return plan
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
  const storage = world.buildings.find(
    (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
  )
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
 * workplace. A planned building that is gone, and a job of a resident who died, are stale until
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
        }
      }
    }
    return out
  },
}
