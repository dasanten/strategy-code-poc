import {
  CONTRACT_MAX_DAYS,
  TRADE_ORG,
  TRADE_ORG_NAME,
  formatGameTime,
  type Building,
  type City,
  type ContractView,
  type RealmLabel,
} from '@csp/shared'

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

/** Who the offer is made to or asked of (`CONTEXT.md`: Mercenary contract). */
export type OfferSide =
  { kind: 'realm'; name: string } | { kind: 'tradeOrg' } | { kind: 'npcCity'; name: string }

/** What the Contracts form holds so far. */
export interface OfferDraft {
  /** Asking to hire rather than offering the Player's own for hire. */
  hiring: boolean
  side: OfferSide | undefined
  /** The residents picked by name, for an offer to or from a realm. */
  residents: readonly string[]
  /** How many soldiers of the Trade Org army, or residents of an NPC city. */
  count: number
  days: number
  pricePerWeek: number
  /** The storage (or warehouse) paid into, by name (`storageName`). */
  storage: string | undefined
}

/** "Bram", "Bram and Tobin", "Bram, Tobin and Corwin". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Stands in the summary line for what the form still lacks. */
const MISSING = '…'

/**
 * The offer as the other side will see it, "Rent out Bram, Tobin and Corwin to Testmark for 7 days
 * at 10 coins a week, paid into Ashford storage", with "…" for what the form still lacks; complete
 * once nothing is missing and the numbers are in range, so the offer can go.
 */
export function offerSummary(d: OfferDraft): { text: string; complete: boolean } {
  const named = !d.side || d.side.kind === 'realm'
  const who = named
    ? d.residents.length > 0
      ? namesText(d.residents)
      : MISSING
    : d.side!.kind === 'tradeOrg'
      ? plural(d.count, 'soldier', 'soldiers')
      : plural(d.count, 'resident', 'residents')
  const side = !d.side ? MISSING : d.side.kind === 'tradeOrg' ? TRADE_ORG_NAME : d.side.name
  const what = d.hiring ? `Hire ${who} from ${side}` : `Rent out ${who} to ${side}`
  const days = d.days >= 1 && d.days <= CONTRACT_MAX_DAYS ? plural(d.days, 'day', 'days') : MISSING
  const price = d.pricePerWeek >= 1 ? plural(d.pricePerWeek, 'coin', 'coins') : MISSING
  const text = `${what} for ${days} at ${price} a week, paid into ${d.storage ?? MISSING}`
  const complete =
    !!d.side &&
    (named ? d.residents.length > 0 : d.count >= 1) &&
    days !== MISSING &&
    price !== MISSING &&
    !!d.storage
  return { text, complete }
}

/**
 * A storage or warehouse to pay into, by its city: "Ashford storage", and where it stands when
 * `among` has another of its kind in that city ("Ashford storage at 12, 4").
 */
export function storageName(
  b: Pick<Building, 'id' | 'kind' | 'cityId' | 'x' | 'y'>,
  cities: readonly Pick<City, 'id' | 'name'>[],
  among: readonly Pick<Building, 'id' | 'kind' | 'cityId'>[] = [],
): string {
  const city = cities.find((c) => c.id === b.cityId)
  const kind = b.kind === 'warehouse' ? 'warehouse' : 'storage'
  const name = city ? `${city.name} ${kind}` : `${kind[0]!.toUpperCase()}${kind.slice(1)}`
  const twin = among.some((o) => o.id !== b.id && o.kind === b.kind && o.cityId === b.cityId)
  return twin || !city ? `${name} at ${b.x}, ${b.y}` : name
}
