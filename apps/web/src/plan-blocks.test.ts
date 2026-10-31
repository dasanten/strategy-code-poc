import {
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_MAX_STEPS,
  queueStepsProblem,
  type OrderRequest,
  type Queue,
  type QueueStepRequest,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  canMove,
  capProblem,
  dropItem,
  idsOf,
  insertItems,
  lastPicked,
  moveItem,
  planProblem,
  planRows,
  removeItem,
  setRepeat,
  stepCount,
  timedItems,
  timeItem,
  topPicked,
  unroll,
  unwrap,
  withIds,
  wrap,
  type PlanItem,
} from './plan-blocks.js'
import { editPlan, givePlan, planOf } from './queue-view.js'

/** Repeat blocks (`CONTEXT.md`: Repeat block): wrapped steps, unrolled when the queue is given. */

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

const orders = (steps: readonly { order: OrderRequest }[]) => steps.map((s) => s.order)

describe('unrolling', () => {
  it('makes a block that many plain copies of its steps, in a row', () => {
    const plan = wrap(run, [3, 4], 5)!
    expect(stepCount(plan)).toBe(12)
    const steps = unroll(plan)
    expect(steps).toHaveLength(12)
    expect(orders(steps.slice(2, 6))).toEqual([walk(9, 3), store, walk(9, 3), store])
    // Steps only: no block reaches the queue.
    expect(steps.every((s) => 'order' in s && !('repeat' in s))).toBe(true)
    expect(queueStepsProblem(steps)).toBeUndefined()
  })

  it('keeps ids on the first copy only, so whoever keeps the queue numbers the rest', () => {
    const steps = unroll(wrap(run, [1, 2], 3)!)
    expect(steps.map((s) => s.id)).toEqual([1, 2, undefined, undefined, undefined, undefined, 3, 4])
  })

  it('unrolls nested blocks, inner ones each time round the outer', () => {
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
    expect(stepCount(outer)).toBe(3 * (1 + 2 + 1) + 1)
    expect(orders(unroll(outer).slice(0, 5))).toEqual([
      walk(30, 4),
      work,
      work,
      walk(9, 3),
      walk(30, 4),
    ])
    expect(orders(unroll(outer)).at(-1)).toEqual(store)
  })

  it('a block repeated once is its steps, and copies share nothing', () => {
    const once = setRepeat(withIds(wrap(run, [1, 2])!, 5).items, 5, 1)
    expect(unroll(once)).toEqual(run)
    const steps = unroll(withIds(wrap(run, [1])!, 5).items)
    steps[1]!.order.x = 99
    expect(steps[0]!.order.x).toBe(30)
    expect(run[0]!.order).toEqual(walk(30, 4))
  })

  it('gives work repeated after itself a duration, as a step followed by another', () => {
    const plan: PlanItem[] = [{ repeat: 3, items: [{ order: work }] }]
    const steps = unroll(plan)
    expect(steps.map((s) => s.minutes)).toEqual([
      QUEUE_DEFAULT_STEP_MINUTES,
      QUEUE_DEFAULT_STEP_MINUTES,
      undefined,
    ])
    expect(queueStepsProblem(steps)).toBeUndefined()
    // The planner shows it too: only the very last step may go without one.
    expect(timedItems(plan)).toEqual([
      { repeat: 3, items: [{ order: work, minutes: QUEUE_DEFAULT_STEP_MINUTES }] },
    ])
    expect(timedItems([{ order: walk(1, 1) }, { order: work }])).toEqual([
      { order: walk(1, 1) },
      { order: work },
    ])
  })
})

describe('the cap', () => {
  it('counts the steps after repeats against what a queue holds, saying by how much', () => {
    const fits: PlanItem[] = [{ repeat: QUEUE_MAX_STEPS / 2, items: run.slice(2) }]
    expect(stepCount(fits)).toBe(QUEUE_MAX_STEPS)
    expect(capProblem(fits)).toBeUndefined()
    expect(planProblem(fits)).toBeUndefined()
    const over: PlanItem[] = [...fits, { order: walk(1, 1) }, { order: walk(2, 2) }]
    expect(capProblem(over)).toBe(
      `${QUEUE_MAX_STEPS + 2} steps after repeats, 2 more than a queue holds (${QUEUE_MAX_STEPS})`,
    )
    expect(planProblem(over)).toBe(capProblem(over))
    // Unrolled, the server would refuse it just so.
    expect(queueStepsProblem(unroll(over))).toBe(`a queue holds at most ${QUEUE_MAX_STEPS} steps`)
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

  it('sets the count, at least once', () => {
    expect(stepCount(setRepeat(plan, 5, 4))).toBe(2 + 8)
    expect(stepCount(setRepeat(plan, 5, 0))).toBe(2 + 2)
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
    expect(unroll(timed).filter((s) => s.minutes === 15)).toHaveLength(2)
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
    steps: run,
    current: 1,
    startedAt: 0,
    loop: false,
    nextStepId: 5,
  }
  const r = { id: 'w1', queue }

  it('edits the queue to the steps unrolled, keeping the ones it has', () => {
    // Repeat x5 the walk home and store, as the epic plans it.
    const plan = editPlan(
      planOf(queue),
      setRepeat(withIds(wrap(planOf(queue).items, [3, 4])!, 5).items, 5, 5),
    )
    const order = givePlan(r, plan)
    expect(order.kind).toBe('editQueue')
    const steps = order.steps as { id?: number; order: OrderRequest }[]
    expect(steps).toHaveLength(2 + 10)
    // The current step (2) keeps its id, so it keeps going; the copies get new ones from the server.
    expect(steps.map((s) => s.id)).toEqual([1, 2, 3, 4, ...Array(8).fill(undefined)])
    expect(queueStepsProblem(steps)).toBeUndefined()
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
    expect((givePlan(r, plan).steps as { id?: number }[]).map((s) => s.id)).toEqual([
      2,
      undefined,
      undefined,
      undefined,
    ])
    const ended = givePlan({ id: 'w1' }, plan)
    expect(ended).toMatchObject({ kind: 'queue', residentId: 'w1' })
    expect((ended.steps as { id?: number }[]).every((s) => s.id === undefined)).toBe(true)
  })
})
