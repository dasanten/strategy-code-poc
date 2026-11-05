import { wantsNothing, type Diplomacy, type DirectOfferView } from '@csp/shared'
import { GOOD_LABELS } from './goods-grid.js'
import { carriedLine, offerStands, offerTerms } from './offers-view.js'

/**
 * What others sent the Player that waits for their answer, wherever they are: one list, whatever
 * kind each thing is. A new kind (a demand, `CONTEXT.md`: Demand) is one more case here and in
 * `incomingItems`; the notice and `IncomingList` take it as it comes.
 */
export type IncomingItem = {
  kind: 'directOffer'
  id: string
  /** Who sent it and what it is, in a line. */
  line: string
  /** The tick it lapses at. */
  lapsesAt: number
  offer: DirectOfferView
}

/** What was sent to the realm and waits for its answer, oldest first. */
export function incomingItems(
  diplomacy: Pick<Diplomacy, 'directOffers'>,
  realmId: string,
): IncomingItem[] {
  return diplomacy.directOffers
    .filter((o) => o.direct.toId === realmId)
    .map((offer) => ({
      kind: 'directOffer' as const,
      id: offer.id,
      line: wantsNothing(offer)
        ? `${offer.from.city ? offer.from.realm : `The realm of ${offer.from.realm}`} set aside what you demanded: ${offerStands(offer, GOOD_LABELS)}`
        : `The realm of ${offer.from.realm} offers: ${(offer.direct.carried
            ? carriedLine(offer, GOOD_LABELS)
            : offerTerms(offer, GOOD_LABELS)
          ).toLowerCase()}`,
      lapsesAt: offer.direct.lapsesAt,
      offer,
    }))
}

/**
 * What the notice says of what the Player hasn't put away yet: the newest, and how many more.
 * Undefined with nothing new, or while the drawer that lists them is open.
 */
export function incomingNoticeLine(
  items: readonly IncomingItem[],
  putAway: ReadonlySet<string>,
  drawerOpen: boolean,
): string | undefined {
  if (drawerOpen) return undefined
  const fresh = items.filter((i) => !putAway.has(i.id))
  const newest = fresh.at(-1)
  if (!newest) return undefined
  return fresh.length === 1 ? newest.line : `${newest.line}, and ${fresh.length - 1} more`
}
