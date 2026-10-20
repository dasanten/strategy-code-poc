import {
  BUILD_MATERIALS,
  MAX_HUNGER,
  ROAD_LINE_MAX_TILES,
  Terrain,
  roadAt,
  roadLine,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { openDb } from './db/index.js'
import { checkInvariants, roadLineOrdersSound } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { loadOrCreateWorld, saveWorld } from './saves.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** A square map drawn as text (sides join): . plains, ^ mountain. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = { '.': Terrain.Plains, '^': Terrain.Mountain }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

const open = draw(Array.from({ length: 10 }, () => '..........'))
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const STONE = BUILD_MATERIALS.road!.stone!

/** A world on `map` with realm r1 (Player 7) and its resident w1 at (x, y), carrying `stone`. */
function setup(map: TerrainMap = open, x = 1, y = 1, stone = 3 * STONE) {
  const world = createWorld(map)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x, y, tick: 0 })
  for (const s of ['strength', 'endurance', 'agility', 'intellect'] as const) {
    r.stats[s] = { base: 10, trained: 0 }
  }
  r.carried = { stone }
  world.residents.push(r)
  return { world, r, queue: new OrderQueue(undefined, map) }
}

/** Gives w1 a road order from `from` to `to`; returns the answer. */
function order(
  world: WorldState,
  queue: OrderQueue,
  from: { x: number; y: number },
  to: { x: number; y: number },
  residentId = 'w1',
) {
  const answer = queue.receive(world, me, 'q', { kind: 'roadLine', residentId, from, to })
  queue.applyAll(world)
  return answer
}

/** Steps the world, fed, until `done` or `max` ticks; checks invariants every tick. */
function run(
  world: WorldState,
  map: TerrainMap,
  walking: Walking,
  max: number,
  done: () => boolean = () => false,
) {
  for (let t = 0; t < max && !done(); t++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    stepWorld(world, map, walking)
    expect(checkInvariants(world, map)).toEqual([])
  }
}

const finished = (world: WorldState, x: number, y: number) => {
  const b = roadAt(world, x, y)
  return b !== undefined && !b.site
}

describe('roadLine', () => {
  it('runs from end to end with each tile next to the one before', () => {
    expect(roadLine({ x: 1, y: 1 }, { x: 4, y: 1 }, 10)).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ])
    const diagonal = roadLine({ x: 0, y: 0 }, { x: 3, y: 2 }, 10)
    expect(diagonal).toHaveLength(6)
    expect(diagonal[0]).toEqual([0, 0])
    expect(diagonal.at(-1)).toEqual([3, 2])
    for (let i = 1; i < diagonal.length; i++) {
      const [ax, ay] = diagonal[i - 1]!
      const [bx, by] = diagonal[i]!
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1)
    }
    expect(roadLine({ x: 2, y: 2 }, { x: 2, y: 2 }, 10)).toEqual([[2, 2]])
  })

  it('goes the short way round the map', () => {
    expect(roadLine({ x: 8, y: 0 }, { x: 1, y: 0 }, 10)).toEqual([
      [8, 0],
      [9, 0],
      [0, 0],
      [1, 0],
    ])
  })
})

describe('road order along a line', () => {
  it('builds the line of road tiles one after another, then is done', () => {
    const { world, r, queue } = setup()
    expect(order(world, queue, { x: 2, y: 1 }, { x: 4, y: 1 })).toEqual({
      type: 'ack',
      requestId: 'q',
    })
    expect(r.order).toMatchObject({
      kind: 'roadLine',
      phase: 'walking',
      tiles: [
        [2, 1],
        [3, 1],
        [4, 1],
      ],
    })
    const walking = new Walking(open)
    const doneAt: number[] = []
    run(world, open, walking, 20_000, () => {
      for (const x of [2, 3, 4])
        if (doneAt[x] === undefined && finished(world, x, 1)) doneAt[x] = world.tick
      return r.order === null
    })
    expect(r.order).toBeNull()
    for (const x of [2, 3, 4]) expect(finished(world, x, 1)).toBe(true)
    expect(doneAt[2]!).toBeLessThan(doneAt[3]!)
    expect(doneAt[3]!).toBeLessThan(doneAt[4]!)
    expect(r.carried.stone ?? 0).toBe(0)
    expect(r.skills.construction).toBeGreaterThan(0)
    expect({ x: r.x, y: r.y }).toEqual({ x: 4, y: 1 })
  })

  it('skips a tile that has a road already', () => {
    const { world, r, queue } = setup(open, 1, 1, 2 * STONE)
    const old: Building = { id: 'old', kind: 'road', cityId: null, x: 2, y: 1 }
    world.buildings.push(old)
    order(world, queue, { x: 1, y: 1 }, { x: 3, y: 1 })
    run(world, open, new Walking(open), 20_000, () => r.order === null)
    expect(world.buildings.filter((b) => b.kind === 'road' && !b.site)).toHaveLength(3)
    expect(world.buildings.filter((b) => b.kind === 'road' && b.x === 2)).toEqual([old])
  })

  it('waits on a site for materials it doesn’t carry', () => {
    const { world, r, queue } = setup(open, 1, 1, 0)
    order(world, queue, { x: 1, y: 1 }, { x: 2, y: 1 })
    run(world, open, new Walking(open), 3000)
    expect(r.order).toMatchObject({
      kind: 'roadLine',
      phase: 'building',
      tiles: [
        [1, 1],
        [2, 1],
      ],
    })
    expect(roadAt(world, 1, 1)?.site).toMatchObject({ delivered: {} })
  })

  it('rejects lines it can’t build, and orders it can’t give', () => {
    const map = draw(['..........', '...^......', ...Array.from({ length: 8 }, () => '..........')])
    const { world, queue } = setup(map)
    const rejected = (from: object, to: object, residentId = 'w1') =>
      order(world, queue, from as never, to as never, residentId)
    expect(rejected({ x: 1, y: 1 }, { x: 5, y: 1 })).toMatchObject({
      type: 'rejected',
      reason: expect.stringContaining('(3, 1)'),
    })
    expect(rejected({ x: 1, y: 1 }, { x: 1.5, y: 1 })).toMatchObject({ type: 'rejected' })
    expect(rejected({ x: 1, y: 1 }, { x: 1, y: 2 }, 'nobody')).toMatchObject({
      reason: 'not one of your residents',
    })
    world.residents[0]!.bornAt = world.tick
    expect(rejected({ x: 1, y: 1 }, { x: 1, y: 2 })).toMatchObject({
      reason: 'children can’t build',
    })
  })

  it('covers at most ROAD_LINE_MAX_TILES tiles', () => {
    const size = 3 * ROAD_LINE_MAX_TILES
    const map = draw(Array.from({ length: size }, () => '.'.repeat(size)))
    const { world, queue } = setup(map)
    const end = (n: number) => ({ x: n, y: 1 })
    expect(order(world, queue, { x: 1, y: 1 }, end(ROAD_LINE_MAX_TILES))).toMatchObject({
      type: 'ack',
    })
    expect(order(world, queue, { x: 1, y: 1 }, end(ROAD_LINE_MAX_TILES + 1))).toMatchObject({
      type: 'rejected',
    })
  })

  it('survives a server restart halfway', async () => {
    const { db, close } = await openDb(':memory:')
    loadOrCreateWorld(db, () => open, 1)
    const { world, r, queue } = setup()
    order(world, queue, { x: 2, y: 1 }, { x: 4, y: 1 })
    run(world, open, new Walking(open), 20_000, () => finished(world, 2, 1))
    expect(r.order).toMatchObject({
      kind: 'roadLine',
      tiles: [
        [3, 1],
        [4, 1],
      ],
    })

    saveWorld(db, world)
    const restarted = loadOrCreateWorld(db, () => open)
    expect(restarted.world).toEqual(world)
    const w1 = restarted.world.residents.find((x) => x.id === 'w1')!
    run(
      restarted.world,
      restarted.terrain,
      new Walking(restarted.terrain),
      20_000,
      () => w1.order === null,
    )
    for (const x of [2, 3, 4]) expect(finished(restarted.world, x, 1)).toBe(true)
    close()
  })

  it('is checked by an invariant', () => {
    const { world, r } = setup()
    r.order = {
      kind: 'roadLine',
      tiles: [
        [1, 1],
        [3, 1],
      ],
      phase: 'building',
      path: null,
      progress: 0,
      siteId: 'nowhere',
    }
    expect(roadLineOrdersSound.check(world, open).map((v) => v.message)).toEqual([
      'resident w1 has a road order whose tile 1 is not next to the one before',
      'resident w1 builds nowhere, which is not the road site on their tile and the order’s next',
    ])
  })
})
