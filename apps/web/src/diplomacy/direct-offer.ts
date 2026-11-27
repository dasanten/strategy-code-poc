// Direct offers (`CONTEXT.md`: Direct offer) on the client. Its rules with a Rust original are
// twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client asks
// them per frame or per row.

import { deliveryStorage } from '../trade/warehouse.js'
import type { WorldState } from '@csp/shared-types'

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
