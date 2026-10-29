import {
  AVERAGE_HORSE_STATS,
  CARRIAGE_CAPACITY,
  HUNGER_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  PASSENGER_WEIGHT,
  TICKS_PER_GAME_DAY,
  Terrain,
  carriageCapacity,
  unitsThatFitCarriage,
  type Carriage,
  type Horse,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, runScriptOrder } from './script-runner.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const SIZE = 24
const open: TerrainMap = {
  size: SIZE,
  tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
}
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * A world on an open map with realm r1 (Player 7, Leader w1) and, at (2, 2), its residents w1
 * (the driver), p1 and p2 with their own food, and carriage k1 with horse h1 of r1.
 */
function setup() {
  const world = createWorld(open)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const at = (id: string, seed: number) =>
    newResident(mulberry32(seed), { id, owner: 'r1', x: 2, y: 2, tick: 0 })
  const [w1, p1, p2] = [at('w1', 1), at('p1', 2), at('p2', 3)]
  for (const r of [w1, p1, p2]) r.carried = { food: OWN_FOOD }
  world.residents.push(w1, p1, p2)
  const horse: Horse = {
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: 2,
    y: 2,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  }
  world.horses.push(horse)
  const carriage: Carriage = {
    id: 'k1',
    realmId: 'r1',
    cityId: null,
    x: 2,
    y: 2,
    horseId: 'h1',
    load: {},
  }
  world.carriages.push(carriage)
  return { world, w1, p1, p2, carriage }
}

/** Sends an order of the Player's and applies it, as the next tick would; returns the reply. */
function order(world: WorldState, o: object) {
  const q = new OrderQueue(undefined, open)
  const reply = q.receive(world, me, 'q', o as { kind: string })
  q.applyAll(world)
  return reply
}

const board = (world: WorldState, residentId: string) =>
  order(world, { kind: 'board', residentId, carriageId: 'k1' })

/** Steps the world until the resident's order is done or `max` ticks pass. */
function until(world: WorldState, r: Resident, max = 2000) {
  const walking = new Walking(open)
  for (let t = 0; r.order && t < max; t++) {
    stepWorld(world, open, walking)
    expect(checkInvariants(world, open)).toEqual([])
  }
}

describe('passengers', () => {
  it('board, ride along with the driven carriage, and get off on it or right next to it', () => {
    const { world, w1, p1, p2, carriage } = setup()
    expect(board(world, 'p1')).toEqual({ type: 'ack', requestId: 'q' })
    expect(board(world, 'p2')).toMatchObject({ type: 'ack' })
    expect([p1.aboard, p2.aboard]).toEqual(['k1', 'k1'])
    expect(
      order(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 12, y: 5 }),
    ).toMatchObject({ type: 'ack' })
    until(world, w1)
    expect([carriage.x, carriage.y]).toEqual([12, 5])
    for (const p of [p1, p2]) expect([p.x, p.y, p.aboard]).toEqual([12, 5, 'k1'])

    // p1 gets off on the carriage's tile, p2 onto the tile right next to it.
    expect(order(world, { kind: 'getOff', residentId: 'p1' })).toMatchObject({ type: 'ack' })
    expect(p1.aboard).toBeUndefined()
    expect(order(world, { kind: 'getOff', residentId: 'p2', x: 13, y: 6 })).toMatchObject({
      type: 'ack',
    })
    expect(p2.aboard).toBeUndefined()
    until(world, p2)
    expect([p1.x, p1.y, p2.x, p2.y]).toEqual([12, 5, 13, 6])

    // The carriage drives on without them.
    order(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 16, y: 5 })
    until(world, w1)
    expect([p1.x, p1.y]).toEqual([12, 5])
  })

  it('get off only next to the carriage, and only while aboard', () => {
    const { world } = setup()
    expect(order(world, { kind: 'getOff', residentId: 'p1' })).toMatchObject({
      reason: 'not aboard a carriage',
    })
    board(world, 'p1')
    expect(order(world, { kind: 'getOff', residentId: 'p1', x: 5, y: 2 })).toMatchObject({
      reason: 'that tile is not next to the carriage',
    })
    expect(order(world, { kind: 'getOff', residentId: 'p1', x: 3 })).toMatchObject({
      reason: 'the target must be a tile',
    })
  })

  it('count each passenger against what the carriage holds, shared with its goods', () => {
    const { world, carriage } = setup()
    const holds = carriageCapacity(world, carriage)
    expect(holds).toBe(CARRIAGE_CAPACITY)
    const before = unitsThatFitCarriage(world, carriage, 'stone')
    board(world, 'p1')
    expect(unitsThatFitCarriage(world, carriage, 'stone')).toBeLessThan(before)

    // Goods leave room for one passenger less than none: p2 can't board.
    carriage.load = { food: holds - 2 * PASSENGER_WEIGHT + 1 }
    expect(board(world, 'p2')).toMatchObject({ reason: 'the carriage is full' })
    carriage.load = { food: holds - 2 * PASSENGER_WEIGHT }
    expect(board(world, 'p2')).toMatchObject({ type: 'ack' })
    expect(checkInvariants(world, open)).toEqual([])

    // Full of people and goods, the carriage takes no more goods.
    const w1 = world.residents.find((r) => r.id === 'w1')!
    w1.carried = { food: 3 }
    order(world, {
      kind: 'drop',
      residentId: 'w1',
      spot: { kind: 'carriage', carriageId: 'k1' },
      goods: { food: 3 },
    })
    stepWorld(world, open, new Walking(open))
    expect(w1.carried.food).toBe(3)
    expect(carriage.load.food).toBe(holds - 2 * PASSENGER_WEIGHT)
  })

  it('fill a carriage with people: five behind an average horse, and no more', () => {
    const { world } = setup()
    for (let i = 0; i < 6; i++) {
      world.residents.push(
        newResident(mulberry32(10 + i), { id: `q${i}`, owner: 'r1', x: 2, y: 2, tick: 0 }),
      )
    }
    const replies = [0, 1, 2, 3, 4, 5].map((i) => board(world, `q${i}`))
    expect(replies.filter((r) => r.type === 'ack')).toHaveLength(
      Math.floor(CARRIAGE_CAPACITY / PASSENGER_WEIGHT),
    )
    expect(replies.at(-1)).toMatchObject({ reason: 'the carriage is full' })
  })

  it('take children aboard, but not the driver, a rider, or anyone off the tile or of another realm', () => {
    const { world, w1, p1, p2, carriage } = setup()
    p1.bornAt = world.tick - 1
    expect(board(world, 'p1')).toMatchObject({ type: 'ack' })
    expect(board(world, 'p1')).toMatchObject({ reason: 'already aboard that carriage' })
    order(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 12, y: 5 })
    expect(board(world, 'w1')).toMatchObject({ reason: 'the driver can’t board' })
    w1.order = null
    p2.riding = 'h9'
    expect(board(world, 'p2')).toMatchObject({ reason: 'dismount first to board' })
    delete p2.riding
    p2.x = 3
    expect(board(world, 'p2')).toMatchObject({
      reason: 'that carriage is not on the resident’s tile',
    })
    p2.x = 2
    carriage.realmId = 'r2'
    expect(board(world, 'p2')).toMatchObject({ reason: 'not a carriage of your realm' })
    carriage.realmId = 'r1'
    expect(order(world, { kind: 'board', residentId: 'p2', carriageId: 'nope' })).toMatchObject({
      reason: 'no such carriage',
    })
  })

  it('get a passenger off first when they are given a walk, and then walk', () => {
    const { world, w1, p1, carriage } = setup()
    board(world, 'p1')
    expect(order(world, { kind: 'walkTo', residentId: 'p1', x: 2, y: 9 })).toMatchObject({
      type: 'ack',
    })
    expect(p1.aboard).toBeUndefined()
    // The driver sets off at once; the carriage leaves p1 behind.
    order(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 12, y: 2 })
    until(world, p1)
    until(world, w1)
    expect([p1.x, p1.y]).toEqual([2, 9])
    expect([carriage.x, carriage.y]).toEqual([12, 2])
  })

  it('stop what a resident was doing when they board, and keep them aboard through other orders', () => {
    const { world, p1 } = setup()
    order(world, { kind: 'walkTo', residentId: 'p1', x: 2, y: 9 })
    board(world, 'p1')
    expect(p1.order).toBeNull()
    expect(order(world, { kind: 'stop', residentId: 'p1' })).toMatchObject({ type: 'ack' })
    expect(p1.aboard).toBe('k1')
  })

  it('get passengers off a carriage that is gone or no longer of their realm', () => {
    const { world, p1, p2, carriage } = setup()
    board(world, 'p1')
    board(world, 'p2')
    carriage.realmId = 'r2'
    stepWorld(world, open)
    expect(p1.aboard).toBeUndefined()
    carriage.realmId = 'r1'
    board(world, 'p1')
    world.carriages = []
    stepWorld(world, open)
    expect([p1.aboard, p2.aboard]).toEqual([undefined, undefined])
  })

  it('board and get off as queue steps, riding along while a step waits for the stop', () => {
    const { world, w1, p1, p2, carriage } = setup()
    // Script 1 waits until its resident is at (12, 5): the step that waits for arrival.
    const host = {
      script: (id: number) =>
        id === 1
          ? { userId: 7, source: 'if (me.x == 12 && me.y == 5) { end() }', followsDefault: false }
          : undefined,
      sender: (userId: number) => (userId === 7 ? me : undefined),
      explored: () => true,
    }
    const kinds = { ...orderKinds, runScript: runScriptOrder(host) }
    const orders = new OrderQueue(kinds, open)
    const queues = new QueueRunner(host, kinds, open)
    const scripts = new ScriptRunner(open, host)
    const walking = new Walking(open)
    const tick = () => {
      orders.applyAll(world)
      queues.runAll(world)
      expect(scripts.runAll(world, true)).toEqual([])
      stepWorld(world, open, walking)
      expect(checkInvariants(world, open)).toEqual([])
    }
    const give = (o: object) => orders.receive(world, me, 'q', o as { kind: string })
    // p1: board, wait for the stop, get off next to the carriage, walk on.
    expect(
      give({
        kind: 'queue',
        residentId: 'p1',
        steps: [
          { order: { kind: 'board', carriageId: 'k1' } },
          { order: { kind: 'runScript', scriptId: 1 } },
          { order: { kind: 'getOff', x: 13, y: 5 } },
          { order: { kind: 'walkTo', x: 13, y: 8 } },
        ],
      }),
    ).toMatchObject({ type: 'ack' })
    // p2: board and get off at once, still at the start; then a board the carriage left behind.
    give({
      kind: 'queue',
      residentId: 'p2',
      steps: [
        { order: { kind: 'board', carriageId: 'k1' } },
        { order: { kind: 'getOff' } },
        { order: { kind: 'walkTo', x: 2, y: 4 } },
        { order: { kind: 'board', carriageId: 'k1' } },
      ],
    })
    tick()
    expect([p1.aboard, p2.aboard]).toEqual(['k1', 'k1'])
    tick()
    // Board ends once aboard: p1's wait starts, and p2 is off again.
    expect(p1).toMatchObject({ aboard: 'k1', queue: { current: 1 } })
    expect(p2).toMatchObject({ queue: { current: 1 } })
    expect(p2.aboard).toBeUndefined()

    give({ kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 12, y: 5 })
    for (let t = 0; t < 300 && (p1.queue || p2.queue || w1.order); t++) tick()
    expect([carriage.x, carriage.y]).toEqual([12, 5])
    expect([p1.x, p1.y, p1.aboard, p1.queue]).toEqual([13, 8, undefined, undefined])
    expect([p2.x, p2.y, p2.aboard, p2.queue]).toEqual([2, 4, undefined, undefined])
    // p2's last board found the carriage gone and was skipped; p1's plan skipped nothing.
    const skips = world.events.filter((e) => e.kind === 'queueStepSkipped')
    expect(skips).toEqual([
      expect.objectContaining({
        residentId: 'p2',
        step: 4,
        order: 'board',
        reason: 'that carriage is not on the resident’s tile',
      }),
    ])
  })

  describe('eat from the carriage (Refilling from a carriage)', () => {
    /**
     * Boards p1 with no Food of their own on a carriage holding `food`, then has w1 (well fed)
     * drive it back and forth across the map for `HUNGER_DAYS + 1` game days, longer than a full
     * hunger meter lasts.
     */
    function longDrive(food: number) {
      const { world, w1, p1, carriage } = setup()
      world.residents = world.residents.filter((r) => r.id !== 'p2')
      board(world, 'p1')
      p1.carried = {}
      w1.carried = { food: 10 }
      carriage.load = food > 0 ? { food } : {}
      const walking = new Walking(open)
      const ends = [20, 2]
      for (let t = 0; t < (HUNGER_DAYS + 1) * TICKS_PER_GAME_DAY; t++) {
        if (!w1.order) {
          order(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: ends[0], y: 2 })
          ends.reverse()
        }
        stepWorld(world, open, walking)
        if (t % 240 === 0) expect(checkInvariants(world, open)).toEqual([])
      }
      expect(p1.aboard).toBe('k1')
      expect(carriage.x).not.toBe(2)
      return { p1, carriage }
    }

    it('keep a passenger with no Food fed over a long drive on a carriage with Food', () => {
      const { p1, carriage } = longDrive(20)
      expect(p1.hunger).toBeGreaterThan(MAX_HUNGER / 2)
      expect(p1.health).toBe(MAX_HEALTH)
      expect(carriage.load.food ?? 0).toBeLessThan(20)
    })

    it('leave passengers hungry on a carriage without Food', () => {
      const { p1 } = longDrive(0)
      expect(p1.hunger).toBe(0)
      expect(p1.carried.food ?? 0).toBe(0)
    })
  })

  it('keep the invariant: a passenger stands on their carriage', () => {
    const { world, p1 } = setup()
    board(world, 'p1')
    expect(checkInvariants(world, open)).toEqual([])
    p1.x = 3
    expect(checkInvariants(world, open)).toEqual([
      expect.objectContaining({ invariant: 'passengers-aboard', entityIds: ['p1', 'k1'] }),
    ])
  })
})
