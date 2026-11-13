import {
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_MAX_DEPTH,
  QUEUE_MAX_REPEAT,
  QUEUE_MAX_STEPS,
} from '@csp/balance'
import { queueStepsProblem } from './shared/queue.js'
import type { Condition, OrderRequest, Queue, QueueStepRequest } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import {
  canMove,
  capProblem,
  depthOf,
  dropItem,
  idsOf,
  insertItems,
  intoElse,
  itemCount,
  lastPicked,
  moveItem,
  planProblem,
  planRows,
  planSteps,
  removeItem,
  setCondition,
  setRepeat,
  stepCount,
  timedItems,
  timeItem,
  topPicked,
  unwrap,
  withIds,
  wrap,
  type PlanItem,
} from './plan-blocks.js'
import { branchesOf, editPlan, givePlan, planOf, roundsOf } from './queue-view.js'

/** Repeat blocks (`CONTEXT.md`: Repeat block, ADR 0032): wrapped steps the queue keeps as blocks. */

const walk = (x: number, y: number): OrderRequest => ({ kind: 'walkTo', x, y })
const work: OrderRequest = { kind: 'task', task: 'work', workplaceId: 'm1' }
const store: OrderRequest = { kind: 'store', goods: ['stone'], to: 's1' }

// Walk to the mine, work it, walk home, store: ids 1 to 4.
const run: (QueueStepRequest & { id: number })[] = [
  { id: 1, order: walk(30, 4) },
  { id: 2, order: work, minutes: 60 },
  { id: 3, order: walk(9, 3) },
  { id: 4, order: store },
]

describe('blocks as written', () => {
  it('keeps a block as one, its steps once, whatever it repeats', () => {
    const plan = wrap(run, [3, 4], 100)!
    expect(stepCount(plan)).toBe(4)
    expect(itemCount(plan)).toBe(5)
    expect(planSteps(plan).map((s) => s.id)).toEqual([1, 2, 3, 4])
    // The server takes the block as it is.
    expect(queueStepsProblem(plan)).toBeUndefined()
  })

  it('nests blocks, and counts how deep', () => {
    // (walk, (work) x2, walk home) x3, store.
    const inner = withIds(wrap(run, [2], 2)!, 5).items
    const outer = withIds(wrap(inner, [1, 5, 3], 3)!, 6).items
    expect(planRows(outer).map((r) => [r.kind, r.depth])).toEqual([
      ['block', 0],
      ['step', 1],
      ['block', 1],
      ['step', 2],
      ['step', 1],
      ['step', 0],
    ])
    expect(depthOf(outer)).toBe(2)
    expect(itemCount(outer)).toBe(6)
  })

  it('gives work repeated after itself a duration, as a step followed by another', () => {
    const plan: PlanItem[] = [{ repeat: 3, items: [{ order: work }] }]
    expect(queueStepsProblem(plan)).toBe(
      'step 1 never ends on its own: give it a duration or make it the last',
    )
    // The planner gives it one: only the very last step may go without.
    const timed = timedItems(plan)
    expect(timed).toEqual([
      { repeat: 3, items: [{ order: work, minutes: QUEUE_DEFAULT_STEP_MINUTES }] },
    ])
    expect(queueStepsProblem(timed)).toBeUndefined()
    expect(timedItems([{ repeat: 'forever', items: [{ order: work }] }])).toEqual([
      { repeat: 'forever', items: [{ order: work, minutes: QUEUE_DEFAULT_STEP_MINUTES }] },
    ])
    expect(timedItems([{ order: walk(1, 1) }, { order: work }])).toEqual([
      { order: walk(1, 1) },
      { order: work },
    ])
  })
})

describe('the cap', () => {
  it('counts steps and blocks as written against what a queue holds, saying by how much', () => {
    const steps = (n: number): PlanItem[] =>
      Array.from({ length: n }, (_, i) => ({ order: walk(i, 1) }))
    // A block of many rounds counts once.
    const fits: PlanItem[] = [{ repeat: QUEUE_MAX_REPEAT, items: steps(QUEUE_MAX_STEPS - 1) }]
    expect(itemCount(fits)).toBe(QUEUE_MAX_STEPS)
    expect(capProblem(fits)).toBeUndefined()
    expect(planProblem(fits)).toBeUndefined()
    const over: PlanItem[] = [...fits, ...steps(2)]
    expect(capProblem(over)).toBe(
      `${QUEUE_MAX_STEPS + 2} steps and blocks, 2 more than a queue holds (${QUEUE_MAX_STEPS})`,
    )
    expect(planProblem(over)).toBe(capProblem(over))
    // The server would refuse it just so.
    expect(queueStepsProblem(over)).toBe(
      `a queue holds at most ${QUEUE_MAX_STEPS} steps and blocks`,
    )
  })

  it('refuses blocks nested too deep, a count out of range and an empty block', () => {
    let deep: PlanItem[] = [{ order: walk(1, 1) }]
    for (let i = 0; i <= QUEUE_MAX_DEPTH; i++) deep = [{ repeat: 2, items: deep }]
    expect(capProblem(deep)).toBe(
      `blocks nested ${QUEUE_MAX_DEPTH + 1} deep, deeper than a queue allows (${QUEUE_MAX_DEPTH})`,
    )
    expect(queueStepsProblem(deep)).toBe(`blocks nest at most ${QUEUE_MAX_DEPTH} deep`)
    const count = `a repeat block repeats from 1 to ${QUEUE_MAX_REPEAT} times, or forever`
    expect(queueStepsProblem([{ repeat: 0, items: [{ order: walk(1, 1) }] }])).toBe(count)
    expect(queueStepsProblem([{ repeat: 'always', items: [{ order: walk(1, 1) }] }])).toBe(count)
    expect(queueStepsProblem([{ repeat: 2, items: [] }])).toBe('a repeat block needs a step')
  })

  it('refuses an empty plan, and one a step of which the server would refuse', () => {
    expect(planProblem([])).toBe('no steps yet')
    expect(planProblem([{ repeat: 2, items: [{ order: { kind: 'attack' } }] }])).toBe(
      "step 1: attack can't be a queue step",
    )
  })
})

describe('editing blocks', () => {
  // Steps 1 to 4 with 3 and 4 in block 5, repeated twice.
  const plan = withIds(wrap(run, [3, 4])!, 5).items

  it('wraps only steps in a row in one list', () => {
    expect(wrap(run, [1, 3])).toBeUndefined()
    expect(wrap(run, [])).toBeUndefined()
    // A step inside a block and one outside it are not in one list.
    expect(wrap(plan, [2, 3])).toBeUndefined()
    // Within a block they are; the inner block nests.
    expect(planRows(withIds(wrap(plan, [3])!, 6).items).map((r) => [r.id, r.depth])).toEqual([
      [1, 0],
      [2, 0],
      [5, 0],
      [6, 1],
      [3, 2],
      [4, 1],
    ])
  })

  it('picks a block as one: its steps go with it', () => {
    expect(topPicked(plan, [5, 3, 4]).map((i) => i.id)).toEqual([5])
    expect(topPicked(plan, [2, 3]).map((i) => i.id)).toEqual([2, 3])
    // Picking a step and the block after it wraps both, nesting the block.
    expect(idsOf(withIds(wrap(plan, [2, 5, 3, 4])!, 6).items)).toEqual([1, 6, 2, 5, 3, 4])
  })

  it('unwraps a block into its steps where it was', () => {
    expect(unwrap(plan, 5)).toEqual(run)
  })

  it('sets the count, at least once and at most the cap, or forever', () => {
    const block = (items: PlanItem[]) => items.find((i) => i.id === 5)
    expect(block(setRepeat(plan, 5, 4))).toMatchObject({ repeat: 4 })
    expect(block(setRepeat(plan, 5, 0))).toMatchObject({ repeat: 1 })
    expect(block(setRepeat(plan, 5, QUEUE_MAX_REPEAT + 1))).toMatchObject({
      repeat: QUEUE_MAX_REPEAT,
    })
    expect(block(setRepeat(plan, 5, 'forever'))).toMatchObject({ repeat: 'forever' })
  })

  it('moves a block and a step within their own list', () => {
    expect(idsOf(moveItem(plan, 5, -1))).toEqual([1, 5, 3, 4, 2])
    expect(idsOf(moveItem(plan, 4, -1))).toEqual([1, 2, 5, 4, 3])
    // The last step of a block stays in it.
    expect(canMove(plan, 4, 1)).toBe(false)
    expect(idsOf(moveItem(plan, 4, 1))).toEqual(idsOf(plan))
    expect(canMove(plan, 1, -1)).toBe(false)
    expect(canMove(plan, 5, -1)).toBe(true)
  })

  it('drags a step into or out of a block, and never a block into itself', () => {
    // Dragged down, it goes after the step dropped on; dragged up, before it.
    expect(idsOf(dropItem(plan, 1, 3))).toEqual([2, 5, 3, 1, 4])
    expect(idsOf(dropItem(plan, 4, 1))).toEqual([4, 1, 2, 5, 3])
    expect(idsOf(dropItem(plan, 5, 1))).toEqual([5, 3, 4, 1, 2])
    expect(dropItem(plan, 5, 3)).toEqual(plan)
  })

  it('removes a block with its steps, and a block once its last step goes', () => {
    expect(idsOf(removeItem(plan, 5))).toEqual([1, 2])
    expect(idsOf(removeItem(removeItem(plan, 3), 4))).toEqual([1, 2])
  })

  it('times a step inside a block', () => {
    const timed = timeItem(plan, 3, 15)
    expect(
      planSteps(timed)
        .filter((s) => s.minutes === 15)
        .map((s) => s.id),
    ).toEqual([3])
  })

  it('pastes after the last picked item, into its list, or at the end', () => {
    const added: PlanItem[] = [{ repeat: 2, items: [{ order: walk(1, 1) }] }]
    expect(lastPicked(plan, [3, 1])).toBe(3)
    expect(planRows(withIds(insertItems(plan, 3, added), 6).items).map((r) => r.id)).toEqual([
      1, 2, 5, 3, 6, 7, 4,
    ])
    expect(idsOf(withIds(insertItems(plan, undefined, added), 6).items)).toEqual([
      1, 2, 5, 3, 4, 6, 7,
    ])
    expect(lastPicked(plan, [])).toBeUndefined()
  })

  it('gives new items ids past every id the plan has', () => {
    const given = withIds(
      [
        { id: 9, order: walk(0, 0) },
        { repeat: 2, items: [{ order: work }] },
      ],
      3,
    )
    expect(idsOf(given.items)).toEqual([9, 10, 11])
    expect(given.nextStepId).toBe(12)
  })
})

describe('giving a resident a plan', () => {
  /** A running queue of the run: ids 1 to 4, on the work step. */
  const queue: Queue = {
    realmId: 'r1',
    items: run,
    current: 2,
    startedAt: 0,
    loop: false,
    nextStepId: 5,
  }
  const r = { id: 'w1', queue }

  it('edits the queue to the plan, its blocks as they are, keeping the steps it has', () => {
    // Repeat x5 the walk home and store, as the epic plans it.
    const plan = editPlan(
      planOf(queue),
      setRepeat(withIds(wrap(planOf(queue).items, [3, 4])!, 5).items, 5, 5),
    )
    const order = givePlan(r, plan)
    expect(order.kind).toBe('editQueue')
    // The current step (2) keeps its id, so it keeps going; the block is new, so it has none.
    expect(order.steps).toEqual([
      { id: 1, order: walk(30, 4) },
      { id: 2, order: work, minutes: 60 },
      {
        repeat: 5,
        items: [
          { id: 3, order: walk(9, 3) },
          { id: 4, order: store },
        ],
      },
    ])
    expect(queueStepsProblem(order.steps)).toBeUndefined()
  })

  it('keeps a block the queue has by its id, so it keeps its round', () => {
    const withBlock: Queue = {
      ...queue,
      items: [run[0]!, { id: 5, repeat: 3, round: 2, items: [run[1]!] }],
      nextStepId: 6,
    }
    const order = givePlan({ id: 'w1', queue: withBlock }, planOf(withBlock))
    expect(order.steps).toEqual([
      { id: 1, order: walk(30, 4) },
      { id: 5, repeat: 3, items: [{ id: 2, order: work, minutes: 60 }] },
    ])
  })

  it('drops ids the queue has no longer, and starts a queue when it has ended', () => {
    const plan = {
      items: [
        {
          id: 7,
          repeat: 2,
          items: [
            { id: 2, order: work },
            { id: 8, order: store },
          ],
        },
      ],
    }
    expect(givePlan(r, plan).steps).toEqual([
      { repeat: 2, items: [{ id: 2, order: work }, { order: store }] },
    ])
    const ended = givePlan({ id: 'w1' }, plan)
    expect(ended).toMatchObject({ kind: 'queue', residentId: 'w1' })
    expect(ended.steps).toEqual([{ repeat: 2, items: [{ order: work }, { order: store }] }])
  })
})

describe('If blocks', () => {
  const hungry: Condition = { kind: 'need', need: 'hunger', side: 'below', share: 0.5 }
  const fetchFood: OrderRequest = { kind: 'fetch', goods: { food: 5 }, from: 's1' }

  it('wraps the picked steps under a condition, and moves others into its Else part', () => {
    const plan = withIds(wrap(run, [1, 2], hungry)!, 5).items
    expect(plan[0]).toEqual({ id: 5, if: hungry, items: [run[0], run[1]] })
    const withElse = intoElse(plan, [3], 5)!
    expect(withElse).toEqual([
      { id: 5, if: hungry, items: [run[0], run[1]], else: [run[2]] },
      run[3],
    ])
    // Not the block itself, nor what is in it.
    expect(intoElse(plan, [5], 5)).toBeUndefined()
    expect(intoElse(plan, [1], 5)).toBeUndefined()
    expect(planSteps(withElse).map((s) => s.id)).toEqual([1, 2, 3, 4])
    expect([itemCount(withElse), depthOf(withElse)]).toEqual([5, 1])
    expect(planProblem(withElse)).toBeUndefined()
    expect(planRows(withElse).map((r) => [r.kind, r.id, r.depth])).toEqual([
      ['if', 5, 0],
      ['step', 1, 1],
      ['step', 2, 1],
      ['step', 3, 1],
      ['step', 4, 0],
    ])
  })

  it('changes its condition, and unwraps into its items then its Else part', () => {
    const plan: PlanItem[] = [{ id: 5, if: hungry, items: [run[0]!], else: [run[1]!] }]
    const sated: Condition = { ...hungry, side: 'above' }
    expect(setCondition(plan, 5, sated)).toEqual([{ ...plan[0], if: sated }])
    expect(unwrap(plan, 5)).toEqual([run[0], run[1]])
  })

  it('drops an Else part left empty, and puts the Else steps in its place once its items go', () => {
    const plan: PlanItem[] = [{ id: 5, if: hungry, items: [run[0]!], else: [run[1]!] }]
    expect(removeItem(plan, 2)).toEqual([{ id: 5, if: hungry, items: [run[0]] }])
    expect(removeItem(plan, 1)).toEqual([run[1]])
  })

  it('gives ids to a block, then its items, then its Else part, as the server does', () => {
    const plan: PlanItem[] = [
      { if: hungry, items: [{ order: fetchFood }], else: [{ order: work, minutes: 60 }] },
    ]
    expect(idsOf(withIds(plan, 1).items)).toEqual([1, 2, 3])
  })

  it('times a step that never ends unless it is the last listed, the Else part counted last', () => {
    const plan: PlanItem[] = [{ if: hungry, items: [{ order: work }], else: [{ order: work }] }]
    const timed = timedItems(plan)
    expect(timed).toEqual([
      {
        if: hungry,
        items: [{ order: work, minutes: QUEUE_DEFAULT_STEP_MINUTES }],
        else: [{ order: work }],
      },
    ])
    expect(queueStepsProblem(timed)).toBeUndefined()
  })

  it('is checked as the server checks it', () => {
    const step = { order: walk(1, 1) }
    expect(queueStepsProblem([{ if: hungry, items: [step] }])).toBeUndefined()
    expect(queueStepsProblem([{ if: hungry, items: [] }])).toBe('an If block needs a step')
    expect(queueStepsProblem([{ if: hungry, items: [step], else: [] }])).toBe(
      "an If block's Else part needs a step",
    )
    expect(queueStepsProblem([{ if: { kind: 'weather' }, items: [step] }])).toBe(
      'an If block: that is no condition',
    )
    expect(queueStepsProblem([{ if: hungry, items: [step], repeat: 2 }])).toBe(
      'an If block holds only its id, condition, items and Else part',
    )
  })

  it('gives a resident the plan with its If blocks, and reads the part the queue runs', () => {
    const queue: Queue = {
      realmId: 'r1',
      items: [{ id: 5, if: hungry, items: [run[0]!], else: [run[1]!], branch: 'else' }],
      current: 2,
      startedAt: 0,
      loop: false,
      nextStepId: 6,
    }
    expect(planOf(queue).items).toEqual([{ id: 5, if: hungry, items: [run[0]], else: [run[1]] }])
    expect(givePlan({ id: 'w1', queue }, planOf(queue)).steps).toEqual([
      { id: 5, if: hungry, items: [run[0]], else: [run[1]] },
    ])
    expect([...branchesOf(queue)]).toEqual([[5, 'else']])
  })
})

describe('Repeat until', () => {
  const stocked: Condition = {
    kind: 'stock',
    placeId: 's1',
    good: 'food',
    compare: 'atLeast',
    amount: 100,
  }

  it('sets a block to repeat until a condition holds, and back to a count or forever', () => {
    const plan = withIds(wrap(run, [1, 2])!, 5).items
    const until = setRepeat(plan, 5, { until: stocked })
    expect(until[0]).toEqual({ id: 5, repeat: { until: stocked }, items: [run[0], run[1]] })
    expect(setRepeat(until, 5, 3)[0]).toMatchObject({ repeat: 3 })
    expect(setRepeat(until, 5, 'forever')[0]).toMatchObject({ repeat: 'forever' })
    // Its steps repeat, so work in it needs a duration unless it ends on its own.
    expect(timedItems([{ repeat: { until: stocked }, items: [{ order: work }] }])).toEqual([
      { repeat: { until: stocked }, items: [{ order: work, minutes: QUEUE_DEFAULT_STEP_MINUTES }] },
    ])
  })

  it('is checked as the server checks it', () => {
    const step = { order: walk(1, 1) }
    expect(queueStepsProblem([{ repeat: { until: stocked }, items: [step] }])).toBeUndefined()
    expect(queueStepsProblem([{ repeat: { until: { kind: 'weather' } }, items: [step] }])).toBe(
      'a Repeat until: that is no condition',
    )
    expect(queueStepsProblem([{ repeat: {}, items: [step] }])).toBe(
      'a Repeat until needs a condition',
    )
    expect(queueStepsProblem([{ repeat: { until: stocked, times: 2 }, items: [step] }])).toBe(
      'a Repeat until holds only its condition',
    )
    expect(queueStepsProblem([{ repeat: [], items: [step] }])).toBe(
      `a repeat block repeats from 1 to ${QUEUE_MAX_REPEAT} times, or forever`,
    )
  })

  it('reads the round a running Repeat until is on, with no count', () => {
    const queue: Queue = {
      realmId: 'r1',
      items: [{ id: 5, repeat: { until: stocked }, items: [run[0]!], round: 7 }],
      current: 1,
      startedAt: 0,
      loop: false,
      nextStepId: 6,
    }
    expect(planOf(queue).items).toEqual([{ id: 5, repeat: { until: stocked }, items: [run[0]] }])
    expect([...roundsOf(queue)]).toEqual([[5, 7]])
  })
})
