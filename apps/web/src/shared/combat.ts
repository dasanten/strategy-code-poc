// Ported from packages/shared/src/combat.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { wrapDelta } from './terrain.js'

/**
 * Whether two residents are in contact (`CONTEXT.md`: Combat): on the same tile or one of the
 * eight around it, the short way round the map of `size` tiles.
 */
export function inContact(
  size: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return Math.abs(wrapDelta(a.x, b.x, size)) <= 1 && Math.abs(wrapDelta(a.y, b.y, size)) <= 1
}
