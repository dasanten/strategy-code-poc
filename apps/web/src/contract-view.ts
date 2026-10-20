import { formatGameTime, type ContractView } from '@csp/shared'

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
