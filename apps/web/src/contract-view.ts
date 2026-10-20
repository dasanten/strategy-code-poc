import { formatGameTime, type ContractView, type Resident } from '@csp/shared'

/**
 * The residents in sight whose orders the Player gives (`CONTEXT.md`: Mercenary contract): their
 * own, but for those rented out under a contract in force, and the mercenaries they hired.
 */
export function commanded(
  residents: Resident[],
  contracts: ContractView[],
  realmId: string,
): Resident[] {
  const inForce = contracts.filter((c) => c.startedAt !== null)
  const ids = (side: 'lender' | 'hirer') =>
    new Set(
      inForce
        .filter((c) => c[side].realmId === realmId)
        .flatMap((c) => c.residents.map((r) => r.id)),
    )
  const rentedOut = ids('lender')
  const hired = ids('hirer')
  return residents.filter((r) => (r.owner === realmId ? !rentedOut.has(r.id) : hired.has(r.id)))
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
