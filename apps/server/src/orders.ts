import type { Account, OrderRequest, ServerMessage, WorldState } from '@csp/shared'

/**
 * One kind of UI order (ADR 0002). `validate` runs when the order arrives and returns a reason
 * to reject it; `apply` runs at the start of the next tick and may only set the order state
 * that later ticks turn into actions, never change the world directly.
 */
export interface OrderKind {
  validate(world: WorldState, account: Account, order: OrderRequest): string | undefined
  apply(world: WorldState, account: Account, order: OrderRequest): void
}

/** The order kinds that exist. Slice 4 adds the first ones (walk to, pick up, drop). */
export const orderKinds: Record<string, OrderKind> = {}

interface Pending {
  account: Account
  order: OrderRequest
}

/** Orders accepted during a tick, applied together at the start of the next one. */
export class OrderQueue {
  private pending: Pending[] = []

  constructor(private kinds: Record<string, OrderKind> = orderKinds) {}

  /** Checks an incoming order and answers it; a valid one waits for the next tick. */
  receive(world: WorldState, account: Account, requestId: unknown, order: unknown): ServerMessage {
    const id = typeof requestId === 'string' ? requestId : ''
    if (!id || typeof order !== 'object' || order === null) {
      return { type: 'rejected', requestId: id, reason: 'malformed order' }
    }
    const req = order as OrderRequest
    const kind = typeof req.kind === 'string' ? this.kinds[req.kind] : undefined
    if (!kind) return { type: 'rejected', requestId: id, reason: `unknown order: ${req.kind}` }
    const reason = kind.validate(world, account, req)
    if (reason) return { type: 'rejected', requestId: id, reason }
    this.pending.push({ account, order: req })
    return { type: 'ack', requestId: id }
  }

  applyAll(world: WorldState): void {
    const batch = this.pending
    this.pending = []
    for (const { account, order } of batch) this.kinds[order.kind]!.apply(world, account, order)
  }

  get size(): number {
    return this.pending.length
  }
}
