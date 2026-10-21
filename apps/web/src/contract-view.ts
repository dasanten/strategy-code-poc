import { TRADE_ORG, formatGameTime, type ContractView, type RealmLabel } from '@csp/shared'

/**
 * How a side of a contract is called: "the realm of Mara", the Trade Organization, or an NPC city
 * by its name (`CONTEXT.md`: Hiring from an NPC city), one of `cities`.
 */
export function sideName(side: RealmLabel, cities: readonly { id: string }[] = []): string {
  if (side.realmId === TRADE_ORG || cities.some((c) => c.id === side.realmId)) return side.realm
  return `the realm of ${side.realm}`
}

/** Where a contract stands, as the Player sees it. */
export function contractStatus(c: ContractView, realmId: string): string {
  if (c.startedAt === null) {
    const theirs = (c.offeredBy === 'lender' ? c.lender : c.hirer).realmId !== realmId
    return theirs ? 'Offered to you' : 'Waiting for them to accept'
  }
  const paid = `${c.paidWeeks} of ${c.weeks} weeks paid`
  if (c.payBy === null) return `${paid} · ends ${formatGameTime(c.endsAt!)}`
  return `${paid} · next week due by ${formatGameTime(c.payBy)}`
}
