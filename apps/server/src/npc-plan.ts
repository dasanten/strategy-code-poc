import {
  FOOD_PER_DAY,
  MAP_SIZE,
  MAX_WORKERS,
  NPC_FOOD_SHORT_DAYS,
  NPC_PLAN_TICKS,
  NPC_SURPLUS_CAP,
  RECIPES,
  buildingAt,
  canWork,
  cityFoodUse,
  cityResidents,
  contractOf,
  hasFoodSurplus,
  isArmed,
  isBigNpcCity,
  isDown,
  materialsNeeded,
  npcNeedsScale,
  npcReserve,
  npcStorages,
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
import {
  cityGrows,
  cityProject,
  endPairs,
  isBuilder,
  noFarm,
  npcBuilders,
  onNode,
  pairAdults,
} from './npc-growth.js'
import {
  chainGood,
  chainInput,
  chainStore,
  holdsBatch,
  ownWorkplaces,
  shortages,
  surplusWork,
} from './npc-chain.js'
import { foundingParty, planFounding } from './npc-founding.js'
import { downToRevive, goesOnReviving, sendRevivers } from './npc-revive.js'
import { roadCrew, type WayFinder } from './npc-roads.js'
import { beats, jobScore, rankJobs, type ScoredJob } from './npc-scores.js'
import { pickScouts } from './npc-scouts.js'
import { feedJobKept, planFeeder } from './npc-stable.js'
import { sendTraders, tradersOut } from './npc-trader.js'
import { planTraining } from './npc-training.js'
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
export function planDue(world: WorldState, city: Pick<City, 'id'>): boolean {
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
 * residents eat in `NPC_FOOD_SHORT_DAYS`. An NPC city with no storage yet (a daughter just founded,
 * `CONTEXT.md`: Founding) lives on the Food its people carry and is never short, so it builds one.
 */
export function foodShort(world: WorldState, city: City): boolean {
  if (!city.tradeOrg && npcStorages(world, city).length === 0) return false
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
      // One working it by the Work default and walking back to its tile holds one place, not two.
      if (id === undefined && o?.kind === 'walkTo') {
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
 * carrying a child does nothing; builders go on building. It shares out the rest by the scores of
 * their jobs (`shareOut`), a reviver for each of its Down residents among them
 * (`CONTEXT.md`: Reviving; those Down do nothing and get no job); one of them feeds its stable when
 * it is due (`planFeeder`). An NPC city's founding party keeps its `found` jobs, and the pass ends
 * with the founding's part (`planFounding`) and, of the soldiers left, those at its training ground
 * (`planTraining`). Without `terrain` the city picks no project; without
 * `ways` it builds no road (`roadCrew`).
 * `people` are the residents the city gives orders to (`runResidents`).
 */
export function planCity(
  world: WorldState,
  city: City,
  terrain?: TerrainMap,
  people: Resident[] = runResidents(world).get(city.id) ?? [],
  ways?: WayFinder,
): CityPlan {
  const plan = (world.cityPlans[city.id] ??= { plannedAt: world.tick, jobs: {} })
  plan.plannedAt = world.tick
  // A founding party out is the founding's business (`planFounding`), not shared out.
  const party = new Set(foundingParty(plan))
  const members = people.filter((r) => party.has(r.id))
  const adults = people.filter((r) => canWork(r, world.tick) && !isDown(r) && !party.has(r.id))
  const short = foodShort(world, city)
  const grows = cityGrows(world, city, adults)
  if (grows) {
    if (short) endPairs(world, adults)
    else pairAdults(world, city, adults)
  }
  const home = npcHome(world, city)
  const project =
    (!short || noFarm(world, city)) && terrain && home
      ? cityProject(world, city, home, terrain, grows)
      : undefined
  if (project) plan.project = project
  else delete plan.project

  const places = workplaces(world, city)
  const placeById = new Map(places.map((p) => [p.id, p]))
  const held = new Places(people)
  const jobs: Record<string, CityJob> = {}
  // The road crew is apart from its builders, and spare hands (`CONTEXT.md`: NPC road).
  const builds = (r: Resident) => isBuilder(r) && plan.jobs[r.id]?.kind !== 'road'
  const builders = adults.filter(builds).length
  const spare: Resident[] = []
  // A trader out on their run (`CONTEXT.md`: NPC trader) is nobody's spare hand.
  const traders = city.tradeOrg ? new Set<string>() : tradersOut(world, plan)
  const size = terrain?.size ?? MAP_SIZE
  const waiting = downToRevive(world, city, size)
  let feeding = false
  for (const r of adults) {
    const at = workplaceOf(r)
    const feed = feedJobKept(world, city, r)
    if (traders.has(r.id)) jobs[r.id] = { kind: 'trade' }
    else if (isArmed(r)) jobs[r.id] = { kind: 'soldier' }
    else if (r.carrying) jobs[r.id] = { kind: 'idle' }
    else if (goesOnReviving(plan.jobs[r.id], waiting)) jobs[r.id] = plan.jobs[r.id]!
    else if (builds(r)) jobs[r.id] = { kind: 'build' }
    else if (at !== undefined) jobs[r.id] = workJob(placeById.get(at) ?? at)
    else if (feed) {
      jobs[r.id] = feed
      feeding = true
    } else spare.push(r)
  }
  const sendToDown = (rest: Resident[], leave: (r: Resident) => void) =>
    sendRevivers(waiting, rest, adults, jobs, short, size, leave)
  const unneeded = shareOut({
    world,
    city,
    adults,
    jobs,
    held,
    spare,
    plan,
    placeById,
    builders,
    foodShort: short,
    sendToDown,
    roads: { home, ways, terrain },
  })
  // Trading posts and the HQ don't feed their stables this way (`npcOneFeeder`).
  if (!city.tradeOrg && !feeding) planFeeder(world, city, adults, jobs)
  // The Trade Organization sends no trader (`tradeOrgSendsNoOne`) and founds nothing.
  if (!city.tradeOrg) {
    sendTraders(world, city, plan, adults, jobs, short, size)
    // A spare hand just sent off as a trader or to feed the stable isn't one any more.
    const left = unneeded.filter((r) => !['trade', 'feed'].includes(jobs[r.id]?.kind ?? ''))
    planFounding(world, city, plan, jobs, { adults, unneeded: left, members }, home, terrain)
    planTraining(world, city, adults, jobs, size)
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

/** What `shareOut` is given by its planning pass. */
interface ShareOut {
  world: WorldState
  city: City
  adults: Resident[]
  jobs: Record<string, CityJob>
  held: Places
  spare: Resident[]
  plan: CityPlan
  /** The workplaces it fills (`workplaces`), by id: those it moves to the farms while Food is short. */
  placeById: Map<string, Building>
  builders: number
  foodShort: boolean
  sendToDown: (spare: Resident[], leave: (r: Resident) => void) => void
  roads: {
    home: Building | undefined
    ways: WayFinder | undefined
    terrain: TerrainMap | undefined
  }
}

/** A job on offer: what it is, and giving it to those of `takers` it has room for, who are returned. */
interface JobOffer {
  job: ScoredJob
  take: (takers: Resident[]) => Resident[]
}

/**
 * How an NPC city shares out its adults beyond its soldiers and those carrying a child
 * (`CONTEXT.md`: NPC city, NPC reserve; ADR 0029): each goes to the job that scores highest with
 * room (`jobScore`), the spare hands first, then any worker whose job it beats by the margin
 * (`beats`). A worker holds their job at the score of the good it makes, which keeps them from moving
 * for another short good or the project; a farm lacking farmers takes them. While Food runs short,
 * workers off the farms go to the farms with room, past the farmers it keeps. The workers of a
 * workplace whose good the city isn't short of are let go and become spare hands (and go back when
 * nothing else needs them), as do farmers beyond those it keeps (`farmersWanted`).
 *
 * What is short comes first. Farming, until it has its farmers, while a farm has room; revivers go to
 * its Down residents (`sendToDown`, `sendRevivers`), ahead of all that comes after; up to
 * `npcBuilders` build the project; the rest go to the workplace of the good shortest
 * of the reserve (`shortPlace`), filling its crew before the next. Those it leaves are the unneeded,
 * for the work spare hands have with nothing short (`CONTEXT.md`: Spare hands' work): its road crew
 * (`roadCrew`; `CONTEXT.md`: NPC road), a few scouts (`pickScouts`), going back (a farmer to farming,
 * one the last pass put to work who is between jobs now, a carrier home with the load stored:
 * `CONTEXT.md`, Carrying the output, to that workplace; at an NPC city only up to the cap of its good,
 * `surplusWork`), and work for surplus at an NPC city. Whoever has none of that is idle.
 * Returns the spare hands nothing short has a use for, idle, on the road crew, scouting or working
 * for surplus (`CONTEXT.md`: Full city).
 */
function shareOut(pass: ShareOut): Resident[] {
  const { world, city, adults, jobs, held, spare, plan, placeById, foodShort, sendToDown } = pass
  const project = plan.project
  let builders = pass.builders
  const own = ownWorkplaces(world, city).filter((b) => !b.site)
  const byId = new Map(own.map((b) => [b.id, b]))
  const placeOf = (r: Resident) => byId.get(jobs[r.id]?.buildingId ?? '')
  const farms = own.filter((b) => b.kind === 'farm')
  const short = shortages(world, city, project)
  const shareOf = new Map(short.map((s) => [s.good, s.share]))
  /** What a resident's job at a workplace is worth to them: what its good lacks, or only going back. */
  const heldScore = (r: Resident) => {
    const place = placeOf(r)
    const good = place && place.kind !== 'farm' ? chainGood(world, place) : undefined
    if (!good) return jobScore({ kind: 'short', share: 0 })
    const share = shareOf.get(good)
    return jobScore(share === undefined ? { kind: 'back' } : { kind: 'short', share })
  }
  const give = (r: Resident, job: CityJob, place?: Building) => {
    const left = placeOf(r)
    if (left) held.leave(left)
    jobs[r.id] = job
    if (place) held.take(place)
  }
  if (foodShort) {
    // Food runs short: workers off the farms go to the farms with room.
    const score = jobScore({ kind: 'farm', foodShort })
    for (const r of adults) {
      const job = jobs[r.id]
      if (job?.kind !== 'work' || !placeById.has(job.buildingId ?? '')) continue
      if (!beats(score, heldScore(r))) continue
      const farm = farms.find((f) => held.room(f) > 0)
      if (!farm) break
      give(r, workJob(farm), farm)
    }
  }
  const kept = new Map<string, CityJob>()
  const release = (r: Resident) => {
    const place = placeOf(r)
    if (place) held.leave(place)
    kept.set(r.id, jobs[r.id]!)
    delete jobs[r.id]
    spare.push(r)
  }
  // Workers of a workplace whose good the city isn't short of become spare hands, the farms aside
  // (farmersWanted): the city moves them to what is short, and they go back when nothing is.
  const onlyBack = jobScore({ kind: 'back' })
  for (const r of adults) {
    if (heldScore(r) <= onlyBack) release(r)
  }
  // A worker stays where they are until the city moves them: one the last pass put to work who
  // has no workplace now (a carrier freed at the storage) goes back there when nothing else needs them.
  for (const r of spare) {
    const before = plan.jobs[r.id]
    if (!before || kept.has(r.id) || !byId.has(before.buildingId ?? '')) continue
    if (before.kind === 'work' || before.kind === 'farm') kept.set(r.id, before)
  }
  // A scout out is called home for what is short only once those at hand have gone.
  spare.sort((a, b) => Number(!!plan.scouts?.[a.id]) - Number(!!plan.scouts?.[b.id]))
  const wanted = farmersWanted(world, city)
  const farmers = adults.filter((r) => jobs[r.id]?.kind === 'farm')
  if (!foodShort) for (const r of farmers.slice(wanted).reverse()) release(r)
  let farming = foodShort ? farmers.length : Math.min(farmers.length, wanted)

  // Those holding a job a better one can take them from, at what it is worth to them.
  const workers = new Map(
    adults.filter((r) => jobs[r.id]?.kind === 'work').map((r) => [r, heldScore(r)]),
  )
  /** Offers its jobs, the highest-scoring first, and returns those of `free` none of them took. */
  const fill = (offers: JobOffer[], free: Resident[]) => {
    for (const offer of rankJobs(offers)) {
      const score = jobScore(offer.job)
      const beaten = [...workers]
        .filter(([r, holds]) => jobs[r.id]?.kind === 'work' && beats(score, holds))
        .map(([r]) => r)
      const took = new Set(offer.take([...free, ...beaten]))
      free = free.filter((r) => !took.has(r))
      for (const r of took) workers.delete(r)
    }
    return free
  }

  const storage = chainStore(world, city)
  const toFarm: JobOffer = {
    job: { kind: 'farm' },
    take: (takers) =>
      takers.filter((r) => {
        if (farming >= wanted) return false
        const farm = farms.find((f) => held.room(f) > 0)
        if (!farm) return false
        give(r, workJob(farm), farm)
        farming++
        return true
      }),
  }
  const reviving: JobOffer = {
    job: { kind: 'revive' },
    take: (takers) => {
      sendToDown(takers, (r) => {
        const place = placeOf(r)
        if (place) held.leave(place)
        if (jobs[r.id]?.kind === 'build') builders--
      })
      return takers.filter((r) => jobs[r.id]?.kind === 'revive')
    },
  }
  const building: JobOffer[] = project
    ? [
        {
          job: { kind: 'project' },
          take: (takers) =>
            takers.filter((r) => {
              if (builders >= npcBuilders(world, city)) return false
              if (!canTakePart(world, city, r, project)) return false
              give(r, { kind: 'build' })
              builders++
              return true
            }),
        },
      ]
    : []
  const shortWork = short.map(
    ({ good, share }): JobOffer => ({
      job: { kind: 'short', share },
      take: (takers) => {
        const took: Resident[] = []
        for (const r of takers) {
          const place = shortPlace(world, good, own, held, storage)
          if (!place) break
          give(r, workJob(place), place)
          took.push(r)
        }
        return took
      },
    }),
  )
  const unneeded = fill([toFarm, reviving, ...building, ...shortWork], spare)
  if (unneeded.length === 0) return unneeded

  // Nothing short has a use for them (`CONTEXT.md`: Spare hands' work).
  const { home, ways, terrain } = pass.roads
  const road: JobOffer = {
    job: { kind: 'road' },
    take: (takers) => {
      const returning = new Set(kept.keys())
      const crew = roadCrew(world, city, plan, takers, returning, storage, home, ways, terrain)
      for (const r of crew) give(r, { kind: 'road' })
      return crew
    },
  }
  const wentBackTo = (r: Resident) => byId.get(kept.get(r.id)?.buildingId ?? '')
  // Scouts already out first; they stay spare hands for a Full city. What is short took them above,
  // and they walk home for it.
  const scouting: JobOffer = {
    job: { kind: 'scout' },
    take: (takers) => {
      const hasPlace = (r: Resident) => wentBackTo(r) !== undefined
      const scouts = pickScouts(world, city, plan, takers, hasPlace, foodShort)
      for (const r of scouts) give(r, { kind: 'scout' })
      return scouts
    },
  }
  // Those who were at a workplace go back so a crew keeps its places: to anything at a Trade Org
  // city, which has no cap; an NPC city's only while it still works it for surplus, or it isn't a
  // good it counts (a workplace of no chain).
  const surplus = city.tradeOrg ? undefined : surplusWork(world, city, storage)
  const worthBack = (b: Building) =>
    !surplus || chainGood(world, b) === undefined || surplus(b) !== undefined
  const goingBack: JobOffer = {
    job: { kind: 'back' },
    take: (takers) =>
      takers.filter((r) => {
        const back = kept.get(r.id)
        const place = wentBackTo(r)
        if (!back || !place || held.room(place) <= 0 || !worthBack(place)) return false
        give(r, back, place)
        return true
      }),
  }
  const surplusJobs = own.flatMap((place): JobOffer[] => {
    const full = surplus?.(place)
    if (full === undefined) return []
    const take = (takers: Resident[]) =>
      takers.filter((r) => {
        if (held.room(place) <= 0) return false
        give(r, workJob(place), place)
        return true
      })
    return [{ job: { kind: 'surplus', full }, take }]
  })
  const idle = fill([road, scouting, goingBack, ...surplusJobs], unneeded)
  for (const r of idle) jobs[r.id] = { kind: 'idle' }
  return unneeded
}

/**
 * The workplace a spare hand goes to for a good short (`CONTEXT.md`: NPC city): of the city's
 * finished `own` workplaces, one with room that makes it. For a good a workplace processes, only
 * while the storage holds a batch of its input; else the workplace of an input it lacks, so the ore
 * is dug before it is smelted.
 */
function shortPlace(
  world: WorldState,
  good: Good,
  own: Building[],
  held: Places,
  storage: Building | undefined,
): Building | undefined {
  const seen = new Set<Good>()
  const workFor = (g: Good): Building | undefined => {
    if (seen.has(g)) return undefined
    seen.add(g)
    const input = chainInput(g)
    if (input && !holdsBatch(storage?.stock, input)) {
      for (const [from, n] of Object.entries(input) as [Good, number][]) {
        if ((storage?.stock?.[from] ?? 0) >= n) continue
        const place = workFor(from)
        if (place) return place
      }
      return undefined
    }
    return own.find((b) => chainGood(world, b) === g && held.room(b) > 0)
  }
  return workFor(good)
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
 * An NPC city works for surplus only up to its cap (`CONTEXT.md`: Spare hands' work; ADR 0004), as
 * far as that can be checked. What it holds can lie past the cap for good reason (workers bring in
 * what they carried when it was reached; a death lowers its reserve), so this looks at its plan,
 * not its stock: in the plan its pass made this tick, nobody works a good its storage holds twice
 * the cap of past the reserve (once for what was stored or changed since the pass, this same tick;
 * no project wants that much). A farm counts only with more farmers than it keeps, and one for a
 * death. A good with no cap isn't worked for surplus and doesn't count; nor does a Trade Org city,
 * which has no cap. The cap is the one for its size now (`npcNeedsScale`).
 */
export const npcSurplusCapped: Invariant = {
  name: 'npc-surplus-capped',
  check(world) {
    const out: InvariantViolation[] = []
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const city = world.cities.find((c) => c.id === cityId)
      if (!city || city.tradeOrg || plan.plannedAt !== world.tick) continue
      const stock = chainStore(world, city)?.stock ?? {}
      const reserve = npcReserve(world, city)
      const steps = npcNeedsScale(world, city)
      const jobs = Object.entries(plan.jobs)
      const farmers = jobs.filter(([, j]) => j.kind === 'farm').length
      for (const place of ownWorkplaces(world, city)) {
        const good = chainGood(world, place)
        const base = good && NPC_SURPLUS_CAP[good]
        if (!good || !base || place.site) continue
        const cap = base * steps
        if ((stock[good] ?? 0) - (reserve[good] ?? 0) < 2 * cap) continue
        if (place.kind === 'farm' && farmers <= farmersWanted(world, city) + 1) continue
        for (const [residentId, job] of jobs) {
          if (job.buildingId !== place.id) continue
          out.push({
            invariant: this.name,
            message: `${cityId} plans ${residentId} at ${place.id}, with ${stock[good]} ${good} past its cap of ${cap}`,
            entityIds: [cityId, residentId, place.id],
          })
        }
      }
    }
    return out
  },
}

/**
 * An NPC city's spare hands don't stand idle while it has work for them (`CONTEXT.md`: Spare hands'
 * work; ADR 0004): in the plan its pass made this tick, nobody free to work is idle while a farm or
 * workplace on a node of its has room and its good lies under half its cap past the reserve (`surplusWork`;
 * half, for what has left the storage since the pass, this same tick). How many of its adults are idle
 * can't be held live: a city with its caps full has nothing for them, which is no fault. This is
 * the rule beneath that share. A Trade Org city has no cap.
 */
export const npcSpareHandsWork: Invariant = {
  name: 'npc-spare-hands-work',
  check(world) {
    const out: InvariantViolation[] = []
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      if (plan.plannedAt !== world.tick) continue
      const city = world.cities.find((c) => c.id === cityId)
      if (!city || city.tradeOrg) continue
      const jobs = Object.values(plan.jobs)
      if (!jobs.some((j) => j.kind === 'idle')) continue
      const people = runResidents(world).get(cityId) ?? []
      const free = (r: Resident) =>
        plan.jobs[r.id]?.kind === 'idle' &&
        canWork(r, world.tick) &&
        !isDown(r) &&
        !r.carrying &&
        !isArmed(r)
      const idle = people.filter(free)
      if (idle.length === 0) continue
      const held = new Places(people)
      const planned = (b: Building) => jobs.filter((j) => j.buildingId === b.id).length
      const full = surplusWork(world, city, chainStore(world, city))
      const open = ownWorkplaces(world, city).find((b) => {
        if (b.site || RECIPES[b.kind]) return false
        const most = MAX_WORKERS[b.kind] ?? 0
        return (full(b) ?? 1) < 0.5 && Math.max(planned(b), held.taken(b)) < most
      })
      if (!open) continue
      out.push({
        invariant: this.name,
        message: `${cityId} plans ${idle.length} idle, with room at ${open.id}, a ${open.kind} under half its cap`,
        entityIds: [cityId, open.id, ...idle.map((r) => r.id)],
      })
    }
    return out
  },
}

/**
 * An NPC city opens no more workplaces than a good needs (`CONTEXT.md`: Spare hands' work; ADR 0004):
 * a plan made this tick lays out no workplace on a node of a good it already has one finished of,
 * unless it is a big city (`isBigNpcCity`) with just that one. A site already begun isn't looked at.
 */
export const npcWorkplacesBounded: Invariant = {
  name: 'npc-workplaces-bounded',
  check(world) {
    const out: InvariantViolation[] = []
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const project = plan.project
      if (plan.plannedAt !== world.tick || project?.kind !== 'build') continue
      if (!onNode(project.building) || buildingAt(world, project.x, project.y)) continue
      const city = world.cities.find((c) => c.id === cityId)
      if (!city || city.tradeOrg) continue
      const good = workplaceGood(world, { ...project, id: '', kind: project.building, cityId })
      const standing = ownWorkplaces(world, city).filter(
        (b) => !b.site && onNode(b.kind) && chainGood(world, b) === good,
      ).length
      if (standing < (isBigNpcCity(world, city) ? 2 : 1)) continue
      out.push({
        invariant: this.name,
        message: `${cityId} plans another ${project.building} for ${good}, with ${standing} standing`,
        entityIds: [cityId],
      })
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
