import {
  BUILD_MATERIALS,
  CITY_LAYOUTS,
  GET_FOOD_AT,
  MOUNTAIN_ROAD_WORK_FACTOR,
  NPC_BUILDERS,
  NPC_ROAD_CREW,
  NPC_ROAD_LONGEST,
  NPC_SMITHY_WEAPON,
  NPC_SOLDIER_SHARE,
  NPC_SURPLUS_CAP,
  NPC_TOWN,
  NPC_TRADER_REACH,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  Terrain,
  WALK_TICKS_PER_TILE,
  buildingAt,
  covers,
  footprintTiles,
  inCityArea,
  isDown,
  npcReserve,
  roadAt,
  roadCrewFood,
  terrainAt,
  tileIndex,
  wallMap,
  wrapDistance,
  type Building,
  type City,
  type CityLayout,
  type CityPlan,
  type Good,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { cityStreetsSound, layoutPlan, streetsOwed } from './city-layout.js'
import { checkInvariants } from './invariants.js'
import { npcHome, stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { farStableSpot, houseTile, stableTile, wallRings } from './npc-growth.js'
import { giveNpcHorses } from './npc-horses.js'
import { planCity } from './npc-plan.js'
import { npcRoadCrewSized, npcRoadsOnce, roadCrew, type WayFinder } from './npc-roads.js'
import { PathFinder, WALKING_COSTS } from './pathfinding.js'
import { mulberry32 } from './residents.js'
import { newId } from './starting-city.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * An NPC city's road crew (`CONTEXT.md`: NPC road, Spare hands' work): with nothing short, some of
 * its spare hands build road out to its workplaces along the way a resident would walk, only from
 * materials above its reserve, and a tile torn down is laid again.
 */

const STONE = BUILD_MATERIALS.road?.stone ?? 0

/** How far from the home the workplace of `town` lies, past the wall. */
const FAR = 60

/** A lumber camp of the city's on a forest node, `dx` tiles east of its home. */
function camp(world: WorldState, terrain: TerrainMap, city: City, dx: number, dy = 0): Building {
  const home = npcHome(world, city)!
  const at = { x: home.x + dx, y: home.y + dy }
  world.nodes.push({ id: newId(world, 'n'), kind: 'forest', ...at })
  terrain.tiles[tileIndex(terrain.size, at.x, at.y)] = Terrain.Forest
  const place = { id: newId(world, 'b'), kind: 'lumberCamp', ...at, cityId: null } as Building
  world.buildings.push(place)
  ;(city.workplaceIds ??= []).push(place.id)
  return place
}

/** A town alone on Plains with a far lumber camp, holding its reserve and `past` above it. */
function town(past: Stock = { stone: 50 }, size = 300) {
  const terrain = plains(size)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(5))
  const place = camp(world, terrain, city, FAR)
  const storage = npcHome(world, city)!
  setStock(world, city, storage, past)
  layStreets(world, terrain, city)
  return { world, terrain, city, place, storage, home: npcHome(world, city)! }
}

/** The street tiles the city wants as road now (`streetsOwed`). */
function owedBy(world: WorldState, terrain: TerrainMap, city: City) {
  const home = npcHome(world, city)!
  const gate = wallRings(world, city, home, terrain.size)?.newGate
  return streetsOwed(world, city, home, gate, terrain)
}

/** Its streets laid, so its crew goes on to its other roads. */
function layStreets(world: WorldState, terrain: TerrainMap, city: City): void {
  layAll(world, owedBy(world, terrain, city))
}

/** The city holds its reserve, its Food cap and Wood cap above that, and `past` above it. */
function setStock(world: WorldState, city: City, storage: Building, past: Stock): void {
  const stock: Stock = npcReserve(world, city)
  const all: Stock = { food: NPC_SURPLUS_CAP.food, wood: NPC_SURPLUS_CAP.wood, ...past }
  for (const [good, n] of Object.entries(all) as [Good, number][]) {
    stock[good] = (stock[good] ?? 0) + n
  }
  storage.stock = stock
}

/** Ways found at once with the walls as they stand, counting the times they are asked for. */
function waysOf(world: WorldState, terrain: TerrainMap) {
  const finder = new PathFinder(terrain)
  const asked: string[] = []
  const ways: WayFinder = {
    way(key, from, to, side, area) {
      asked.push(key)
      finder.setWalls(wallMap(world, terrain))
      return finder.findPath(from, to, WALKING_COSTS, { realmId: side, ...(area && { area }) })
    },
  }
  return { ways, asked }
}

/** A second town at `dx` tiles east of the first, holding its reserve and `past` above it. */
function neighbour(
  world: WorldState,
  terrain: TerrainMap,
  dx: number,
  past: Stock = { stone: 50 },
) {
  const city = foundNpcCity(world, terrain, NPC_TOWN, 60 + dx, 60, mulberry32(6))
  setStock(world, city, npcHome(world, city)!, past)
  layStreets(world, terrain, city)
  return city
}

/** The finished Trade Org warehouse of a post. */
const warehouseOf = (world: WorldState, post: City): Building =>
  world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === post.id)!

/** Plans the city a few times, laying at once all it wants built, so it comes to its next road. */
function joinAll(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  ways: WayFinder,
  passes = 8,
): CityPlan {
  let plan = planCity(world, city, terrain, undefined, ways)
  for (let i = 0; i < passes; i++) {
    layNew(
      world,
      (plan.roads ?? []).flatMap((r) => r.tiles),
    )
    plan = planCity(world, city, terrain, undefined, ways)
  }
  return plan
}

/** A finished road on each of the tiles that has none yet, once each. */
function layNew(world: WorldState, tiles: readonly (readonly [number, number])[]): void {
  const once = new Map(tiles.map((t) => [`${t[0]},${t[1]}`, t]))
  layAll(
    world,
    [...once.values()].filter(([x, y]) => !roadAt(world, x, y)),
  )
}

/** Those a plan puts on the road crew. */
const crewOf = (world: WorldState, plan: CityPlan): Resident[] =>
  world.residents.filter((r) => plan.jobs[r.id]?.kind === 'road')

/** The finished road of a way's tile. */
const finished = (world: WorldState, t: readonly [number, number]) => {
  const road = roadAt(world, t[0], t[1])
  return road && !road.site ? road : undefined
}

/** A finished road on each of the tiles. */
function layAll(world: WorldState, tiles: readonly (readonly [number, number])[]): void {
  for (const [x, y] of tiles) {
    world.buildings.push({ id: newId(world, 'b'), kind: 'road', x, y, cityId: null })
  }
}

describe('a road crew', () => {
  it('is its spare hands with nothing short, at most NPC_ROAD_CREW of them', () => {
    const { world, terrain, city } = town()
    const { ways } = waysOf(world, terrain)
    const plan = planCity(world, city, terrain, undefined, ways)
    expect(crewOf(world, plan)).toHaveLength(NPC_ROAD_CREW)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('comes apart from the builders, and ahead of work for surplus', () => {
    const { world, terrain, city } = town()
    const { ways } = waysOf(world, terrain)
    const house = { kind: 'build' as const, building: 'house' as const, x: 30, y: 30 }
    world.cityPlans[city.id] = { plannedAt: world.tick, jobs: {}, project: house }
    const plan = planCity(world, city, terrain, undefined, ways)
    const jobs = Object.values(plan.jobs)
    expect(jobs.filter((j) => j.kind === 'road')).toHaveLength(NPC_ROAD_CREW)
    expect(jobs.filter((j) => j.kind === 'build').length).toBeLessThanOrEqual(NPC_BUILDERS)
  })

  it('comes ahead of scouts, who are the rest of the spare hands, and takes one out last', () => {
    const { world, terrain, city } = town()
    const { ways } = waysOf(world, terrain)
    const plan = planCity(world, city, terrain, undefined, ways)
    const jobs = Object.values(plan.jobs)
    expect(jobs.filter((j) => j.kind === 'road')).toHaveLength(NPC_ROAD_CREW)
    expect(jobs.filter((j) => j.kind === 'scout').length).toBeGreaterThan(0)
    const crew = crewOf(world, plan).map((r) => r.id)
    expect(crew.some((id) => plan.jobs[id]?.kind === 'scout')).toBe(false)

    // A new crew, with a scout out among the spare hands: the scout stays out.
    const scout = world.residents.find((r) => plan.jobs[r.id]?.kind === 'scout')!
    plan.scouts = { [scout.id]: { saw: [] } }
    for (const id of crew) delete plan.jobs[id]
    const next = planCity(world, city, terrain, undefined, ways)
    expect(next.jobs[scout.id]?.kind).toBe('scout')
    expect(crewOf(world, next)).toHaveLength(NPC_ROAD_CREW)
  })

  it('keeps its members from pass to pass', () => {
    const { world, terrain, city } = town()
    const { ways } = waysOf(world, terrain)
    const first = crewOf(world, planCity(world, city, terrain, undefined, ways)).map((r) => r.id)
    const again = crewOf(world, planCity(world, city, terrain, undefined, ways)).map((r) => r.id)
    expect(again).toEqual(first)
  })

  it('takes a way worked out once, kept as plain data', () => {
    const { world, terrain, city, place, home } = town()
    const { ways, asked } = waysOf(world, terrain)
    planCity(world, city, terrain, undefined, ways)
    const plan = planCity(world, city, terrain, undefined, ways)
    expect(new Set(asked).size).toBe(asked.length)
    expect(asked).toHaveLength(plan.roads!.length)
    const road = plan.roads!.find((r) => r.to === place.id)!
    expect(road.tiles.at(-1)).toEqual([place.x, place.y])
    const [x, y] = road.tiles[0]!
    expect(wrapDistance(terrain.size, home, { x, y })).toBeLessThan(2)
    expect(JSON.parse(JSON.stringify(plan.roads))).toEqual(plan.roads)
  })

  it('goes to the nearest workplace first, and leaves those in its area alone', () => {
    const { world, terrain, city, place, home } = town()
    const nearer = camp(world, terrain, city, 0, FAR - 10)
    const inside = camp(world, terrain, city, 2, 2)
    expect(inCityArea(world, city, inside.x, inside.y, terrain.size)).toBe(true)
    const { ways } = waysOf(world, terrain)
    planCity(world, city, terrain, undefined, ways)
    const plan = planCity(world, city, terrain, undefined, ways)
    const to = plan.roads!.map((r) => r.to)
    expect(to).not.toContain(inside.id)
    expect(to.indexOf(nearer.id)).toBeLessThan(to.indexOf(place.id))
    const far = to.map((id) =>
      wrapDistance(
        terrain.size,
        home,
        world.buildings.find((b) => b.id === id)!,
      ),
    )
    expect(far).toEqual([...far].sort((a, b) => a - b))
  })

  it('is called off for what is short, and brings back what it carries', () => {
    const { world, terrain, city, storage } = town()
    const { ways } = waysOf(world, terrain)
    const [member] = crewOf(world, planCity(world, city, terrain, undefined, ways))
    member!.carried.stone = 5
    // Stone below the reserve: nobody lays any more.
    const reserve = npcReserve(world, city).stone ?? 0
    storage.stock!.stone = reserve - 1
    const plan = planCity(world, city, terrain, undefined, ways)
    expect(crewOf(world, plan)).toEqual([])
    member!.order = null
    delete member!.script
    member!.x = storage.x
    member!.y = storage.y
    stepNpcCities(world, terrain.size, terrain, ways)
    expect(member!.order).toMatchObject({ kind: 'drop', goods: { stone: 5 } })
  })

  it('stands down with nothing to spare, and leaves a tile it was on', () => {
    const { world, terrain, city, storage } = town()
    const { ways } = waysOf(world, terrain)
    const [member] = crewOf(world, planCity(world, city, terrain, undefined, ways))
    member!.script = {
      scriptId: 0,
      task: 'build',
      memory: { building: 'road', at: { x: 1, y: 1 } },
    }
    storage.stock!.stone = npcReserve(world, city).stone ?? 0
    planCity(world, city, terrain, undefined, ways)
    world.tick = world.cityPlans[city.id]!.plannedAt
    expect(crewOf(world, world.cityPlans[city.id]!)).toEqual([])
    stepNpcCities(world, terrain.size, terrain, ways)
    expect(member!.script?.memory.building).not.toBe('road')
  })

  it('keeps above what its project still wants', () => {
    const { world, terrain, city, storage, home } = town({ stone: 2 })
    const { ways } = waysOf(world, terrain)
    const people = world.residents.filter((r) => r.cityId === city.id)
    const crew = (plan: CityPlan) =>
      roadCrew(world, city, plan, people, new Set(), storage, home, ways, terrain)
    expect(crew({ plannedAt: 0, jobs: {} })).toHaveLength(NPC_ROAD_CREW)
    // A mine wants more Stone than the 2 above the reserve.
    const project = { kind: 'build' as const, building: 'mine' as const, x: 200, y: 200 }
    expect(crew({ plannedAt: 0, jobs: {}, project })).toEqual([])
  })

  it('lets go of its tile and brings home what it carries once armed', () => {
    const { world, terrain, city, storage } = town()
    const { ways } = waysOf(world, terrain)
    const plan = planCity(world, city, terrain, undefined, ways)
    const member = crewOf(world, plan)[0]!
    const [x, y] = plan.roads![0]!.tiles[0]!
    const site: Building = {
      id: newId(world, 'b'),
      kind: 'road',
      x,
      y,
      cityId: null,
      site: { delivered: {}, work: 0 },
    }
    world.buildings.push(site)
    member.x = x
    member.y = y
    member.carried = { food: 3, stone: 20, [NPC_SMITHY_WEAPON]: 1 }
    member.order = { kind: 'build', building: 'road', at: { x, y }, siteId: site.id }
    delete member.script
    expect(planCity(world, city, terrain, undefined, ways).jobs[member.id]?.kind).toBe('soldier')
    const before = storage.stock!.stone ?? 0
    const walking = new Walking(terrain)
    for (let t = 0; t < TICKS_PER_GAME_DAY && (member.carried.stone ?? 0) > 0; t++) {
      stepWorld(world, terrain, walking)
    }
    expect(member.carried.stone ?? 0).toBe(0)
    expect(storage.stock!.stone ?? 0).toBeGreaterThanOrEqual(before + 20)
    expect(member.carried[NPC_SMITHY_WEAPON]).toBe(1)
  })

  it('lays a torn-down tile again', () => {
    const { world, terrain, city } = town()
    const { ways } = waysOf(world, terrain)
    const plan = planCity(world, city, terrain, undefined, ways)
    const tiles = plan.roads![0]!.tiles
    layAll(
      world,
      plan.roads!.flatMap((r) => r.tiles),
    )
    expect(crewOf(world, planCity(world, city, terrain, undefined, ways))).toEqual([])

    const [x, y] = tiles[3]!
    world.buildings = world.buildings.filter((b) => !(b.kind === 'road' && b.x === x && b.y === y))
    const again = planCity(world, city, terrain, undefined, ways)
    const [member] = crewOf(world, again)
    expect(member).toBeDefined()
    member!.carried.stone = STONE
    member!.order = null
    delete member!.script
    world.tick = again.plannedAt + 1
    stepNpcCities(world, terrain.size, terrain, ways)
    expect(member!.script?.memory).toMatchObject({ building: 'road', at: { x, y } })
  })

  it('gives up a way with no way through, and does not ask again', () => {
    const { world, terrain, city, place } = town()
    // A lake round the camp.
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 3) continue
        terrain.tiles[tileIndex(terrain.size, place.x + dx, place.y + dy)] = Terrain.Lake
      }
    }
    const { ways, asked } = waysOf(world, terrain)
    const first = planCity(world, city, terrain, undefined, ways)
    expect(first.roads!.find((r) => r.to === place.id)!.tiles).toEqual([])
    layAll(
      world,
      first.roads!.flatMap((r) => r.tiles),
    )
    expect(crewOf(world, planCity(world, city, terrain, undefined, ways))).toEqual([])
    expect(new Set(asked).size).toBe(asked.length)
  })

  it('takes no crew while its way is being found', () => {
    const { world, terrain, city } = town()
    const ways: WayFinder = { way: () => ({ status: 'searching' }) }
    expect(crewOf(world, planCity(world, city, terrain, undefined, ways))).toEqual([])
  })

  it('counts as spare hands for a Full city', () => {
    const { world, terrain, city } = town()
    const { ways } = waysOf(world, terrain)
    const plan = planCity(world, city, terrain, undefined, ways)
    expect(crewOf(world, plan).length).toBeGreaterThan(0)
    expect(plan.fullSince).toBe(world.tick)
  })

  it('builds no road for a Trade Org city', () => {
    const terrain = plains(300)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 60, 60, undefined, mulberry32(3))
    camp(world, terrain, city, FAR)
    const warehouse = world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === city.id)!
    warehouse.stock = { stone: 5000, wood: 5000 }
    const { ways, asked } = waysOf(world, terrain)
    expect(crewOf(world, planCity(world, city, terrain, undefined, ways))).toEqual([])
    expect(asked).toEqual([])
  })
})

describe('a road crew going on from its workplaces', () => {
  it('goes to the nearest post in its reach once its workplaces are joined', () => {
    const { world, terrain, city, place } = town({ stone: 50 }, 600)
    const near = foundTradingPost(world, terrain, 180, 60, undefined, mulberry32(3))
    foundTradingPost(world, terrain, 300, 60, undefined, mulberry32(4))
    const warehouse = warehouseOf(world, near)
    const { ways } = waysOf(world, terrain)

    const first = planCity(world, city, terrain, undefined, ways)
    expect(first.roads!.map((r) => r.to)).toContain(place.id)
    expect(first.roads!.map((r) => r.to)).not.toContain(warehouse.id)

    const plan = joinAll(world, terrain, city, ways)
    const to = plan.roads!.map((r) => r.to)
    expect(to).toContain(warehouse.id)
    expect(to.indexOf(place.id)).toBeLessThan(to.indexOf(warehouse.id))
    expect(to).toHaveLength(new Set(to).size)
    const road = plan.roads!.find((r) => r.to === warehouse.id)!
    expect(road.tiles.at(-1)).toEqual([warehouse.x, warehouse.y])
    const other = world.buildings.filter((b) => b.kind === 'warehouse' && b.id !== warehouse.id)
    expect(to).not.toContain(other[0]!.id)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves a post out of its reach alone, and takes no city of the Trade Org for a neighbour', () => {
    const { world, terrain, city } = town({ stone: 50 }, 1700)
    const far = foundTradingPost(
      world,
      terrain,
      60 + NPC_TRADER_REACH + 50,
      60,
      undefined,
      mulberry32(3),
    )
    const { ways, asked } = waysOf(world, terrain)
    const plan = joinAll(world, terrain, city, ways)
    expect(plan.roads!.map((r) => r.to)).not.toContain(warehouseOf(world, far).id)
    expect(plan.roads!.map((r) => r.to)).not.toContain(far.id)
    expect(asked.some((key) => key.endsWith(far.id))).toBe(false)
  })

  it('goes on to the edge of its nearest neighbour, past the post, and stops there', () => {
    const { world, terrain, city } = town({ stone: 50 }, 800)
    const next = neighbour(world, terrain, 150)
    neighbour(world, terrain, 400)
    const post = foundTradingPost(world, terrain, 60, 200, undefined, mulberry32(3))
    const { ways } = waysOf(world, terrain)
    const plan = joinAll(world, terrain, city, ways)
    const to = plan.roads!.map((r) => r.to)
    expect(to.indexOf(warehouseOf(world, post).id)).toBeLessThan(to.indexOf(next.id))
    expect(to).toHaveLength(new Set(to).size)
    const tiles = plan.roads!.find((r) => r.to === next.id)!.tiles
    // Its first tile in the area is the way's last: no walls or gates of theirs are crossed.
    const [x, y] = tiles.at(-1)!
    expect(inCityArea(world, next, x, y, terrain.size)).toBe(true)
    for (const [tx, ty] of tiles.slice(0, -1)) {
      expect(inCityArea(world, next, tx, ty, terrain.size)).toBe(false)
    }
    expect(crewOf(world, plan)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('builds the road between two cities only once', () => {
    const { world, terrain, city } = town({ stone: 50 }, 600)
    const next = neighbour(world, terrain, 150)
    const { ways } = waysOf(world, terrain)
    const plan = joinAll(world, terrain, city, ways)
    expect(plan.roads!.map((r) => r.to)).toContain(next.id)
    const theirs = joinAll(world, terrain, next, ways)
    expect((theirs.roads ?? []).map((r) => r.to)).not.toContain(city.id)
    expect(crewOf(world, theirs)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('gives up on a neighbour with no way through, and does not ask again', () => {
    const { world, terrain, city } = town({ stone: 50 }, 600)
    const next = neighbour(world, terrain, 150)
    // Water on both sides of the first town, all the way across the map.
    for (let y = 0; y < terrain.size; y++) {
      for (const x of [170, 171, 500, 501])
        terrain.tiles[tileIndex(terrain.size, x, y)] = Terrain.Lake
    }
    const { ways, asked } = waysOf(world, terrain)
    const plan = joinAll(world, terrain, city, ways)
    expect(plan.roads!.find((r) => r.to === next.id)!.tiles).toEqual([])
    expect(crewOf(world, plan)).toEqual([])
    expect(asked.filter((key) => key.endsWith(`:${next.id}`))).toHaveLength(1)
    // Nor do they try it from their side.
    const theirs = joinAll(world, terrain, next, ways)
    expect((theirs.roads ?? []).map((r) => r.to)).not.toContain(city.id)
  })

  it('gives up on a way too long, however it is too long, and does not ask again', () => {
    const size = 2 * NPC_ROAD_LONGEST + 400
    const { world, terrain, city } = town({ stone: 50 }, size)
    const beyond = neighbour(world, terrain, NPC_ROAD_LONGEST + 100)
    const asked: string[] = []
    const none: WayFinder = {
      way(key) {
        asked.push(key)
        return { status: 'found', path: [], cost: 0 }
      },
    }
    const straight = joinAll(world, terrain, city, none)
    expect(straight.roads!.find((r) => r.to === beyond.id)!.tiles).toEqual([])
    expect(asked.filter((key) => key.endsWith(`:${beyond.id}`))).toEqual([])

    // Near enough as the crow flies, but the way round is too long.
    const { world: w2, terrain: t2, city: c2 } = town({ stone: 50 }, 600)
    const next = neighbour(w2, t2, 150)
    const long = Array.from({ length: NPC_ROAD_LONGEST + 1 }, (): [number, number] => [1, 1])
    const round: WayFinder = {
      way: (key) =>
        key.endsWith(`:${next.id}`)
          ? { status: 'found', path: long, cost: long.length }
          : { status: 'found', path: [], cost: 0 },
    }
    const plan = joinAll(w2, t2, c2, round)
    expect(plan.roads!.find((r) => r.to === next.id)!.tiles).toEqual([])
    expect(checkInvariants(w2, t2)).toEqual([])
  })

  /** Answers the way to `to` with `steps` tiles running south-east, and every other with none. */
  const diagonalTo = (to: string, steps: number): WayFinder => ({
    way: (key, from) => {
      if (!key.endsWith(`:${to}`)) return { status: 'found', path: [], cost: 0 }
      const path = Array.from({ length: steps }, (_, i): [number, number] => [
        from[0] + i + 1,
        from[1] + i + 1,
      ])
      return { status: 'found', path, cost: steps }
    },
  })

  it('goes by the tiles of a way, not by how far it is as the crow flies', () => {
    const size = 2 * NPC_ROAD_LONGEST + 400
    const { world, terrain, city, home } = town({ stone: 50 }, size)
    // Too far as the crow flies, but not that many Steps away, going diagonally.
    const d = NPC_ROAD_LONGEST - 100
    const next = foundNpcCity(world, terrain, NPC_TOWN, 60 + d, 60 + d, mulberry32(6))
    const hall = world.buildings.find((b) => b.id === next.townHallId)!
    expect(wrapDistance(size, home, hall)).toBeGreaterThan(NPC_ROAD_LONGEST)
    const plan = joinAll(world, terrain, city, diagonalTo(next.id, d))
    expect(plan.roads!.find((r) => r.to === next.id)!.tiles).toHaveLength(d)
  })

  it('goes by the edge of the area, not by the town hall further in', () => {
    const size = 2 * NPC_ROAD_LONGEST + 400
    const { world, terrain, city, home } = town({ stone: 50 }, size)
    const next = neighbour(world, terrain, NPC_ROAD_LONGEST + 3)
    const hall = world.buildings.find((b) => b.id === next.townHallId)!
    expect(Math.abs(hall.x - home.x)).toBeGreaterThan(NPC_ROAD_LONGEST)
    const plan = joinAll(world, terrain, city, diagonalTo(next.id, NPC_ROAD_LONGEST))
    expect(plan.roads!.find((r) => r.to === next.id)!.tiles).toHaveLength(NPC_ROAD_LONGEST)
  })

  it('leaves out the warehouses of the HQ inner ring, and goes on to a post it can walk to', () => {
    const { world, terrain, city, home } = town({ stone: 50 }, 1400)
    const hq = foundTradeOrgHq(world, terrain, 300, 60, mulberry32(3))
    const post = warehouseOf(
      world,
      foundTradingPost(world, terrain, 60, 500, undefined, mulberry32(4)),
    )
    const inner = world.buildings.filter((b) => b.kind === 'warehouse' && b.cityId === hq.id)
    expect(inner.length).toBeGreaterThan(0)
    const { ways } = waysOf(world, terrain)
    // Nearer than the post, but behind gates that stay closed to everyone else.
    for (const b of inner) {
      expect(wrapDistance(terrain.size, home, b)).toBeLessThan(
        wrapDistance(terrain.size, home, post),
      )
      expect(ways.way(`look:${b.id}`, [home.x, home.y], [b.x, b.y], city.id).status).toBe(
        'unreachable',
      )
    }
    const plan = joinAll(world, terrain, city, ways)
    const to = plan.roads!.map((r) => r.to)
    for (const b of inner) expect(to).not.toContain(b.id)
    expect(plan.roads!.find((r) => r.to === post.id)!.tiles.length).toBeGreaterThan(0)
  })

  it('finishes a road on to a neighbour no longer its nearest, while it stands', () => {
    const { world, terrain, city } = town({ stone: 50 }, 800)
    const next = neighbour(world, terrain, 300)
    const { ways } = waysOf(world, terrain)
    const before = joinAll(world, terrain, city, ways, 2)
    const old = before.roads!.find((r) => r.to === next.id)!
    expect(old.tiles.length).toBeGreaterThan(0)

    const daughter = neighbour(world, terrain, 150)
    const plan = joinAll(world, terrain, city, ways)
    const to = plan.roads!.map((r) => r.to)
    expect(to.indexOf(next.id)).toBeLessThan(to.indexOf(daughter.id))

    world.cities = world.cities.filter((c) => c.id !== next.id)
    const after = planCity(world, city, terrain, undefined, ways)
    expect(after.roads!.map((r) => r.to)).not.toContain(next.id)
  })

  it('searches its way only as far as the first tile of the area', () => {
    const terrain = plains(100)
    const finder = new PathFinder(terrain)
    const area = new Set([tileIndex(100, 50, 50), tileIndex(100, 51, 50)])
    const found = finder.findPath([40, 50], [70, 50], WALKING_COSTS, { area })
    expect(found).toMatchObject({ status: 'found' })
    expect(found.status === 'found' && found.path.at(-1)).toEqual([50, 50])
  })

  it('finds the edge of an area on its own land, with the goal across water', () => {
    const terrain = plains(100)
    // Water all the way across on both sides of the goal, so it is on land of its own.
    for (let y = 0; y < terrain.size; y++) {
      for (const x of [48, 49, 90, 91]) terrain.tiles[tileIndex(100, x, y)] = Terrain.Lake
    }
    const finder = new PathFinder(terrain)
    const tiles = (xs: number[]) => new Set(xs.map((x) => tileIndex(100, x, 50)))
    const area = tiles([46, 47, 50, 51])
    const found = finder.findPath([20, 50], [55, 50], WALKING_COSTS, { area })
    expect(found.status === 'found' && found.path.at(-1)).toEqual([46, 50])
    // None of it on the start's land: no way, without a search.
    const across = finder.findPath([20, 50], [55, 50], WALKING_COSTS, { area: tiles([50, 51]) })
    expect(across.status).toBe('unreachable')
  })
})

describe('on a road', () => {
  /** A road city with one tile left of its way, and a crew member standing on it with Stone. */
  function oneTileLeft(under: number) {
    const { world, terrain, city, home } = town({ stone: 50 })
    const { ways } = waysOf(world, terrain)
    // The way's tile a little out of the town, on the wanted ground.
    let plan = planCity(world, city, terrain, undefined, ways)
    const tiles = plan.roads!.flatMap((r) => r.tiles)
    const outside = tiles.filter(([x, y]) => !inCityArea(world, city, x, y, terrain.size))
    const [x, y] = outside[Math.floor(outside.length / 2)]!
    terrain.tiles[tileIndex(terrain.size, x, y)] = under
    layNew(
      world,
      tiles.filter(([tx, ty]) => tx !== x || ty !== y),
    )
    plan = planCity(world, city, terrain, undefined, ways)
    const crew = crewOf(world, plan)
    const [member] = crew
    // Enough soldiers armed already, none of them its farmers, so nobody is sent off for a weapon.
    const people = world.residents.filter((r) => r.cityId === city.id)
    const others = people.filter((r) => !crew.includes(r) && plan.jobs[r.id]?.kind !== 'farm')
    for (const r of others.slice(0, Math.ceil(people.length * NPC_SOLDIER_SHARE))) {
      r.carried[NPC_SMITHY_WEAPON] = 1
    }
    member!.x = x
    member!.y = y
    member!.carried = { food: 3, stone: STONE }
    member!.order = null
    member!.script = { scriptId: 0, task: 'build', memory: { building: 'road', at: { x, y } } }
    expect(wrapDistance(terrain.size, home, member!)).toBeGreaterThan(0)
    return { world, terrain, member: member!, x, y }
  }

  /** The ticks until the tile is built. */
  function ticksToBuild(under: number): number {
    const { world, terrain, x, y } = oneTileLeft(under)
    const walking = new Walking(terrain)
    let t = 0
    while (!finished(world, [x, y]) && t < TICKS_PER_GAME_DAY) {
      stepWorld(world, terrain, walking)
      t++
    }
    return t
  }

  it('builds Mountain at MOUNTAIN_ROAD_WORK_FACTOR times the work', () => {
    const onPlains = ticksToBuild(Terrain.Plains)
    const onMountain = ticksToBuild(Terrain.Mountain)
    expect(onMountain / onPlains).toBeGreaterThan(MOUNTAIN_ROAD_WORK_FACTOR * 0.8)
    expect(onMountain / onPlains).toBeLessThan(MOUNTAIN_ROAD_WORK_FACTOR * 1.2)
  })

  it('walks back for Food when it runs low, and goes on with the tile', () => {
    const { world, terrain, member, x, y } = oneTileLeft(Terrain.Plains)
    member.carried.food = GET_FOOD_AT - 1
    const walking = new Walking(terrain)
    let fetched = false
    for (let t = 0; t < TICKS_PER_GAME_DAY && !finished(world, [x, y]); t++) {
      stepWorld(world, terrain, walking)
      const o = member.order
      if (o?.kind === 'fetch' && (o.goods.food ?? 0) >= 1) fetched = true
    }
    expect(fetched).toBe(true)
    expect(member.carried.food ?? 0).toBeGreaterThan(GET_FOOD_AT)
    expect(finished(world, [x, y])).toBeTruthy()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('comes for the Food to get home before it starts a far tile, Stone or no Stone', () => {
    const far = 700
    const { world, terrain, city, home } = town({ stone: 50 }, 1600)
    const place = camp(world, terrain, city, far)
    const asked: WayFinder = {
      way: (_key, _from, to) =>
        to[0] === place.x
          ? { status: 'found', path: [[place.x, place.y]], cost: 1 }
          : { status: 'found', path: [], cost: 0 },
    }
    const plan = planCity(world, city, terrain, undefined, asked)
    const [member] = crewOf(world, plan)
    member!.x = home.x
    member!.y = home.y
    member!.carried = { food: OWN_FOOD, stone: 10 * STONE }
    member!.order = null
    delete member!.script
    world.tick = plan.plannedAt + 1
    stepNpcCities(world, terrain.size, terrain, asked)
    expect(member!.script).toBeUndefined()
    const need = roadCrewFood(far * WALK_TICKS_PER_TILE)
    expect(need).toBeGreaterThan(OWN_FOOD)
    expect(member!.order).toMatchObject({ kind: 'pickUp' })
    const goods = member!.order?.kind === 'pickUp' ? member!.order.goods : {}
    expect(OWN_FOOD + (goods.food ?? 0)).toBeGreaterThanOrEqual(need)
  })
})

describe('on the map', () => {
  /** Runs the world until `done` or `days` have passed, checking the invariants every game day. */
  function run(world: WorldState, terrain: TerrainMap, days: number, done = () => false) {
    const walking = new Walking(terrain)
    for (let t = 0; t < days * TICKS_PER_GAME_DAY && !done(); t++) {
      stepWorld(world, terrain, walking)
      if (t % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  }

  it(
    'finishes a road to a far workplace round a lake',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city, home, place } = town({ stone: 400 })
      // A lake right across the straight way there.
      const lake = { x: home.x + 35, y: home.y }
      for (let dy = -14; dy <= 14; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          terrain.tiles[tileIndex(terrain.size, lake.x + dx, lake.y + dy)] = Terrain.Lake
        }
      }
      const roads = () => world.cityPlans[city.id]?.roads?.find((r) => r.to === place.id)?.tiles
      const built = () => {
        const tiles = roads()
        return tiles !== undefined && tiles.every((t) => finished(world, t))
      }
      run(world, terrain, 20, built)
      expect(built()).toBe(true)
      const tiles = roads()!
      expect(tiles.at(-1)).toEqual([place.x, place.y])
      expect(tiles.length).toBeGreaterThan(FAR)
      for (const [x, y] of tiles) expect(terrainAt(terrain, x, y)).not.toBe(Terrain.Lake)
      // The way hangs together, a Step at a time.
      for (let i = 1; i < tiles.length; i++) {
        const [x0, y0] = tiles[i - 1]!
        const [x1, y1] = tiles[i]!
        expect(wrapDistance(terrain.size, { x: x0, y: y0 }, { x: x1, y: y1 })).toBeLessThan(2)
      }
    },
  )

  it(
    'joins two cities with one road, and reaches a post on the way',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city } = town({ stone: 400 }, 500)
      const next = neighbour(world, terrain, 130, { stone: 400 })
      const post = foundTradingPost(world, terrain, 60, 150, undefined, mulberry32(3))
      const warehouse = warehouseOf(world, post)
      const roadTo = (c: City, to: string) =>
        world.cityPlans[c.id]?.roads?.find((r) => r.to === to)?.tiles
      const between = () => roadTo(city, next.id) ?? roadTo(next, city.id)
      const built = (tiles: readonly (readonly [number, number])[] | undefined) =>
        tiles !== undefined && tiles.length > 0 && tiles.every((t) => finished(world, t))
      const done = () =>
        built(between()) && (built(roadTo(city, warehouse.id)) || built(roadTo(next, warehouse.id)))
      run(world, terrain, 40, done)
      expect(done()).toBe(true)
      // One road between them, not one from each side.
      expect(roadTo(city, next.id) !== undefined && roadTo(next, city.id) !== undefined).toBe(false)
      const way = between()!
      const far = roadTo(city, next.id) ? next : city
      const [x, y] = way.at(-1)!
      expect(inCityArea(world, far, x, y, terrain.size)).toBe(true)
      for (let i = 1; i < way.length; i++) {
        const [x0, y0] = way[i - 1]!
        const [x1, y1] = way[i]!
        expect(wrapDistance(terrain.size, { x: x0, y: y0 }, { x: x1, y: y1 })).toBeLessThan(2)
      }
    },
  )

  it('does not starve its crew on a long road', { tags: ['slow'], timeout: 600_000 }, () => {
    const far = 700
    const size = 1600
    const terrain = plains(size)
    const world = createWorld(terrain)
    const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(5))
    const place = camp(world, terrain, city, far)
    setStock(world, city, npcHome(world, city)!, { stone: 200 })
    layStreets(world, terrain, city)
    const { ways } = waysOf(world, terrain)
    // All of it laid but the far end, so the crew walks a long way for each load.
    let plan = joinAll(world, terrain, city, ways, 0)
    for (let i = 0; i < 8 && !plan.roads?.some((r) => r.to === place.id); i++) {
      layNew(
        world,
        (plan.roads ?? []).flatMap((r) => r.tiles),
      )
      plan = planCity(world, city, terrain, undefined, ways)
    }
    const tiles = plan.roads!.find((r) => r.to === place.id)!.tiles
    expect(tiles.length).toBeGreaterThan(far - 1)
    const left = tiles.slice(-25)
    layNew(world, tiles.slice(0, -25))
    const walking = new Walking(terrain)
    const people = () => world.residents.filter((r) => r.cityId === city.id)
    const count = people().length
    let lowest = Infinity
    let onCrew = 0
    for (let t = 0; t < 40 * TICKS_PER_GAME_DAY; t++) {
      stepWorld(world, terrain, walking)
      const now = world.cityPlans[city.id]
      const crew = now ? crewOf(world, now) : []
      onCrew = Math.max(onCrew, crew.length)
      for (const r of crew) lowest = Math.min(lowest, r.hunger)
      if (left.every((tile) => finished(world, tile))) break
    }
    expect(onCrew).toBeGreaterThan(0)
    expect(left.every((tile) => finished(world, tile))).toBe(true)
    expect(lowest).toBeGreaterThan(0)
    expect(world.residents.filter((r) => isDown(r))).toEqual([])
    // Streets come first, so it can take long enough for the city to found a daughter: count hers.
    expect(world.residents.length).toBeGreaterThanOrEqual(count)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it(
    'never takes its stone below the reserve, and goes back to other work',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city, storage } = town({ stone: 3 })
      const walking = new Walking(terrain)
      const before = world.buildings.filter((b) => b.kind === 'road').length
      const reserve = () => npcReserve(world, city).stone ?? 0
      let lowest = Infinity
      let onCrew = 0
      for (let t = 0; t < 3 * TICKS_PER_GAME_DAY; t++) {
        stepWorld(world, terrain, walking)
        lowest = Math.min(lowest, (storage.stock?.stone ?? 0) - reserve())
        const plan = world.cityPlans[city.id]
        if (plan) onCrew = Math.max(onCrew, crewOf(world, plan).length)
      }
      expect(onCrew).toBeGreaterThan(0)
      expect(lowest).toBeGreaterThanOrEqual(0)
      const roads = world.buildings.filter((b) => b.kind === 'road').length - before
      expect(roads).toBeGreaterThan(0)
      expect(roads).toBeLessThanOrEqual(3 / STONE)
      expect(crewOf(world, world.cityPlans[city.id]!)).toEqual([])
    },
  )
})

describe.each(CITY_LAYOUTS)('the streets of %s', (layout) => {
  /** A new town that picked the layout, with a far lumber camp, its streets not laid yet. */
  function unlaid(past: Stock = { stone: 50 }) {
    const pick = (l: CityLayout) => {
      for (let seed = 1; ; seed++) {
        const terrain = plains(300)
        const world = createWorld(terrain, seed)
        const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(5))
        if (city.layout === l) return { world, terrain, city }
      }
    }
    const { world, terrain, city } = pick(layout)
    const place = camp(world, terrain, city, FAR)
    const home = npcHome(world, city)!
    setStock(world, city, home, past)
    return { world, terrain, city, place, home, ...waysOf(world, terrain) }
  }

  /** Whether a tile touches a building, corners too. */
  const touches = (b: Building, [x, y]: readonly [number, number], size: number) =>
    footprintTiles(b, size).some(([fx, fy]) => wrapDistance(size, { x: fx, y: fy }, { x, y }) < 2)

  /** What the city's layout says now. */
  const lanesOf = ({ world, city, home, terrain }: ReturnType<typeof unlaid>) =>
    layoutPlan(
      world,
      city,
      home,
      wallRings(world, city, home, terrain.size)?.newGate,
      terrain.size,
    )!

  /** A finished house of the city at the next spot of its layout. */
  function putUpHouse(t: ReturnType<typeof unlaid>): Building {
    const { world, terrain, city, home } = t
    const rings = wallRings(world, city, home, terrain.size)
    const at = houseTile(world, city, home, terrain, rings)!
    const house: Building = { id: newId(world, 'b'), kind: 'house', cityId: city.id, ...at }
    world.buildings.push(house)
    return house
  }

  it('wants only tiles of its streets beside what stands, and none under it', () => {
    const t = unlaid()
    const { world, terrain, city, ways } = t
    const streets = planCity(world, city, terrain, undefined, ways).streets!
    expect(streets.length).toBeGreaterThan(0)
    const side = world.buildings.filter(
      (b) => b.cityId === city.id && ['townHall', 'house', 'storage'].includes(b.kind),
    )
    const lanes = lanesOf(t)
    for (const tile of streets) {
      expect(buildingAt(world, tile[0], tile[1], terrain.size)).toBeUndefined()
      expect(side.some((b) => touches(b, tile, terrain.size))).toBe(true)
      expect(lanes.street(tile[0], tile[1])).toBe(true)
    }
    expect(JSON.parse(JSON.stringify(streets))).toEqual(streets)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('goes up beside a new building once it stands', () => {
    const t = unlaid()
    const { world, terrain, city, ways } = t
    layStreets(world, terrain, city)
    expect(owedBy(world, terrain, city)).toEqual([])
    const house = putUpHouse(t)
    house.site = { delivered: {}, work: 0 }
    expect(owedBy(world, terrain, city)).toEqual([])
    delete house.site
    const owed = owedBy(world, terrain, city)
    expect(owed.length).toBeGreaterThan(0)
    for (const tile of owed) expect(touches(house, tile, terrain.size)).toBe(true)
    expect(planCity(world, city, terrain, undefined, ways).streets).toEqual(owed)
  })

  it('comes ahead of its other roads, nearest home first', () => {
    const { world, terrain, city, place, ways, home } = unlaid()
    const plan = planCity(world, city, terrain, undefined, ways)
    expect(plan.roads!.map((r) => r.to)).toContain(place.id)
    const far = plan.streets!.map(([x, y]) => wrapDistance(terrain.size, home, { x, y }))
    expect(far).toEqual([...far].sort((a, b) => a - b))
    const [member] = crewOf(world, plan)
    member!.carried.stone = STONE
    member!.order = null
    delete member!.script
    world.tick = plan.plannedAt + 1
    stepNpcCities(world, terrain.size, terrain, ways)
    const [x, y] = plan.streets![0]!
    expect(member!.script?.memory).toMatchObject({ building: 'road', at: { x, y } })
  })

  it('waits for materials above its reserve', () => {
    const { world, terrain, city, home, ways } = unlaid({})
    home.stock!.stone = npcReserve(world, city).stone ?? 0
    const plan = planCity(world, city, terrain, undefined, ways)
    expect(crewOf(world, plan)).toEqual([])
    expect(plan.streets).toBeUndefined()
  })

  it('in an old city stops at what stands, and tears nothing down', () => {
    const { world, terrain, city, ways } = unlaid()
    const owed = owedBy(world, terrain, city)
    // A house from before layouts, right on the street.
    const [x, y] = owed[0]!
    const old: Building = { id: newId(world, 'b'), kind: 'house', cityId: city.id, x, y }
    world.buildings.push(old)
    const streets = planCity(world, city, terrain, undefined, ways).streets!
    const tiles = new Set(streets.map(([tx, ty]) => `${tx},${ty}`))
    for (const [fx, fy] of footprintTiles(old, terrain.size)) {
      expect(tiles.has(`${fx},${fy}`)).toBe(false)
    }
    expect(streets.length).toBeGreaterThan(0)
    expect(world.buildings).toContain(old)
  })

  it('leaves out water, and does not go up beside a farm', () => {
    const { world, terrain, city, ways, home } = unlaid()
    const [lx, ly] = owedBy(world, terrain, city)[0]!
    terrain.tiles[tileIndex(terrain.size, lx, ly)] = Terrain.Lake
    layStreets(world, terrain, city)
    expect(roadAt(world, lx, ly)).toBeUndefined()
    // Beyond its wall, as a farm goes, across the lines of its streets or not.
    const farm: Building = {
      id: newId(world, 'b'),
      kind: 'farm',
      cityId: city.id,
      x: home.x + 40,
      y: home.y + 40,
    }
    world.buildings.push(farm)
    expect(planCity(world, city, terrain, undefined, ways).streets).toBeUndefined()
  })

  it('keeps the tiles of its streets free, road or no road', () => {
    const t = unlaid()
    const { world, terrain, city, home } = t
    const rings = wallRings(world, city, home, terrain.size)
    const before = houseTile(world, city, home, terrain, rings)
    layStreets(world, terrain, city)
    expect(houseTile(world, city, home, terrain, rings)).toEqual(before)
    const house = putUpHouse(t)
    const lanes = lanesOf(t)
    for (const [x, y] of footprintTiles(house, terrain.size)) {
      expect(lanes.street(x, y)).toBe(false)
    }
  })

  it('keeps them free of a stable over its horses, unless they stand on one already', () => {
    const t = unlaid()
    const { world, terrain, city, home } = t
    const size = terrain.size
    const lanes = lanesOf(t)
    const offLanes = (at: { x: number; y: number }) =>
      footprintTiles({ kind: 'stable', ...at }, size).every(([x, y]) => !lanes.street(x, y))
    const spot = farStableSpot(world, city, home, terrain)!
    expect(offLanes(spot)).toBe(true)

    // Its horses go where that spot is, and its stable goes up around them, off the streets.
    giveNpcHorses(world, terrain, city)
    const horses = world.horses.filter((h) => h.cityId === city.id)
    expect(horses.length).toBeGreaterThan(0)
    const rings = wallRings(world, city, home, size)
    const around = stableTile(world, city, home, terrain, rings)!
    expect(offLanes(around)).toBe(true)
    for (const h of horses) expect(covers({ kind: 'stable', ...around }, h.x, h.y, size)).toBe(true)

    // As a city from before layouts may have them, on a street: nobody leads them anywhere.
    const goesAround = owedBy(world, terrain, city).some(([x, y]) => {
      for (const h of horses) {
        h.x = x
        h.y = y
      }
      const at = stableTile(world, city, home, terrain, rings)!
      return covers({ kind: 'stable', ...at }, x, y, size) && !offLanes(at)
    })
    expect(goesAround).toBe(true)
  })

  it(
    'goes up on the map, tile by tile, never below the reserve',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city, home } = unlaid({ stone: 30 })
      const owed = owedBy(world, terrain, city)
      const wanted = Math.min(owed.length, 8)
      expect(wanted).toBeGreaterThan(0)
      const walking = new Walking(terrain)
      const built = () => owed.filter((tile) => finished(world, tile)).length
      let lowest = Infinity
      for (let t = 0; t < 10 * TICKS_PER_GAME_DAY && built() < wanted; t++) {
        stepWorld(world, terrain, walking)
        lowest = Math.min(lowest, (home.stock?.stone ?? 0) - (npcReserve(world, city).stone ?? 0))
        if (t % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
      }
      expect(built()).toBeGreaterThanOrEqual(wanted)
      expect(lowest).toBeGreaterThanOrEqual(0)
      expect(checkInvariants(world, terrain)).toEqual([])
    },
  )
})

describe('the city-streets-sound invariant', () => {
  it('finds streets of a city with no layout, and a tile twice', () => {
    const { world, terrain, city } = town()
    world.cityPlans[city.id] = { plannedAt: 0, jobs: {}, streets: [[1, 1]] }
    expect(cityStreetsSound.check(world, terrain)).toEqual([])
    world.cityPlans[city.id]!.streets = [
      [1, 1],
      [1, 1],
    ]
    expect(cityStreetsSound.check(world, terrain)).toHaveLength(1)
    world.cityPlans[city.id]!.streets = [[1, 1]]
    delete city.layout
    expect(cityStreetsSound.check(world, terrain)).toHaveLength(1)
  })
})

describe('the npc-roads-once invariant', () => {
  it('finds two cities each keeping a road to the other', () => {
    const { world, terrain, city } = town({ stone: 50 }, 600)
    const next = neighbour(world, terrain, 150)
    world.cityPlans[city.id] = {
      plannedAt: 0,
      jobs: {},
      roads: [{ to: next.id, tiles: [[1, 1]] }],
    }
    expect(npcRoadsOnce.check(world, terrain)).toEqual([])
    world.cityPlans[next.id] = {
      plannedAt: 0,
      jobs: {},
      roads: [{ to: city.id, tiles: [[1, 1]] }],
    }
    expect(npcRoadsOnce.check(world, terrain)).toHaveLength(1)
  })

  it('finds a way too long', () => {
    const { world, terrain, city, place } = town()
    const tiles = Array.from({ length: NPC_ROAD_LONGEST + 1 }, (): [number, number] => [1, 1])
    world.cityPlans[city.id] = { plannedAt: 0, jobs: {}, roads: [{ to: place.id, tiles }] }
    expect(npcRoadsOnce.check(world, terrain)).toHaveLength(1)
  })
})

describe('the npc-road-crew-sized invariant', () => {
  /** A plan that puts `n` residents of the city on the road crew. */
  function planned(world: WorldState, city: City, n: number): void {
    const people = world.residents.filter((r) => r.cityId === city.id).slice(0, n)
    world.cityPlans[city.id] = {
      plannedAt: world.tick,
      jobs: Object.fromEntries(people.map((r) => [r.id, { kind: 'road' as const }])),
    }
  }

  it('lets a crew of NPC_ROAD_CREW be', () => {
    const { world, terrain, city } = town()
    planned(world, city, NPC_ROAD_CREW)
    expect(npcRoadCrewSized.check(world, terrain)).toEqual([])
  })

  it('finds a crew too big', () => {
    const { world, terrain, city } = town()
    planned(world, city, NPC_ROAD_CREW + 1)
    expect(npcRoadCrewSized.check(world, terrain)).toHaveLength(1)
  })

  it('finds a crew at a Trade Org city', () => {
    const terrain = plains(300)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 60, 60, undefined, mulberry32(3))
    planned(world, city, 1)
    expect(npcRoadCrewSized.check(world, terrain)).toHaveLength(1)
  })
})
