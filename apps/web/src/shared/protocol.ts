// Ported from packages/shared/src/protocol.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

/**
 * A price line as a Player sees it: what is held only when they see inside (`CONTEXT.md`: Seeing
 * inside a storage).
 */
export type Shown<P extends { stock: number }> = Omit<P, 'stock'> & { stock?: number }

export const WS_PATH = '/ws'

/**
 * The close code the server ends a socket with that sent more messages than it may; the client
 * shows it as "too many requests" and waits before connecting again.
 */
export const WS_CLOSE_TOO_MANY_REQUESTS = 4429

/**
 * The close code a socket gets when its session ended (logout, a password reset, or expiry): the
 * client shows the login screen instead of reconnecting.
 */
export const WS_CLOSE_LOGGED_OUT = 4001

/**
 * The close code a socket gets when the tab speaks an older protocol than the server serves: the
 * game was updated since the tab loaded, and the client shows a Reload button (ADR 0034).
 */
export const WS_CLOSE_UPDATED = 4426

/**
 * The protocol version this client speaks, named when it connects (`/ws?v=…`, ADR 0034). The
 * server's `PROTOCOL_VERSION` (`crates/csp-server/src/realtime.rs`) is the same; a Rust test checks.
 */
export const PROTOCOL_VERSION = 3
