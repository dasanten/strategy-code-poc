// Ported from packages/shared/src/protocol.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

/**
 * A price line as a Player sees it: what is held only when they see inside (`CONTEXT.md`: Seeing
 * inside a storage).
 */
export type Shown<P extends { stock: number }> = Omit<P, 'stock'> & { stock?: number }
