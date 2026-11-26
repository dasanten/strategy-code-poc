// Ported from packages/shared/src/protocol.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

export {
  WS_PATH,
  WS_CLOSE_TOO_MANY_REQUESTS,
  WS_CLOSE_LOGGED_OUT,
  WS_CLOSE_UPDATED,
  WS_CLOSE_RELOAD,
  PROTOCOL_VERSION,
} from '@csp/shared-types'

/**
 * A price line as a Player sees it: what is held only when they see inside (`CONTEXT.md`: Seeing
 * inside a storage).
 */
export type Shown<P extends { stock: number }> = Omit<P, 'stock'> & { stock?: number }
