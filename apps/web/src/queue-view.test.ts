import {
  QUEUE_DEFAULT_STEP_MINUTES,
  queueStepsProblem,
  type OrderRequest,
  type Queue,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  appendRequest,
  appendRequests,
  dropStep,
  moveStep,
  queueRows,
  removeStep,
  STORE_ALL,
  stepLabel,
  timeStep,
  type Queued,
} from './queue-view.js'

/** Queues on the resident card (`CONTEXT.md`: Queue): Shift-append and the queue list. */

const idle: Queued = { id: 'w1', x: 6, y: 6, order: null }
const work: OrderRequest = { kind: 'task', task: 'work', residentId: 'w1', workplaceId: 'f1' }
const walkHome: OrderRequest = { kind: 'walkTo', residentId: 'w1', x: 9, y: 3 }

/** The queue the server keeps for a queue order of these steps. */
function queueOf(request: OrderRequest, current = 0): Queue {
  const steps = request.steps as { id?: number; order: OrderRequest; minutes?: number }[]
  return {
    realmId: 'r1',
    steps: steps.map((s, i) => ({ ...s, id: s.id ?? i + 1 })),
    current,
    startedAt: 0,
    loop: request.loop === true,
    nextStepId: steps.length + 1,
  }
}

/** Shift-queues these orders on a resident one after another, the server keeping each. */
function shiftQueue(r: Queued, orders: OrderRequest[]): Queued {
  let now = r
  for (const order of orders) {
    const request = appendRequest(now, order)!
    expect(queueStepsProblem(request.steps)).toBeUndefined()
    now = { ...now, queue: queueOf(request) }
  }
  return now
}

describe('Shift-append', () => {
  it('starts a queue on an idle resident', () => {
    expect(appendRequest(idle, walkHome)).toEqual({
      kind: 'queue',
      residentId: 'w1',
      steps: [{ order: { kind: 'walkTo', x: 9, y: 3 } }],
    })
  })

  it('appends to the queue they have, keeping each step by its id', () => {
    const r = shiftQueue(idle, [walkHome])
    const request = appendRequest(r, { kind: 'walkTo', residentId: 'w1', x: 1, y: 1 })
    expect(request).toEqual({
      kind: 'editQueue',
      residentId: 'w1',
      steps: [
        { id: 1, order: { kind: 'walkTo', x: 9, y: 3 } },
        { order: { kind: 'walkTo', x: 1, y: 1 } },
      ],
    })
  })

  it('keeps a walk they are on as the first step', () => {
    const walking: Queued = {
      ...idle,
      order: { kind: 'walkTo', target: { x: 2, y: 2 }, path: null, progress: 0 },
    }
    expect(appendRequest(walking, walkHome)?.steps).toEqual([
      { order: { kind: 'walkTo', x: 2, y: 2 } },
      { order: { kind: 'walkTo', x: 9, y: 3 } },
    ])
  })

  it('puts a walk to their tile before an order acting there, so a loop finds them there', () => {
    expect(appendRequest(idle, work)?.steps).toEqual([
      { order: { kind: 'walkTo', x: 6, y: 6 } },
      { order: { kind: 'task', task: 'work', workplaceId: 'f1' } },
    ])
    // Already walking there as the step before: no second walk.
    const there = shiftQueue(idle, [{ kind: 'walkTo', residentId: 'w1', x: 6, y: 6 }])
    expect(appendRequest(there, work)?.steps).toHaveLength(2)
  })

  it('gives a step that never ends a duration once another follows it', () => {
    const r = shiftQueue(idle, [work])
    const request = appendRequest(r, { ...STORE_ALL, residentId: 'w1' })!
    expect(request.steps).toEqual([
      { id: 1, order: { kind: 'walkTo', x: 6, y: 6 } },
      {
        id: 2,
        order: { kind: 'task', task: 'work', workplaceId: 'f1' },
        minutes: QUEUE_DEFAULT_STEP_MINUTES,
      },
      { order: { kind: 'store', goods: STORE_ALL.goods } },
    ])
    expect(queueStepsProblem(request.steps)).toBeUndefined()
  })

  it('leaves orders that are no step as they are', () => {
    expect(appendRequest(idle, { kind: 'stop', residentId: 'w1' })).toBeUndefined()
    expect(appendRequest(idle, { kind: 'attack', residentId: 'w1', targetId: 'x1' })).toBe(
      undefined,
    )
  })

  it('appends for each of several residents', () => {
    const other: Queued = { ...idle, id: 'w2', x: 1, y: 1 }
    const requests = appendRequests([idle, other], (r) => ({ ...walkHome, residentId: r.id }))
    expect(requests.map((o) => [o.kind, o.residentId])).toEqual([
      ['queue', 'w1'],
      ['queue', 'w2'],
    ])
    const stops = appendRequests([idle], (r) => ({ kind: 'stop', residentId: r.id }))
    expect(stops).toEqual([{ kind: 'stop', residentId: 'w1' }])
  })
})

describe('the queue list', () => {
  // Work the farm, store, walk home: the browser check's round.
  const round = shiftQueue(idle, [work, { ...STORE_ALL, residentId: 'w1' }, walkHome])
  const q = { ...round.queue!, current: 1, loop: true }
  const names = { buildings: [{ id: 'f1', kind: 'farm' as const }] }

  it('lists the steps, the current one, durations and real time', () => {
    expect(queueRows(q, names)).toEqual([
      { id: 1, label: 'Walk to 6, 6', current: false, endless: false },
      {
        id: 2,
        label: 'Work the farm',
        current: true,
        minutes: QUEUE_DEFAULT_STEP_MINUTES,
        real: '1 min',
        endless: true,
      },
      { id: 3, label: 'Store what they carry', current: false, endless: false },
      { id: 4, label: 'Walk to 9, 3', current: false, endless: false },
    ])
    expect(q.loop).toBe(true)
  })

  it('reorders, removes and times steps by id', () => {
    expect(moveStep(q, 4, -1).map((s) => s.id)).toEqual([1, 2, 4, 3])
    expect(moveStep(q, 1, -1).map((s) => s.id)).toEqual([1, 2, 3, 4])
    expect(dropStep(q, 4, 1).map((s) => s.id)).toEqual([4, 1, 2, 3])
    expect(removeStep(q, 3).map((s) => s.id)).toEqual([1, 2, 4])
    expect(timeStep(q, 2, 10)[1]).toMatchObject({ id: 2, minutes: 10 })
    expect(timeStep(q, 2, undefined)[1]).not.toHaveProperty('minutes')
  })

  it('gives work moved off the end a duration', () => {
    const last = shiftQueue(idle, [walkHome, work])
    const moved = moveStep(last.queue!, 3, -1)
    expect(moved.map((s) => [s.id, s.minutes])).toEqual([
      [1, undefined],
      [3, QUEUE_DEFAULT_STEP_MINUTES],
      [2, undefined],
    ])
    expect(queueStepsProblem(moved)).toBeUndefined()
  })
})

describe('step labels', () => {
  const buildings = [
    { id: 's1', kind: 'storage' as const },
    { id: 'b1', kind: 'stable' as const },
  ]
  it('names the place a planned step acts on', () => {
    expect(stepLabel({ ...STORE_ALL, to: 's1' }, { buildings })).toBe(
      'Store what they carry at the storage',
    )
    expect(stepLabel({ kind: 'fetch', goods: { wood: 5 }, from: 's1' }, { buildings })).toBe(
      'Fetch 5 wood from the storage',
    )
    expect(stepLabel({ kind: 'task', task: 'feedStable', stableId: 'b1' }, { buildings })).toBe(
      'Feed the stable',
    )
    expect(stepLabel({ kind: 'mount', horseId: 'h1' }, {})).toBe('Mount a horse')
  })
})
