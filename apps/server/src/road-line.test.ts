import {
  BUILD_MATERIALS,
  MAX_HUNGER,
  ROAD_LINE_MAX_TILES,
  Terrain,
  roadAt,
  roadLine,
  wallMap,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { openDb } from './db/index.js'
import { checkInvariants, lineOrdersSound } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { loadOrCreateWorld, saveWorld } from './saves.js'
import { PathFinder } from './pathfinding.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** A square map drawn as text (sides join): . plains, ^ mountain, ~ lake. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = {
    '.': Terrain.Plains,
    '^': Terrain.Mountain,
    '~': Terrain.Lake,
  }
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
    const slant = roadLine({ x: 0, y: 0 }, { x: 3, y: 2 }, 10)
    expect(slant).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 2],
    ])
    expect(roadLine({ x: 2, y: 2 }, { x: 2, y: 2 }, 10)).toEqual([[2, 2]])
  })

  it('steps diagonally: (0, 0) to (5, 5) is 6 tiles, each a diagonal step on', () => {
    const line = roadLine({ x: 0, y: 0 }, { x: 5, y: 5 }, 10)
    expect(line).toHaveLength(6)
    expect(line[0]).toEqual([0, 0])
    expect(line.at(-1)).toEqual([5, 5])
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]!
      const [bx, by] = line[i]!
      expect([bx - ax, by - ay]).toEqual([1, 1])
    }
    // Any way round, every tile is one step on from the one before.
    for (const to of [
      { x: 7, y: 3 },
      { x: 2, y: 8 },
      { x: 9, y: 6 },
    ]) {
      const tiles = roadLine({ x: 4, y: 4 }, to, 10)
      expect(tiles.at(-1)).toEqual([to.x, to.y])
      for (let i = 1; i < tiles.length; i++) {
        const [ax, ay] = tiles[i - 1]!
        const [bx, by] = tiles[i]!
        expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1)
      }
    }
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

  it('lays out and builds every tile of a line across Mountain', () => {
    const map = draw(['..........', '..^^^.....', ...Array.from({ length: 8 }, () => '..........')])
    const { world, r, queue } = setup(map, 1, 1, 5 * STONE)
    expect(order(world, queue, { x: 1, y: 1 }, { x: 5, y: 1 })).toMatchObject({ type: 'ack' })
    expect(r.order).toMatchObject({ tiles: [1, 2, 3, 4, 5].map((x) => [x, 1]) })
    run(world, map, new Walking(map), 40_000, () => r.order === null)
    expect(r.order).toBeNull()
    for (const x of [1, 2, 3, 4, 5]) expect(finished(world, x, 1)).toBe(true)
  })

  it('rejects lines it can’t build, and orders it can’t give', () => {
    const map = draw(['..........', '...~......', ...Array.from({ length: 8 }, () => '..........')])
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
    expect(lineOrdersSound.check(world, open).map((v) => v.message)).toEqual([
      'resident w1 has a road order whose tile 1 is not a step on from the one before',
      'resident w1 builds nowhere, which is not the road site on their tile and the order’s next',
    ])
  })
})

describe('wall order along a line', () => {
  const WOOD = BUILD_MATERIALS.wall!.wood!
  const wallAt = (world: WorldState, x: number, y: number) =>
    world.buildings.find((b) => b.kind === 'wall' && b.x === x && b.y === y)

  it('builds wall diagonally tile by tile, and nobody steps diagonally through it', () => {
    const { world, r, queue } = setup(open, 1, 1, 0)
    r.carried = { wood: 4 * WOOD }
    const answer = queue.receive(world, me, 'q', {
      kind: 'wallLine',
      residentId: 'w1',
      from: { x: 2, y: 2 },
      to: { x: 5, y: 5 },
    })
    queue.applyAll(world)
    expect(answer).toEqual({ type: 'ack', requestId: 'q' })
    expect(r.order).toMatchObject({
      kind: 'wallLine',
      tiles: [
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
      ],
    })
    const doneAt: number[] = []
    run(world, open, new Walking(open), 40_000, () => {
      for (const x of [2, 3, 4, 5])
        if (doneAt[x] === undefined && wallAt(world, x, x) && !wallAt(world, x, x)!.site)
          doneAt[x] = world.tick
      return r.order === null
    })
    expect(r.order).toBeNull()
    for (const x of [2, 3, 4, 5]) expect(wallAt(world, x, x)?.site).toBeUndefined()
    const order = [2, 3, 4, 5].map((x) => doneAt[x]!)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(r.carried.wood ?? 0).toBe(0)

    // From (4, 3) to (3, 4) is one diagonal step across the line, between the walls on (3, 3)
    // and (4, 4): closed, so the way goes round an end of the line.
    const finder = new PathFinder(open)
    finder.setWalls(wallMap(world, open))
    const way = finder.findPath([4, 3], [3, 4])
    expect(way.status).toBe('found')
    expect(way.path!.length).toBeGreaterThan(1)
    expect(way.path!.some(([x, y]) => wallAt(world, x, y))).toBe(false)
  })

  it('skips tiles with a wall or gate, and checks the rest like a wall', () => {
    const map = draw(Array.from({ length: 10 }, (_, y) => (y === 5 ? '.^........' : '..........')))
    const { world, r, queue } = setup(map, 1, 1, 0)
    r.carried = { wood: 3 * WOOD }
    world.buildings.push({ id: 'old', kind: 'gate', cityId: null, x: 2, y: 1 })
    const send = (to: { x: number; y: number }) => {
      const answer = queue.receive(world, me, 'q', {
        kind: 'wallLine',
        residentId: 'w1',
        from: { x: 1, y: 1 },
        to,
      })
      queue.applyAll(world)
      return answer
    }
    expect(send({ x: 1, y: 6 })).toMatchObject({
      type: 'rejected',
      reason: expect.stringContaining('(1, 5)'),
    })
    expect(send({ x: 3, y: 1 })).toMatchObject({ type: 'ack' })
    run(world, map, new Walking(map), 40_000, () => r.order === null)
    for (const x of [1, 3]) expect(wallAt(world, x, 1)).toMatchObject({ kind: 'wall' })
    for (const x of [1, 3]) expect(wallAt(world, x, 1)?.site).toBeUndefined()
    expect(world.buildings.filter((b) => b.x === 2 && b.y === 1).map((b) => b.id)).toEqual(['old'])
  })
})
