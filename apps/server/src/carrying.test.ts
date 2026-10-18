import {
  Terrain,
  carryCapacity,
  stockWeight,
  type Building,
  type Good,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { worldWithCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const open: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const stranger = { userId: 8, account: { name: 'Tobin', isAdmin: false } }

/** A world on an open map: realm r1 (Player 7) with resident w1 on a storage at (1, 1). */
function setup(stock: Stock = { food: 50, stone: 50 }) {
  const world = createWorld(open)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 1, y: 1, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  world.residents.push(r)
  const storage: Building = { id: 's1', kind: 'storage', cityId: 'c1', x: 1, y: 1, stock }
  world.buildings.push(storage)
  return { world, r, storage, queue: new OrderQueue() }
}

/** Sends an order and, if accepted, runs the tick that resolves it. */
function order(world: WorldState, queue: OrderQueue, o: object, sender = me) {
  const answer = queue.receive(world, sender, 'q', o)
  queue.applyAll(world)
  stepWorld(world, open)
  return answer
}

const atStorage = { kind: 'storage', storageId: 's1' }
const ground = { kind: 'ground' }

/** Every unit of each good in the world, wherever it is. */
function total(world: WorldState): Stock {
  const out: Stock = {}
  const add = (s: Stock | undefined) => {
    for (const [g, n] of Object.entries(s ?? {}) as [Good, number][]) out[g] = (out[g] ?? 0) + n
  }
  world.residents.forEach((r) => add(r.carried))
  world.buildings.forEach((b) => add(b.stock))
  world.piles.forEach((p) => add(p.goods))
  world.carriages.forEach((k) => add(k.load))
  return out
}

describe('pick-up order', () => {
  it('takes goods from the storage on the tile in the next tick', () => {
    const { world, r, storage, queue } = setup()
    const o = { kind: 'pickUp', residentId: 'w1', spot: atStorage, goods: { food: 5 } }
    expect(queue.receive(world, me, 'q1', o)).toEqual({ type: 'ack', requestId: 'q1' })
    expect(r.carried).toEqual({})
    queue.applyAll(world)
    expect(r.order).toEqual({ kind: 'pickUp', from: atStorage, goods: { food: 5 } })
    stepWorld(world, open)
    expect(r.carried).toEqual({ food: 5 })
    expect(storage.stock).toEqual({ food: 45, stone: 50 })
    expect(r.order).toBeNull()
  })

  it('takes only what is there and whole units that fit the carry capacity', () => {
    const { world, r, storage, queue } = setup({ food: 3, stone: 500 })
    const capacity = carryCapacity(r, world.tick)
    order(world, queue, {
      kind: 'pickUp',
      residentId: 'w1',
      spot: atStorage,
      goods: { food: 10, stone: 500 },
    })
    expect(r.carried.food).toBe(3)
    expect(r.carried.stone).toBe(Math.floor(capacity) - 3)
    expect(stockWeight(r.carried)).toBeLessThanOrEqual(capacity)
    expect(storage.stock).toEqual({ stone: 500 - r.carried.stone! })
  })

  it('takes from the pile on the ground, and an emptied pile is gone', () => {
    const { world, r, queue } = setup()
    world.piles.push({ id: 'p1', x: 1, y: 1, goods: { wood: 4 } })
    order(world, queue, { kind: 'pickUp', residentId: 'w1', spot: ground, goods: { wood: 4 } })
    expect(r.carried).toEqual({ wood: 4 })
    expect(world.piles).toEqual([])
  })

  it("can take another realm's goods: nothing is protected yet", () => {
    const { world, r, storage, queue } = setup()
    storage.cityId = 'someone-elses-city'
    order(world, queue, { kind: 'pickUp', residentId: 'w1', spot: atStorage, goods: { food: 2 } })
    expect(r.carried).toEqual({ food: 2 })
  })

  it('never lets two residents take the same goods', () => {
    const { world, r, queue } = setup()
    const r2 = newResident(mulberry32(2), { id: 'w2', owner: 'r1', x: 1, y: 1, tick: 0 })
    world.residents.push(r2)
    world.piles.push({ id: 'p1', x: 1, y: 1, goods: { food: 6 } })
    const take = (id: string) => ({
      kind: 'pickUp',
      residentId: id,
      spot: ground,
      goods: { food: 6 },
    })
    queue.receive(world, me, 'a', take('w1'))
    queue.receive(world, me, 'b', take('w2'))
    queue.applyAll(world)
    stepWorld(world, open)
    expect((r.carried.food ?? 0) + (r2.carried.food ?? 0)).toBe(6)
    expect(world.piles).toEqual([])
  })

  it('replaces a walk order, and gets nothing if the resident has left the tile', () => {
    const { world, r, queue } = setup()
    r.order = { kind: 'walkTo', target: { x: 5, y: 1 }, path: null, progress: 0 }
    queue.receive(world, me, 'q', {
      kind: 'pickUp',
      residentId: 'w1',
      spot: atStorage,
      goods: { food: 1 },
    })
    queue.applyAll(world)
    expect(r.order?.kind).toBe('pickUp')
    r.x = 2 // moved off the storage before the tick resolves
    stepWorld(world, open)
    expect(r.carried).toEqual({})
    expect(r.order).toBeNull()
  })

  it('rejects what cannot be done', () => {
    const { world, queue } = setup({ food: 5 })
    const pick = (o: object) => ({ kind: 'pickUp', residentId: 'w1', spot: atStorage, ...o })
    const reason = (o: object, sender = me) =>
      (queue.receive(world, sender, 'q', o) as { reason?: string }).reason
    expect(reason(pick({ goods: { food: 1 } }), stranger)).toBe('not one of your residents')
    expect(reason(pick({ residentId: 'nobody', goods: { food: 1 } }))).toBe(
      'not one of your residents',
    )
    expect(reason(pick({ goods: { food: 1.5 } }))).toBe('goods must be whole units of known goods')
    expect(reason(pick({ goods: { food: 0 } }))).toBe('goods must be whole units of known goods')
    expect(reason(pick({ goods: { gems: 1 } }))).toBe('goods must be whole units of known goods')
    expect(reason(pick({ goods: {} }))).toBe('goods must be whole units of known goods')
    expect(reason(pick({ spot: { kind: 'roof' }, goods: { food: 1 } }))).toBe(
      'the spot must be the ground, a storage or a construction site',
    )
    expect(reason(pick({ spot: { kind: 'storage', storageId: 's9' }, goods: { food: 1 } }))).toBe(
      'that storage is not on the resident’s tile',
    )
    expect(reason(pick({ goods: { stone: 1 } }))).toBe('none of those goods here')
    expect(reason(pick({ spot: ground, goods: { food: 1 } }))).toBe('none of those goods here')
    expect(queue.size).toBe(0)
  })
})

describe('drop order', () => {
  it('puts carried goods on the ground, starting or adding to the pile', () => {
    const { world, r, queue } = setup()
    r.carried = { food: 4, wood: 2 }
    order(world, queue, { kind: 'drop', residentId: 'w1', spot: ground, goods: { food: 3 } })
    expect(r.carried).toEqual({ food: 1, wood: 2 })
    expect(world.piles).toMatchObject([{ x: 1, y: 1, goods: { food: 3 } }])
    order(world, queue, {
      kind: 'drop',
      residentId: 'w1',
      spot: ground,
      goods: { food: 9, wood: 2 },
    })
    expect(r.carried).toEqual({})
    expect(world.piles).toMatchObject([{ x: 1, y: 1, goods: { food: 4, wood: 2 } }])
    expect(r.order).toBeNull()
  })

  it('puts carried goods in the storage on the tile', () => {
    const { world, r, storage, queue } = setup({})
    r.carried = { ironOre: 5 }
    order(world, queue, { kind: 'drop', residentId: 'w1', spot: atStorage, goods: { ironOre: 5 } })
    expect(r.carried).toEqual({})
    expect(storage.stock).toEqual({ ironOre: 5 })
  })

  it('keeps the goods if the storage is no longer on the tile', () => {
    const { world, r, queue } = setup({})
    r.carried = { wood: 3 }
    queue.receive(world, me, 'q', {
      kind: 'drop',
      residentId: 'w1',
      spot: atStorage,
      goods: { wood: 3 },
    })
    queue.applyAll(world)
    world.buildings = []
    stepWorld(world, open)
    expect(r.carried).toEqual({ wood: 3 })
    expect(world.piles).toEqual([])
  })

  it('rejects goods the resident does not carry', () => {
    const { world, r, queue } = setup()
    r.carried = { food: 1 }
    expect(
      queue.receive(world, me, 'q', {
        kind: 'drop',
        residentId: 'w1',
        spot: ground,
        goods: { stone: 1 },
      }),
    ).toMatchObject({ type: 'rejected', reason: 'not carrying any of those goods' })
  })
})

describe('carrying in a real city', () => {
  it('moves goods without making or losing any, and keeps the invariants', () => {
    const { world, terrain } = worldWithCity()
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    const r = world.residents.find((x) => x.id === world.realms[0]!.leaderId)!
    const sender = { userId: 1, account: { name: 'p1', isAdmin: false } }
    const queue = new OrderQueue()
    const step = (o: object) => {
      expect(queue.receive(world, sender, 'q', o)).toMatchObject({ type: 'ack' })
      queue.applyAll(world)
      stepWorld(world, terrain)
    }
    Object.assign(r, { order: null, carried: {} })
    r.x = storage.x
    r.y = storage.y
    const before = total(world)
    const spot = { kind: 'storage', storageId: storage.id }
    step({ kind: 'pickUp', residentId: r.id, spot, goods: { food: 10 } })
    expect(r.carried.food).toBe(10)
    r.x += 1
    step({ kind: 'drop', residentId: r.id, spot: ground, goods: { food: 4 } })
    expect(total(world)).toEqual(before)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})
