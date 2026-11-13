import { QUEUE_DEFAULT_STEP_MINUTES } from '@csp/balance'
import { queueStepsProblem } from './shared/queue.js'
import type { OrderRequest, Queue } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import {
  appendRequest,
  appendRequests,
  appendToEach,
  clearedItems,
  draftEdit,
  draftFor,
  editPlan,
  EMPTY_PLAN,
  givePlan,
  giveToAll,
  planOf,
  planStep,
  queueRows,
  showsMinutes,
  stepGroup,
  STORE_ALL,
  stepLabel,
  type Queued,
} from './queue-view.js'
import { dropItem, idsOf, moveItem, removeItem, timeItem, unroll } from './plan-blocks.js'

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
      { id: 1, label: 'Walk to 6, 6', current: false, endless: false, group: 'move' },
      {
        id: 2,
        label: 'Work the farm',
        current: true,
        minutes: QUEUE_DEFAULT_STEP_MINUTES,
        real: '1 min',
        endless: true,
        group: 'work',
      },
      { id: 3, label: 'Store what they carry', current: false, endless: false, group: 'goods' },
      { id: 4, label: 'Walk to 9, 3', current: false, endless: false, group: 'move' },
    ])
    expect(q.loop).toBe(true)
  })

  it('lists boarding and getting off a carriage', () => {
    // Board at the carriage, run along, get off: the Shift-queued passenger's plan.
    const r = shiftQueue(idle, [
      { kind: 'board', residentId: 'w1', carriageId: 'k1' },
      { kind: 'getOff', residentId: 'w1' },
      { kind: 'getOff', residentId: 'w1', x: 20, y: 7 },
    ])
    expect(queueRows(r.queue!).map((row) => row.label)).toEqual([
      'Walk to 6, 6',
      'Board the carriage',
      'Get off',
      'Get off at 20, 7',
    ])
  })

  it('reorders, removes and times steps by id', () => {
    const steps = planOf(q).items
    expect(idsOf(moveItem(steps, 4, -1))).toEqual([1, 2, 4, 3])
    expect(idsOf(moveItem(steps, 1, -1))).toEqual([1, 2, 3, 4])
    expect(idsOf(dropItem(steps, 4, 1))).toEqual([4, 1, 2, 3])
    expect(idsOf(removeItem(steps, 3))).toEqual([1, 2, 4])
    expect(timeItem(steps, 2, 10)[1]).toMatchObject({ id: 2, minutes: 10 })
    expect(timeItem(steps, 2, undefined)[1]).not.toHaveProperty('minutes')
  })

  it('gives work moved off the end a duration', () => {
    const last = shiftQueue(idle, [walkHome, work])
    const moved = unroll(moveItem(planOf(last.queue!).items, 3, -1))
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

  it('names a Build line step’s road or wall and both its ends', () => {
    const line = { building: 'road', from: { x: 3, y: 4 }, to: { x: 8, y: 4 } }
    expect(stepLabel({ kind: 'task', task: 'buildLine', ...line }, {})).toBe(
      'Build a road line from 3, 4 to 8, 4',
    )
  })

  it('names a place out of sight as last seen', () => {
    const lastSeen = [{ id: 'm2', kind: 'mine' as const }]
    expect(stepLabel({ kind: 'task', task: 'work', workplaceId: 'm2' }, { lastSeen })).toBe(
      'Work the mine (as last seen)',
    )
  })

  it('names the waypoint a step at its tile goes to', () => {
    const waypoints = [{ name: 'Pass', x: 12, y: 6 }]
    expect(stepLabel({ kind: 'walkTo', x: 12, y: 6 }, { waypoints })).toBe('Walk to Pass')
    expect(stepLabel({ kind: 'walkTo', x: 12, y: 7 }, { waypoints })).toBe('Walk to 12, 7')
    // A removed waypoint leaves the step where it was: its tile.
    expect(stepLabel({ kind: 'walkTo', x: 12, y: 6 }, {})).toBe('Walk to 12, 6')
  })

  it('names a building at a step’s tile with its city, and its city on a step acting on it', () => {
    const cities = [{ id: 'c1', name: 'Quarrytown IV' }]
    const farm = { id: 'f1', kind: 'farm' as const, x: 10, y: 20, cityId: 'c1' }
    // A farm covers more than its corner tile.
    expect(stepLabel({ kind: 'walkTo', x: 11, y: 21 }, { buildings: [farm], cities })).toBe(
      'Walk to Farm, Quarrytown IV',
    )
    expect(
      stepLabel({ kind: 'task', task: 'work', workplaceId: 'f1' }, { buildings: [farm], cities }),
    ).toBe('Work the farm in Quarrytown IV')
    expect(
      stepLabel(
        { ...STORE_ALL, to: 's1' },
        { buildings: [{ ...buildings[0]!, cityId: 'c1' }], cities },
      ),
    ).toBe('Store what they carry at the storage in Quarrytown IV')
    // One out of sight is named as last seen; one with no city known, without it.
    expect(stepLabel({ kind: 'walkTo', x: 10, y: 20 }, { lastSeen: [farm], cities })).toBe(
      'Walk to Farm, Quarrytown IV (as last seen)',
    )
    expect(stepLabel({ kind: 'walkTo', x: 10, y: 20 }, { buildings: [farm] })).toBe('Walk to Farm')
    // A waypoint on the tile goes first; a bare tile falls back to coordinates.
    const waypoints = [{ name: 'Gate', x: 10, y: 20 }]
    expect(stepLabel({ kind: 'walkTo', x: 10, y: 20 }, { buildings: [farm], waypoints })).toBe(
      'Walk to Gate',
    )
    expect(stepLabel({ kind: 'walkTo', x: 40, y: 40 }, { buildings: [farm], cities })).toBe(
      'Walk to 40, 40',
    )
  })

  it('names the city a Relocate step goes to', () => {
    const cities = [{ id: 'c2', name: 'Redbank' }]
    expect(stepLabel({ kind: 'relocate', cityId: 'c2' }, { cities })).toBe('Relocate to Redbank')
    expect(stepLabel({ kind: 'relocate', cityId: 'c9' }, { cities })).toBe(
      'Relocate to another city',
    )
  })
})

describe('the group planner', () => {
  // Walk to the far mine, work it, store at the outpost storage: the epic's plan.
  const mine = { x: 30, y: 4 }
  const workMine: OrderRequest = { kind: 'task', task: 'work', workplaceId: 'm1' }
  const store: OrderRequest = { kind: 'store', goods: STORE_ALL.goods, to: 's9' }
  const plan = planStep(planStep(EMPTY_PLAN, workMine, mine), store)
  const members: Queued[] = [
    idle,
    { id: 'w2', x: 1, y: 1, order: null },
    shiftQueue({ ...idle, id: 'w3' }, [{ kind: 'walkTo', residentId: 'w3', x: 2, y: 2 }]),
  ]

  it('plans a step acting on a place after a walk there, and times one that never ends', () => {
    expect(plan.items).toEqual([
      { id: 1, order: { kind: 'walkTo', ...mine } },
      { id: 2, order: workMine, minutes: QUEUE_DEFAULT_STEP_MINUTES },
      { id: 3, order: store },
    ])
  })

  it('edits the plan as the queue list does, keeping its ids', () => {
    const looped = editPlan(plan, removeItem(plan.items, 3), true)
    expect(idsOf(looped.items)).toEqual([1, 2])
    expect(looped.loop).toBe(true)
    // A step added after a removal gets a fresh id.
    expect(planStep(looped, store).items.at(-1)!.id).toBe(4)
  })

  it('Give to all unrolls repeat blocks into plain steps', () => {
    const repeated = editPlan(plan, [{ repeat: 3, items: plan.items }])
    const [request] = giveToAll(repeated, members.slice(0, 1))
    const steps = request!.steps as { order: OrderRequest }[]
    expect(steps).toHaveLength(9)
    expect(steps.map((s) => s.order).slice(3, 6)).toEqual([
      { kind: 'walkTo', ...mine },
      workMine,
      store,
    ])
    expect(queueStepsProblem(steps)).toBeUndefined()
  })

  it('Give to all sends one queue request per member with the same steps', () => {
    const requests = giveToAll({ ...plan, loop: true }, members)
    expect(requests.map((o) => [o.kind, o.residentId])).toEqual([
      ['queue', 'w1'],
      ['queue', 'w2'],
      ['queue', 'w3'],
    ])
    const steps = [
      { order: { kind: 'walkTo', ...mine } },
      { order: workMine, minutes: QUEUE_DEFAULT_STEP_MINUTES },
      { order: store },
    ]
    for (const o of requests) {
      expect(o.steps).toEqual(steps)
      expect(o.loop).toBe(true)
      expect(queueStepsProblem(o.steps)).toBeUndefined()
    }
  })

  it('Give to all gives each member the same Build line, with no walk before it', () => {
    const line = { building: 'wall', from: { x: 30, y: 10 }, to: { x: 34, y: 14 } }
    const buildLine: OrderRequest = { kind: 'task', task: 'buildLine', ...line }
    const requests = giveToAll(planStep(EMPTY_PLAN, buildLine), members.slice(0, 2))
    for (const o of requests) expect(o.steps).toEqual([{ order: buildLine }])
  })

  it('appending to a group adds the step after each member’s own steps', () => {
    const requests = appendToEach(members, workMine, mine)
    const walkMine = { order: { kind: 'walkTo', ...mine } }
    const step = { order: workMine }
    expect(requests).toEqual([
      { kind: 'queue', residentId: 'w1', steps: [walkMine, step] },
      { kind: 'queue', residentId: 'w2', steps: [walkMine, step] },
      {
        kind: 'editQueue',
        residentId: 'w3',
        steps: [{ id: 1, order: { kind: 'walkTo', x: 2, y: 2 } }, walkMine, step],
      },
    ])
  })
})

describe('the queue draft', () => {
  // A looped three-step draft for an idle resident: walk to the mine, work it, store.
  const mine = { x: 30, y: 4 }
  const workMine: OrderRequest = { kind: 'task', task: 'work', workplaceId: 'm1' }
  const store: OrderRequest = { kind: 'store', goods: STORE_ALL.goods, to: 's9' }

  it('collects steps added for a resident with no queue, giving nothing until Start queue', () => {
    expect(draftFor(idle, undefined)).toEqual(EMPTY_PLAN)
    // Steps go onto the open draft; the resident still has no queue and no order was made.
    const built = planStep(planStep(draftFor(idle, undefined)!, workMine, mine), store)
    const open = editPlan(built, built.items, true)
    expect(draftFor(idle, open)).toBe(open)
    expect(idle.queue).toBeUndefined()
    expect(unroll(open.items)).toHaveLength(3)
    // Start queue gives it as a new looped queue.
    expect(givePlan(idle, open)).toEqual({
      kind: 'queue',
      residentId: 'w1',
      steps: [
        { order: { kind: 'walkTo', ...mine } },
        { order: workMine, minutes: QUEUE_DEFAULT_STEP_MINUTES },
        { order: store },
      ],
      loop: true,
    })
  })

  it('opens a draft for a paste or load into a resident with no queue', () => {
    const draft = draftEdit(idle, [{ order: walkHome }, { order: store }])
    expect(draft?.items.map((s) => ('order' in s ? s.order.kind : 'block'))).toEqual([
      'walkTo',
      'store',
    ])
  })

  it('edits a running queue live, unless a repeat block is in it', () => {
    const running = shiftQueue(idle, [walkHome, work])
    expect(draftFor(running, undefined)).toBeUndefined()
    const steps = planOf(running.queue!).items
    expect(draftEdit(running, steps.slice(1))).toBeUndefined()
    const wrapped = draftEdit(running, [{ repeat: 2, items: steps }])
    expect(wrapped?.nextStepId).toBe(running.queue!.nextStepId + 1)
  })

  it('Edit as draft leaves the running queue untouched until Start queue', () => {
    const running = shiftQueue(idle, [walkHome, work, { ...walkHome, x: 1 }])
    const queue = structuredClone(running.queue!)
    let draft = planOf(running.queue!)
    // Steps added and removed go onto the draft, never to the server.
    expect(draftFor(running, draft)).toBe(draft)
    draft = planStep(draft, store)
    draft = editPlan(draft, removeItem(draft.items, 1), true)
    expect(running.queue).toEqual(queue)
    // Start queue replaces it; the steps it keeps keep their ids, so the current one goes on.
    const started = givePlan(running, draft)
    expect(started.kind).toBe('editQueue')
    const kept = running.queue!.steps.slice(1).map((s) => s.id)
    expect((started.steps as { id?: number }[]).map((s) => s.id)).toEqual([...kept, undefined])
    expect(started.loop).toBe(true)
  })

  it('still queues an order given with Shift at once', () => {
    expect(appendRequest(idle, walkHome)?.kind).toBe('queue')
    const running = shiftQueue(idle, [walkHome])
    expect(appendRequest(running, work)?.kind).toBe('editQueue')
  })
})

describe('Clear', () => {
  const store: OrderRequest = { kind: 'store', goods: STORE_ALL.goods, to: 's9' }

  it('empties a draft', () => {
    const built = planStep(planStep(EMPTY_PLAN, walkHome), store)
    // A draft has no current step, even one copied from a running queue.
    expect(editPlan(built, clearedItems(built.items)).items).toEqual([])
  })

  it('keeps only the current step of a running looped queue and turns loop off', () => {
    const five = shiftQueue(idle, [
      walkHome,
      { ...walkHome, x: 1 },
      { ...walkHome, x: 2 },
      { ...walkHome, x: 3 },
      { ...walkHome, x: 4 },
    ])
    const running = { ...five, queue: { ...five.queue!, loop: true, current: 2 } }
    const current = running.queue.steps[2]!
    const items = clearedItems(planOf(running.queue).items, current.id)
    expect(givePlan(running, { items, loop: false })).toEqual({
      kind: 'editQueue',
      residentId: 'w1',
      steps: [{ id: current.id, order: current.order }],
      loop: false,
    })
  })

  it('empties a group plan', () => {
    const plan = planStep(planStep(EMPTY_PLAN, walkHome), store)
    expect(editPlan(plan, clearedItems(plan.items)).items).toEqual([])
  })
})

describe('the duration chip', () => {
  const step = (minutes: number | undefined, endless: boolean) => ({ minutes, endless })
  it('shows when a step has a duration', () => {
    expect(showsMinutes(step(10, false), false)).toBe(true)
    expect(showsMinutes(step(10, true), true)).toBe(true)
  })
  it('shows when a step that never ends needs one, not being last', () => {
    expect(showsMinutes(step(undefined, true), false)).toBe(true)
    expect(showsMinutes(step(undefined, true), true)).toBe(false)
  })
  it('hides on a step that ends on its own with none', () => {
    expect(showsMinutes(step(undefined, false), false)).toBe(false)
  })
  it('groups steps by the Orders tab kind for their icon', () => {
    expect(stepGroup({ kind: 'walkTo', x: 1, y: 1 })).toBe('move')
    expect(stepGroup({ kind: 'task', task: 'explore' })).toBe('move')
    expect(stepGroup(STORE_ALL)).toBe('goods')
    expect(stepGroup({ kind: 'task', task: 'work', workplaceId: 'f1' })).toBe('work')
    expect(stepGroup({ kind: 'runScript', scriptId: 'x' })).toBe('scripts')
  })
})

describe('adding a step between two others', () => {
  const store: OrderRequest = { kind: 'store', goods: STORE_ALL.goods, to: 's9' }
  const fetch: OrderRequest = { kind: 'fetch', goods: { wood: 5 }, from: 's9' }
  const storage = { x: 20, y: 20 }
  const three = planStep(planStep(planStep(EMPTY_PLAN, walkHome), store), { kind: 'dismount' })

  it('puts it after the insert point, keeping the rest', () => {
    // A Fetch walks to its storage itself.
    const placed = planStep(three, fetch, storage, 1)
    expect(unroll(placed.items).map((s) => [s.id, s.order.kind])).toEqual([
      [1, 'walkTo'],
      [4, 'fetch'],
      [2, 'store'],
      [3, 'dismount'],
    ])
  })

  it('puts a walk before a step done on its tile, unless the step before walks there', () => {
    const pickUp: OrderRequest = { kind: 'pickUp', goods: { wood: 5 } }
    expect(unroll(planStep(three, pickUp, storage, 1).items).map((s) => s.order.kind)).toEqual([
      'walkTo',
      'walkTo',
      'pickUp',
      'store',
      'dismount',
    ])
    const atStorage = planStep(EMPTY_PLAN, { kind: 'walkTo', ...storage })
    const two = planStep(atStorage, { kind: 'dismount' })
    const placed = planStep(two, pickUp, storage, 1)
    expect(unroll(placed.items).map((s) => s.order.kind)).toEqual(['walkTo', 'pickUp', 'dismount'])
  })

  it('goes into a running queue as one edit with the step in place', () => {
    const running = shiftQueue(idle, [walkHome, { kind: 'dismount', residentId: 'w1' }])
    const placed = planStep(planOf(running.queue!), store, undefined, 1)
    const request = givePlan(running, placed)
    expect(request.kind).toBe('editQueue')
    expect((request.steps as { order: OrderRequest }[]).map((s) => s.order.kind)).toEqual([
      'walkTo',
      'store',
      'dismount',
    ])
  })
})

describe('a step acting on no place', () => {
  const explore: OrderRequest = { kind: 'task', task: 'explore' }

  it('adds Explore to an empty queue as one step, with no walk before it', () => {
    expect(planStep(EMPTY_PLAN, explore).items).toEqual([{ id: 1, order: explore }])
    expect(appendRequest(idle, { ...explore, residentId: 'w1' })).toEqual({
      kind: 'queue',
      residentId: 'w1',
      steps: [{ order: explore }],
    })
  })

  it('adds Dismount, Get off and Run script with no walk either', () => {
    for (const order of [
      { kind: 'dismount' },
      { kind: 'getOff' },
      { kind: 'runScript', scriptId: 's' },
    ] as OrderRequest[])
      expect(appendRequest(idle, { ...order, residentId: 'w1' })?.steps).toEqual([{ order }])
  })
})
