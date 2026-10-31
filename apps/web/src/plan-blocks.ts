import {
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_MAX_STEPS,
  neverEnds,
  queueStepsProblem,
  type QueueStepRequest,
} from '@csp/shared'

/**
 * Repeat blocks (`CONTEXT.md`: Repeat block): in the planner, some steps in a row wrapped with a
 * count, nestable. A plan is a list of steps and blocks; when it is given, `unroll` makes each
 * block that many plain copies of its steps, so the queue, the server and scripts only ever see
 * steps. Steps and blocks share one id space within a plan, so the planner picks, moves and
 * removes either by id.
 */

/** Some steps in a row wrapped with a count: they run `repeat` times in a row. */
export interface RepeatBlock {
  id?: number
  repeat: number
  items: PlanItem[]
}

/** What a plan holds: a step, or a repeat block of more. */
export type PlanItem = QueueStepRequest | RepeatBlock

/** The count a new block gets. */
export const DEFAULT_REPEAT = 2

export function isBlock(item: PlanItem): item is RepeatBlock {
  return 'repeat' in item
}

/** Whether any item is a block. */
export function hasBlocks(items: readonly PlanItem[]): boolean {
  return items.some(isBlock)
}

/**
 * The plain steps the plan becomes: each block its steps `repeat` times over. The first copy of
 * every step keeps its id, so a step of a running queue stays that step (and the current one keeps
 * going); the other copies have none, so whoever keeps the queue gives them new ones. A step that
 * never ends on its own gets a duration once another follows it, as every planner edit does.
 */
export function unroll(items: readonly PlanItem[]): QueueStepRequest[] {
  return timed(unrolled(items, true))
}

function unrolled(items: readonly PlanItem[], keepIds: boolean): QueueStepRequest[] {
  return items.flatMap((item) => {
    if (!isBlock(item)) return [keepIds ? copyStep(item) : withoutId(item)]
    return Array.from({ length: item.repeat }, (_, k) =>
      unrolled(item.items, keepIds && k === 0),
    ).flat()
  })
}

/** How many steps the plan becomes once unrolled. */
export function stepCount(items: readonly PlanItem[]): number {
  return items.reduce((n, item) => n + (isBlock(item) ? item.repeat * stepCount(item.items) : 1), 0)
}

/**
 * Why the plan can't be given for its size, if it can't: more steps after repeats than a queue
 * holds (`QUEUE_MAX_STEPS`), saying by how much.
 */
export function capProblem(items: readonly PlanItem[]): string | undefined {
  const n = stepCount(items)
  if (n <= QUEUE_MAX_STEPS) return undefined
  return `${n} steps after repeats, ${n - QUEUE_MAX_STEPS} more than a queue holds (${QUEUE_MAX_STEPS})`
}

/**
 * Why the plan can't be given, if it can't: no steps, more steps after repeats than a queue holds
 * (`capProblem`), or a step the server would refuse once unrolled (`queueStepsProblem`).
 */
export function planProblem(items: readonly PlanItem[]): string | undefined {
  if (stepCount(items) === 0) return 'no steps yet'
  return capProblem(items) ?? queueStepsProblem(unroll(items))
}

/** A fresh copy of the items, sharing nothing, with or without their ids. */
export function copyItems(items: readonly PlanItem[], keepIds = true): PlanItem[] {
  return items.map((item) => {
    if (!isBlock(item)) return keepIds ? copyStep(item) : withoutId(item)
    const block: RepeatBlock = { repeat: item.repeat, items: copyItems(item.items, keepIds) }
    return keepIds && item.id !== undefined ? { id: item.id, ...block } : block
  })
}

/**
 * The items with every step and block lacking an id given one, from `nextStepId` on (or past the
 * highest id they have) in the order they are listed (a block before its steps), and the id the
 * next one gets. Without blocks that is the order the server's `editQueue` gives them out in.
 */
export function withIds(
  items: readonly PlanItem[],
  nextStepId: number,
): { items: PlanItem[]; nextStepId: number } {
  let next = Math.max(nextStepId, ...idsOf(items).map((id) => id + 1))
  const give = (list: readonly PlanItem[]): PlanItem[] =>
    list.map((item) => {
      const id = item.id ?? next++
      if (!isBlock(item)) return { ...copyStep(item), id }
      return { id, repeat: item.repeat, items: give(item.items) }
    })
  const given = give(items)
  return { items: given, nextStepId: next }
}

/** Every id in the items, steps and blocks, in the order they are listed. */
export function idsOf(items: readonly PlanItem[]): number[] {
  return items.flatMap((item) => [
    ...(item.id === undefined ? [] : [item.id]),
    ...(isBlock(item) ? idsOf(item.items) : []),
  ])
}

/** One row of the planner's list: a step, or the head of a block, with how deep it sits. */
export type PlanRow =
  | { kind: 'step'; id: number; depth: number; step: QueueStepRequest }
  | { kind: 'block'; id: number; depth: number; repeat: number; steps: number }

/** The plan as the planner lists it: each block's head, then its items one deeper. */
export function planRows(items: readonly PlanItem[], depth = 0): PlanRow[] {
  return items.flatMap((item): PlanRow[] => {
    if (!isBlock(item)) return [{ kind: 'step', id: item.id!, depth, step: item }]
    const head: PlanRow = {
      kind: 'block',
      id: item.id!,
      depth,
      repeat: item.repeat,
      steps: stepCount(item.items),
    }
    return [head, ...planRows(item.items, depth + 1)]
  })
}

/**
 * The picked items that act as one: those not inside a picked block, in the order listed. Copy
 * copies these, and Repeat wraps them.
 */
export function topPicked(items: readonly PlanItem[], picked: readonly number[]): PlanItem[] {
  return items.flatMap((item) => {
    if (item.id !== undefined && picked.includes(item.id)) return [item]
    return isBlock(item) ? topPicked(item.items, picked) : []
  })
}

/**
 * The items with the picked ones wrapped in a block repeating `repeat` times, where they were;
 * undefined unless they sit in a row in one list (a block's or the plan's). The block has no id
 * yet: the planner gives it one (`withIds`).
 */
export function wrap(
  items: readonly PlanItem[],
  picked: readonly number[],
  repeat = DEFAULT_REPEAT,
): PlanItem[] | undefined {
  const tops = topPicked(items, picked)
  if (tops.length === 0) return undefined
  let done = false
  const into = (list: readonly PlanItem[]): PlanItem[] => {
    const at = list.indexOf(tops[0]!)
    if (at >= 0) {
      if (!tops.every((t, i) => list[at + i] === t)) return [...list]
      done = true
      const block: RepeatBlock = { repeat, items: [...tops] }
      return [...list.slice(0, at), block, ...list.slice(at + tops.length)]
    }
    return list.map((item) => (isBlock(item) ? { ...item, items: into(item.items) } : item))
  }
  const wrapped = into(items)
  return done ? wrapped : undefined
}

/** The items with the block `id` replaced by its own items. */
export function unwrap(items: readonly PlanItem[], id: number): PlanItem[] {
  return items.flatMap((item) => {
    if (!isBlock(item)) return [item]
    if (item.id === id) return item.items
    return [{ ...item, items: unwrap(item.items, id) }]
  })
}

/** The items with block `id` repeating `repeat` times, at least once. */
export function setRepeat(items: readonly PlanItem[], id: number, repeat: number): PlanItem[] {
  const n = Math.max(1, Math.floor(repeat))
  return items.map((item) => {
    if (!isBlock(item)) return item
    if (item.id === id) return { ...item, repeat: n }
    return { ...item, items: setRepeat(item.items, id, n) }
  })
}

/** The items without `id`; a block left empty goes too. */
export function removeItem(items: readonly PlanItem[], id: number): PlanItem[] {
  return items.flatMap((item): PlanItem[] => {
    if (item.id === id) return []
    if (!isBlock(item)) return [item]
    const rest = removeItem(item.items, id)
    return rest.length === 0 ? [] : [{ ...item, items: rest }]
  })
}

/** The items with step `id`'s duration set in game minutes, or cleared with undefined. */
export function timeItem(
  items: readonly PlanItem[],
  id: number,
  minutes: number | undefined,
): PlanItem[] {
  return items.map((item) => {
    if (isBlock(item)) return { ...item, items: timeItem(item.items, id, minutes) }
    if (item.id !== id) return item
    const step = { ...item, minutes }
    if (minutes === undefined) delete step.minutes
    return step
  })
}

/** The items with `id` moved up (-1) or down (+1) among the items of its own list. */
export function moveItem(items: readonly PlanItem[], id: number, by: -1 | 1): PlanItem[] {
  const i = items.findIndex((item) => item.id === id)
  if (i < 0) {
    return items.map((item) =>
      isBlock(item) ? { ...item, items: moveItem(item.items, id, by) } : item,
    )
  }
  const j = i + by
  if (j < 0 || j >= items.length) return [...items]
  const moved = [...items]
  ;[moved[i], moved[j]] = [moved[j]!, moved[i]!]
  return moved
}

/** Whether `id` can move up (-1) or down (+1) in its list. */
export function canMove(items: readonly PlanItem[], id: number, by: -1 | 1): boolean {
  const i = items.findIndex((item) => item.id === id)
  if (i >= 0) return i + by >= 0 && i + by < items.length
  return items.some((item) => isBlock(item) && canMove(item.items, id, by))
}

/**
 * The items with `id` dragged to the place of `onto`, in onto's list; nothing changes when onto
 * is inside the dragged block.
 */
export function dropItem(items: readonly PlanItem[], id: number, onto: number): PlanItem[] {
  const dragged = find(items, id)
  if (!dragged || id === onto || (isBlock(dragged) && idsOf(dragged.items).includes(onto)))
    return [...items]
  // Its place among the items once the dragged one is out, as in a flat list.
  const flatBefore = idsOf(items)
  const below = flatBefore.indexOf(id) < flatBefore.indexOf(onto)
  return insertAt(removeItem(items, id), onto, [dragged], below)
}

/**
 * The items with `added` put after `after` in its list, or at the end of the plan when undefined
 * or not there (a paste with nothing picked, a load).
 */
export function insertItems(
  items: readonly PlanItem[],
  after: number | undefined,
  added: readonly PlanItem[],
): PlanItem[] {
  if (after === undefined || !find(items, after)) return [...items, ...added]
  return insertAt(items, after, added, true)
}

function insertAt(
  items: readonly PlanItem[],
  at: number,
  added: readonly PlanItem[],
  after: boolean,
): PlanItem[] {
  return items.flatMap((item): PlanItem[] => {
    if (item.id === at) return after ? [item, ...added] : [...added, item]
    return isBlock(item) ? [{ ...item, items: insertAt(item.items, at, added, after) }] : [item]
  })
}

/** The step or block `id`, wherever it sits. */
export function find(items: readonly PlanItem[], id: number): PlanItem | undefined {
  for (const item of items) {
    if (item.id === id) return item
    const inside = isBlock(item) ? find(item.items, id) : undefined
    if (inside) return inside
  }
  return undefined
}

/** The id of the last picked item in the order listed, where a paste goes after. */
export function lastPicked(
  items: readonly PlanItem[],
  picked: readonly number[],
): number | undefined {
  return idsOf(items)
    .filter((id) => picked.includes(id))
    .at(-1)
}

/**
 * The items with every step that never ends on its own given a duration, unless it is the last
 * step the plan unrolls to: one last in a block repeated is followed by its own next copy.
 */
export function timedItems(items: readonly PlanItem[]): PlanItem[] {
  const last = lastStep(items)
  const time = (list: readonly PlanItem[]): PlanItem[] =>
    list.map((item) => {
      if (isBlock(item)) return { ...item, items: time(item.items) }
      if (item === last || item.minutes !== undefined || !neverEnds(item.order)) return item
      return { ...item, minutes: QUEUE_DEFAULT_STEP_MINUTES }
    })
  return time(items)
}

/** The step the plan unrolls to last, if no block around it repeats it. */
function lastStep(items: readonly PlanItem[]): QueueStepRequest | undefined {
  const item = items.at(-1)
  if (!item || !isBlock(item)) return item
  return item.repeat === 1 ? lastStep(item.items) : undefined
}

/** The steps with every one that never ends on its own, and isn't last, given a duration. */
function timed(steps: QueueStepRequest[]): QueueStepRequest[] {
  return steps.map((s, i) =>
    s.minutes === undefined && neverEnds(s.order) && i < steps.length - 1
      ? { ...s, minutes: QUEUE_DEFAULT_STEP_MINUTES }
      : s,
  )
}

function copyStep(s: QueueStepRequest): QueueStepRequest {
  return {
    ...(s.id === undefined ? {} : { id: s.id }),
    order: structuredClone(s.order),
    ...(s.minutes === undefined ? {} : { minutes: s.minutes }),
  }
}

function withoutId(s: QueueStepRequest): QueueStepRequest {
  return {
    order: structuredClone(s.order),
    ...(s.minutes === undefined ? {} : { minutes: s.minutes }),
  }
}
