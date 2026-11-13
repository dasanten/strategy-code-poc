// Ported from packages/shared/src/queue.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import {
  QUEUE_MAX_DEPTH,
  QUEUE_MAX_REPEAT,
  QUEUE_MAX_STEPS,
  QUEUE_STEP_MAX_CHARS,
} from '@csp/balance'
import type {
  BuildLine,
  OrderRequest,
  Queue,
  QueueItem,
  QueueStep,
  QueueStepRequest,
} from '@csp/shared-types'

/**
 * Queues (`CONTEXT.md`: Queue): which orders can be steps and how a step list is checked, shared
 * by the server and the UI.
 */

/**
 * The order kinds a queue step can be: the one-off actions and tasks the UI gives a resident, and
 * running one of the Player's scripts. Never a queue.
 */
export const QUEUE_STEP_KINDS: readonly string[] = [
  'walkTo',
  'drive',
  'row',
  'sail',
  'unhitch',
  'hitch',
  'board',
  'getOff',
  'pickUp',
  'drop',
  'store',
  'fetch',
  'build',
  'tearDown',
  'workAt',
  'teach',
  'haul',
  'roadLine',
  'wallLine',
  'mount',
  'dismount',
  'relocate',
  'feed',
  'task',
  'runScript',
]

/** Steps that run a script (a task's default or the Player's own) rather than a built-in order. */
export function runsScript(order: Pick<OrderRequest, 'kind'>): boolean {
  return order.kind === 'task' || order.kind === 'runScript'
}

/**
 * A step that never ends on its own: working a workplace, a haul route, feeding a stable,
 * teaching or training.
 */
export function neverEnds(order: OrderRequest): boolean {
  if (['workAt', 'haul', 'teach'].includes(order.kind)) return true
  return (
    order.kind === 'task' && ['work', 'haul', 'feedStable', 'train'].includes(order.task as string)
  )
}

/**
 * The line a Build line step carries (`CONTEXT.md`: Build line): road or wall and its two picked
 * ends, as the task order gives it. Undefined for any other step, and for a Build line step
 * without a whole line.
 */
export function stepLine(order: OrderRequest): BuildLine | undefined {
  if (order.kind !== 'task' || order.task !== 'buildLine') return undefined
  const tile = (p: unknown) => {
    const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown }
    return Number.isInteger(x) && Number.isInteger(y) ? { x: x as number, y: y as number } : null
  }
  const [from, to] = [tile(order.from), tile(order.to)]
  const { building } = order
  if ((building !== 'road' && building !== 'wall') || !from || !to) return undefined
  return { building, from, to }
}

/** A step of a queue's items as `walkItems` finds it, and whether a block around it repeats it. */
interface WalkedStep {
  step: unknown
  repeated: boolean
}

/** Whether an item as sent is a repeat block rather than a step: it has `repeat`. */
function isBlockLike(item: unknown): item is Record<string, unknown> {
  return typeof item === 'object' && item !== null && !Array.isArray(item) && 'repeat' in item
}

/**
 * Why a queue's items can't be given, if they can't (`CONTEXT.md`: Repeat block): steps and
 * repeat blocks, at most `QUEUE_MAX_STEPS` of them as written, blocks nested at most
 * `QUEUE_MAX_DEPTH` deep, each repeating a whole number of times up to `QUEUE_MAX_REPEAT` or
 * forever, never empty. Each step must be an order a step can be (`QUEUE_STEP_KINDS`), with a
 * duration in whole game minutes if any; one that never ends needs a duration unless it is the
 * last step and no block around it repeats it. A Build line step carries its whole line
 * (`stepLine`) and ends on its own once the line is built or laid out. Steps are numbered top to
 * bottom.
 */
export function queueStepsProblem(items: unknown): string | undefined {
  if (!Array.isArray(items)) return 'the steps must be a list'
  let count = 0
  let problem: string | undefined
  const steps: WalkedStep[] = []
  const set = (p: string) => (problem ??= p)
  const walk = (list: readonly unknown[], depth: number, repeated: boolean) => {
    for (const item of list) {
      count++
      if (!isBlockLike(item)) {
        steps.push({ step: item, repeated })
        continue
      }
      if (depth + 1 > QUEUE_MAX_DEPTH) set(`blocks nest at most ${QUEUE_MAX_DEPTH} deep`)
      if (Object.keys(item).some((k) => !['id', 'repeat', 'items'].includes(k)))
        set('a repeat block holds only its id, count and items')
      const { repeat, items: inner } = item
      const countOk =
        repeat === 'forever' ||
        (typeof repeat === 'number' &&
          Number.isInteger(repeat) &&
          repeat >= 1 &&
          repeat <= QUEUE_MAX_REPEAT)
      if (!countOk) set(`a repeat block repeats from 1 to ${QUEUE_MAX_REPEAT} times, or forever`)
      if (Array.isArray(inner) && inner.length > 0) walk(inner, depth + 1, repeated || repeat !== 1)
      else set('a repeat block needs a step')
    }
  }
  walk(items, 0, false)
  if (count > QUEUE_MAX_STEPS) return `a queue holds at most ${QUEUE_MAX_STEPS} steps and blocks`
  if (problem) return problem
  for (const [i, { step, repeated }] of steps.entries()) {
    const n = i + 1
    const s = step as Partial<QueueStepRequest> | null
    const order = s?.order
    if (typeof order !== 'object' || order === null || Array.isArray(order))
      return `step ${n} must be an order`
    if (typeof order.kind !== 'string' || !QUEUE_STEP_KINDS.includes(order.kind))
      return `step ${n}: ${String(order.kind)} can't be a queue step`
    if (JSON.stringify(order).length > QUEUE_STEP_MAX_CHARS) return `step ${n} is too long`
    if (order.kind === 'task' && order.task === 'buildLine' && !stepLine(order))
      return `step ${n}: a Build line step needs road or wall and its two ends`
    const minutes = s!.minutes
    if (minutes !== undefined && !(Number.isInteger(minutes) && minutes > 0))
      return `step ${n}'s duration must be a whole number of minutes`
    if (minutes === undefined && neverEnds(order) && (n < steps.length || repeated))
      return `step ${n} never ends on its own: give it a duration or make it the last`
  }
  return undefined
}

/** The steps of a queue's items top to bottom, as written: each once, whatever its blocks repeat. */
export function queueSteps(items: readonly QueueItem[]): QueueStep[] {
  return items.flatMap((item) => ('repeat' in item ? queueSteps(item.items) : [item]))
}

/** The current step's place among the queue's steps top to bottom, from 0; -1 if none. */
export function currentIndex(q: Pick<Queue, 'items' | 'current'>): number {
  return queueSteps(q.items).findIndex((s) => s.id === q.current)
}

/** What a script sees of a queue (the `queue` script view): where it is and the current step. */
export interface QueueView {
  /** The current step, counted from 1 among the steps top to bottom. */
  step: number
  steps: number
  loop: boolean
  /** The current step's order kind, and the task or script it runs, if any. */
  kind: string
  task?: string
  scriptId?: number
  minutes?: number
  startedAt?: number
}

export function queueView(q: Queue): QueueView {
  const steps = queueSteps(q.items)
  const at = Math.max(0, currentIndex(q))
  const { order, minutes } = steps[at]!
  return {
    step: at + 1,
    steps: steps.length,
    loop: q.loop,
    kind: order.kind,
    ...(typeof order.task === 'string' ? { task: order.task } : {}),
    ...(typeof order.scriptId === 'number' ? { scriptId: order.scriptId } : {}),
    ...(minutes === undefined ? {} : { minutes }),
    ...(q.startedAt === null ? {} : { startedAt: q.startedAt }),
  }
}
