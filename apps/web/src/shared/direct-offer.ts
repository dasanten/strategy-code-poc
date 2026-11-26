// Ported from packages/shared/src/direct-offer.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { deliveryStorage } from './warehouse.js'
import type { WorldState } from '@csp/shared-types'

export { carriedFeesOver } from '@csp/lang-wasm'

export { carriedUnloadShares } from '@csp/lang-wasm'

/*
 * Direct offers (`CONTEXT.md`: Direct offer): in person, an offer at a storage of the sender's that
 * only the named realm can accept; carried, two Transfers once they accept. World queries orders,
 * scripts and the UI share (ADR 0002).
 */

/**
 * The cities a carried Direct offer can go between, from what the Player sees: those of `realmId`
 * with a finished storage in sight (`CONTEXT.md`: Direct offer).
 */
export function citiesToCarryAt<C extends { id: string; realmId: string | null }>(
  world: { cities: readonly C[]; buildings: Pick<WorldState, 'buildings'>['buildings'] },
  realmId: string,
): C[] {
  return world.cities.filter((c) => c.realmId === realmId && deliveryStorage(world, c.id))
}
