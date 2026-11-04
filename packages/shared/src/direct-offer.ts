import { sharingSight, type RealmLabel } from './alliance.js'
import { DIRECT_OFFERS_TO_ONE_REALM } from './balance.js'
import { postOfferProblem, seenOffer, type OfferTerms, type SeenOffer } from './offers.js'
import { organizationLabel } from './standing.js'
import type { DirectOfferTerms, Offer, WorldState } from './world.js'

/*
 * Direct offers (`CONTEXT.md`: Direct offer), the in-person way: an offer at a storage of the
 * sender's that only the named realm can accept. World queries orders, scripts and the UI share
 * (ADR 0002).
 */

/**
 * The other realms a realm can send a Direct offer (`CONTEXT.md`: Direct offer): those it sees
 * residents of (`seenRealms`, which may hold anything else too), its allies, those whose cities it
 * has seen (Last seen), those with a standing toward it or it toward them, and its sides in
 * contracts and Direct offers.
 */
export function realmsToOfferTo(
  world: Pick<
    WorldState,
    'realms' | 'alliances' | 'lastSeen' | 'standings' | 'contracts' | 'offers'
  >,
  realmId: string,
  seenRealms: Iterable<string>,
): string[] {
  const known = new Set<string>(seenRealms)
  for (const id of sharingSight(world, realmId)) known.add(id)
  const userId = world.realms.find((r) => r.id === realmId)?.userId
  const remembered = userId === undefined ? undefined : world.lastSeen[userId]
  for (const m of remembered ?? []) {
    if (m.is === 'city' && m.realmId !== null) known.add(m.realmId)
  }
  for (const s of world.standings) {
    if (s.of === realmId) known.add(s.toward)
    if (s.toward === realmId) known.add(s.of)
  }
  for (const c of world.contracts) {
    if (c.lenderId === realmId) known.add(c.hirerId)
    if (c.hirerId === realmId) known.add(c.lenderId)
  }
  for (const o of world.offers) {
    if (!o.direct) continue
    if (o.realmId === realmId) known.add(o.direct.toId)
    if (o.direct.toId === realmId) known.add(o.realmId)
  }
  return world.realms.map((r) => r.id).filter((id) => id !== realmId && known.has(id))
}

/**
 * Why `realmId` can't send `toId` a Direct offer on these terms, or undefined when it can: another
 * realm, not at its limit of standing ones to that realm, and an offer it could post. Whether it
 * knows of `toId` is the order's to check, which knows what it sees.
 */
export function directOfferProblem(
  world: Pick<WorldState, 'realms' | 'buildings' | 'cities' | 'offers'>,
  realmId: string,
  toId: unknown,
  terms: OfferTerms,
): string | undefined {
  if (toId === realmId) return 'send a direct offer to another realm'
  if (!world.realms.some((r) => r.id === toId)) return 'send a direct offer to a realm'
  const standing = world.offers.filter((o) => o.realmId === realmId && o.direct?.toId === toId)
  if (standing.length >= DIRECT_OFFERS_TO_ONE_REALM) {
    return `at most ${DIRECT_OFFERS_TO_ONE_REALM} direct offers can stand to one realm`
  }
  return postOfferProblem(world, realmId, terms)
}

/** Why `realmId` can't decline an offer, or undefined when it can: one sent to it, still standing. */
export function declineOfferProblem(
  world: Pick<WorldState, 'offers'>,
  realmId: string,
  offerId: unknown,
): string | undefined {
  const offer = world.offers.find((o) => o.id === offerId)
  if (!offer) return 'that offer is gone'
  return offer.direct?.toId === realmId ? undefined : 'that offer wasn’t sent to you'
}

/**
 * A Direct offer as its two sides see it, wherever they are: with who sent it, to whom, and the
 * city of the storage to fetch it at.
 */
export type DirectOfferView = SeenOffer & {
  direct: DirectOfferTerms
  from: RealmLabel
  to: RealmLabel
  /** The name of the storage's city; null for an outpost's. */
  city: string | null
}

/** The Direct offers the realm sent or was sent, oldest first. */
export function directOffersFor(
  world: Pick<WorldState, 'offers' | 'buildings' | 'realms' | 'residents' | 'cities'>,
  realmId: string,
): DirectOfferView[] {
  const label = (id: string): RealmLabel => ({ realmId: id, realm: organizationLabel(world, id) })
  return world.offers
    .filter(
      (o): o is Offer & { direct: DirectOfferTerms } =>
        o.direct !== undefined && (o.realmId === realmId || o.direct.toId === realmId),
    )
    .map((o) => {
      const cityId = world.buildings.find((b) => b.id === o.storageId)?.cityId
      return {
        ...seenOffer(o),
        direct: o.direct,
        from: label(o.realmId),
        to: label(o.direct.toId),
        city: world.cities.find((c) => c.id === cityId)?.name ?? null,
      }
    })
}
