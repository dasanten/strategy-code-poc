import { QUEUE_MAX_STEPS, QUEUE_STEP_MAX_CHARS } from './balance.js'
import type { OrderRequest } from './protocol.js'
import type { Queue } from './world.js'

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
  'unhitch',
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

/** A queue step as a request gives it: `id` names a step already in the queue being edited. */
export interface QueueStepRequest {
  id?: number
  order: OrderRequest
  minutes?: number
}

/**
 * Why a list of queue steps can't be given, if it can't: each must be an order a step can be
 * (`QUEUE_STEP_KINDS`), at most `QUEUE_MAX_STEPS` of them, with a duration in whole game minutes
 * if any; one that never ends needs a duration unless it is the last.
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
