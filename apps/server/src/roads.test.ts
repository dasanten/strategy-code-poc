import {
  AVERAGE_HORSE_STATS,
  BUILD_MATERIALS,
  BUILD_WORK,
  CARRIAGE_SPEED,
  DIAGONAL_STEP,
  MAX_HEALTH,
  MAX_HUNGER,
  TERRAIN_SPEED,
  Terrain,
  WALK_TICKS_PER_TILE,
  buildingAt,
  groundAt,
  roadAt,
  roadTiles,
  teardownWork,
  type Building,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { buildingsInPlace, checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { PathFinder, WALKING_COSTS } from './pathfinding.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** A square map drawn as text (sides join): . plains, f forest, h hills, ^ mountain, ~ lake. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = {
    '.': Terrain.Plains,
    f: Terrain.Forest,
    h: Terrain.Hills,
    '^': Terrain.Mountain,
    '~': Terrain.Lake,
  }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A world on `map` with realm r1 (Player 7) and its resident w1 at (x, y), average stats. */
function setup(map: TerrainMap, x = 2, y = 2) {
  const world = createWorld(map)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x, y, tick: 0 })
  for (const s of ['strength', 'endurance', 'agility', 'intellect'] as const) {
    r.stats[s] = { base: 10, trained: 0 }
  }
  world.residents.push(r)
  return { world, r, queue: new OrderQueue(undefined, map) }
}

/** A finished road on (x, y). */
function road(world: WorldState, x: number, y: number, id = `rd${x},${y}`): Building {
  const b: Building = { id, kind: 'road', cityId: null, x, y }
  world.buildings.push(b)
  return b
}

/** Steps the world, keeping residents fed. */
function run(world: WorldState, map: TerrainMap, ticks = 1, walking?: Walking) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    stepWorld(world, map, walking)
  }
}

/** Ticks until the resident's walk or drive order is done. */
function ticksToArrive(world: WorldState, map: TerrainMap, r: Resident, max = 5000) {
  const walking = new Walking(map)
  let t = 0
  while (r.order && t < max) {
    run(world, map, 1, walking)
    t++
  }
  return t
}

const forest = draw(Array.from({ length: 16 }, () => 'f'.repeat(16)))

describe('building a road', () => {
  const map = draw([
    '........',
    '.fh^....',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ])

  it('lays out a site on passable land but Mountain, and finishes it from Stone and work', () => {
    const { world, r, queue } = setup(map, 1, 1)
    const build = { kind: 'build', residentId: 'w1', building: 'road' }
    expect(queue.receive(world, me, 'q1', build)).toEqual({ type: 'ack', requestId: 'q1' })
    queue.applyAll(world)
    run(world, map)
    const site = roadAt(world, 1, 1)!
    expect(site.site).toEqual({ delivered: {}, work: expect.any(Number) })
    expect(site.cityId).toBeNull()
    expect(buildingAt(world, 1, 1)).toBeUndefined()

    r.carried = { stone: BUILD_MATERIALS.road!.stone! }
    queue.receive(world, me, 'q2', {
      kind: 'drop',
      residentId: 'w1',
      spot: { kind: 'site', siteId: site.id },
      goods: { stone: 5 },
    })
    queue.applyAll(world)
    run(world, map, 2)
    expect(site.site!.delivered).toEqual(BUILD_MATERIALS.road)

    queue.receive(world, me, 'q3', build)
    queue.applyAll(world)
    run(world, map, BUILD_WORK.road! + 2)
    expect(site.site).toBeUndefined()
    expect(r.order).toBeNull()
    expect(checkInvariants(world, map)).toEqual([])

    // Hills take a road too; Mountain doesn't; one road per tile.
    r.x = 2
    expect(queue.receive(world, me, 'q4', build)).toEqual({ type: 'ack', requestId: 'q4' })
    r.x = 3
    expect(queue.receive(world, me, 'q5', build)).toMatchObject({
      type: 'rejected',
      reason: 'a road goes on passable land, not on Mountain',
    })
    r.x = 1
    expect(queue.receive(world, me, 'q6', build)).toMatchObject({
      type: 'rejected',
      reason: 'there is already a road on this tile',
    })
  })

  it('shares a tile with a building, such as a gate, and a building can go on a road', () => {
    const { world, queue } = setup(map, 4, 4)
    world.buildings.push({ id: 'g1', kind: 'gate', cityId: null, x: 4, y: 4 })
    queue.receive(world, me, 'q1', { kind: 'build', residentId: 'w1', building: 'road' })
    queue.applyAll(world)
    run(world, map)
    expect(buildingAt(world, 4, 4)?.id).toBe('g1')
    expect(roadAt(world, 4, 4)?.site).toBeDefined()
    expect(checkInvariants(world, map)).toEqual([])

    // A road with no building yet: a stable can still go there.
    road(world, 5, 4)
    world.residents[0]!.x = 5
    expect(
      queue.receive(world, me, 'q2', { kind: 'build', residentId: 'w1', building: 'stable' }),
    ).toEqual({ type: 'ack', requestId: 'q2' })
  })

  it('takes deliveries for the road site and the building site on one tile apart', () => {
    const { world, r, queue } = setup(map, 4, 4)
    world.buildings.push({
      id: 'b1',
      kind: 'gate',
      cityId: null,
      x: 4,
      y: 4,
      site: { delivered: {}, work: 0 },
    })
    const rd = road(world, 4, 4)
    rd.site = { delivered: {}, work: 0 }
    r.carried = { wood: 3, stone: 3 }
    queue.receive(world, me, 'q1', {
      kind: 'drop',
      residentId: 'w1',
      spot: { kind: 'site', siteId: rd.id },
      goods: { stone: 3 },
    })
    queue.applyAll(world)
    run(world, map, 2)
    queue.receive(world, me, 'q2', {
      kind: 'drop',
      residentId: 'w1',
      spot: { kind: 'site', siteId: 'b1' },
      goods: { wood: 3 },
    })
    queue.applyAll(world)
    run(world, map, 2)
    expect(rd.site.delivered).toEqual({ stone: 1 })
    expect(world.buildings[0]!.site!.delivered).toEqual({ wood: 3 })
    expect(checkInvariants(world, map)).toEqual([])
  })

  it('is torn down like any building, leaving the building it shared the tile with', () => {
    const { world, r, queue } = setup(map, 4, 4)
    world.buildings.push({ id: 'g1', kind: 'gate', cityId: null, x: 4, y: 4 })
    const rd = road(world, 4, 4)
    queue.receive(world, me, 'q1', { kind: 'tearDown', residentId: 'w1', buildingId: rd.id })
    queue.applyAll(world)
    run(world, map, Math.ceil(teardownWork(rd)) + 2)
    expect(roadAt(world, 4, 4)).toBeUndefined()
    expect(buildingAt(world, 4, 4)?.id).toBe('g1')
    // Half of a road's one Stone, rounded down, is nothing left over.
    expect(world.piles).toEqual([])
    expect(r.order).toBeNull()
    expect(checkInvariants(world, map)).toEqual([])
  })
})

describe('moving on a road', () => {
  it('walks at road speed whatever the terrain beneath', () => {
    const ticks = (withRoad: boolean) => {
      const { world, r } = setup(forest, 2, 2)
      if (withRoad) for (let x = 3; x <= 6; x++) road(world, x, 2)
      r.order = { kind: 'walkTo', target: { x: 6, y: 2 }, path: null, progress: 0 }
      return ticksToArrive(world, forest, r) / 4
    }
    const onRoad = ticks(true)
    expect(Math.abs(onRoad - WALK_TICKS_PER_TILE / TERRAIN_SPEED[Terrain.Road])).toBeLessThan(2)
    expect(ticks(false)).toBeGreaterThan(onRoad * 1.5)
  })

  it('drives a carriage at road speed whatever the terrain beneath', () => {
    const ticks = (withRoad: boolean) => {
      const { world, r } = setup(forest, 2, 2)
      world.horses.push({
        id: 'h1',
        realmId: 'r1',
        cityId: null,
        x: 2,
        y: 2,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats: { ...AVERAGE_HORSE_STATS },
        bornAt: 0,
      })
      world.carriages.push({
        id: 'k1',
        realmId: 'r1',
        cityId: null,
        x: 2,
        y: 2,
        horseId: null,
        load: {},
      })
      if (withRoad) for (let x = 3; x <= 6; x++) road(world, x, 2)
      r.order = {
        kind: 'drive',
        carriageId: 'k1',
        target: { x: 6, y: 2 },
        path: null,
        progress: 0,
      }
      return ticksToArrive(world, forest, r) / 4
    }
    const onRoad = ticks(true)
    expect(Math.abs(onRoad - WALK_TICKS_PER_TILE / CARRIAGE_SPEED[Terrain.Road])).toBeLessThan(2)
    expect(ticks(false)).toBeGreaterThan(onRoad * 3)
  })

  it('burns food as on Plains, even over hills', () => {
    const hills = draw(Array.from({ length: 8 }, () => 'h'.repeat(8)))
    const plains = draw(Array.from({ length: 8 }, () => '.'.repeat(8)))
    const drain = (map: TerrainMap, withRoad: boolean) => {
      const { world, r } = setup(map, 2, 2)
      if (withRoad) road(world, 2, 2)
      stepWorld(world, map)
      return MAX_HUNGER - r.hunger
    }
    expect(drain(hills, true)).toBeCloseTo(drain(plains, false))
    expect(drain(hills, false)).toBeGreaterThan(drain(plains, false))
  })

  it('ignores road sites: nobody goes faster on one yet', () => {
    const map = draw(Array.from({ length: 8 }, () => 'h'.repeat(8)))
    const world = createWorld(map)
    road(world, 1, 1)
    road(world, 2, 1).site = { delivered: {}, work: 0 }
    const roads = roadTiles(world, map.size)
    expect(groundAt(map, roads, 1, 1)).toBe(Terrain.Road)
    expect(groundAt(map, roads, 2, 1)).toBe(Terrain.Hills)
  })
})

describe('pathfinding with roads', () => {
  // Mountains between (1, 5) and (9, 5), plains round them; a road could run along row 1.
  const map = draw([
    '~~~~~~~~~~~',
    '~.........~',
    '~.^^^^^^^.~',
    '~.^^^^^^^.~',
    '~.^^^^^^^.~',
    '~.^^^^^^^.~',
    '~.^^^^^^^.~',
    '~.^^^^^^^.~',
    '~.^^^^^^^.~',
    '~.........~',
    '~~~~~~~~~~~',
  ])
  const layRoad = (world: WorldState) => {
    for (let y = 1; y <= 5; y++) road(world, 1, y)
    for (let y = 1; y <= 5; y++) road(world, 9, y)
    for (let x = 2; x <= 8; x++) road(world, x, 1)
  }

  it('prefers a road to plains of the same length', () => {
    const finder = new PathFinder(map)
    const before = finder.findPath([1, 5], [9, 5], WALKING_COSTS)
    // Round the mountains, cutting the two corners diagonally: 12 straight steps and 2 diagonal.
    const round = 12 + 2 * DIAGONAL_STEP
    expect(before.status).toBe('found')
    if (before.status !== 'found') return
    expect(before.cost).toBeCloseTo(round, 4)

    const world = createWorld(map)
    layRoad(world)
    finder.setRoads(roadTiles(world, map.size))
    const byRoad = finder.findPath([1, 5], [9, 5], WALKING_COSTS)
    expect(byRoad).toMatchObject({ status: 'found' })
    if (byRoad.status !== 'found') return
    // Along the road: 3 up, a diagonal, 6 across, a diagonal, 3 down, all at road speed.
    expect(byRoad.path).toHaveLength(14)
    expect(byRoad.path.every(([x, y]) => x === 1 || x === 9 || y === 1)).toBe(true)
    expect(byRoad.cost).toBeCloseTo(round / TERRAIN_SPEED[Terrain.Road], 4)

    // Torn down, the road is forgotten.
    finder.setRoads([])
    const after = finder.findPath([1, 5], [9, 5], WALKING_COSTS)
    expect(after.status === 'found' && after.cost).toBeCloseTo(round, 4)
  })

  it('sends walkers along the road', () => {
    const { world, r } = setup(map, 1, 5)
    layRoad(world)
    r.order = { kind: 'walkTo', target: { x: 9, y: 5 }, path: null, progress: 0 }
    const walking = new Walking(map)
    const visited = new Set<string>()
    while (r.order) {
      run(world, map, 1, walking)
      visited.add(`${r.x},${r.y}`)
    }
    expect(visited.has('5,1')).toBe(true)
    expect(checkInvariants(world, map)).toEqual([])
  })
})

describe('road invariants', () => {
  it('catch a road on Mountain, of a city, and two roads on one tile', () => {
    const map = draw(['^...', '....', '....', '....'])
    const world = createWorld(map)
    road(world, 0, 0, 'a')
    road(world, 1, 1, 'b').cityId = 'c9'
    road(world, 2, 2, 'c')
    road(world, 2, 2, 'd')
    const messages = buildingsInPlace.check(world, map).map((v) => v.message)
    expect(messages).toContain('a is a road on Mountain')
    expect(messages).toContain('b is a road of city c9')
    expect(messages).toContainEqual(expect.stringMatching(/^d overlaps .+ on tile .2,2.$/))
  })
})
