import { realmName, type RealmLabel } from './alliance.js'
import { TICKS_PER_GAME_DAY, type MercenaryContract, type WorldState } from './world.js'

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

/** A mercenary contract as one of its sides sees it. */
export interface ContractView {
  id: string
  lender: RealmLabel
  hirer: RealmLabel
  offeredBy: MercenaryContract['offeredBy']
  /** The rented residents, by id and name; a dead one is gone from the contract. */
  residents: { id: string; name: string }[]
  days: number
  pricePerWeek: number
  /** The storage to pay into, with where it stands; null once it is gone. */
  storage: { id: string; x: number; y: number } | null
  startedAt: number | null
  /** When its time is up; null while only offered. */
  endsAt: number | null
  weeks: number
  paidWeeks: number
  /** When the next unpaid week has to be paid by (`contractPayBy`). */
  payBy: number | null
}

/** The contracts the realm is a side of, offered or in force. */
export function contractsFor(
  world: Pick<WorldState, 'contracts' | 'realms' | 'residents' | 'buildings'>,
  realmId: string,
): ContractView[] {
  const label = (id: string): RealmLabel => ({ realmId: id, realm: realmName(world, id) })
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
