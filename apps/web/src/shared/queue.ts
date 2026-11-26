// Ported from packages/shared/src/queue.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { BuildLine, OrderRequest, Queue, QueueItem, QueueStep } from '@csp/shared-types'
import { ORDER_KINDS, orderKind } from '@csp/lang-wasm'

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

/**
 * A step that never ends on its own: working a workplace, a haul route, feeding a stable,
 * teaching or training. Feeding the stable once ends (`feedsOnce`).
 */
export function neverEnds(order: OrderRequest): boolean {
  if (orderKind(order.kind)?.neverEnds) return true
  return (
    !feedsOnce(order) &&
    order.kind === 'task' &&
    ['work', 'haul', 'feedStable', 'train'].includes(order.task as string)
  )
}

/**
 * A Feed the stable step that runs a single round, its `once` param above 0, ending once the
 * stable is full (`CONTEXT.md`: Feeding the stable, Once).
 */
export function feedsOnce(order: OrderRequest): boolean {
  if (order.kind !== 'task' || order.task !== 'feedStable') return false
  const once = (order.params as Record<string, unknown> | undefined)?.once
  return typeof once === 'number' && once > 0
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
