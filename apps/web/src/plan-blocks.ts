import {
  QUEUE_DEFAULT_STEP_MINUTES,
  QUEUE_MAX_DEPTH,
  QUEUE_MAX_REPEAT,
  QUEUE_MAX_STEPS,
} from '@csp/balance'
import { neverEnds, queueStepsProblem } from './shared/queue.js'
import type { Condition, QueueStepRequest, Repeat } from '@csp/shared-types'

/**
 * Repeat blocks and If blocks (`CONTEXT.md`: Repeat block, If block, ADR 0032): some steps in a
 * row wrapped with a count or forever, or with a condition and an optional Else part, nestable. A
 * plan is a tree of steps and blocks, and the queue given from it is the same tree: the server
 * runs the blocks, and a block counts once towards a queue's size however often it repeats.
 * Steps and blocks share one id space, so the planner picks, moves and removes either by id.
 */

/**
 * Some steps in a row wrapped with a count: they run `repeat` times in a row, forever, or until a
 * condition holds.
 */
export interface RepeatBlock {
  id?: number
  repeat: Repeat
  items: PlanItem[]
}

/** Some steps run only when `if` holds as their turn comes, and an optional Else part run when not. */
export interface IfBlock {
  id?: number
  if: Condition
  items: PlanItem[]
  else?: PlanItem[]
}

/** A block of steps: a repeat block or an If block. */
export type Block = RepeatBlock | IfBlock

/** What a plan holds: a step, or a block of more. */
export type PlanItem = QueueStepRequest | Block

/** The count a new block gets. */
export const DEFAULT_REPEAT = 2

export function isBlock(item: PlanItem): item is Block {
  return 'repeat' in item || 'if' in item
}

export function isIf(item: PlanItem): item is IfBlock {
  return 'if' in item
}

/** A block's lists: its items, and an If block's Else part when it has one. */
export function partsOf(b: Block): PlanItem[][] {
  return isIf(b) && b.else ? [b.items, b.else] : [b.items]
}

/** Every item right inside a block: its items, then an If block's Else part. */
export function inner(b: Block): PlanItem[] {
  return partsOf(b).flat()
}

/** The block with each of its lists changed by `f`, its items before its Else part. */
export function mapParts(b: Block, f: (list: PlanItem[]) => PlanItem[]): Block {
  if (!isIf(b)) return { ...b, items: f(b.items) }
  const out: IfBlock = { ...b, items: f(b.items) }
  if (b.else) out.else = f(b.else)
  return out
}

/** Whether any item is a block. */
export function hasBlocks(items: readonly PlanItem[]): boolean {
  return items.some(isBlock)
}

/** The plan's steps top to bottom, as written: each once, whatever its blocks repeat. */
export function planSteps(items: readonly PlanItem[]): QueueStepRequest[] {
  return items.flatMap((item) => (isBlock(item) ? planSteps(inner(item)) : [item]))
}

/** How many steps the plan holds as written. */
export function stepCount(items: readonly PlanItem[]): number {
  return planSteps(items).length
}

/** How many steps and blocks the plan holds as written: what a queue's size counts. */
export function itemCount(items: readonly PlanItem[]): number {
  return items.reduce((n, item) => n + 1 + (isBlock(item) ? itemCount(inner(item)) : 0), 0)
}

/** How deep the plan's blocks nest: 0 for steps alone. */
export function depthOf(items: readonly PlanItem[]): number {
  return Math.max(
    0,
    ...items.map((item) =>
      isBlock(item) ? 1 + Math.max(...partsOf(item).map((part) => depthOf(part))) : 0,
    ),
  )
}

/**
 * Why the plan can't be given for its size, if it can't: more steps and blocks than a queue holds
 * (`QUEUE_MAX_STEPS`), saying by how much, or blocks nested deeper than `QUEUE_MAX_DEPTH`.
 */
export function capProblem(items: readonly PlanItem[]): string | undefined {
  const n = itemCount(items)
  if (n > QUEUE_MAX_STEPS)
    return `${n} steps and blocks, ${n - QUEUE_MAX_STEPS} more than a queue holds (${QUEUE_MAX_STEPS})`
  const depth = depthOf(items)
  if (depth > QUEUE_MAX_DEPTH)
    return `blocks nested ${depth} deep, deeper than a queue allows (${QUEUE_MAX_DEPTH})`
  return undefined
}

/**
 * Why the plan can't be given, if it can't: no steps, more steps and blocks than a queue holds or
 * nested too deep (`capProblem`), or anything else the server would refuse (`queueStepsProblem`).
 */
export function planProblem(items: readonly PlanItem[]): string | undefined {
  if (stepCount(items) === 0) return 'no steps yet'
  return capProblem(items) ?? queueStepsProblem(items)
}

/**
 * How a block repeats, as the planner's head gives it: a whole number in range, forever, or until
 * a condition holds (`CONTEXT.md`: Repeat block).
 */
export function repeatOf(count: Repeat): Repeat {
  if (typeof count !== 'number') return structuredClone(count)
  return Math.min(QUEUE_MAX_REPEAT, Math.max(1, Math.floor(count)))
}

/** A block's own fields, without its id or its lists: its count, or its condition. */
function headOf(b: Block): Omit<RepeatBlock, 'id' | 'items'> | Omit<IfBlock, 'id' | 'items'> {
  return isIf(b) ? { if: structuredClone(b.if) } : { repeat: structuredClone(b.repeat) }
}

/** A fresh copy of the items, sharing nothing, with or without their ids. */
export function copyItems(items: readonly PlanItem[], keepIds = true): PlanItem[] {
  return items.map((item) => {
    if (!isBlock(item)) return keepIds ? copyStep(item) : withoutId(item)
    const block = mapParts({ ...headOf(item), items: item.items, ...elseOf(item) } as Block, (l) =>
      copyItems(l, keepIds),
    )
    return keepIds && item.id !== undefined ? { id: item.id, ...block } : block
  })
}

/** An If block's Else part as a field to spread, if it has one. */
function elseOf(b: Block): Pick<IfBlock, 'else'> {
  return isIf(b) && b.else ? { else: b.else } : {}
}

/**
 * The items with every step and block lacking an id given one, from `nextStepId` on (or past the
 * highest id they have) in the order they are listed (a block before its steps, an If block's
 * items before its Else part), and the id the next one gets. That is the order the server's
 * `editQueue` gives them out in.
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
      const block = { ...headOf(item), items: item.items, ...elseOf(item) } as Block
      return { id, ...mapParts(block, give) }
    })
  const given = give(items)
  return { items: given, nextStepId: next }
}

/** Every id in the items, steps and blocks, in the order they are listed. */
export function idsOf(items: readonly PlanItem[]): number[] {
  return items.flatMap((item) => [
    ...(item.id === undefined ? [] : [item.id]),
    ...(isBlock(item) ? idsOf(inner(item)) : []),
  ])
}

/** One row of the planner's list: a step, or the head of a block, with how deep it sits. */
export type PlanRow =
  | { kind: 'step'; id: number; depth: number; step: QueueStepRequest }
  | { kind: 'block'; id: number; depth: number; repeat: Repeat; steps: number }
  | { kind: 'if'; id: number; depth: number; if: Condition; steps: number }

/** The plan as the planner lists it: each block's head, then its items one deeper. */
export function planRows(items: readonly PlanItem[], depth = 0): PlanRow[] {
  return items.flatMap((item): PlanRow[] => {
    if (!isBlock(item)) return [{ kind: 'step', id: item.id!, depth, step: item }]
    const steps = stepCount(inner(item))
    const head: PlanRow = isIf(item)
      ? { kind: 'if', id: item.id!, depth, if: item.if, steps }
      : { kind: 'block', id: item.id!, depth, repeat: item.repeat, steps }
    return [head, ...planRows(inner(item), depth + 1)]
  })
}

/**
 * The picked items that act as one: those not inside a picked block, in the order listed. Copy
 * copies these, and Repeat and If wrap them.
 */
export function topPicked(items: readonly PlanItem[], picked: readonly number[]): PlanItem[] {
  return items.flatMap((item) => {
    if (item.id !== undefined && picked.includes(item.id)) return [item]
    return isBlock(item) ? topPicked(inner(item), picked) : []
  })
}

/**
 * The items with the picked ones wrapped in a block, where they were: one repeating `repeat` times
 * (or forever, or until a condition holds), or with `repeat` a condition, an If block. Undefined
 * unless they sit in a row in one list (a block's or the plan's). The block has no id yet: the
 * planner gives it one (`withIds`).
 */
export function wrap(
  items: readonly PlanItem[],
  picked: readonly number[],
  repeat: Repeat | Condition = DEFAULT_REPEAT,
): PlanItem[] | undefined {
  const tops = topPicked(items, picked)
  if (tops.length === 0) return undefined
  let done = false
  const into = (list: readonly PlanItem[]): PlanItem[] => {
    const at = list.indexOf(tops[0]!)
    if (at >= 0) {
      if (!tops.every((t, i) => list[at + i] === t)) return [...list]
      done = true
      const block: Block =
        typeof repeat === 'object' && 'kind' in repeat
          ? { if: repeat, items: [...tops] }
          : { repeat, items: [...tops] }
      return [...list.slice(0, at), block, ...list.slice(at + tops.length)]
    }
    return list.map((item) => (isBlock(item) ? mapParts(item, into) : item))
  }
  const wrapped = into(items)
  return done ? wrapped : undefined
}

/** The items with the block `id` replaced by its own items (an If block's Else part after them). */
export function unwrap(items: readonly PlanItem[], id: number): PlanItem[] {
  return items.flatMap((item) => {
    if (!isBlock(item)) return [item]
    if (item.id === id) return inner(item)
    return [mapParts(item, (l) => unwrap(l, id))]
  })
}

/** The items with block `id` repeating `repeat` times (a whole number in range), forever or until. */
export function setRepeat(items: readonly PlanItem[], id: number, repeat: Repeat): PlanItem[] {
  const n = repeatOf(repeat)
  return items.map((item) => {
    if (!isBlock(item)) return item
    if (item.id === id && !isIf(item)) return { ...item, repeat: n }
    return mapParts(item, (l) => setRepeat(l, id, n))
  })
}

/** The items with If block `id` asking `condition` (`CONTEXT.md`: If block). */
export function setCondition(
  items: readonly PlanItem[],
  id: number,
  condition: Condition,
): PlanItem[] {
  return items.map((item) => {
    if (!isBlock(item)) return item
    if (item.id === id && isIf(item)) return { ...item, if: condition }
    return mapParts(item, (l) => setCondition(l, id, condition))
  })
}

/**
 * The items with the picked ones moved to the end of If block `id`'s Else part, which it gets if
 * it has none; undefined when nothing is picked or the block itself or anything in it is.
 */
export function intoElse(
  items: readonly PlanItem[],
  picked: readonly number[],
  id: number,
): PlanItem[] | undefined {
  const target = find(items, id)
  if (!target || !isIf(target)) return undefined
  const moved = topPicked(items, picked)
  const within = new Set([id, ...idsOf(inner(target))])
  if (moved.length === 0 || moved.some((m) => m.id === undefined || within.has(m.id)))
    return undefined
  const rest = moved.reduce<PlanItem[]>((list, m) => removeItem(list, m.id!), [...items])
  const put = (list: readonly PlanItem[]): PlanItem[] =>
    list.map((item) => {
      if (!isBlock(item)) return item
      if (item.id === id && isIf(item)) return { ...item, else: [...(item.else ?? []), ...moved] }
      return mapParts(item, put)
    })
  return put(rest)
}

/**
 * The items without `id`. A repeat block left empty goes too; an If block whose items are left
 * empty goes, its Else part's steps put in its place; an Else part left empty goes.
 */
export function removeItem(items: readonly PlanItem[], id: number): PlanItem[] {
  return items.flatMap((item): PlanItem[] => {
    if (item.id === id) return []
    if (!isBlock(item)) return [item]
    const kept = mapParts(item, (l) => removeItem(l, id))
    if (isIf(kept)) {
      if (kept.else?.length === 0) delete kept.else
      if (kept.items.length === 0) return kept.else ?? []
      return [kept]
    }
    return kept.items.length === 0 ? [] : [kept]
  })
}

/** The items with step `id`'s duration set in game minutes, or cleared with undefined. */
export function timeItem(
  items: readonly PlanItem[],
  id: number,
  minutes: number | undefined,
): PlanItem[] {
  return items.map((item) => {
    if (isBlock(item)) return mapParts(item, (l) => timeItem(l, id, minutes))
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
    return items.map((item) => (isBlock(item) ? mapParts(item, (l) => moveItem(l, id, by)) : item))
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
  return items.some((item) => isBlock(item) && partsOf(item).some((l) => canMove(l, id, by)))
}

/**
 * The items with `id` dragged to the place of `onto`, in onto's list; nothing changes when onto
 * is inside the dragged block.
 */
export function dropItem(items: readonly PlanItem[], id: number, onto: number): PlanItem[] {
  const dragged = find(items, id)
  if (!dragged || id === onto || (isBlock(dragged) && idsOf(inner(dragged)).includes(onto)))
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
    return isBlock(item) ? [mapParts(item, (l) => insertAt(l, at, added, after))] : [item]
  })
}

/** The step or block `id`, wherever it sits. */
export function find(items: readonly PlanItem[], id: number): PlanItem | undefined {
  for (const item of items) {
    if (item.id === id) return item
    const inside = isBlock(item) ? find(inner(item), id) : undefined
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
      if (isBlock(item)) return mapParts(item, time)
      if (item === last || item.minutes !== undefined || !neverEnds(item.order)) return item
      return { ...item, minutes: QUEUE_DEFAULT_STEP_MINUTES }
    })
  return time(items)
}

/**
 * The step listed last, if no block around it repeats it: as the server counts, an If block's
 * Else part comes after its items.
 */
function lastStep(items: readonly PlanItem[]): QueueStepRequest | undefined {
  const item = items.at(-1)
  if (!item || !isBlock(item)) return item
  if (isIf(item)) return lastStep(item.else ?? item.items)
  return item.repeat === 1 ? lastStep(item.items) : undefined
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
