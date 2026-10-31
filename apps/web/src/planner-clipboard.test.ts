import { QUEUE_DEFAULT_STEP_MINUTES, type OrderRequest, type Queue } from '@csp/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clear,
  copy,
  isEmpty,
  paste,
  pastedIds,
  pastePosition,
  pickStep,
} from './planner-clipboard.js'
import { editPlan, EMPTY_PLAN, insertSteps, queueRequest } from './queue-view.js'

/** The planner clipboard (`CONTEXT.md`: Planner clipboard): pick, copy and paste steps. */

const walk = (x: number, y: number): OrderRequest => ({ kind: 'walkTo', x, y })
const work: OrderRequest = { kind: 'task', task: 'work', workplaceId: 'f1' }

/** A queue of these steps, ids 1, 2, 3, … */
function queueOf(...steps: { order: OrderRequest; minutes?: number }[]): Queue {
  return {
    realmId: 'r1',
    steps: steps.map((s, i) => ({ ...s, id: i + 1 })),
    current: 0,
    startedAt: 0,
    loop: false,
    nextStepId: steps.length + 1,
  }
}

const q = queueOf({ order: walk(20, 20) }, { order: work, minutes: 30 }, { order: walk(9, 3) })

describe('planner clipboard', () => {
  beforeEach(clear)

  it('starts empty, and is empty again once cleared', () => {
    expect(isEmpty()).toBe(true)
    expect(paste()).toEqual([])
    copy(q.steps)
    expect(isEmpty()).toBe(false)
    clear()
    expect(isEmpty()).toBe(true)
  })

  it('pastes equal steps with no ids, places and durations kept', () => {
    copy(q.steps)
    const pasted = paste()
    expect(pasted).toEqual([
      { order: walk(20, 20) },
      { order: work, minutes: 30 },
      { order: walk(9, 3) },
    ])
    expect(pasted.every((s) => s.id === undefined)).toBe(true)
  })

  it('pastes fresh copies each time, sharing nothing with the queue or each other', () => {
    copy(q.steps)
    const a = paste()
    const b = paste()
    expect(a).not.toBe(b)
    expect(a[0]!.order).not.toBe(q.steps[0]!.order)
    expect(a[0]!.order).not.toBe(b[0]!.order)
    // Changing a copy changes neither the clipboard nor the other.
    a[0]!.order.x = 99
    expect(paste()[0]!.order.x).toBe(20)
    expect(b[0]!.order.x).toBe(20)
  })

  it('copying again replaces what was on the clipboard', () => {
    copy(q.steps)
    copy([q.steps[2]!])
    expect(paste()).toEqual([{ order: walk(9, 3) }])
  })

  it('copies a step without its id even when the step has one', () => {
    copy([{ id: 7, order: work, minutes: 5 }])
    expect(paste()).toEqual([{ order: work, minutes: 5 }])
  })
})

describe('picking steps', () => {
  const ids = [1, 2, 3, 4, 5]

  it('a tap picks that step alone', () => {
    expect(pickStep([], ids, 3, false)).toEqual([3])
    expect(pickStep([1, 2], ids, 4, false)).toEqual([4])
  })

  it('tapping the one step picked unpicks it', () => {
    expect(pickStep([3], ids, 3, false)).toEqual([])
    // With several picked, a tap on one of them picks just that one.
    expect(pickStep([2, 3], ids, 3, false)).toEqual([3])
  })

  it('Shift+tap extends to a range, either way round', () => {
    expect(pickStep([2], ids, 4, true)).toEqual([2, 3, 4])
    expect(pickStep([4], ids, 2, true)).toEqual([2, 3, 4])
    expect(pickStep([2, 3], ids, 5, true)).toEqual([2, 3, 4, 5])
    expect(pickStep([3], ids, 3, true)).toEqual([3])
  })

  it('Shift+tap with nothing picked picks that step', () => {
    expect(pickStep([], ids, 2, true)).toEqual([2])
  })

  it('ignores a step no longer in the planner, and picks of steps gone', () => {
    expect(pickStep([2], ids, 9, false)).toEqual([2])
    expect(pickStep([9], ids, 2, true)).toEqual([2])
  })
})

describe('paste position', () => {
  it('goes after the last picked step', () => {
    expect(pastePosition([1, 2, 3], [1])).toBe(0)
    expect(pastePosition([1, 2, 3], [1, 2])).toBe(1)
    expect(pastePosition([1, 2, 3], [3, 2])).toBe(2)
  })

  it('goes at the end with none picked, or picks of steps gone', () => {
    expect(pastePosition([1, 2, 3], [])).toBe(2)
    expect(pastePosition([1, 2, 3], [9])).toBe(2)
    expect(pastePosition([], [])).toBe(-1)
  })

  it('inserts the pasted steps after that position, timing a step that never ends', () => {
    copy([q.steps[1]!, q.steps[2]!])
    const steps = insertSteps(q, 0, paste())
    expect(steps.map((s) => s.id)).toEqual([1, undefined, undefined, 2, 3])
    expect(steps.map((s) => s.order)).toEqual([walk(20, 20), work, walk(9, 3), work, walk(9, 3)])
    // Into an empty planner, they are the plan.
    expect(insertSteps(EMPTY_PLAN, -1, paste()).map((s) => s.order)).toEqual([work, walk(9, 3)])
    // At the end, a working step pasted before another gets the default duration.
    copy([
      { id: 1, order: work },
      { id: 2, order: walk(1, 1) },
    ])
    const atEnd = insertSteps(q, 2, paste())
    expect(atEnd[3]).toEqual({ order: work, minutes: QUEUE_DEFAULT_STEP_MINUTES })
    expect(atEnd[4]).toEqual({ order: walk(1, 1) })
  })

  it('the pasted steps get the next ids, so they can be picked and a second paste goes after', () => {
    expect(pastedIds(4, 2)).toEqual([4, 5])
    expect(pastedIds(4, 0)).toEqual([])
    // A group's plan hands them out just so.
    copy([q.steps[0]!, q.steps[2]!])
    const plan = editPlan(EMPTY_PLAN, insertSteps(EMPTY_PLAN, -1, paste()))
    expect(plan.steps.map((s) => s.id)).toEqual(pastedIds(EMPTY_PLAN.nextStepId, 2))
    const again = editPlan(plan, insertSteps(plan, pastePosition([1, 2], [1, 2]), paste()))
    expect(again.steps.map((s) => s.id)).toEqual([1, 2, 3, 4])
    expect(again.steps.map((s) => s.order)).toEqual([
      walk(20, 20),
      walk(9, 3),
      walk(20, 20),
      walk(9, 3),
    ])
  })

  it('a resident with no queue gets one from the paste, one with a queue an edit', () => {
    copy(q.steps)
    expect(queueRequest({ id: 'w1' }, paste())).toMatchObject({
      kind: 'queue',
      residentId: 'w1',
      steps: paste(),
    })
    expect(queueRequest({ id: 'w1', queue: q }, insertSteps(q, 2, paste()))).toMatchObject({
      kind: 'editQueue',
      residentId: 'w1',
    })
  })
})
