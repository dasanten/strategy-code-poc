// Ported from packages/shared/src/queue.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { QUEUE_MAX_STEPS, QUEUE_STEP_MAX_CHARS } from '@csp/balance'
import type { BuildLine, OrderRequest, Queue, QueueStepRequest } from '@csp/shared-types'

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

/**
 * Why a list of queue steps can't be given, if it can't: each must be an order a step can be
 * (`QUEUE_STEP_KINDS`), at most `QUEUE_MAX_STEPS` of them, with a duration in whole game minutes
 * if any; one that never ends needs a duration unless it is the last. A Build line step carries
 * its whole line (`stepLine`) and ends on its own once the line is built or laid out.
 */
export function queueStepsProblem(steps: unknown): string | undefined {
  if (!Array.isArray(steps)) return 'the steps must be a list'
  if (steps.length > QUEUE_MAX_STEPS) return `a queue holds at most ${QUEUE_MAX_STEPS} steps`
  for (const [i, step] of steps.entries()) {
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
    if (minutes === undefined && neverEnds(order) && n < steps.length)
      return `step ${n} never ends on its own: give it a duration or make it the last`
  }
  return undefined
}

/** What a script sees of a queue (the `queue` script view): where it is and the current step. */
export interface QueueView {
  /** The current step, counted from 1. */
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
  const { order, minutes } = q.steps[q.current]!
  return {
    step: q.current + 1,
    steps: q.steps.length,
    loop: q.loop,
    kind: order.kind,
    ...(typeof order.task === 'string' ? { task: order.task } : {}),
    ...(typeof order.scriptId === 'number' ? { scriptId: order.scriptId } : {}),
    ...(minutes === undefined ? {} : { minutes }),
    ...(q.startedAt === null ? {} : { startedAt: q.startedAt }),
  }
}
