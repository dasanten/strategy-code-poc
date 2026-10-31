import {
  OWN_FOOD,
  QUEUE_MAX_STEPS,
  Terrain,
  queueView,
  type Building,
  type OrderRequest,
  type RealmEvent,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { newHorse } from './horses.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { QueueRunner, queuesSound } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** Queues (`CONTEXT.md`: Queue): steps done one after another, timed, looped and edited. */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with city c1 (its town hall at (9, 3)): resident w1 standing on farm f1 at (6, 6), a storage s1 at
 * (12, 6) with Food, and Player 8's resident x1 of realm r2.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'w1' },
    { id: 'r2', userId: 8, leaderId: 'x1' },
  )
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const farm: Building = { id: 'f1', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
  const s1: Building = { id: 's1', kind: 'storage', cityId: 'c1', x: 12, y: 6, stock: { food: 50 } }
  world.buildings.push(farm, s1)
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 6, y: 6, tick: 0 })
  r.cityId = 'c1'
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food: OWN_FOOD, wood: 5 }
  const x1 = newResident(mulberry32(2), { id: 'x1', owner: 'r2', x: 1, y: 1, tick: 0 })
  world.residents.push(r, x1)
  const scripts = defaultScripts(terrain, [me])
  const orders = new OrderQueue(scripts.kinds, terrain)
  const queues = new QueueRunner(
    { sender: (id) => (id === 7 ? me : undefined) },
    scripts.kinds,
    terrain,
  )
  const walking = new Walking(terrain)
  /** One tick as the game runs it: orders, queues, scripts, then the world steps. */
  const tick = () => {
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
    expect(queuesSound.check(world, terrain)).toEqual([])
  }
  const give = (order: OrderRequest) =>
    orders.receive(world, me, 'q', { residentId: 'w1', ...order })
  return { world, r, s1, tick, give }
}

const walk = (x: number, y: number) => ({ order: { kind: 'walkTo', x, y } })
const skips = (events: RealmEvent[]) => events.filter((e) => e.kind === 'queueStepSkipped')

describe('queue order', () => {
  it('does its steps in order, then ends', () => {
    const s = setup()
    expect(s.give({ kind: 'queue', steps: [walk(9, 6), walk(9, 9)] })).toMatchObject({
      type: 'ack',
    })
    const been: string[] = []
    for (let i = 0; i < 100 && (i === 0 || s.r.queue); i++) {
      s.tick()
      been.push(`${s.r.x},${s.r.y}`)
    }
    expect(been).toContain('9,6')
    expect(been.indexOf('9,6')).toBeLessThan(been.indexOf('9,9'))
    expect(s.r).toMatchObject({ x: 9, y: 9, order: null })
    expect(s.r.queue).toBeUndefined()
    expect(skips(s.world.events)).toEqual([])
  })

  it('hands a timed task step over to the next once its minutes are up', () => {
    const s = setup()
    s.give({
      kind: 'queue',
      steps: [{ order: { kind: 'task', task: 'work', workplaceId: 'f1' }, minutes: 5 }, walk(6, 9)],
    })
    s.tick()
    const started = s.r.queue!.startedAt!
    expect(s.r.script?.memory).toMatchObject({ workplaceId: 'f1' })
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    while (s.world.tick < started + 5) s.tick()
    expect(s.r.queue).toMatchObject({ current: 0 })
    s.tick()
    // Five game minutes in, the work ends and the walk starts.
    expect(s.r.script).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 6, y: 9 } })
    expect(s.r.queue).toMatchObject({ current: 1, startedAt: started + 5 })
  })

  it('moves on once a script step ends itself', () => {
    const s = setup()
    s.give({
      kind: 'queue',
      steps: [{ order: { kind: 'task', task: 'tearDown', buildingId: 'f1' } }, walk(6, 9)],
    })
    s.tick()
    expect(s.r.script?.memory).toEqual({ buildingId: 'f1' })
    // The farm is gone: the Tear down default calls end(), and the walk starts.
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 'f1')
    for (let i = 0; i < 5 && s.r.order?.kind !== 'walkTo'; i++) s.tick()
    expect(s.r.script).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 6, y: 9 } })
    expect(skips(s.world.events)).toEqual([])
  })

  it('starts again from the first step when it loops', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [walk(8, 6), walk(6, 6)], loop: true })
    const at: string[] = []
    for (let i = 0; i < 60; i++) {
      s.tick()
      at.push(`${s.r.x},${s.r.y}`)
    }
    // Back and forth, more than once.
    expect(at.filter((p) => p === '8,6').length).toBeGreaterThan(1)
    expect(at.lastIndexOf('6,6')).toBeGreaterThan(at.indexOf('8,6'))
    expect(s.r.queue).toBeDefined()
  })

  it('skips a step that can’t start and notes it in the realm log', () => {
    const s = setup()
    s.give({
      kind: 'queue',
      steps: [walk(14, 14), { order: { kind: 'workAt' }, minutes: 10 }, walk(6, 14)],
    })
    for (let i = 0; i < 300 && (i === 0 || s.r.queue); i++) s.tick()
    expect(skips(s.world.events)).toEqual([
      expect.objectContaining({
        userId: 7,
        kind: 'queueStepSkipped',
        residentId: 'w1',
        step: 2,
        order: 'workAt',
        reason: expect.any(String),
      }),
    ])
    expect(s.r).toMatchObject({ x: 6, y: 14 })
  })

  it('skips a kept step whose kind is unknown or inherited from Object.prototype', () => {
    // Such steps can't be given (`queueStepsProblem`), but a kept queue is checked again when
    // its step's turn comes, and a lookup must not find `Object.prototype.constructor`.
    const s = setup()
    const kinds = ['constructor', 'toString', '__proto__', 'fly']
    s.r.queue = {
      realmId: 'r1',
      steps: kinds.map((kind, i) => ({ id: i + 1, order: { kind } })),
      current: 0,
      startedAt: null,
      loop: false,
      nextStepId: kinds.length + 1,
    }
    expect(() => s.tick()).not.toThrow()
    expect(s.r.queue).toBeUndefined()
    expect(skips(s.world.events)).toEqual(
      kinds.map((kind) =>
        expect.objectContaining({ order: kind, reason: `unknown order: ${kind}` }),
      ),
    )
  })

  it('skips a step that ends in a failure and notes it', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [{ order: { kind: 'store', goods: ['wood'] } }, walk(3, 3)] })
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'store' })
    // The storage burns down on the way.
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 's1')
    for (let i = 0; i < 100 && s.r.queue; i++) s.tick()
    expect(skips(s.world.events)).toEqual([
      expect.objectContaining({ step: 1, order: 'store', reason: 'the storage is gone' }),
    ])
    expect(s.r).toMatchObject({ x: 3, y: 3 })
  })

  it('ends when none of its looping steps can start', () => {
    const s = setup()
    s.r.x = 1
    s.give({ kind: 'queue', steps: [{ order: { kind: 'workAt' } }], loop: true })
    s.tick()
    expect(s.r.queue).toBeUndefined()
    expect(skips(s.world.events)).toEqual([expect.objectContaining({ step: 1, queueEnded: true })])
  })

  it('ends with any other order, and keeps going when the Player renames them', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [walk(20, 6), walk(6, 6)] })
    s.tick()
    s.give({ kind: 'rename', name: 'Mara Two' })
    s.tick()
    expect(s.r.queue).toBeDefined()
    s.give({ kind: 'walkTo', x: 1, y: 1 })
    s.tick()
    expect(s.r.queue).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 1, y: 1 } })
  })

  it('shows scripts where it is and the current step, not the steps', () => {
    const s = setup()
    s.give({
      kind: 'queue',
      steps: [walk(9, 9), { order: { kind: 'task', task: 'work', workplaceId: 'f1' }, minutes: 3 }],
      loop: true,
    })
    s.tick()
    expect(queueView(s.r.queue!)).toEqual({
      step: 1,
      steps: 2,
      loop: true,
      kind: 'walkTo',
      startedAt: s.world.tick - 1,
    })
    s.r.queue!.current = 1
    expect(queueView(s.r.queue!)).toMatchObject({ step: 2, kind: 'task', task: 'work', minutes: 3 })
  })

  it('takes a resident out of their army, and ends once an army takes them in', () => {
    const s = setup()
    s.world.armies.push({
      id: 'ar1',
      name: 'Vanguard',
      realmId: 'r1',
      memberIds: ['w1'],
      order: null,
    })
    s.give({ kind: 'queue', steps: [walk(20, 6)] })
    s.tick()
    expect(s.world.armies).toEqual([])
    expect(s.r.order).toMatchObject({ kind: 'walkTo' })
    s.world.armies.push({ id: 'ar2', name: 'Rear', realmId: 'r1', memberIds: ['w1'], order: null })
    s.tick()
    expect(s.r.queue).toBeUndefined()
  })

  it('is seen only by the realm that gave it', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [walk(9, 9)] })
    s.tick()
    const seenBy = (realmId: string) =>
      entitiesInSight(s.world, terrain, realmId).find((e) => e.is === 'resident' && e.id === 'w1')
    expect(seenBy('r1')).toMatchObject({ queue: { realmId: 'r1', steps: [walk(9, 9)] } })
    expect(seenBy('r2')).toBeDefined()
    expect(seenBy('r2')).not.toHaveProperty('queue')
  })

  it('is checked when given', () => {
    const s = setup()
    const reason = (o: object) => {
      const answer = s.give({ kind: 'queue', ...o })
      return answer.type === 'rejected' ? answer.reason : undefined
    }
    expect(reason({ steps: [] })).toBe('a queue needs a step')
    expect(reason({ steps: [{ order: { kind: 'queue', steps: [walk(1, 1)] } }] })).toBe(
      "step 1: queue can't be a queue step",
    )
    expect(reason({ steps: [{ order: { kind: 'attack', targetId: 'x1' } }] })).toBe(
      "step 1: attack can't be a queue step",
    )
    expect(reason({ steps: [{ order: { kind: 'workAt' } }, walk(1, 1)] })).toBe(
      'step 1 never ends on its own: give it a duration or make it the last',
    )
    expect(reason({ steps: [walk(1, 1), { order: { kind: 'workAt' } }] })).toBeUndefined()
    const feed = { kind: 'task', task: 'feedStable', stableId: 'b1' }
    expect(reason({ steps: [{ order: feed }, walk(1, 1)] })).toBe(
      'step 1 never ends on its own: give it a duration or make it the last',
    )
    expect(reason({ steps: [{ order: feed, minutes: 30 }, walk(1, 1)] }) ?? '').not.toMatch(
      /never ends/,
    )
    expect(reason({ steps: [{ ...walk(1, 1), minutes: 0 }] })).toBe(
      "step 1's duration must be a whole number of minutes",
    )
    expect(reason({ steps: Array.from({ length: QUEUE_MAX_STEPS + 1 }, () => walk(1, 1)) })).toBe(
      `a queue holds at most ${QUEUE_MAX_STEPS} steps`,
    )
    expect(
      s.give({ kind: 'queue', residentId: 'x1', steps: [walk(1, 1)] } as OrderRequest),
    ).toMatchObject({ type: 'rejected', reason: 'not one of your residents' })
  })
})

describe('planning ahead', () => {
  /** Setup, with a second farm f2 far off at (20, 20), and a carriage k2 of realm r2. */
  function farOff() {
    const s = setup()
    s.world.buildings.push({ id: 'f2', kind: 'farm', cityId: null, x: 20, y: 20 })
    s.world.carriages.push({
      id: 'k2',
      realmId: 'r2',
      cityId: null,
      x: 2,
      y: 2,
      horseId: null,
      load: {},
    } as (typeof s.world.carriages)[number])
    const reason = (kind: 'queue' | 'editQueue', steps: object[]) => {
      const answer = s.give({ kind, steps })
      return answer.type === 'rejected' ? answer.reason : undefined
    }
    return { ...s, reason }
  }
  const workF2 = (minutes?: number) => ({
    order: { kind: 'task', task: 'work', workplaceId: 'f2' },
    ...(minutes === undefined ? {} : { minutes }),
  })

  it('walks to a workplace elsewhere, works it, then stores at a storage', () => {
    const s = farOff()
    expect(
      s.reason('queue', [
        walk(20, 20),
        workF2(5),
        { order: { kind: 'store', goods: ['wood'], to: 's1' } },
      ]),
    ).toBeUndefined()
    const worked: string[] = []
    for (let i = 0; i < 400 && (i === 0 || s.r.queue); i++) {
      s.tick()
      if (s.r.order?.kind === 'workAt') worked.push(`${s.r.x},${s.r.y}`)
    }
    expect(worked).toContain('20,20')
    expect(s.s1.stock).toMatchObject({ wood: 5 })
    expect(s.r.carried.wood ?? 0).toBe(0)
    expect(skips(s.world.events)).toEqual([])
  })

  it('takes a step on another tile and skips it with a log line when it can’t start there', () => {
    const s = farOff()
    // Working f2 from (6, 6), with no walk there first.
    expect(s.reason('queue', [workF2(5), walk(3, 3)])).toBeUndefined()
    for (let i = 0; i < 100 && (i === 0 || s.r.queue); i++) s.tick()
    expect(skips(s.world.events)).toEqual([
      expect.objectContaining({ step: 1, order: 'task', reason: expect.any(String) }),
    ])
    expect(s.r).toMatchObject({ x: 3, y: 3 })
  })

  it('turns down a step whose place can’t make sense', () => {
    const s = farOff()
    expect(s.reason('queue', [walk(1, 1), walk(SIZE, 1)])).toBe('step 2: that tile is off the map')
    const road = { kind: 'roadLine', from: { x: 1, y: 1 }, to: { x: 1, y: -1 } }
    expect(s.reason('queue', [{ order: road }])).toBe('step 1: that tile is off the map')
    expect(s.reason('queue', [{ order: { kind: 'board', carriageId: 'k9' } }])).toBe(
      'step 1: no such carriage',
    )
    expect(s.reason('queue', [{ order: { kind: 'fetch', goods: ['food'], from: 'k2' } }])).toBe(
      'step 1: not a carriage of your realm',
    )
    const drive = { kind: 'drive', carriageId: 'k2', x: 3, y: 3 }
    expect(s.reason('queue', [{ order: drive }])).toBe('step 1: not a carriage of your realm')
    expect(s.reason('queue', [{ order: { kind: 'mount', horseId: 'h9' } }])).toBe(
      'step 1: no such horse',
    )
  })

  it('walks to a training ground elsewhere and teaches there until its minutes are up', () => {
    const s = farOff()
    s.world.buildings.push({ id: 'g1', kind: 'trainingGround', cityId: null, x: 14, y: 14 })
    const teach = { kind: 'teach', buildingId: 'g1', subject: 'combat' }
    // Teaching never ends on its own: it needs minutes unless it is the last step.
    expect(s.reason('queue', [walk(15, 15), { order: teach }, walk(9, 9)])).toBe(
      'step 2 never ends on its own: give it a duration or make it the last',
    )
    expect(s.reason('queue', [walk(15, 15), { order: teach, minutes: 30 }, walk(9, 9)])).toBe(
      undefined,
    )
    let taught = false
    for (let i = 0; i < 300 && (i === 0 || s.r.queue); i++) {
      s.tick()
      if (s.r.order?.kind === 'teach') taught = true
    }
    expect(taught).toBe(true)
    expect(s.r).toMatchObject({ x: 9, y: 9 })
    expect(skips(s.world.events)).toEqual([])
  })

  it('walks to a horse elsewhere and mounts it', () => {
    const s = farOff()
    s.world.horses.push(
      newHorse(mulberry32(3), { id: 'h1', realmId: 'r1', cityId: null, x: 9, y: 6, tick: 0 }),
    )
    s.give({
      kind: 'queue',
      steps: [walk(9, 6), { order: { kind: 'mount', horseId: 'h1' } }, walk(9, 9)],
    })
    for (let i = 0; i < 100 && (i === 0 || s.r.queue); i++) s.tick()
    expect(s.r).toMatchObject({ x: 9, y: 9, riding: 'h1' })
    expect(skips(s.world.events)).toEqual([])
  })

  it('checks only the steps an edit adds', () => {
    const s = farOff()
    s.give({ kind: 'queue', steps: [walk(20, 6), workF2()] })
    s.tick()
    // f2 is torn down: the step stays, to be skipped when its turn comes.
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 'f2')
    expect(
      s.reason('editQueue', [
        { id: 1, ...walk(20, 6) },
        { id: 2, ...workF2() },
      ]),
    ).toBe(undefined)
    // Added again, as a saved queue loaded after the tear-down: given, to be skipped too.
    expect(s.reason('editQueue', [{ id: 1, ...walk(20, 6) }, workF2()])).toBe(undefined)
  })

  it('gives a step whose building or storage is gone, and skips it when its turn comes', () => {
    const s = farOff()
    // A saved queue loaded after its workplace and storage were torn down (`CONTEXT.md`: Saved queue).
    const work = { order: { kind: 'task', task: 'work', workplaceId: 'torn-down' }, minutes: 5 }
    const store = { order: { kind: 'store', goods: ['wood'], to: 'torn-down-storage' } }
    expect(s.reason('queue', [work, store, walk(3, 3)])).toBeUndefined()
    for (let i = 0; i < 100 && (i === 0 || s.r.queue); i++) s.tick()
    expect(skips(s.world.events)).toEqual([
      expect.objectContaining({ step: 1, order: 'task' }),
      expect.objectContaining({ step: 2, order: 'store' }),
    ])
    expect(s.r).toMatchObject({ x: 3, y: 3 })
  })
})

describe('edit-queue order', () => {
  it('keeps the current step going while steps are added, removed and reordered', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [walk(20, 6), walk(6, 9), walk(9, 9)] })
    s.tick()
    s.tick()
    const walking = s.r.order
    const startedAt = s.r.queue!.startedAt
    // The walk to (20, 6), step 1, now comes after a new first step; (6, 9) is dropped.
    expect(
      s.give({
        kind: 'editQueue',
        steps: [walk(3, 3), { id: 1, ...walk(20, 6) }, { id: 3, ...walk(9, 9) }],
      }),
    ).toMatchObject({ type: 'ack' })
    s.tick()
    expect(s.r.order).toBe(walking)
    expect(s.r.queue).toMatchObject({ current: 1, startedAt, nextStepId: 5 })
    expect(s.r.queue!.steps.map((x) => x.id)).toEqual([4, 1, 3])
    for (let i = 0; i < 200 && s.r.queue; i++) s.tick()
    expect(s.r).toMatchObject({ x: 9, y: 9 })
  })

  it('starts the step in its place when the current one is removed', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [walk(20, 6), walk(6, 9)], loop: true })
    s.tick()
    s.give({ kind: 'editQueue', steps: [{ id: 2, ...walk(6, 9) }, walk(9, 9)] })
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 6, y: 9 } })
    expect(s.r.queue).toMatchObject({ current: 0, loop: true })
    // Removing every step ends the queue, and the resident stops.
    s.give({ kind: 'editQueue', steps: [] })
    s.tick()
    expect(s.r.queue).toBeUndefined()
    expect(s.r.order).toBeNull()
  })

  it('is checked when given', () => {
    const s = setup()
    const reason = (o: object) => {
      const answer = s.give({ kind: 'editQueue', ...o })
      return answer.type === 'rejected' ? answer.reason : undefined
    }
    expect(reason({ steps: [walk(1, 1)] })).toBe('not working through a queue')
    s.give({ kind: 'queue', steps: [walk(20, 6)] })
    s.tick()
    expect(reason({ steps: [{ id: 9, ...walk(1, 1) }] })).toBe('no such step in the queue')
    expect(
      reason({
        steps: [
          { id: 1, ...walk(1, 1) },
          { id: 1, ...walk(2, 2) },
        ],
      }),
    ).toBe('a step is in the list twice')
    expect(reason({ steps: [{ id: 1, ...walk(1, 1) }], loop: true })).toBeUndefined()
  })
})

describe('queues-sound invariant', () => {
  it('finds a step out of range, a queue in a queue and a step started in the future', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [walk(9, 9)] })
    s.tick()
    expect(checkInvariants(s.world, terrain)).toEqual([])
    const q = s.r.queue!
    q.current = 5
    q.startedAt = s.world.tick + 1
    q.steps.push({ id: 1, order: { kind: 'queue' } })
    expect(queuesSound.check(s.world, terrain).map((v) => v.message)).toEqual([
      "w1's queue is at step 5 of 2",
      `w1's queue started a step at tick ${s.world.tick + 1}, after ${s.world.tick}`,
      "w1's queue has step ids 1, 1 with 2 next",
      "w1's queue holds a queue step",
    ])
  })
})
