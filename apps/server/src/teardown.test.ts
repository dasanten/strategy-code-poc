import {
  BUILDABLE,
  BUILD_MATERIALS,
  BUILD_WORK,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
  Terrain,
  buildWork,
  teardownReturns,
  teardownWork,
  ticksForAge,
  type Building,
  type Good,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildingsInPlace,
  checkInvariants,
  tearDownOrdersOnBuildings,
  teardownsWithinNeeds,
} from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { defaultScripts } from './test-default-scripts.js'
import { createWorld, stepWorld } from './world.js'

/** Plains, with forest at (3, 3) and hills at (7, 7). */
function map(): TerrainMap {
  const tiles = new Uint8Array(16 * 16).fill(Terrain.Plains)
  tiles[3 * 16 + 3] = Terrain.Forest
  tiles[7 * 16 + 7] = Terrain.Hills
  return { size: 16, tiles }
}
const terrain = map()
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const stranger = { userId: 8, account: { name: 'Tobin', isAdmin: false } }

/**
 * A world with a forest node at (3, 3) and an iron ore node at (7, 7); a finished mine on the
 * iron ore; realm r1 (Player 7) with resident w1 on the mine, Strength 10.
 */
function setup() {
  const world = createWorld({ size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) })
  world.nodes = [
    { id: 'n1', kind: 'forest', x: 3, y: 3 },
    { id: 'n3', kind: 'ironOre', x: 7, y: 7 },
  ]
  world.buildings.push({ id: 'b1', kind: 'mine', cityId: null, x: 7, y: 7 })
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = resident(world, 'w1', 7, 7)
  return { world, r, queue: new OrderQueue(tasks.kinds) }
}

function resident(world: WorldState, id: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner: 'r1', x, y, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  r.stats.intellect = { base: 10, trained: 0 }
  world.residents.push(r)
  return r
}

const tasks = defaultScripts(terrain, [me, stranger])
/**
 * Whether tearing down is given as the Tear down task from the UI, whose default script starts
 * the tear-down order (`CONTEXT.md`: Default script), instead of by the bare tear-down order.
 */
let byTask = false

/** Steps the world, keeping residents fed; running scripts go first, as in the game. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    if (byTask) expect(tasks.runAll(world)).toEqual([])
    stepWorld(world, terrain)
  }
}

const tearDownOrder = (buildingId = 'b1', residentId = 'w1') => ({
  ...(byTask ? { kind: 'task', task: 'tearDown' } : { kind: 'tearDown' }),
  residentId,
  buildingId,
})

/** Applies the queued orders, and the scripts they start request their first actions. */
function applyAll(world: WorldState, queue: OrderQueue) {
  queue.applyAll(world)
  if (byTask) expect(tasks.runAll(world)).toEqual([])
}

/** Sends an order, and if accepted runs the tick that starts it. */
function order(world: WorldState, queue: OrderQueue, o: object, sender = me) {
  const answer = queue.receive(world, sender, 'q', o)
  applyAll(world, queue)
  run(world)
  return answer
}

/** All goods in the world: carried, in piles, stored and delivered to sites. */
function allGoods(world: WorldState): Stock {
  const out: Stock = {}
  const add = (s: Stock | undefined) => {
    for (const [g, n] of Object.entries(s ?? {}) as [Good, number][]) out[g] = (out[g] ?? 0) + n
  }
  for (const r of world.residents) add(r.carried)
  for (const p of world.piles) add(p.goods)
  for (const b of world.buildings) {
    add(b.stock)
    add(b.site?.delivered)
  }
  return out
}

describe.each([
  ['the tear-down order', false],
  ['the Tear down task, running Tear down (default)', true],
])('%s', (_, task) => {
  beforeEach(() => {
    byTask = task
  })
  afterEach(() => {
    byTask = false
  })

  it('works at the building until it is gone, leaving part of its materials on the tile', () => {
    const { world, r, queue } = setup()
    expect(queue.receive(world, me, 'q1', tearDownOrder())).toEqual({
      type: 'ack',
      requestId: 'q1',
    })
    applyAll(world, queue)
    expect(r.order).toEqual({ kind: 'tearDown', buildingId: 'b1', at: { x: 7, y: 7 } })
    const mine = world.buildings[0]!
    const need = teardownWork(mine)
    expect(need).toBe(BUILD_WORK.mine! * TEARDOWN_WORK_SHARE)
    expect(need).toBeLessThan(BUILD_WORK.mine!)
    run(world, 10)
    expect(mine.teardown).toBeCloseTo(10 * buildWork(r, world.tick))
    expect(r.skills.construction).toBeGreaterThan(0)
    expect(checkInvariants(world, terrain)).toEqual([])

    mine.teardown = need - 0.5
    run(world)
    expect(world.buildings).toEqual([])
    expect(world.piles).toEqual([
      expect.objectContaining({
        x: 7,
        y: 7,
        goods: {
          wood: Math.floor(BUILD_MATERIALS.mine!.wood! * TEARDOWN_MATERIALS_RETURNED),
          stone: Math.floor(BUILD_MATERIALS.mine!.stone! * TEARDOWN_MATERIALS_RETURNED),
        },
      }),
    ])
    expect(r.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
    if (byTask) {
      // With the building gone, Tear down (default) stands idle.
      run(world, 5)
      expect(r.order).toBeNull()
      expect(r.script?.memory).toEqual({ buildingId: 'b1', done: true })
    }
  })

  it('frees the tile, so it can be built on again', () => {
    const { world, r, queue } = setup()
    order(world, queue, tearDownOrder())
    world.buildings[0]!.teardown = teardownWork(world.buildings[0]!) - 0.1
    run(world)
    expect(world.buildings).toEqual([])
    expect(r.order).toBeNull()
    expect(
      order(world, queue, { kind: 'build', residentId: 'w1', building: 'mine' }),
    ).toMatchObject({ type: 'ack' })
    expect(world.buildings).toHaveLength(1)
    expect(world.buildings[0]!.site).toBeDefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('tears down an unfinished site with less work, leaving all its delivered materials', () => {
    const { world, r, queue } = setup()
    world.buildings = [
      {
        id: 'b1',
        kind: 'mine',
        cityId: null,
        x: 7,
        y: 7,
        site: { delivered: { wood: 12, stone: 3 }, work: 8 },
      },
    ]
    const builder = resident(world, 'w2', 7, 7)
    builder.order = { kind: 'build', building: 'mine', at: { x: 7, y: 7 }, siteId: 'b1' }
    const before = allGoods(world)
    expect(teardownWork(world.buildings[0]!)).toBe(8 * TEARDOWN_WORK_SHARE)
    // w2 keeps building, so the site needs a little more tear-down work each tick.
    order(world, queue, tearDownOrder())
    for (let i = 0; i < 20 && world.buildings.length > 0; i++) {
      expect(checkInvariants(world, terrain)).toEqual([])
      run(world)
    }
    expect(world.buildings).toEqual([])
    expect(world.piles[0]!.goods).toEqual({ wood: 12, stone: 3 })
    expect(allGoods(world)).toEqual(before)
    expect(r.order).toBeNull()
    expect(builder.order).toBeNull() // the site they were building is gone
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('takes down a site no one has worked on yet at once', () => {
    const { world, queue } = setup()
    world.buildings = [
      { id: 'b1', kind: 'mine', cityId: null, x: 7, y: 7, site: { delivered: {}, work: 0 } },
    ]
    order(world, queue, tearDownOrder())
    expect(world.buildings).toEqual([])
    expect(world.piles).toEqual([])
  })

  it('lets two residents tear down together, faster than one', () => {
    const { world, queue } = setup()
    resident(world, 'w2', 7, 7)
    queue.receive(world, me, 'a', tearDownOrder('b1', 'w1'))
    queue.receive(world, me, 'b', tearDownOrder('b1', 'w2'))
    applyAll(world, queue)
    run(world, 5)
    expect(world.buildings[0]!.teardown).toBeCloseTo(10)
  })

  it('stops when the resident leaves the tile; the work done stays for anyone to go on', () => {
    const { world, r, queue } = setup()
    order(world, queue, tearDownOrder())
    const done = world.buildings[0]!.teardown!
    r.x = 6
    run(world)
    expect(r.order).toBeNull()
    expect(world.buildings[0]!.teardown).toBe(done)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('tears down other Organizations’ buildings too', () => {
    const { world, queue } = setup()
    world.realms.push({ id: 'r2', userId: 8, leaderId: 'w9' })
    const other = resident(world, 'w9', 7, 7)
    other.owner = 'r2'
    expect(queue.receive(world, stranger, 's', tearDownOrder('b1', 'w9'))).toMatchObject({
      type: 'ack',
    })
  })

  it('rejects what cannot be torn down', () => {
    const { world, r, queue } = setup()
    const reject = (o: object, sender = me) => {
      const a = queue.receive(world, sender, 'x', o)
      return a.type === 'rejected' ? a.reason : 'ack'
    }
    expect(reject(tearDownOrder(), stranger)).toBe('not one of your residents')
    expect(reject({ ...tearDownOrder(), buildingId: undefined })).toBe('which building?')
    expect(reject(tearDownOrder('b9'))).toBe('the resident is not at that building')
    r.x = 6
    expect(reject(tearDownOrder())).toBe('the resident is not at that building')
    r.x = 7
    r.bornAt = world.tick - ticksForAge(5)
    expect(reject(tearDownOrder())).toBe('children can’t tear down buildings')
    r.bornAt = world.tick - ticksForAge(30)
    world.buildings.push({ id: 'b2', kind: 'warehouse', cityId: 'c1', x: 7, y: 7 })
    expect(reject(tearDownOrder('b2'))).toBe('a warehouse can’t be torn down yet')
    expect(queue.size).toBe(0)
  })

  it('ends the order if the building is gone before work starts', () => {
    const { world, r, queue } = setup()
    queue.receive(world, me, 'q', tearDownOrder())
    queue.applyAll(world)
    world.buildings = []
    run(world)
    expect(r.order).toBeNull()
  })
})

describe('tear-down returns', () => {
  it('never leave more than was built in', () => {
    for (const kind of BUILDABLE) {
      const built = BUILD_MATERIALS[kind] ?? {}
      const back = teardownReturns({ id: 'b', kind, cityId: null, x: 0, y: 0 })
      for (const [good, units] of Object.entries(back) as [Good, number][]) {
        expect(units).toBeLessThanOrEqual(built[good] ?? 0)
      }
      const delivered = { ...built }
      const site: Building = {
        id: 's',
        kind,
        cityId: null,
        x: 0,
        y: 0,
        site: { delivered, work: 1 },
      }
      expect(teardownReturns(site)).toEqual(delivered)
    }
  })
})

describe('tear-down invariants', () => {
  it('tear-down work stays below what is needed, and only on what can be built', () => {
    const { world } = setup()
    const mine = world.buildings[0]!
    mine.teardown = teardownWork(mine)
    expect(teardownsWithinNeeds.check(world, terrain)).toHaveLength(1)
    mine.teardown = -1
    expect(teardownsWithinNeeds.check(world, terrain)).toHaveLength(1)
    mine.teardown = 1
    expect(teardownsWithinNeeds.check(world, terrain)).toEqual([])
    world.buildings.push({ id: 'h', kind: 'warehouse', cityId: 'c1', x: 1, y: 1, teardown: 0 })
    expect(teardownsWithinNeeds.check(world, terrain).map((v) => v.message)).toContain(
      'h is a warehouse being torn down',
    )
  })

  it('at most one building or site per tile', () => {
    const { world } = setup()
    world.buildings.push({
      id: 'b2',
      kind: 'mine',
      cityId: null,
      x: 7,
      y: 7,
      site: { delivered: {}, work: 0 },
    })
    expect(buildingsInPlace.check(world, terrain).map((v) => v.message)).toContainEqual(
      expect.stringMatching(/^b2 overlaps .+ on tile .7,7.$/),
    )
  })

  it('a resident tearing down stands on that building', () => {
    const { world, r } = setup()
    r.order = { kind: 'tearDown', buildingId: 'b1', at: { x: 7, y: 7 } }
    expect(tearDownOrdersOnBuildings.check(world, terrain)).toEqual([])
    r.x = 6
    expect(tearDownOrdersOnBuildings.check(world, terrain)).toHaveLength(1)
    r.x = 7
    world.buildings = []
    expect(tearDownOrdersOnBuildings.check(world, terrain)).toHaveLength(1)
  })
})
