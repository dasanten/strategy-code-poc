// Ported from packages/shared/src/contract.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { organizationLabel } from './standing.js'
import { type WorldState } from './world.js'
import { TICKS_PER_GAME_DAY } from '@csp/balance'
import type { ContractView, MercenaryContract, RealmLabel } from '@csp/shared-types'

/** World queries about mercenary contracts (ADR 0002: the game API orders and scripts share). */

/** Game days in a game week, the period a mercenary contract is paid for (`CONTEXT.md`). */
export const GAME_DAYS_PER_WEEK = 7

/** Ticks in one game week. */
export const TICKS_PER_GAME_WEEK = GAME_DAYS_PER_WEEK * TICKS_PER_GAME_DAY

/** Game weeks the contract runs, the last one maybe short; each is paid in full. */
export function contractWeeks(c: Pick<MercenaryContract, 'days'>): number {
  return Math.ceil(c.days / GAME_DAYS_PER_WEEK)
}

/** The tick an accepted contract's time is up. */
export function contractEndsAt(c: MercenaryContract & { startedAt: number }): number {
  return c.startedAt + c.days * TICKS_PER_GAME_DAY
}

/**
 * The tick by which the contract's next unpaid week has to be paid: when that week ends, or when
 * the contract does if that is sooner. Null when it is only offered or every week is paid.
 */
export function contractPayBy(c: MercenaryContract): number | null {
  if (c.startedAt === null || c.paidWeeks >= contractWeeks(c)) return null
  return Math.min(
    c.startedAt + (c.paidWeeks + 1) * TICKS_PER_GAME_WEEK,
    contractEndsAt({ ...c, startedAt: c.startedAt }),
  )
}

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
