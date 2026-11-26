// Ported from packages/shared/src/contract.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { organizationLabel } from './standing.js'
import type { ContractView, MercenaryContract, RealmLabel, WorldState } from '@csp/shared-types'
import { contractWeeks, contractEndsAt, contractPayBy } from '@csp/lang-wasm'

export { contractWeeks, contractEndsAt, contractPayBy } from '@csp/lang-wasm'

/** World queries about mercenary contracts (ADR 0002: the game API orders and scripts share). */

export { GAME_DAYS_PER_WEEK, TICKS_PER_GAME_WEEK } from '@csp/shared-types'

/** The contract in force that rents out the resident, if any. */
export function contractOf(
  world: Pick<WorldState, 'contracts'>,
  residentId: string,
): MercenaryContract | undefined {
  return world.contracts.find((c) => c.startedAt !== null && c.residentIds.includes(residentId))
}

/** The contracts the realm is a side of, offered or in force. */
export function contractsFor(
  world: Pick<WorldState, 'contracts' | 'realms' | 'residents' | 'buildings' | 'cities'>,
  realmId: string,
): ContractView[] {
  const label = (id: string): RealmLabel => ({ realmId: id, realm: organizationLabel(world, id) })
  return world.contracts
    .filter((c) => c.lenderId === realmId || c.hirerId === realmId)
    .map((c) => {
      const storage = world.buildings.find((b) => b.id === c.storageId)
      return {
        id: c.id,
        lender: label(c.lenderId),
        hirer: label(c.hirerId),
        offeredBy: c.offeredBy,
        residents: c.residentIds.map((id) => ({
          id,
          name: world.residents.find((r) => r.id === id)?.name ?? '?',
        })),
        days: c.days,
        pricePerWeek: c.pricePerWeek,
        storage: storage ? { id: storage.id, x: storage.x, y: storage.y } : null,
        startedAt: c.startedAt,
        endsAt: c.startedAt === null ? null : contractEndsAt({ ...c, startedAt: c.startedAt }),
        weeks: contractWeeks(c),
        paidWeeks: c.paidWeeks,
        payBy: contractPayBy(c),
      }
    })
}
