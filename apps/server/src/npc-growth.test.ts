import {
  BUILD_MATERIALS,
  MAX_WORKERS,
  NPC_ADULTS_PER_PAIR,
  NPC_VILLAGE,
  NPC_WALL_STEP,
  TICKS_PER_GAME_DAY,
  CITY_AREA_MARGIN,
  Terrain,
  buildProblem,
  mayStep,
  tileIndex,
  wallMap,
  wallSide,
  type Building,
  type Resident,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { requestBuilding, resolveBuilding } from './building.js'
import { requestCarrying, resolveCarrying } from './carrying.js'
import { checkInvariants } from './invariants.js'
import { stepNpcCities } from './npc-behaviour.js'
import { nextProject, wallRings } from './npc-growth.js'
import { mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'
import {
  WALL,
  FOREST,
  village,
  nearRing,
  fillInside,
  fillHouses,
  storageOf,
  ring,
  run,
} from './npc-growth.fixture.js'

describe('NPC cities grow', () => {
  it(
    'tears the old wall down only after the new one is finished',
    { tags: ['slow'], timeout: 300_000 },
    () => {
      const { world, terrain, city, home } = village()
      const size = terrain.size
      fillInside(world, terrain, home)
      fillHouses(world, city, home)
      storageOf(world, city).stock = { food: 400, wood: 600 }
      const oldIds = new Set(ring(world, city, home, size, WALL).map((b) => b.id))
      run(world, terrain, city, home, oldIds, 180 * TICKS_PER_GAME_DAY, () =>
        world.buildings.every((b) => !oldIds.has(b.id)),
      )
      expect(world.buildings.filter((b) => oldIds.has(b.id))).toEqual([])
      // The gate stands in line with the old one, further out.
      const gate = world.buildings.find((b) => b.kind === 'gate' && b.cityId === city.id)!
      expect([gate.x - home.x, gate.y - home.y]).toEqual([0, WALL + NPC_WALL_STEP])
      // The houses inside are still the city's, with the one it built on its edge.
      expect(
        world.buildings.filter((b) => b.kind === 'house' && b.cityId === city.id),
      ).toHaveLength(NPC_VILLAGE.houses + 1)
    },
  )

  it('pairs adults while it has a food surplus, and ends pairs when Food runs short', () => {
    const { world, terrain, city, home } = village()
    for (const r of world.residents) Object.assign(r, { x: home.x, y: home.y, order: null })
    storageOf(world, city).stock = { food: 400 }
    stepNpcCities(world, terrain.size, terrain)
    const paired = world.residents.filter((r) => r.pair)
    expect(paired).toHaveLength(2 * Math.floor(NPC_VILLAGE.residents / NPC_ADULTS_PER_PAIR))
    expect(paired[0]!.pair).toEqual({ partnerId: paired[1]!.id, since: 0 })
    // Pairing stops nobody: the pair are put to work like everyone else.
    expect(paired.every((r) => r.order !== null || r.script)).toBe(true)
    storageOf(world, city).stock = { food: 1 }
    stepNpcCities(world, terrain.size, terrain)
    expect(world.residents.filter((r) => r.pair)).toEqual([])
  })

  it('keeps a resident carrying a child out of work, at home; the partner works', () => {
    const { world, terrain, city, home } = village()
    for (const r of world.residents) Object.assign(r, { x: home.x, y: home.y, order: null })
    storageOf(world, city).stock = { food: 400 }
    stepNpcCities(world, terrain.size, terrain)
    const [a, b] = world.residents.filter((r) => r.pair) as [Resident, Resident]
    for (const r of [a, b]) {
      r.order = null
      delete r.script
    }
    a.carrying = {
      since: world.tick,
      partnerId: b.id,
      partnerName: b.name,
      partnerBase: { strength: 10, endurance: 10, agility: 10, intellect: 10 },
    }
    stepNpcCities(world, terrain.size, terrain)
    expect(a.order).toBeNull()
    expect(a.script).toBeUndefined()
    expect(b.order !== null || b.script !== undefined).toBe(true)
    // Food running short doesn't end a pair with a child on the way.
    storageOf(world, city).stock = { food: 1 }
    stepNpcCities(world, terrain.size, terrain)
    expect([a.pair?.partnerId, b.pair?.partnerId]).toEqual([b.id, a.id])
  })

  it('builds a house inside its wall when it has a food surplus and no free housing', () => {
    const { world, terrain, city, home } = village()
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400, wood: 100 }
    const project = nextProject(world, city, home, terrain)
    expect(project).toMatchObject({ kind: 'build', building: 'house' })
    const p = project as { x: number; y: number }
    expect(Math.max(Math.abs(p.x - home.x), Math.abs(p.y - home.y))).toBeLessThan(WALL - 1)
    // With room in its houses it builds none.
    world.residents.pop()
    expect(nextProject(world, city, home, terrain)).toBeUndefined()
  })

  it('builds the house by the game’s Build default, one builder fetching its Wood from the storage', () => {
    const { world, terrain, city, home } = village()
    fillHouses(world, city, home)
    const storage = storageOf(world, city)
    storage.stock = { food: 400, wood: 100 }
    const houses = () => world.buildings.filter((b) => b.kind === 'house' && b.cityId === city.id)
    const before = houses().length
    const walking = new Walking(terrain)
    let fetched = false
    for (let t = 0; t < 10 * TICKS_PER_GAME_DAY && houses().length === before; t++) {
      stepWorld(world, terrain, walking)
      const fetchers = world.residents.filter(
        (r) => r.script?.task === 'build' && r.script.memory.fetch,
      )
      expect(fetchers.length).toBeLessThanOrEqual(1)
      fetched ||= fetchers.length > 0
      if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(houses().length).toBe(before + 1)
    expect(fetched).toBe(true)
    expect(storage.stock.wood).toBe(100 - BUILD_MATERIALS.house!.wood!)
  }, 60_000)

  it('with no room left inside, builds on its edge, then puts up a new wall from its gate', () => {
    const { world, terrain, city, home } = village()
    fillInside(world, terrain, home)
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400, wood: 100 }
    const edge = nextProject(world, city, home, terrain) as { x: number; y: number }
    expect(edge).toMatchObject({ kind: 'build', building: 'house' })
    // Its footprint just outside the wall.
    expect(nearRing(home, { ...edge, kind: 'house' })).toBe(WALL + 1)
    expect(wallRings(world, city, home, terrain.size)?.expanding).toBe(false)
    world.buildings.push({ id: 'h', kind: 'house', cityId: city.id, x: edge.x, y: edge.y })
    expect(wallRings(world, city, home, terrain.size)).toMatchObject({
      inner: WALL,
      outer: WALL + NPC_WALL_STEP,
      expanding: true,
    })
    expect(nextProject(world, city, home, terrain)).toEqual({
      kind: 'build',
      building: 'gate',
      x: home.x,
      y: home.y + WALL + NPC_WALL_STEP,
    })
  })

  it('builds a lumber camp on the nearest forest when it needs wood and makes none', () => {
    const { world, terrain, city, home } = village()
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400 }
    expect(nextProject(world, city, home, terrain)).toEqual({
      kind: 'build',
      building: 'lumberCamp',
      ...FOREST,
    })
  })

  it('builds a farm beyond its next wall when every farm is full', () => {
    const { world, terrain, city, home } = village()
    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
    const rand = mulberry32(5)
    while (world.residents.length < MAX_WORKERS.farm!) {
      world.residents.push(
        newResident(rand, {
          id: newId(world, 'r'),
          owner: null,
          cityId: city.id,
          x: farm.x,
          y: farm.y,
          tick: 0,
        }),
      )
    }
    for (const r of world.residents) {
      r.order = { kind: 'workAt', buildingId: farm.id, at: { x: farm.x, y: farm.y }, progress: 0 }
    }
    const project = nextProject(world, city, home, terrain) as { x: number; y: number }
    expect(project).toMatchObject({ kind: 'build', building: 'farm' })
    expect(nearRing(home, { ...project, kind: 'farm' })).toBeGreaterThan(WALL + NPC_WALL_STEP)
    // Out of the way of the gate.
    expect(project.x).not.toBe(home.x)
  })

  it('leaves the Trade Organization’s cities to grow their own way', () => {
    const { world, terrain, city, home } = village()
    city.tradeOrg = 'post'
    for (const r of world.residents) Object.assign(r, { x: home.x, y: home.y, order: null })
    storageOf(world, city).stock = { food: 400 }
    stepNpcCities(world, terrain.size, terrain)
    expect(world.residents.some((r) => r.pair)).toBe(false)
  })
})

describe('houses, farms and NPC walls', () => {
  it('a house goes only in a city’s area, a farm only on Plains', () => {
    const { world, terrain, home } = village()
    expect(buildProblem(world, home.x + 4, home.y, 'house', terrain)).toBeUndefined()
    // Every tile of its footprint in the area, which ends `CITY_AREA_MARGIN` past the wall.
    const edge = home.x + WALL + CITY_AREA_MARGIN
    expect(buildProblem(world, edge - 1, home.y, 'house', terrain)).toBeUndefined()
    expect(buildProblem(world, edge, home.y, 'house', terrain)).toBe(
      'a house goes in a city’s area',
    )
    expect(buildProblem(world, home.x + 8, home.y, 'farm', terrain)).toBeUndefined()
    terrain.tiles[tileIndex(terrain.size, home.x + 11, home.y + 3)] = Terrain.Forest
    expect(buildProblem(world, home.x + 8, home.y, 'farm', terrain)).toBe(
      'a farm goes wholly on Plains, off any resource node',
    )
  })

  it('a farm is laid out for its builder’s city, an NPC city’s lumber camp is one of its own', () => {
    const { world, terrain, city } = village()
    const [farmer, woodcutter] = world.residents as [Resident, Resident]
    Object.assign(farmer, { x: 40, y: 40 })
    farmer.order = { kind: 'build', building: 'farm', at: { x: 40, y: 40 }, siteId: null }
    Object.assign(woodcutter, FOREST)
    woodcutter.order = { kind: 'build', building: 'lumberCamp', at: FOREST, siteId: null }
    resolveBuilding(world, requestBuilding(world), terrain)
    const farm = world.buildings.find((b) => b.x === 40 && b.y === 40)!
    const camp = world.buildings.find((b) => b.x === FOREST.x && b.y === FOREST.y)!
    expect(farm).toMatchObject({ kind: 'farm', cityId: city.id })
    expect(camp).toMatchObject({ kind: 'lumberCamp', cityId: null })
    expect(city.workplaceIds).toEqual([camp.id])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('the last materials carried to a site with all its work finish it', () => {
    const { world, terrain, city, home } = village()
    const r = world.residents[0]!
    Object.assign(r, { x: home.x + 4, y: home.y, carried: { wood: 25 } })
    const site: Building = {
      id: 'h',
      kind: 'house',
      cityId: null,
      x: home.x + 4,
      y: home.y,
      site: { delivered: {}, work: TICKS_PER_GAME_DAY },
    }
    world.buildings.push(site)
    r.order = { kind: 'drop', to: { kind: 'site', siteId: 'h' }, goods: { wood: 25 } }
    resolveCarrying(world, requestCarrying(world), terrain.size)
    expect(site.site).toBeUndefined()
    expect(site.cityId).toBe(city.id)
    expect(r.carried.wood).toBe(5)
  })

  it('catches a city working one of its farms as its own workplace', () => {
    const { world, terrain, city } = village()
    const farm = world.buildings.find((b) => b.kind === 'farm')!
    city.workplaceIds = [farm.id]
    expect(checkInvariants(world, terrain)).toContainEqual(
      expect.objectContaining({ invariant: 'city-workplaces-sound' }),
    )
  })

  it('an NPC city’s residents stand on its walls, others don’t', () => {
    const { world, terrain, city, home } = village()
    const walls = wallMap(world, terrain)
    const size = terrain.size
    const inside = tileIndex(size, home.x, home.y - WALL + 1)
    const wall = tileIndex(size, home.x, home.y - WALL)
    const own = world.residents[0]!
    expect(wallSide(own)).toBe(city.id)
    expect(mayStep(walls, wallSide(own), inside, wall, true)).toBe(true)
    expect(mayStep(walls, null, inside, wall, true)).toBe(false)
    expect(mayStep(walls, 'realm1', inside, wall, true)).toBe(false)
  })
})
