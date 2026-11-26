// Ported from packages/shared/src/queue.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { Queue, QueueItem, QueueStep } from '@csp/shared-types'
import { ORDER_KINDS } from '@csp/lang-wasm'

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
