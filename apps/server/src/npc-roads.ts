import {
  BUILD_MATERIALS,
  NPC_ROAD_CREW,
  WALK_TICKS_PER_TILE,
  carryCapacity,
  inCityArea,
  isAt,
  npcReserve,
  setOutFood,
  stockWeight,
  tileIndex,
  wrapDistance,
  type Building,
  type City,
  type CityPlan,
  type CityRoad,
  type Good,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { walkTo } from './npc-behaviour.js'
import { holdsBatch, ownWorkplaces, projectNeeds } from './npc-chain.js'
import type { PathResult, Point } from './pathfinding.js'
import { worldIndex } from './world-index.js'

/*
 * An NPC city's road crew (`CONTEXT.md`: NPC road, Spare hands' work; ADR 0026): with nothing short,
 * up to `NPC_ROAD_CREW` of its spare hands, apart from its builders, build road from its home to
 * each of its workplaces outside its area, nearest first, along the way a resident would walk, tile
 * by tile, skipping tiles that have a road. They take the materials from the storage only above its
 * reserve and what its project wants, and each tile is the game's Build default with the materials
 * in hand, so it never fetches any more. A way is worked out once and kept in the plan as plain data
 * (`CityPlan.roads`; ADR 0002), so a road costs no pathfinding a tick.
 */

/** What a road crew asks for a way: `Walking` in the game, a found path a little at a time. */
export interface WayFinder {
  /** The way a resident of `side` would walk; asked again until it is settled. `key` names it. */
  way(key: string, from: Point, to: Point, side: string | null): PathResult
}

/** What one tile of road takes. */
const roadMaterials = (): Stock => BUILD_MATERIALS.road ?? {}

/** What the city keeps from its crew: its reserve, and what its project still needs. */
function keeps(world: WorldState, city: City, plan: CityPlan): Stock {
  const want = npcReserve(world, city)
  for (const [good, n] of Object.entries(projectNeeds(world, plan.project)) as [Good, number][]) {
    want[good] = (want[good] ?? 0) + n
  }
  return want
}

/** Whole tiles of road the goods make, by what one takes; 0 when they lack some or are below 0. */
function tilesIn(goods: Stock): number {
  let tiles = Infinity
  for (const [good, n] of Object.entries(roadMaterials()) as [Good, number][]) {
    tiles = Math.min(tiles, Math.floor((goods[good] ?? 0) / n))
  }
  return tiles === Infinity ? 0 : Math.max(0, tiles)
}

/** What a store holds above what the city keeps (`keeps`), by the goods a road takes. */
function aboveKept(world: WorldState, city: City, plan: CityPlan, store: Building): Stock {
  const want = keeps(world, city, plan)
  const above: Stock = {}
  for (const good of Object.keys(roadMaterials()) as Good[]) {
    above[good] = (store.stock?.[good] ?? 0) - (want[good] ?? 0)
  }
  return above
}

/** The next tile of its roads still to build that no other of the crew took, and how many are left. */
function nextTile(
  world: WorldState,
  plan: CityPlan,
  size: number,
  taken: ReadonlySet<string> = new Set(),
): { tile: readonly [number, number]; left: number } | undefined {
  const built = worldIndex(world).roads(size)
  let tile: readonly [number, number] | undefined
  let left = 0
  for (const road of plan.roads ?? []) {
    for (const t of road.tiles) {
      if (built.has(tileIndex(size, t[0], t[1]))) continue
      left++
      if (!tile && !taken.has(`${t[0]},${t[1]}`)) tile = t
    }
  }
  return tile && { tile, left }
}

/**
 * Brings its ways up to date and says whether it has a road to build now (`CONTEXT.md`: NPC road).
 * Ways go in the order of its finished workplaces outside its area, nearest its home first; those of
 * workplaces gone or taken into its area are dropped. The nearest workplace without a way yet asks
 * for one, one search at a time, and the ways it knows go on meanwhile. One with no way through
 * stays empty, given up.
 */
function planRoads(
  world: WorldState,
  city: City,
  plan: CityPlan,
  home: Building,
  ways: WayFinder,
  size: number,
): boolean {
  const places = ownWorkplaces(world, city)
    .filter((b) => !b.site && !inCityArea(world, city, b.x, b.y, size))
    .sort((a, b) => wrapDistance(size, home, a) - wrapDistance(size, home, b))
  const known = new Map((plan.roads ?? []).map((r) => [r.to, r]))
  const roads: CityRoad[] = []
  let searching = false
  for (const place of places) {
    let road = known.get(place.id)
    if (!road && !searching) {
      const found = ways.way(
        `${city.id}:${place.id}`,
        [home.x, home.y],
        [place.x, place.y],
        city.id,
      )
      if (found.status === 'searching') searching = true
      else {
        const tiles = found.status === 'found' ? found.path : []
        road = { to: place.id, tiles: tiles.map(([x, y]) => [x, y]) }
      }
    }
    if (road) roads.push(road)
  }
  if (roads.length > 0) plan.roads = roads
  else delete plan.roads
  return nextTile(world, plan, size) !== undefined
}

/**
 * The road crew of this planning pass (`CONTEXT.md`: NPC road), from `unneeded`, the spare hands
 * nothing short has a use for: none at a Trade Org city, or while what a road takes is short or
 * neither the storage nor the crew has any to spare, or with no road to build. Those on the crew
 * stay on it; next come those free of any workplace, then those who would go back to one, and last
 * a scout out, who is far off and comes home first.
 */
export function roadCrew(
  world: WorldState,
  city: City,
  plan: CityPlan,
  unneeded: readonly Resident[],
  returning: ReadonlySet<string>,
  store: Building | undefined,
  home: Building | undefined,
  ways: WayFinder | undefined,
  size: number,
): Resident[] {
  if (city.tradeOrg || !ways || !store || !home || unneeded.length === 0) return []
  const onCrew = (r: Resident) => plan.jobs[r.id]?.kind === 'road'
  const above = aboveKept(world, city, plan, store)
  if (Object.values(above).some((n) => n < 0)) return []
  const inHand = unneeded.filter(onCrew).reduce((sum, r) => sum + tilesIn(r.carried), 0)
  if (tilesIn(above) + inHand < 1) return []
  if (!planRoads(world, city, plan, home, ways, size)) return []
  const rank = (r: Resident) =>
    onCrew(r) ? 0 : plan.scouts?.[r.id] ? 3 : returning.has(r.id) ? 2 : 1
  return [...unneeded].sort((a, b) => rank(a) - rank(b)).slice(0, NPC_ROAD_CREW)
}

/** Whether a resident is running the Build default on a tile of road (`layRoad`). */
export function onRoadWork(r: Resident): boolean {
  return (
    r.script?.scriptId === 0 && r.script.task === 'build' && r.script.memory.building === 'road'
  )
}

/**
 * Gives an idle resident on the road crew their next step, if they have one (`CONTEXT.md`: NPC
 * road): with what a tile takes in hand, the Build default on the next tile still to build that no
 * other of the crew took; else the walk to the storage, and there a pick-up of the Food for the walk
 * (`setOutFood`) and as many tiles' materials as fit and it can spare above what it keeps (`keeps`,
 * less what the crew is picking up this tick). False with no tile to go to or nothing to fetch.
 * `crew` are the city's residents on the crew, them too.
 */
export function layRoad(
  world: WorldState,
  city: City,
  plan: CityPlan,
  r: Resident,
  crew: readonly Resident[],
  store: Building | undefined,
  size: number,
): boolean {
  const taken = new Set<string>()
  for (const other of crew) {
    const at = other.id !== r.id ? other.script?.memory.at : undefined
    if (at && typeof at === 'object' && !Array.isArray(at)) taken.add(`${at.x},${at.y}`)
  }
  const next = nextTile(world, plan, size, taken)
  if (!next) return false
  const [x, y] = next.tile
  if (holdsBatch(r.carried, roadMaterials())) {
    r.order = null
    r.script = { scriptId: 0, task: 'build', memory: { building: 'road', at: { x, y } } }
    return true
  }
  if (!store) return false
  const above = aboveKept(world, city, plan, store)
  for (const other of crew) {
    const o = other.order
    if (o?.kind !== 'pickUp') continue
    for (const good of Object.keys(above) as Good[]) {
      above[good] = (above[good] ?? 0) - (o.goods[good] ?? 0)
    }
  }
  if (tilesIn(above) < 1) return false
  if (!isAt(r, store, size)) {
    walkTo(r, store)
    return true
  }
  let room = carryCapacity(r, world.tick) - stockWeight(r.carried)
  const walk = wrapDistance(size, r, { x, y }) * WALK_TICKS_PER_TILE
  const food = Math.min(
    store.stock?.food ?? 0,
    Math.max(0, setOutFood(walk) - (r.carried.food ?? 0)),
    Math.max(0, room),
  )
  room -= stockWeight({ food })
  const tiles = Math.min(tilesIn(above), next.left, Math.floor(room / stockWeight(roadMaterials())))
  if (tiles < 1) return false
  const goods: Stock = food > 0 ? { food } : {}
  for (const [good, n] of Object.entries(roadMaterials()) as [Good, number][]) {
    goods[good] = n * tiles
  }
  r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: store.id }, goods }
  return true
}

/**
 * A road crew stays its size (`CONTEXT.md`: NPC road; ADR 0004): no plan puts more than
 * `NPC_ROAD_CREW` residents on it, and no plan of a Trade Org city any, since they build none.
 */
export const npcRoadCrewSized: Invariant = {
  name: 'npc-road-crew-sized',
  check(world) {
    const out: InvariantViolation[] = []
    for (const city of world.cities) {
      const jobs = world.cityPlans[city.id]?.jobs
      if (!jobs) continue
      const crew = Object.keys(jobs).filter((id) => jobs[id]?.kind === 'road')
      const most = city.tradeOrg ? 0 : NPC_ROAD_CREW
      if (crew.length <= most) continue
      out.push({
        invariant: this.name,
        message: `${city.id} plans a road crew of ${crew.length}, at most ${most}`,
        entityIds: [city.id, ...crew],
      })
    }
    return out
  },
}
