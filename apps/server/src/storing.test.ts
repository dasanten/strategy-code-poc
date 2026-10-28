import {
  OWN_FOOD,
  Terrain,
  unitsThatFit,
  type Building,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, storeFetchOrdersSound } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const SIZE = 16
const open: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with city c1: resident w1 at (5, 5), storage s1 at (1, 1) with plenty of
 * Food and stone, storage s2 far off at (11, 11), empty, and carriage k1 at (8, 5), empty.
 * Realm r2 (Player 8) with carriage k2 at (5, 8).
 */
function setup(terrain = open) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'x1' })
  world.cities.push({ id: 'c1', name: 'Ashford', realmId: 'r1', townHallId: 'h1' })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 5, y: 5, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { wood: 10, food: 1 }
  world.residents.push(r)
  const storage = (id: string, x: number, y: number, stock: Stock): Building => {
    const b: Building = { id, kind: 'storage', cityId: 'c1', x, y, stock }
    world.buildings.push(b)
    return b
  }
  const s1 = storage('s1', 1, 1, { food: 50, stone: 500 })
  const s2 = storage('s2', 11, 11, {})
  const carriage = (id: string, realmId: string, x: number, y: number) => {
    const k = { id, realmId, cityId: null, x, y, horseId: null, load: {} as Stock }
    world.carriages.push(k)
    return k
  }
  const k1 = carriage('k1', 'r1', 8, 5)
  carriage('k2', 'r2', 5, 8)
  return {
    world,
    r,
    s1,
    s2,
    k1,
    queue: new OrderQueue(undefined, terrain),
    walking: new Walking(terrain),
  }
}

/** Sends an order, then runs ticks until the resident's order is over (at most `max`). */
function run(
  s: ReturnType<typeof setup>,
  o: object,
  terrain = open,
  max = 400,
): ReturnType<OrderQueue['receive']> {
  const answer = s.queue.receive(s.world, me, 'q', { residentId: 'w1', ...o })
  s.queue.applyAll(s.world)
  for (let i = 0; i < max && s.r.order; i++) {
    stepWorld(s.world, terrain, s.walking)
    expect(storeFetchOrdersSound.check(s.world, terrain)).toEqual([])
  }
  return answer
}

describe('store order', () => {
  it('walks to the nearest storage of my realm, stores the goods and tops up own food', () => {
    const s = setup()
    s.queue.receive(s.world, me, 'q', { kind: 'store', residentId: 'w1', goods: ['wood'] })
    s.queue.applyAll(s.world)
    expect(s.r.order).toMatchObject({
      kind: 'store',
      to: { kind: 'storage', storageId: 's1' },
      phase: 'walking',
    })
    run(s, { kind: 'store', goods: ['wood'] })
    expect(s.r.order).toBeNull()
    expect(s.s1.stock).toEqual({ food: 50 - (OWN_FOOD - 1), stone: 500, wood: 10 })
    expect(s.r.carried).toEqual({ food: OWN_FOOD })
    expect(s.r.orderEnded).toEqual({ kind: 'store', tick: s.world.tick - 1, reason: null })
  })

  it('stores Food beyond own food, or exact units when asked', () => {
    const s = setup()
    s.r.x = s.s1.x
    s.r.y = s.s1.y
    s.r.carried = { food: OWN_FOOD + 3, wood: 10 }
    run(s, { kind: 'store', goods: { food: null, wood: 4 } })
    expect(s.s1.stock).toMatchObject({ food: 53, wood: 4 })
    expect(s.r.carried).toEqual({ food: OWN_FOOD, wood: 6 })
  })

  it('unloads onto a carriage of mine when `to` is one, and tops up no food there', () => {
    const s = setup()
    s.k1.load = { food: 20 }
    run(s, { kind: 'store', goods: { wood: 4 }, to: 'k1' })
    expect(s.k1.load).toEqual({ food: 20, wood: 4 })
    expect(s.r.carried).toEqual({ wood: 6, food: 1 })
    expect(s.r).toMatchObject({ x: 8, y: 5, orderEnded: { kind: 'store', reason: null } })
  })

  it('follows a carriage that moves on before they get there', () => {
    const s = setup()
    s.queue.receive(s.world, me, 'q', {
      kind: 'store',
      residentId: 'w1',
      goods: ['wood'],
      to: 'k1',
    })
    s.queue.applyAll(s.world)
    stepWorld(s.world, open, s.walking)
    s.k1.x = 12
    s.k1.y = 9
    for (let i = 0; i < 400 && s.r.order; i++) stepWorld(s.world, open, s.walking)
    expect(s.k1.load).toEqual({ wood: 10 })
    expect(s.r).toMatchObject({ x: 12, y: 9 })
  })

  it('is rejected without goods to store, a storage of my realm, or with another’s carriage', () => {
    const s = setup()
    const reason = (o: object) => {
      const answer = s.queue.receive(s.world, me, 'q', { kind: 'store', residentId: 'w1', ...o })
      return answer.type === 'rejected' ? answer.reason : undefined
    }
    expect(reason({ goods: ['stone'] })).toBe('not carrying any of those goods')
    expect(reason({ goods: ['food'] })).toBe('not carrying any of those goods')
    expect(reason({ goods: { wood: 0 } })).toMatch(/^goods must be/)
    expect(reason({ goods: ['gold'] })).toMatch(/^goods must be/)
    expect(reason({ goods: ['wood'], to: 'k2' })).toMatch(/^to must be/)
    expect(reason({ goods: ['wood'], to: 's2' })).toBeUndefined()
    s.world.cities[0]!.realmId = 'r2'
    expect(reason({ goods: ['wood'] })).toBe('no storage')
  })

  it('ends, saying why, when the storage is gone or there is no way there', () => {
    const s = setup()
    run(s, { kind: 'store', goods: ['wood'] }, open, 2)
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 's1')
    stepWorld(s.world, open, s.walking)
    expect(s.r.order).toBeNull()
    expect(s.r.orderEnded).toMatchObject({ kind: 'store', reason: 'the storage is gone' })
    expect(s.r.carried.wood).toBe(10)

    // Two rows of lake cut the map (a torus) in two: s2 lies beyond them.
    const cut: TerrainMap = { size: SIZE, tiles: new Uint8Array(open.tiles) }
    for (let x = 0; x < SIZE; x++) {
      cut.tiles[0 * SIZE + x] = Terrain.Lake
      cut.tiles[8 * SIZE + x] = Terrain.Lake
    }
    const t = setup(cut)
    t.s1.y = 3
    run(t, { kind: 'store', goods: ['wood'], to: 's2' }, cut)
    expect(t.r.order).toBeNull()
    expect(t.r.orderEnded).toMatchObject({ kind: 'store', reason: 'no way' })
  })

  it('keeps how it ended until the next order', () => {
    const s = setup()
    run(s, { kind: 'store', goods: ['wood'] })
    expect(s.r.orderEnded).toBeDefined()
    s.queue.receive(s.world, me, 'q', { kind: 'walkTo', residentId: 'w1', x: 3, y: 3 })
    s.queue.applyAll(s.world)
    expect(s.r.orderEnded).toBeUndefined()
  })
})

describe('fetch order', () => {
  it('takes as much as fits from the nearest storage or carriage of mine holding the goods', () => {
    const s = setup()
    s.r.carried = { food: 1 }
    const fits = unitsThatFit(s.r, 'stone', s.world.tick)
    run(s, { kind: 'fetch', goods: ['stone'] })
    expect(s.r.carried).toEqual({ food: 1, stone: fits })
    expect(s.s1.stock!.stone).toBe(500 - fits)
    expect(s.r.orderEnded).toMatchObject({ kind: 'fetch', reason: null })

    // The nearer carriage, once it holds some.
    const t = setup()
    t.k1.load = { stone: 3 }
    run(t, { kind: 'fetch', goods: { stone: 10 } })
    expect(t.r.carried.stone).toBe(3)
    expect(t.k1.load).toEqual({})
    expect(t.s1.stock!.stone).toBe(500)
  })

  it('fetches from `from` when it is set', () => {
    const s = setup()
    run(s, { kind: 'fetch', goods: { food: 5 }, from: 's2' })
    expect(s.r.carried.food).toBe(1)
    expect(s.r).toMatchObject({ x: 11, y: 11, orderEnded: { reason: null } })
    s.s2.stock = { food: 8 }
    run(s, { kind: 'fetch', goods: { food: 5 }, from: 's2' })
    expect(s.r.carried.food).toBe(6)
    expect(s.s2.stock).toEqual({ food: 3 })
  })

  it('is rejected when nothing of mine holds the goods', () => {
    const s = setup()
    const answer = s.queue.receive(s.world, me, 'q', {
      kind: 'fetch',
      residentId: 'w1',
      goods: ['iron'],
    })
    expect(answer).toMatchObject({ type: 'rejected', reason: 'nothing of yours holds those goods' })
  })
})

describe('store and fetch in a real city', () => {
  it('move goods without making or losing any, and keep the invariants', () => {
    const { world, terrain } = worldWithCity()
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    const r = world.residents.find((x) => x.id === world.realms[0]!.leaderId)!
    const sender = { userId: 1, account: { name: 'p1', isAdmin: false } }
    const queue = new OrderQueue(undefined, terrain)
    const walking = new Walking(terrain)
    const total = (w: WorldState) =>
      [...w.residents.map((x) => x.carried), ...w.buildings.map((b) => b.stock ?? {})].reduce(
        (n, s) => n + (s.wood ?? 0),
        0,
      )
    const ticks = (o: object) => {
      expect(queue.receive(world, sender, 'q', { residentId: r.id, ...o })).toMatchObject({
        type: 'ack',
      })
      queue.applyAll(world)
      for (let i = 0; i < 600 && r.order; i++) {
        stepWorld(world, terrain, walking)
        if (i % 25 === 0) expect(checkInvariants(world, terrain)).toEqual([])
      }
      expect(r.order).toBeNull()
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    r.order = null
    r.carried = { wood: 7 }
    const before = total(world)
    ticks({ kind: 'store', goods: ['wood'] })
    expect(storage.stock!.wood).toBeGreaterThanOrEqual(7)
    ticks({ kind: 'fetch', goods: { wood: 5 } })
    expect(r.carried.wood).toBe(5)
    expect(total(world)).toBe(before)
    expect(r.orderEnded).toMatchObject({ kind: 'fetch', reason: null })
  }, 30_000)
})
