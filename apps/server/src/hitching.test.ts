import {
  AVERAGE_HORSE_STATS,
  MAX_HEALTH,
  MAX_HUNGER,
  Terrain,
  ticksForAge,
  type Carriage,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** The Hitch order (`CONTEXT.md`: Hitched horse): the horse a resident chooses pulls the carriage. */

const SIZE = 16
const open: TerrainMap = {
  size: SIZE,
  tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
}
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * A world with realm r1 (Player 7, Leader w1) and, at (2, 2), w1, carriage k1 with no horse hitched
 * and horses h1, h2 and h3 of r1, each with a speed of its own.
 */
function setup() {
  const world = createWorld(open)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 2, y: 2, tick: 0 })
  w1.carried = { food: 10 }
  world.residents.push(w1)
  const horse = (id: string, more: Partial<Horse> = {}): Horse => ({
    id,
    realmId: 'r1',
    cityId: null,
    x: 2,
    y: 2,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    name: id,
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
    ...more,
  })
  const [h1, h2, h3] = [horse('h1'), horse('h2'), horse('h3')]
  world.horses.push(h1, h2, h3)
  const carriage: Carriage = {
    id: 'k1',
    realmId: 'r1',
    cityId: null,
    x: 2,
    y: 2,
    horseId: null,
    load: {},
  }
  world.carriages.push(carriage)
  return { world, w1, h1, h2, h3, carriage, horse }
}

/** Sends an order of the Player's and applies it, as the next tick would; returns the reply. */
function give(world: WorldState, o: object) {
  const q = new OrderQueue(undefined, open)
  const reply = q.receive(world, me, 'q', o as { kind: string })
  q.applyAll(world)
  return reply
}

/** Has w1 hitch a horse, by default h2 to k1. */
const hitch = (world: WorldState, o: object = {}) =>
  give(world, { kind: 'hitch', residentId: 'w1', carriageId: 'k1', horseId: 'h2', ...o })

const ack = { type: 'ack', requestId: 'q' }

describe('the hitch order', () => {
  it('hitches the named horse among several, and that one is driven off', () => {
    const { world, w1, h1, h2, h3, carriage } = setup()
    expect(hitch(world)).toEqual(ack)
    expect(carriage.horseId).toBe('h2')
    expect(checkInvariants(world, open)).toEqual([])

    give(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 6, y: 2 })
    const walking = new Walking(open)
    for (let t = 0; w1.order && t < 2000; t++) {
      stepWorld(world, open, walking)
      expect(checkInvariants(world, open)).toEqual([])
    }
    expect([carriage.x, carriage.y, carriage.horseId]).toEqual([6, 2, 'h2'])
    expect([h2.x, h2.y]).toEqual([6, 2])
    expect([h1.x, h1.y, h3.x, h3.y]).toEqual([2, 2, 2, 2])
  })

  it('leaves Drive taking the first free horse with none hitched', () => {
    const { world, w1, carriage } = setup()
    give(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 3, y: 2 })
    const walking = new Walking(open)
    for (let t = 0; w1.order && t < 2000; t++) stepWorld(world, open, walking)
    expect(carriage.horseId).toBe('h1')
  })

  it('swaps a hitched horse, which stands free on the tile to be mounted', () => {
    const { world, h1, carriage } = setup()
    carriage.horseId = 'h1'
    expect(hitch(world)).toEqual(ack)
    expect(carriage.horseId).toBe('h2')
    expect([h1.x, h1.y]).toEqual([2, 2])
    expect(give(world, { kind: 'mount', residentId: 'w1', horseId: 'h1' })).toEqual(ack)
    expect(checkInvariants(world, open)).toEqual([])
  })

  it('lets the driver drive on behind the new horse, and leaves the old one behind', () => {
    const { world, w1, h1, h2, carriage } = setup()
    carriage.horseId = 'h1'
    give(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 8, y: 2 })
    const walking = new Walking(open)
    while (carriage.x < 4) stepWorld(world, open, walking)
    h2.x = carriage.x
    h2.y = carriage.y
    const [x, y] = [carriage.x, carriage.y]

    expect(hitch(world)).toEqual(ack)
    expect(w1.order).toMatchObject({ kind: 'drive' })
    for (let t = 0; w1.order && t < 2000; t++) {
      stepWorld(world, open, walking)
      expect(checkInvariants(world, open)).toEqual([])
    }
    expect([carriage.x, carriage.y, h2.x, h2.y]).toEqual([8, 2, 8, 2])
    expect([h1.x, h1.y]).toEqual([x, y])
  })

  it('goes on with what the resident was doing', () => {
    const { world, w1 } = setup()
    give(world, { kind: 'walkTo', residentId: 'w1', x: 9, y: 9 })
    expect(hitch(world)).toEqual(ack)
    expect(w1.order).toMatchObject({ kind: 'walkTo' })
  })

  it('refuses a horse that isn’t the realm’s, on the tile and free', () => {
    const { world, w1, h2, carriage } = setup()
    expect(hitch(world, { horseId: 'nope' })).toMatchObject({ reason: 'no such horse' })
    expect(hitch(world, { carriageId: 'nope' })).toMatchObject({ reason: 'no such carriage' })

    h2.realmId = 'r2'
    expect(hitch(world)).toMatchObject({ reason: 'not a horse of your realm' })
    expect(h2.realmId).toBe('r2')
    h2.realmId = 'r1'

    h2.x = 3
    expect(hitch(world)).toMatchObject({ reason: 'that horse is not on the carriage’s tile' })
    h2.x = 2

    h2.downUntil = world.tick + 100
    expect(hitch(world)).toMatchObject({ reason: 'that horse is Down' })
    delete h2.downUntil

    const rider = newResident(mulberry32(2), { id: 'p1', owner: 'r1', x: 2, y: 2, tick: 0 })
    rider.riding = 'h2'
    world.residents.push(rider)
    expect(hitch(world)).toMatchObject({ reason: 'someone rides that horse' })
    delete rider.riding

    world.carriages.push({ ...carriage, id: 'k2', horseId: 'h2' })
    expect(hitch(world)).toMatchObject({ reason: 'that horse already pulls a carriage' })
    carriage.horseId = 'h1'
    expect(hitch(world, { horseId: 'h1' })).toMatchObject({
      reason: 'that horse already pulls a carriage',
    })
    expect(carriage.horseId).toBe('h1')
    expect(w1.order).toBeNull()
  })

  it('refuses a child, a resident off the tile, another realm’s carriage and a stranger', () => {
    const { world, w1, carriage } = setup()
    const born = w1.bornAt
    w1.bornAt = world.tick - ticksForAge(5)
    expect(hitch(world)).toMatchObject({ reason: 'children can’t hitch' })
    w1.bornAt = born

    w1.x = 3
    expect(hitch(world)).toMatchObject({ reason: 'that carriage is not on the resident’s tile' })
    w1.x = 2

    carriage.realmId = 'r2'
    expect(hitch(world)).toMatchObject({ reason: 'not a carriage of your realm' })
    carriage.realmId = 'r1'

    const q = new OrderQueue(undefined, open)
    const o = { kind: 'hitch', residentId: 'w1', carriageId: 'k1', horseId: 'h2' }
    expect(q.receive(world, { ...me, userId: 8 }, 'q', o)).toMatchObject({
      reason: 'not one of your residents',
    })
    expect(carriage.horseId).toBeNull()
  })

  it('gives one horse to the first of two carriages hitching it in the same tick', () => {
    const { world, carriage } = setup()
    const second = { ...carriage, id: 'k2' }
    world.carriages.push(second)
    const q = new OrderQueue(undefined, open)
    for (const carriageId of ['k1', 'k2']) {
      const o = { kind: 'hitch', residentId: 'w1', carriageId, horseId: 'h2' }
      expect(q.receive(world, me, 'q', o)).toEqual(ack)
    }
    q.applyAll(world)
    expect([carriage.horseId, second.horseId]).toEqual(['h2', null])
    expect(checkInvariants(world, open)).toEqual([])
  })

  it('gets a passenger off the carriage first', () => {
    const { world, w1, carriage } = setup()
    expect(give(world, { kind: 'board', residentId: 'w1', carriageId: 'k1' })).toEqual(ack)
    expect(w1.aboard).toBe('k1')
    expect(hitch(world)).toEqual(ack)
    expect(w1.aboard).toBeUndefined()
    expect(carriage.horseId).toBe('h2')
    expect(checkInvariants(world, open)).toEqual([])
  })

  describe('as a queue step', () => {
    /** Steps the world and its queues while the resident has a queue. */
    function run(world: WorldState, orders: OrderQueue, resident: { queue?: unknown }) {
      const host = {
        script: () => undefined,
        sender: (userId: number) => (userId === 7 ? me : undefined),
        explored: () => true,
      }
      const queues = new QueueRunner(host, orderKinds, open)
      const walking = new Walking(open)
      orders.applyAll(world)
      for (let t = 0; resident.queue && t < 2000; t++) {
        queues.runAll(world)
        stepWorld(world, open, walking)
        expect(checkInvariants(world, open)).toEqual([])
      }
    }

    it('hitches the named horse when its turn comes, then drives off with it', () => {
      const { world, w1, h2, carriage } = setup()
      w1.x = 5
      const orders = new OrderQueue(undefined, open)
      const reply = orders.receive(world, me, 'q', {
        kind: 'queue',
        residentId: 'w1',
        steps: [
          { order: { kind: 'walkTo', x: 2, y: 2 } },
          { order: { kind: 'hitch', carriageId: 'k1', horseId: 'h2' } },
          { order: { kind: 'drive', carriageId: 'k1', x: 4, y: 2 } },
        ],
      })
      expect(reply).toEqual(ack)
      run(world, orders, w1)
      expect(carriage.horseId).toBe('h2')
      expect([carriage.x, carriage.y, h2.x, h2.y]).toEqual([4, 2, 4, 2])
      expect(world.events.filter((e) => e.kind === 'queueStepSkipped')).toEqual([])
    })

    it('refuses another realm’s horse when added, and skips a step whose horse has gone', () => {
      const { world, w1, h2 } = setup()
      const orders = new OrderQueue(undefined, open)
      const step = { order: { kind: 'hitch', carriageId: 'k1', horseId: 'h2' } }
      h2.realmId = 'r2'
      expect(
        orders.receive(world, me, 'q', { kind: 'queue', residentId: 'w1', steps: [step] }),
      ).toMatchObject({ reason: 'step 1: not a horse of your realm' })
      h2.realmId = 'r1'

      h2.x = 3
      expect(
        orders.receive(world, me, 'q', { kind: 'queue', residentId: 'w1', steps: [step] }),
      ).toEqual(ack)
      run(world, orders, w1)
      expect(world.events.filter((e) => e.kind === 'queueStepSkipped')).toEqual([
        expect.objectContaining({
          order: 'hitch',
          reason: 'that horse is not on the carriage’s tile',
        }),
      ])
    })
  })
})
