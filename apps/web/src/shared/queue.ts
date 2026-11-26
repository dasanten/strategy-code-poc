// Ported from packages/shared/src/queue.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { OrderRequest, Queue, QueueItem, QueueStep } from '@csp/shared-types'
import { ORDER_KINDS } from '@csp/lang-wasm'

export { neverEnds, feedsOnce, stepLine } from '@csp/lang-wasm'

export { queueStepsProblem } from '@csp/lang-wasm'

/**
 * Queues (`CONTEXT.md`: Queue): which orders can be steps and how a step list is checked, shared
 * by the server and the UI.
 */

/**
 * The order kinds a queue step can be: the one-off actions and tasks the UI gives a resident, and
 * running one of the Player's scripts. Never a queue. Read from each kind's facts (`ORDER_KINDS`).
 */
export const QUEUE_STEP_KINDS: readonly string[] = ORDER_KINDS.filter((k) => k.queueStep).map(
  (k) => k.kind,
)

/** Steps that run a script (a task's default or the Player's own) rather than a built-in order. */
export function runsScript(order: Pick<OrderRequest, 'kind'>): boolean {
  return order.kind === 'task' || order.kind === 'runScript'
}

/** The steps of a queue's items top to bottom, as written: each once, whatever its blocks repeat. */
export function queueSteps(items: readonly QueueItem[]): QueueStep[] {
  return items.flatMap((item) => {
    if ('repeat' in item) return queueSteps(item.items)
    if ('if' in item) return [...queueSteps(item.items), ...queueSteps(item.else ?? [])]
    return [item]
  })
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
