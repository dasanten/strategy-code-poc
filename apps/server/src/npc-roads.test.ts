import {
  BUILD_MATERIALS,
  NPC_BUILDERS,
  NPC_ROAD_CREW,
  NPC_SURPLUS_CAP,
  NPC_TOWN,
  TICKS_PER_GAME_DAY,
  Terrain,
  inCityArea,
  npcReserve,
  roadAt,
  terrainAt,
  tileIndex,
  wallMap,
  wrapDistance,
  type Building,
  type City,
  type CityPlan,
  type Good,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome, stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { npcRoadCrewSized, roadCrew, type WayFinder } from './npc-roads.js'
import { PathFinder, WALKING_COSTS } from './pathfinding.js'
import { mulberry32 } from './residents.js'
import { newId } from './starting-city.js'
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
  return { world, terrain, city, place, storage, home: npcHome(world, city)! }
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
    way(key, from, to, side) {
      asked.push(key)
      finder.setWalls(wallMap(world, terrain))
      return finder.findPath(from, to, WALKING_COSTS, { realmId: side })
    },
  }
  return { ways, asked }
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
      roadCrew(world, city, plan, people, new Set(), storage, home, ways, terrain.size)
    expect(crew({ plannedAt: 0, jobs: {} })).toHaveLength(NPC_ROAD_CREW)
    // A mine wants more Stone than the 2 above the reserve.
    const project = { kind: 'build' as const, building: 'mine' as const, x: 200, y: 200 }
    expect(crew({ plannedAt: 0, jobs: {}, project })).toEqual([])
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
    'never takes its stone below the reserve, and goes back to other work',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city, storage } = town({ stone: 3 })
      const walking = new Walking(terrain)
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
      const roads = world.buildings.filter((b) => b.kind === 'road')
      expect(roads.length).toBeGreaterThan(0)
      expect(roads.length).toBeLessThanOrEqual(3 / STONE)
      expect(crewOf(world, world.cityPlans[city.id]!)).toEqual([])
    },
  )
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
