import {
  CARRIAGE_CAPACITY,
  MAX_HEALTH,
  MAX_HUNGER,
  Terrain,
  type Building,
  type Carriage,
  type Good,
  type HaulOrder,
  type Horse,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { openDb } from './db/index.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { loadOrCreateWorld, saveWorld } from './saves.js'
import { dropGoods } from './survival.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** A square map drawn as text (sides join): . plains, ^ mountain. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = { '.': Terrain.Plains, '^': Terrain.Mountain }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

const open = draw(Array.from({ length: 16 }, () => '.'.repeat(16)))
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * A world on `map` with realm r1 (Player 7, Leader w1) and, at (2, 2), w1 carrying a little Food,
 * carriage k1 of r1 and horse h1 of r1. A storage s1 stands at (10, 2).
 */
function setup(map: TerrainMap = open) {
  const world = createWorld(map)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 2, y: 2, tick: 0 })
  w1.carried = { food: 2 }
  world.residents.push(w1)
  const horse: Horse = {
    id: 'h1',
    realmId: 'r1',
    x: 2,
    y: 2,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
  }
  world.horses.push(horse)
  const carriage: Carriage = { id: 'k1', realmId: 'r1', x: 2, y: 2, horseId: null, load: {} }
  world.carriages.push(carriage)
  world.cities.push({
    id: 'c1',
    name: 'Ash',
    realmId: 'r1',
    x: 8,
    y: 0,
    size: 5,
    wall: 'wooden',
    gate: { x: 8, y: 2 },
  })
  const storage: Building = { id: 's1', kind: 'storage', cityId: 'c1', x: 10, y: 2, stock: {} }
  world.buildings.push(storage)
  return { world, w1, horse, carriage, storage }
}

/** w1 starts hauling `goods` with carriage k1 from their tile to (10, 2). */
function haul(world: WorldState, goods: Good[], keepFood = 0, extra: object = {}) {
  const q = new OrderQueue(undefined, open)
  const answer = q.receive(world, me, 'q', {
    kind: 'haul',
    residentId: 'w1',
    carriageId: 'k1',
    x: 10,
    y: 2,
    goods,
    keepFood,
    ...extra,
  })
  q.applyAll(world)
  return answer
}

/** Steps the world `ticks` times, or until `until` holds, checking the invariants every tick. */
function run(
  world: WorldState,
  walking: Walking,
  ticks: number,
  until: () => boolean = () => false,
  map: TerrainMap = open,
) {
  for (let t = 0; t < ticks && !until(); t++) {
    stepWorld(world, map, walking)
    expect(checkInvariants(world, map)).toEqual([])
  }
}

const pile = (world: WorldState, x: number, y: number, goods: Stock) =>
  dropGoods(world, x, y, goods)

describe('the haul order', () => {
  it('needs the Player’s adult on their carriage with a horse, another stop, and goods', () => {
    const { world, w1 } = setup()
    const q = new OrderQueue(undefined, open)
    const order = (o: object) =>
      q.receive(world, me, 'q', {
        kind: 'haul',
        residentId: 'w1',
        carriageId: 'k1',
        x: 10,
        y: 2,
        goods: ['ironOre'],
        keepFood: 6,
        ...o,
      })
    expect(order({})).toEqual({ type: 'ack', requestId: 'q' })
    expect(order({ x: 2 })).toMatchObject({ reason: 'the other stop must be another tile' })
    expect(order({ x: 1.5 })).toMatchObject({ reason: 'the other stop must be a tile' })
    expect(order({ goods: [] })).toMatchObject({ reason: 'pick the goods to haul' })
    expect(order({ goods: ['gems'] })).toMatchObject({ reason: 'pick the goods to haul' })
    expect(order({ goods: ['wood', 'wood'] })).toMatchObject({ reason: 'pick the goods to haul' })
    expect(order({ keepFood: -1 })).toMatchObject({ reason: expect.stringContaining('Food') })
    expect(order({ keepFood: CARRIAGE_CAPACITY + 1 })).toMatchObject({
      reason: expect.stringContaining('Food'),
    })
    expect(order({ carriageId: 'nope' })).toMatchObject({ reason: 'not one of your carriages' })
    expect(
      q.receive(world, { ...me, userId: 8 }, 'q', { kind: 'haul', residentId: 'w1' }),
    ).toMatchObject({ reason: 'not one of your residents' })
    w1.x = 3
    expect(order({})).toMatchObject({ reason: 'that carriage is not on the resident’s tile' })
  })

  it('refuses a stop in the mountains', () => {
    const map = draw(Array.from({ length: 16 }, (_, y) => (y === 8 ? '^' : '.').repeat(16)))
    const { world } = setup(map)
    const q = new OrderQueue(undefined, map)
    const answer = q.receive(world, me, 'q', {
      kind: 'haul',
      residentId: 'w1',
      carriageId: 'k1',
      x: 2,
      y: 8,
      goods: ['ironOre'],
      keepFood: 0,
    })
    expect(answer).toMatchObject({ reason: 'a carriage can’t go there' })
  })
})

describe('a haul route', () => {
  it('loads at the first stop, unloads at the other, and comes back for more', () => {
    const { world, w1, carriage, storage } = setup()
    pile(world, 2, 2, { ironOre: 50, wood: 5 })
    expect(haul(world, ['ironOre'])).toMatchObject({ type: 'ack' })
    const walking = new Walking(open)

    run(world, walking, 2000, () => (storage.stock!.ironOre ?? 0) === 50)
    expect(storage.stock!.ironOre).toBe(50)
    // Only the route's goods go; the driver keeps their own Food.
    expect(world.piles[0]!.goods).toEqual({ wood: 5 })
    expect(w1.carried.ironOre ?? 0).toBe(0)

    // Back at the first stop, it waits for goods, then takes the new ones.
    run(world, walking, 200)
    expect([carriage.x, carriage.y]).toEqual([2, 2])
    expect(w1.order).toMatchObject({ kind: 'haul', stop: 'from', phase: 'loading' })
    pile(world, 2, 2, { ironOre: 30 })
    run(world, walking, 2000, () => (storage.stock!.ironOre ?? 0) === 80)
    expect(storage.stock!.ironOre).toBe(80)
    expect(carriage.horseId).toBe('h1')
  })

  it('keeps Food on board for the horse, topped up where there is some', () => {
    const { world, w1, carriage, storage } = setup()
    storage.stock = { food: 40 }
    pile(world, 2, 2, { ironOre: 20 })
    haul(world, ['ironOre'], 6)
    const walking = new Walking(open)
    run(world, walking, 2000, () => (storage.stock!.ironOre ?? 0) === 20)
    run(world, walking, 50)
    // Topped up at the storage (the horse may have eaten a little since).
    expect(carriage.load.food).toBeGreaterThan(5)
    expect(storage.stock!.food).toBeLessThan(40)
    expect(w1.order?.kind).toBe('haul')
  })

  it('hauls Food without unloading what the horse keeps or the driver’s own', () => {
    const { world, w1, carriage, storage } = setup()
    pile(world, 2, 2, { food: 30 })
    haul(world, ['food'], 4)
    const walking = new Walking(open)
    const order = () => w1.order as { stop: string; phase: string }
    run(world, walking, 2000, () => order().stop === 'from' && order().phase === 'driving')
    expect(carriage.load.food).toBe(4)
    expect(storage.stock!.food).toBe(26)
    expect(w1.carried.food).toBe(2)
  })

  it('stops when told to', () => {
    const { world, w1 } = setup()
    haul(world, ['ironOre'])
    expect(w1.order?.kind).toBe('haul')
    const q = new OrderQueue(undefined, open)
    expect(q.receive(world, me, 'q', { kind: 'stop', residentId: 'w1' })).toMatchObject({
      type: 'ack',
    })
    q.applyAll(world)
    expect(w1.order).toBeNull()
  })

  it('ends when the carriage loses its horse', () => {
    const { world, w1, horse } = setup()
    pile(world, 2, 2, { ironOre: 10 })
    haul(world, ['ironOre'])
    const walking = new Walking(open)
    run(world, walking, 100, () => (w1.order as { phase: string }).phase === 'driving')
    world.horses = world.horses.filter((h) => h !== horse)
    run(world, walking, 100, () => w1.order === null)
    expect(w1.order).toBeNull()
  })

  it('breaks the invariants when broken', () => {
    const map = draw(Array.from({ length: 16 }, (_, y) => (y === 8 ? '^' : '.').repeat(16)))
    const { world, w1 } = setup(map)
    const w2 = newResident(mulberry32(2), { id: 'w2', owner: 'r1', x: 5, y: 5, tick: 0 })
    world.residents.push(w2)
    haul(world, ['ironOre'])
    w2.order = { ...(w1.order as HaulOrder), to: { x: 2, y: 8 }, goods: [], keepFood: 999 }
    const messages = checkInvariants(world, map).map((v) => `${v.invariant}: ${v.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/drivers-on-carriages: resident w2 drives k1 but isn't on its tile/),
        expect.stringMatching(/drivers-on-carriages: resident w2 drives k1 together with w1/),
        expect.stringMatching(/haul-routes-sound: resident w2 hauls to \(2, 8\), where no/),
        expect.stringMatching(/haul-routes-sound: resident w2 hauls no goods/),
        expect.stringMatching(/haul-routes-sound: resident w2 keeps 999 Food/),
        expect.stringMatching(/haul-routes-sound: resident w2 loads at the from stop but stands/),
      ]),
    )
  })

  it('survives a server restart halfway', async () => {
    const { db, close } = await openDb(':memory:')
    loadOrCreateWorld(db, () => open, 1)
    const { world, w1 } = setup()
    pile(world, 2, 2, { ironOre: 50 })
    haul(world, ['ironOre'])
    run(world, new Walking(open), 30)
    expect(w1.order).toMatchObject({ kind: 'haul', stop: 'to', phase: 'driving' })

    saveWorld(db, world)
    const restarted = loadOrCreateWorld(db, () => open)
    expect(restarted.world).toEqual(world)
    const storage = restarted.world.buildings.find((b) => b.id === 's1')!
    const walking = new Walking(restarted.terrain)
    run(restarted.world, walking, 2000, () => (storage.stock!.ironOre ?? 0) === 50)
    expect(storage.stock!.ironOre).toBe(50)
    const driver = restarted.world.residents.find((r): r is Resident => r.id === 'w1')!
    expect(driver.order?.kind).toBe('haul')
    close()
  })
})
