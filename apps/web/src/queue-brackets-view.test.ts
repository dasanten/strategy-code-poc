import { QUEUE_MAX_STEPS } from '@csp/balance'
import type { OrderRequest } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import { capProblem, idsOf, stepCount, type PlanItem } from './plan-blocks.js'
import { canMoveTo, insertPoints, moveItems } from './queue-brackets-view.js'

/** The planner's brackets (`CONTEXT.md`: Planner blocks, Repeat block). */

const walk = (id: number): PlanItem => ({ id, order: { kind: 'walkTo', x: id, y: 0 } })
const block = (id: number, items: PlanItem[], repeat = 2): PlanItem => ({ id, repeat, items })

/** The items as nested ids: a block as [its id, its items]. */
const shape = (items: readonly PlanItem[]): unknown[] =>
  items.map((item) => ('items' in item ? [item.id, shape(item.items)] : item.id))

// Walk 1, a repeat block 10 of walks 2 and 3, walk 4.
const plan = [walk(1), block(10, [walk(2), walk(3)]), walk(4)]

describe('the "+" points', () => {
  it('follow every step and block but the last, inside a block at its end too', () => {
    expect(insertPoints(plan)).toEqual([1, 2, 3, 10])
    expect(insertPoints([walk(1)])).toEqual([])
    // A block last in the queue still has one after its own last step.
    expect(insertPoints([walk(1), block(10, [walk(2)])])).toEqual([1, 2])
  })
})

describe('moving picked steps and blocks', () => {
  it('drops a step into a block', () => {
    expect(shape(moveItems(plan, [4], 2))).toEqual([1, [10, [2, 4, 3]]])
    // At the block's end: after its last step.
    expect(shape(moveItems(plan, [1], 3))).toEqual([[10, [2, 3, 1]], 4])
  })

  it('drops a step out of a block', () => {
    expect(shape(moveItems(plan, [2], 4))).toEqual([1, [10, [3]], 4, 2])
    expect(shape(moveItems(plan, [3], 1))).toEqual([1, 3, [10, [2]], 4])
    // To the end of the queue.
    expect(shape(moveItems(plan, [2], undefined))).toEqual([1, [10, [3]], 4, 2])
  })

  it('drops a block, with its steps, into another block', () => {
    const two = [...plan, block(20, [walk(5)])]
    expect(shape(moveItems(two, [20], 2))).toEqual([1, [10, [2, [20, [5]], 3]], 4])
  })

  it('moves several picked as they were listed, a picked block as one', () => {
    expect(shape(moveItems(plan, [1, 10], 4))).toEqual([4, 1, [10, [2, 3]]])
    // A step picked inside a picked block goes with its block.
    expect(shape(moveItems(plan, [10, 2], 4))).toEqual([1, 4, [10, [2, 3]]])
  })

  it('never puts a block into itself or a step after itself', () => {
    expect(canMoveTo(plan, [10], 2)).toBe(false)
    expect(canMoveTo(plan, [1], 1)).toBe(false)
    expect(canMoveTo(plan, [], 4)).toBe(false)
    expect(moveItems(plan, [10], 3)).toEqual(plan)
    expect(idsOf(moveItems(plan, [10], 3))).toEqual(idsOf(plan))
  })
})

describe('the step cap after repeats', () => {
  it('counts a nested block’s copies, wherever it is dropped', () => {
    const nested = moveItems(
      [walk(1), block(10, [walk(2)], 3), block(20, [walk(5), walk(6)], 4)],
      [20],
      2,
    )
    // Walk 1, then 3 × (walk 2 + 4 × (walks 5, 6)) = 1 + 3 × 9.
    expect(stepCount(nested)).toBe(28)
    const many: OrderRequest = { kind: 'walkTo', x: 0, y: 0 }
    const over = [block(30, [{ id: 31, order: many }], QUEUE_MAX_STEPS + 1)]
    expect(capProblem(over)).toBeDefined()
    expect(capProblem(nested)).toBeUndefined()
    // One more round of the outer block puts it over: 1 + 6 × 9.
    const tripled = nested.map((item) => ('items' in item ? { ...item, repeat: 6 } : item))
    expect(stepCount(tripled)).toBe(55)
    expect(capProblem(tripled)).toContain(String(55 - QUEUE_MAX_STEPS))
  })
})
