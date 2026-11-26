// Ported from packages/shared/src/contract.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { MercenaryContract, WorldState } from '@csp/shared-types'

/** World queries about mercenary contracts (ADR 0002: the game API orders and scripts share). */

export { GAME_DAYS_PER_WEEK, TICKS_PER_GAME_WEEK } from '@csp/shared-types'

/** The contract in force that rents out the resident, if any. */
export function contractOf(
  world: Pick<WorldState, 'contracts'>,
  residentId: string,
): MercenaryContract | undefined {
  return world.contracts.find((c) => c.startedAt !== null && c.residentIds.includes(residentId))
}
