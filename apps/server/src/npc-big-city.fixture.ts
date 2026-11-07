// The staged big city of `npc-big-city.test.ts`; left out of the build.

import {
  NODE_TERRAINS,
  NODE_WORKPLACE,
  NPC_SURPLUS_CAP,
  NPC_TOWN,
  TICKS_PER_GAME_DAY,
  HOUSING_ROOM,
  RECIPES,
  canWork,
  cityResidents,
  isAt,
  isDown,
  npcReserve,
  npcSoldierTarget,
  tileIndex,
  ticksForAge,
  type Building,
  type BuildingKind,
  type City,
  type CityLayout,
  type Good,
  type Resident,
  type ResourceKind,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { updateCityMembership } from './cities.js'
import { layoutPlan } from './city-layout.js'
import { npcHome } from './npc-behaviour.js'
import { ownWorkplaces } from './npc-chain.js'
import { foundNpcCity, takenGround } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { mulberry32 } from './residents.js'
import { newId } from './starting-city.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** Residents of the staged city (`npc-big-city.test.ts`): about what production's big city has. */
export const BIG_CITY_RESIDENTS = 110

/** Of them, children: not old enough to work for all of a 40-day run. */
const BIG_CITY_CHILDREN = 14

/** Tiles along each side of its wall: a town's, with its houses filling the inside. */
const BIG_CITY_SIZE = NPC_TOWN.size

/** A finished workplace of `kind`, on a node of `resource` when it digs or cuts, east of the wall. */
function workplace(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  at: { x: number; y: number },
  kind: BuildingKind,
  resource?: ResourceKind,
): Building {
  if (resource) {
    world.nodes.push({ id: newId(world, 'n'), kind: resource, ...at })
    terrain.tiles[tileIndex(terrain.size, at.x, at.y)] = NODE_TERRAINS[resource][0]!
  }
  const place: Building = { id: newId(world, 'b'), kind, cityId: null, ...at }
  world.buildings.push(place)
  ;(city.workplaceIds ??= []).push(place.id)
  return place
}

/** Puts up houses on its layout's spots, nearest its home first, until all its residents fit. */
function buildHouses(world: WorldState, terrain: TerrainMap, city: City, home: Building): void {
  const plan = layoutPlan(world, city, home, { dx: 0, dy: Math.floor(BIG_CITY_SIZE / 2) }, terrain.size)
  const ground = takenGround(world, terrain)
  const reach = Math.floor(BIG_CITY_SIZE / 2) - 2
  const spots: { x: number; y: number; d: number }[] = []
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      spots.push({ x: home.x + dx, y: home.y + dy, d: Math.max(Math.abs(dx), Math.abs(dy)) })
    }
  }
  const room = HOUSING_ROOM.house ?? 1
  const wanted = Math.ceil(BIG_CITY_RESIDENTS / room) + 2
  let houses = world.buildings.filter((b) => b.cityId === city.id && b.kind === 'house').length
  for (const { x, y } of spots.sort((a, b) => a.d - b.d)) {
    if (houses >= wanted) return
    const off = (tx: number, ty: number) => !plan?.street(tx, ty)
    if (plan && !plan.spot('house', x, y)) continue
    if (!ground.fits('house', x, y, off)) continue
    ground.take('house', x, y)
    world.buildings.push({ id: newId(world, 'b'), kind: 'house', cityId: city.id, x, y })
    houses++
  }
}

/**
 * An NPC city of `BIG_CITY_RESIDENTS` alone on a Plains map, staged as production's big city stood
 * when Daniel looked (2026-11-06; ADR 0029): its soldiers armed, children among its residents, the
 * farms it needs, its whole chain built from lumber camp to smithy with a free node of each good for
 * a second, and every good at its reserve and half a village's surplus cap. Everyone starts free at
 * home, and its first pass shares them out. With `layout` its houses follow that one, in place of
 * the one it drew. Its map of `mapSize` is by default too small to hold a daughter
 * (`NPC_CITY_MIN_DISTANCE`).
 */
export function bigCity(layout?: CityLayout, mapSize = 240): {
  world: WorldState
  terrain: TerrainMap
  city: City
  home: Building
} {
  const terrain = plains(mapSize)
  const world = createWorld(terrain)
  const size = { ...NPC_TOWN, size: BIG_CITY_SIZE, residents: BIG_CITY_RESIDENTS, farms: 8 }
  const city = foundNpcCity(world, terrain, size, 60, 60, mulberry32(29))
  if (layout) city.layout = layout
  const home = npcHome(world, city)!
  for (const [i, kind] of (['smelter', 'smithy'] as const).entries()) {
    workplace(world, terrain, city, { x: home.x + 6 + i * 4, y: home.y + 6 }, kind)
  }
  buildHouses(world, terrain, city, home)
  updateCityMembership(world, terrain.size)

  const east = 60 + BIG_CITY_SIZE + 14
  workplace(world, terrain, city, { x: east, y: 70 }, NODE_WORKPLACE.forest, 'forest')
  workplace(world, terrain, city, { x: east, y: 80 }, NODE_WORKPLACE.stone, 'stone')
  workplace(world, terrain, city, { x: east, y: 90 }, NODE_WORKPLACE.ironOre, 'ironOre')
  for (const [i, kind] of (['forest', 'stone', 'ironOre'] as const).entries()) {
    const at = { x: east + 10, y: 70 + i * 10 }
    world.nodes.push({ id: newId(world, 'n'), kind, ...at })
    terrain.tiles[tileIndex(terrain.size, at.x, at.y)] = NODE_TERRAINS[kind][0]!
  }

  const residents = cityResidents(world, city)
  for (const r of residents.slice(-BIG_CITY_CHILDREN)) {
    r.bornAt = world.tick - ticksForAge(5)
  }
  const adults = residents.filter((r) => canWork(r, world.tick))
  for (const r of residents) {
    Object.assign(r, { x: home.x, y: home.y, order: null })
    delete r.script
  }
  for (const r of adults.slice(0, npcSoldierTarget(adults.length))) r.carried.spear = 1

  const reserve = npcReserve(world, city)
  const stock: Stock = { ...reserve }
  for (const [good, cap] of Object.entries(NPC_SURPLUS_CAP) as [Good, number][]) {
    if (good === 'goldOre') continue
    stock[good] = (reserve[good] ?? 0) + Math.floor(cap / 2)
  }
  home.stock = stock
  return { world, terrain, city, home }
}

/** One count of the big city: who there is, what they're planned to do, who stands on the storage. */
export interface BigCityCount {
  day: number
  residents: number
  adults: number
  onStorage: number
  /** Adults by the kind of their job in the last plan; `none` for one who has none yet. */
  jobs: Record<string, number>
  /** Its finished workplaces by kind. */
  places: Record<string, number>
}

/** Counts the city as it stands. */
export function countBigCity(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  home: Building,
): BigCityCount {
  const residents = cityResidents(world, city).filter((r) => !isDown(r))
  const adults = residents.filter((r) => canWork(r, world.tick))
  const planned = world.cityPlans[city.id]?.jobs ?? {}
  const jobs: Record<string, number> = {}
  for (const r of adults) {
    const kind = planned[r.id]?.kind ?? 'none'
    jobs[kind] = (jobs[kind] ?? 0) + 1
  }
  const places: Record<string, number> = {}
  for (const b of ownWorkplaces(world, city)) {
    if (!b.site) places[b.kind] = (places[b.kind] ?? 0) + 1
  }
  return {
    day: world.tick / TICKS_PER_GAME_DAY,
    residents: residents.length,
    adults: adults.length,
    onStorage: residents.filter((r) => isAt(r, home, terrain.size)).length,
    jobs,
    places,
  }
}

/** What a run of the big city reports: a count every `everyDays`, and its planning time. */
export interface BigCityRun {
  counts: BigCityCount[]
  /** Time its planning took, in milliseconds per game hour (`npcPlanMs`, one pass an hour). */
  planMsPerHour: number
}

/**
 * Walking whose pathfinder finishes every search it is given: with its budget of real time per tick
 * (`PATH_BUDGET_MS`), when a path settles hangs on how busy the machine is, and no two runs are alike.
 * So a run of the same code always comes out the same, and two runs can be compared.
 */
export function unhurriedWalking(terrain: TerrainMap): Walking {
  const walking = new Walking(terrain)
  const requestSteps = walking.requestSteps.bind(walking)
  walking.requestSteps = (world) => requestSteps(world, Infinity)
  return walking
}

/**
 * Runs the world for `days` game days, counting every `everyDays`, and calling `eachDay` at the end
 * of each game day and `eachTick` after each tick.
 */
export function runBigCity(
  staged: ReturnType<typeof bigCity>,
  days: number,
  everyDays: number,
  eachDay: () => void = () => {},
  eachTick: () => void = () => {},
): BigCityRun {
  const { world, terrain, city, home } = staged
  const walking = unhurriedWalking(terrain)
  const counts: BigCityCount[] = []
  let ms = 0
  for (let day = 1; day <= days; day++) {
    for (let t = 0; t < TICKS_PER_GAME_DAY; t++) {
      ms += stepWorld(world, terrain, walking).npcPlanMs
      eachTick()
    }
    if (day % everyDays === 0) counts.push(countBigCity(world, terrain, city, home))
    eachDay()
  }
  return { counts, planMsPerHour: ms / (days * 24) }
}

/** A run as lines of text, for the log and the PR. */
export function bigCityReport(run: BigCityRun): string {
  const lines = run.counts.map((c) => {
    const jobs = Object.entries(c.jobs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ')
    const places = Object.entries(c.places)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ')
    return `day ${c.day}: ${c.residents} residents, ${c.adults} adults, ${c.onStorage} on the storage; ${jobs}; built: ${places}`
  })
  const on = run.counts.map((c) => c.onStorage)
  lines.push(`on the storage: ${Math.min(...on)} to ${Math.max(...on)}`)
  lines.push(`planning: ${run.planMsPerHour.toFixed(2)} ms per game hour`)
  return lines.join('\n')
}

/** What the big city shows while it is watched (`watchBigCity`). */
export interface BigCityHold {
  /** The most of its adults idle in any one plan, as a share of those it had then. */
  idleShare: number
  /** The mean of that share over its plans. */
  meanIdleShare: number
  /**
   * The most of its adults, its soldiers aside, with no order and no script at any tick, as a share of
   * those it had then: its idle, and those whose job has nothing for them just now.
   */
  stillShare: number
  /** The mean of that share over its ticks. */
  meanStillShare: number
  /**
   * The longest anyone stood on its storage with no order and no script, in ticks. One waiting there for
   * what their smelter or smithy needs (`takeInput`) is fetching, and isn't counted.
   */
  longestOnStorage: number
  /** The job of whoever did: `child` for one too young for a job. */
  longestJob: string
  /** The most residents on its storage at any tick, those walking over it and stowing included. */
  mostOnStorage: number
  /** Its planned farmers at the end of each game day. */
  farmers: number[]
  /** The biggest change in `farmers` from one game day to the next. */
  farmerSwing: number
}

/** A watch of the big city: `tick` after every tick from `fromDay` on, then `hold` says what it saw. */
export interface BigCityWatch {
  tick: () => void
  hold: () => BigCityHold
}

/** Watches the big city from game day `fromDay` on: whether it holds to its idle share (T80.11). */
export function watchBigCity(staged: ReturnType<typeof bigCity>, fromDay: number): BigCityWatch {
  const { world, terrain, city, home } = staged
  const shares: number[] = []
  const farmers: number[] = []
  const standing = new Map<string, number>()
  let stillShares = 0
  let ticks = 0
  const seen: Pick<
    BigCityHold,
    'stillShare' | 'longestOnStorage' | 'longestJob' | 'mostOnStorage'
  > = {
    stillShare: 0,
    longestOnStorage: 0,
    longestJob: 'nobody',
    mostOnStorage: 0,
  }
  let plannedAt: number | undefined
  const tick = () => {
    if (world.tick < fromDay * TICKS_PER_GAME_DAY) return
    const plan = world.cityPlans[city.id]
    const jobs = plan?.jobs ?? {}
    const residents = cityResidents(world, city).filter((r) => !isDown(r))
    const adults = residents.filter((r) => canWork(r, world.tick))
    const count = (kind: string) => adults.filter((r) => jobs[r.id]?.kind === kind).length
    if (plan && plan.plannedAt !== plannedAt) {
      plannedAt = plan.plannedAt
      shares.push(count('idle') / adults.length)
    }
    if (world.tick % TICKS_PER_GAME_DAY === 0) farmers.push(count('farm'))
    const still = adults.filter(
      (r) =>
        !r.order && !r.script && !['soldier', 'teach', 'train'].includes(jobs[r.id]?.kind ?? ''),
    )
    seen.stillShare = Math.max(seen.stillShare, still.length / adults.length)
    stillShares += still.length / adults.length
    ticks++
    const fetching = (r: Resident) => {
      const place = world.buildings.find((b) => b.id === jobs[r.id]?.buildingId)
      return !!place && RECIPES[place.kind] !== undefined
    }
    let on = 0
    for (const r of residents) {
      const here = isAt(r, home, terrain.size)
      if (here) on++
      if (!here || r.order || r.script || fetching(r)) {
        standing.delete(r.id)
        continue
      }
      const stood = (standing.get(r.id) ?? 0) + 1
      standing.set(r.id, stood)
      if (stood > seen.longestOnStorage) {
        seen.longestOnStorage = stood
        seen.longestJob = canWork(r, world.tick) ? (jobs[r.id]?.kind ?? 'none') : 'child'
      }
    }
    seen.mostOnStorage = Math.max(seen.mostOnStorage, on)
  }
  const hold = (): BigCityHold => ({
    ...seen,
    idleShare: Math.max(...shares),
    meanIdleShare: shares.reduce((sum, s) => sum + s, 0) / shares.length,
    meanStillShare: stillShares / ticks,
    farmers,
    farmerSwing: Math.max(0, ...farmers.slice(1).map((n, i) => Math.abs(n - farmers[i]!))),
  })
  return { tick, hold }
}

/** What a watch saw as lines of text, for the log and the PR. */
export function bigCityHoldReport(hold: BigCityHold): string {
  const percent = (share: number) => `${(share * 100).toFixed(1)}%`
  return [
    `idle: at most ${percent(hold.idleShare)} of its adults, ${percent(hold.meanIdleShare)} on average`,
    `no order and no script, soldiers aside: at most ${percent(hold.stillShare)}, ${percent(hold.meanStillShare)} on average`,
    `on the storage: at most ${hold.mostOnStorage} at once; the longest anyone stood there ${hold.longestOnStorage} ticks (${hold.longestJob})`,
    `farmers: ${hold.farmers.join(', ')}; swing ${hold.farmerSwing}`,
  ].join('\n')
}
