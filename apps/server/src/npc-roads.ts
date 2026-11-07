import {
  BUILD_MATERIALS,
  CITY_AREA_MARGIN,
  NPC_ROAD_CREW,
  NPC_ROAD_LONGEST,
  NPC_TRADER_REACH,
  WALK_TICKS_PER_TILE,
  carryCapacity,
  footprintTiles,
  inCityArea,
  inInnerRingAround,
  isAt,
  isCityBuilding,
  npcNeedsScale,
  npcReserve,
  roadCrewFood,
  setOutFood,
  stockWeight,
  tileIndex,
  wrapDelta,
  wrapDistance,
  type Building,
  type City,
  type CityPlan,
  type CityRoad,
  type Good,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { streetsOwed } from './city-layout.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { walkTo } from './npc-behaviour.js'
import { holdsBatch, ownWorkplaces, projectNeeds } from './npc-chain.js'
import { foundingMaterials, fullButMaterials } from './npc-founding.js'
import { wallRings } from './npc-growth.js'
import type { PathResult, Point } from './pathfinding.js'
import { worldIndex } from './world-index.js'

/*
 * An NPC city's road crew (`CONTEXT.md`: NPC road, City layout, Spare hands' work; ADR 0026): with
 * nothing short, up to `npcRoadCrew` of its spare hands, apart from its builders, build its
 * layout's streets beside the buildings that stand, then road from its home to each of its
 * workplaces outside its area, nearest first, then on to the nearest Trade Org warehouse in its
 * trader's reach and the edge of its nearest neighbour's area, along the way a resident would walk,
 * tile by tile, skipping tiles that have a road. They take the materials from the storage only above
 * its reserve and what its project wants, and each tile is the game's Build default with the
 * materials in hand, so it never fetches any more, and gets its Food as that default does (Getting
 * food). A way is worked out once and kept in the plan as plain data (`CityPlan.roads`; ADR 0002), so
 * a road costs no pathfinding a tick; its streets are worked out each pass (`CityPlan.streets`).
 */

/** What a road crew asks for a way: `Walking` in the game, a found path a little at a time. */
export interface WayFinder {
  /** The way a resident of `side` would walk; asked again until it is settled. `key` names it. */
  way(
    key: string,
    from: Point,
    to: Point,
    side: string | null,
    area?: ReadonlySet<number>,
  ): PathResult
}

/** What one tile of road takes. */
const roadMaterials = (): Stock => BUILD_MATERIALS.road ?? {}

/**
 * What the city keeps from its crew: its reserve, what its project still needs, and once it would
 * otherwise be full (`fullButMaterials`) a town hall's and a storage's materials, so founding comes
 * before roads (`CONTEXT.md`: NPC road).
 */
function keeps(world: WorldState, city: City, plan: CityPlan): Stock {
  const want = npcReserve(world, city)
  const add = (goods: Stock) => {
    for (const [good, n] of Object.entries(goods) as [Good, number][]) {
      want[good] = (want[good] ?? 0) + n
    }
  }
  add(projectNeeds(world, plan.project))
  if (fullButMaterials(world, city, plan)) add(foundingMaterials())
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

/**
 * The next tile still to build that no other of the crew took, and how many are left: of its streets
 * first (`CONTEXT.md`: City layout), then of its roads in order.
 */
function nextTile(
  world: WorldState,
  streets: readonly (readonly [number, number])[],
  roads: readonly CityRoad[],
  size: number,
  taken: ReadonlySet<string> = new Set(),
): { tile: readonly [number, number]; left: number } | undefined {
  const built = worldIndex(world).roads(size)
  let tile: readonly [number, number] | undefined
  let left = 0
  for (const tiles of [streets, ...roads.map((road) => road.tiles)]) {
    for (const t of tiles) {
      if (built.has(tileIndex(size, t[0], t[1]))) continue
      left++
      if (!tile && !taken.has(`${t[0]},${t[1]}`)) tile = t
    }
  }
  return tile && { tile, left }
}

/** The tiles of a city's area (`inCityArea`), as tile indices, for a way's search. */
function areaTiles(world: WorldState, city: City, size: number): Set<number> {
  const tiles = new Set<number>()
  for (const b of world.buildings) {
    if (b.cityId !== city.id || !isCityBuilding(b)) continue
    for (const [x, y] of footprintTiles(b, size)) {
      for (let dy = -CITY_AREA_MARGIN; dy <= CITY_AREA_MARGIN; dy++) {
        for (let dx = -CITY_AREA_MARGIN; dx <= CITY_AREA_MARGIN; dx++) {
          tiles.add(tileIndex(size, x + dx, y + dy))
        }
      }
    }
  }
  return tiles
}

/**
 * Whether a building is a finished Trade Org warehouse a road can lead to: not one in the HQ's inner
 * ring, whose gates stay closed to everyone else (`CONTEXT.md`: Trade Org HQ), so that a way there
 * isn't given up in place of the way to a post it can walk to.
 */
function isPost(world: WorldState, b: Building, size: number): boolean {
  if (b.kind !== 'warehouse' || b.site) return false
  const owner = world.cities.find((c) => c.id === b.cityId)
  if (!owner?.tradeOrg) return false
  const hall =
    owner.tradeOrg === 'hq' ? worldIndex(world).buildingById(owner.townHallId) : undefined
  return !hall || !inInnerRingAround(hall, b, size)
}

/** The nearest such warehouse (`isPost`) within its trader's reach of `home`. */
function nearestPost(world: WorldState, home: Building, size: number): Building | undefined {
  let best: { b: Building; d: number } | undefined
  for (const b of world.buildings) {
    if (b.kind !== 'warehouse') continue
    const d = wrapDistance(size, home, b)
    if (d > NPC_TRADER_REACH || (best && d >= best.d) || !isPost(world, b, size)) continue
    best = { b, d }
  }
  return best?.b
}

/** The city nearest `home` and its town hall, the Trade Org's aside: they have their warehouses. */
function nearestNeighbour(
  world: WorldState,
  city: City,
  home: Building,
  size: number,
): { city: City; hall: Building } | undefined {
  const index = worldIndex(world)
  let best: { city: City; hall: Building; d: number } | undefined
  for (const other of world.cities) {
    if (other.id === city.id || other.tradeOrg) continue
    const hall = index.buildingById(other.townHallId)
    if (!hall) continue
    const d = wrapDistance(size, home, hall)
    if (!best || d < best.d) best = { city: other, hall, d }
  }
  return best
}

/** Whether a road's far end still stands, for one that isn't to a workplace: a post, or a city. */
function leadsOn(world: WorldState, to: string, size: number): boolean {
  if (world.cities.some((c) => c.id === to && !c.tradeOrg)) return true
  const b = worldIndex(world).buildingById(to)
  return b !== undefined && isPost(world, b, size)
}

/**
 * Brings its streets and ways up to date and says whether it has a road to build now (`CONTEXT.md`:
 * NPC road, City layout). Its streets come ahead of all its ways, worked out anew each pass, so they
 * follow its buildings as they go up. Ways go in the order of its finished workplaces outside its area, nearest its home first; those of
 * workplaces gone or taken into its area are dropped. The nearest workplace without a way yet asks
 * for one, one search at a time, and the ways it knows go on meanwhile. Once all it knows are built,
 * it asks for the way to the nearest post, then to the edge of its nearest neighbour's area, unless
 * that neighbour already has the road between them. Ways on to ones no longer the nearest stay while
 * they stand, so a road isn't left half done when a daughter is founded. One with no way through, or
 * longer than `NPC_ROAD_LONGEST`, stays empty, given up.
 */
function planRoads(
  world: WorldState,
  city: City,
  plan: CityPlan,
  home: Building,
  ways: WayFinder,
  terrain: TerrainMap,
): boolean {
  const size = terrain.size
  const streets = streetsOwed(
    world,
    city,
    home,
    wallRings(world, city, home, size)?.newGate,
    terrain,
  )
  if (streets.length > 0) plan.streets = streets
  else delete plan.streets
  const known = new Map((plan.roads ?? []).map((r) => [r.to, r]))
  /** The fewest tiles a way from its home to (x, y) can have: a Step can go diagonally. */
  const fewestTiles = (x: number, y: number) =>
    Math.max(Math.abs(wrapDelta(home.x, x, size)), Math.abs(wrapDelta(home.y, y, size)))
  /** The way to `to` once it is settled; until then, asks a search for it. */
  const settle = (to: string, at: Point, area?: ReadonlySet<number>): CityRoad | undefined => {
    const ends = area ? [...area].map((t) => [t % size, Math.floor(t / size)] as const) : [at]
    if (ends.every(([x, y]) => fewestTiles(x, y) > NPC_ROAD_LONGEST)) return { to, tiles: [] }
    const found = ways.way(`${city.id}:${to}`, [home.x, home.y], at, city.id, area)
    if (found.status === 'searching') return undefined
    const tiles =
      found.status === 'found' && found.path.length <= NPC_ROAD_LONGEST ? found.path : []
    return { to, tiles: tiles.map(([x, y]) => [x, y]) }
  }
  const places = ownWorkplaces(world, city)
    .filter((b) => !b.site && !inCityArea(world, city, b.x, b.y, size))
    .sort((a, b) => wrapDistance(size, home, a) - wrapDistance(size, home, b))
  const placeIds = new Set(places.map((b) => b.id))
  const roads: CityRoad[] = []
  let searching = false
  for (const place of places) {
    let road = known.get(place.id)
    if (!road && !searching) {
      road = settle(place.id, [place.x, place.y])
      searching = !road
    }
    if (road) roads.push(road)
  }
  for (const road of plan.roads ?? []) {
    if (!placeIds.has(road.to) && leadsOn(world, road.to, size)) roads.push(road)
  }
  const has = (to: string) => roads.some((r) => r.to === to)
  if (!searching && !nextTile(world, streets, roads, size)) {
    const post = nearestPost(world, home, size)
    if (post && !has(post.id)) {
      const road = settle(post.id, [post.x, post.y])
      if (road) roads.push(road)
      else searching = true
    }
  }
  if (!searching && !nextTile(world, streets, roads, size)) {
    const next = nearestNeighbour(world, city, home, size)
    const theirs = next && world.cityPlans[next.city.id]?.roads?.some((r) => r.to === city.id)
    if (next && !theirs && !has(next.city.id)) {
      const area = areaTiles(world, next.city, size)
      const road = settle(next.city.id, [next.hall.x, next.hall.y], area)
      if (road) roads.push(road)
    }
  }
  if (roads.length > 0) plan.roads = roads
  else delete plan.roads
  return nextTile(world, streets, roads, size) !== undefined
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
  terrain: TerrainMap | undefined,
): Resident[] {
  if (city.tradeOrg || !ways || !terrain || !store || !home || unneeded.length === 0) return []
  const onCrew = (r: Resident) => plan.jobs[r.id]?.kind === 'road'
  const above = aboveKept(world, city, plan, store)
  if (Object.values(above).some((n) => n < 0)) return []
  const inHand = unneeded.filter(onCrew).reduce((sum, r) => sum + tilesIn(r.carried), 0)
  if (tilesIn(above) + inHand < 1) return []
  if (!planRoads(world, city, plan, home, ways, terrain)) return []
  const rank = (r: Resident) =>
    onCrew(r) ? 0 : plan.scouts?.[r.id] ? 3 : returning.has(r.id) ? 2 : 1
  return [...unneeded].sort((a, b) => rank(a) - rank(b)).slice(0, npcRoadCrew(world, city))
}

/** Most of an NPC city's spare hands on its road crew (`CONTEXT.md`: NPC road): more as it grows. */
export function npcRoadCrew(world: WorldState, city: City): number {
  return NPC_ROAD_CREW * npcNeedsScale(world, city)
}

/** Whether a resident is running the Build default on a tile of road (`layRoad`). */
export function onRoadWork(r: Resident): boolean {
  return (
    r.script?.scriptId === 0 && r.script.task === 'build' && r.script.memory.building === 'road'
  )
}

/**
 * Gives an idle resident on the road crew their next step, if they have one (`CONTEXT.md`: NPC
 * road): with what a tile takes in hand and the Food to get home from it (`roadCrewFood`), the Build
 * default on the next tile still to build that no other of the crew took; else the walk to the
 * storage, and there a pick-up of the Food for the walk (`setOutFood`) and as many tiles' materials
 * as fit and it can spare above what it keeps (`keeps`, less what the crew is picking up this tick).
 * False with no tile to go to or nothing to fetch. `crew` are the city's residents on the crew, them
 * too.
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
  const next = nextTile(world, plan.streets ?? [], plan.roads ?? [], size, taken)
  if (!next) return false
  const [x, y] = next.tile
  const holds = holdsBatch(r.carried, roadMaterials())
  const walk = store ? wrapDistance(size, store, { x, y }) * WALK_TICKS_PER_TILE : 0
  const fed = !store || (store.stock?.food ?? 0) < 1 || (r.carried.food ?? 0) >= roadCrewFood(walk)
  if (holds && fed) {
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
  if (!holds && tilesIn(above) < 1) return false
  if (!isAt(r, store, size)) {
    walkTo(r, store)
    return true
  }
  let room = carryCapacity(r, world.tick) - stockWeight(r.carried)
  const food = Math.min(
    store.stock?.food ?? 0,
    Math.max(0, setOutFood(walk) - (r.carried.food ?? 0)),
    Math.max(0, room),
  )
  room -= stockWeight({ food })
  const tiles = Math.min(tilesIn(above), next.left, Math.floor(room / stockWeight(roadMaterials())))
  // Holding a tile's materials already, they can come for the Food alone.
  if (tiles < 1 && !(holds && food > 0)) return false
  const goods: Stock = food > 0 ? { food } : {}
  if (tiles >= 1) {
    for (const [good, n] of Object.entries(roadMaterials()) as [Good, number][]) {
      goods[good] = n * tiles
    }
  }
  r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: store.id }, goods }
  return true
}

/**
 * NPC roads are built once and stay in bounds (`CONTEXT.md`: NPC road; ADR 0004): two cities never
 * each keep a road to the other, and no way is longer than `NPC_ROAD_LONGEST`.
 */
export const npcRoadsOnce: Invariant = {
  name: 'npc-roads-once',
  check(world) {
    const out: InvariantViolation[] = []
    for (const city of world.cities) {
      for (const road of world.cityPlans[city.id]?.roads ?? []) {
        if (road.tiles.length > NPC_ROAD_LONGEST) {
          out.push({
            invariant: this.name,
            message: `${city.id}'s way to ${road.to} is ${road.tiles.length} tiles long`,
            entityIds: [city.id, road.to],
          })
        }
        // Each pair once: seen from the one with the lower id.
        if (city.id > road.to) continue
        if (world.cityPlans[road.to]?.roads?.some((r) => r.to === city.id)) {
          out.push({
            invariant: this.name,
            message: `${city.id} and ${road.to} each keep a road to the other`,
            entityIds: [city.id, road.to],
          })
        }
      }
    }
    return out
  },
}

/**
 * A road crew stays its size (`CONTEXT.md`: NPC road; ADR 0004): no plan made this tick puts more
 * than `npcRoadCrew` residents on it, as an older one may have been made when the city was bigger, and
 * no plan of a Trade Org city any, since they build none.
 */
export const npcRoadCrewSized: Invariant = {
  name: 'npc-road-crew-sized',
  check(world) {
    const out: InvariantViolation[] = []
    for (const city of world.cities) {
      const plan = world.cityPlans[city.id]
      const jobs = plan?.jobs
      if (!jobs) continue
      const crew = Object.keys(jobs).filter((id) => jobs[id]?.kind === 'road')
      if (crew.length === 0) continue
      if (!city.tradeOrg && plan.plannedAt !== world.tick) continue
      const most = city.tradeOrg ? 0 : npcRoadCrew(world, city)
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
