// Ported from packages/shared/src/direct-offer.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { realmsKnownTo } from './demand.js'
import { GOOD_WEIGHT } from './narrowed.js'
import {
  offerTermsProblem,
  postOfferProblem,
  seenOffer,
  type OfferTerms,
  wantsNothing,
} from './offers.js'
import { organizationLabel, tradeOrgRefuses } from './standing.js'
import { NO_CARAVANS, tradeOrgHq } from './trade-org.js'
import {
  feeAtPickUp,
  nearestWarehouse,
  pickUpTransferProblem,
  transferFee,
  transferTiles,
} from './transfer.js'
import { deliveryStorage } from './warehouse.js'
import { type Offer, type WorldState } from './world.js'
import { DIRECT_OFFERS_TO_ONE_REALM } from '@csp/balance'
import type {
  CarriedFeeBy,
  CarriedOfferTerms,
  CarriedWay,
  DirectOfferTerms,
  DirectOfferView,
  Good,
  RealmLabel,
} from '@csp/shared-types'

/*
 * Direct offers (`CONTEXT.md`: Direct offer): in person, an offer at a storage of the sender's that
 * only the named realm can accept; carried, two Transfers once they accept. World queries orders,
 * scripts and the UI share (ADR 0002).
 */

/** The other realms a realm can send a Direct offer (`CONTEXT.md`): those it knows of. */
export function realmsToOfferTo(
  world: Parameters<typeof realmsKnownTo>[0],
  realmId: string,
  seenRealms: Iterable<string>,
): string[] {
  return realmsKnownTo(world, realmId, seenRealms)
}

/** Why `realmId` can't send `toId` any Direct offer: another realm, and not at its limit to it. */
function sendingProblem(
  world: Pick<WorldState, 'realms' | 'offers'>,
  realmId: string,
  toId: unknown,
): string | undefined {
  if (toId === realmId) return 'send a direct offer to another realm'
  if (!world.realms.some((r) => r.id === toId)) return 'send a direct offer to a realm'
  // Goods set aside on accepting a demand were asked for: they use up none of the limit.
  const standing = world.offers.filter(
    (o) => o.realmId === realmId && o.direct?.toId === toId && !wantsNothing(o),
  )
  if (standing.length >= DIRECT_OFFERS_TO_ONE_REALM) {
    return `at most ${DIRECT_OFFERS_TO_ONE_REALM} direct offers can stand to one realm`
  }
  return undefined
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
  return sendingProblem(world, realmId, toId) ?? postOfferProblem(world, realmId, terms)
}

/** An offer's goods, units and times, as an order sends them or an offer holds them. */
type OfferGoods = Pick<OfferTerms, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits' | 'times'>

/** What a sender asks a carried Direct offer to be: the two cities and who pays. */
export type CarriedRequest = {
  fromCityId: unknown
  toCityId: unknown
  feeBy: unknown
}

/**
 * The part of the fee each of a carried Direct offer's two Transfers takes where it unloads
 * (`CONTEXT.md`: Direct offer). Paid by the sender, theirs all at its pick-up and the other side's
 * all on unloading at the sender's city; split, half of each at either end.
 */
export function carriedUnloadShares(feeBy: CarriedFeeBy): { sender: number; other: number } {
  return feeBy === 'sender' ? { sender: 0, other: 1 } : { sender: 0.5, other: 0.5 }
}

/** The way between two cities, undefined when a storage or warehouse is missing. */
function carriedWay(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  size: number,
  fromCityId: string,
  toCityId: string,
): CarriedWay | undefined {
  const from = deliveryStorage(world, fromCityId)
  const to = deliveryStorage(world, toCityId)
  if (!from || !to) return undefined
  const senderWarehouse = nearestWarehouse(world, from, size)
  const otherWarehouse = nearestWarehouse(world, to, size)
  if (!senderWarehouse || !otherWarehouse) return undefined
  return {
    fromCityId,
    toCityId,
    senderTiles: transferTiles(size, senderWarehouse, from, to),
    otherTiles: transferTiles(size, otherWarehouse, to, from),
  }
}

/**
 * The ways the realm can name for a carried Direct offer, so the UI can show its exact fee: from each
 * of its cities with a storage to each city of another realm whose storage is among `seenStorages`.
 * None once the HQ has fallen. `size` is the map's.
 */
export function carriedWaysFor(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  size: number,
  realmId: string,
  seenStorages: readonly { cityId: string | null }[],
): CarriedWay[] {
  if (!tradeOrgHq(world)) return []
  const others = new Set<string>()
  for (const s of seenStorages) {
    const city = s.cityId === null ? undefined : world.cities.find((c) => c.id === s.cityId)
    if (city?.realmId && city.realmId !== realmId) others.add(city.id)
  }
  if (others.size === 0) return []
  return citiesToCarryAt(world, realmId).flatMap((own) =>
    [...others].flatMap((other) => carriedWay(world, size, own.id, other) ?? []),
  )
}

/**
 * What each side of a carried Direct offer pays on a way when all of its goods are taken: the
 * sender's goods over `senderTiles`, the other side's over `otherTiles`, each fee's parts as who
 * pays says (`carriedUnloadShares`).
 */
export function carriedFeesOver(
  way: Pick<CarriedWay, 'senderTiles' | 'otherTiles'>,
  feeBy: CarriedFeeBy,
  goods: Pick<Offer, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits' | 'times'>,
): { senderFee: number; otherFee: number } {
  const fee = (good: Good, units: number, tiles: number) =>
    transferFee(units * GOOD_WEIGHT[good], tiles)
  const senders = fee(goods.gives, goods.givesUnits * goods.times, way.senderTiles)
  const others = fee(goods.wants, goods.wantsUnits * goods.times, way.otherTiles)
  const shares = carriedUnloadShares(feeBy)
  const sendersAtPickUp = feeAtPickUp(senders, shares.sender)
  const othersAtPickUp = feeAtPickUp(others, shares.other)
  return {
    senderFee: sendersAtPickUp + others - othersAtPickUp,
    otherFee: senders - sendersAtPickUp + othersAtPickUp,
  }
}

/** What each side pays for this offer between the two cities, undefined with a way missing. */
export function carriedOfferFees(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  size: number,
  carried: Pick<CarriedOfferTerms, 'fromCityId' | 'toCityId' | 'feeBy'>,
  goods: Pick<Offer, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits' | 'times'>,
): { senderFee: number; otherFee: number } | undefined {
  const way = carriedWay(world, size, carried.fromCityId, carried.toCityId)
  return way && carriedFeesOver(way, carried.feeBy, goods)
}

/**
 * Why the Trade Organization can't carry this offer between `senderId` and `toId`, or undefined when
 * it can (`CONTEXT.md`: Direct offer): the HQ stands, it refuses neither side, sound terms, and
 * both Transfers are ones each side could order, each within one load. `asking` is the realm
 * being answered.
 */
function carriedProblem(
  world: WorldState,
  senderId: string,
  toId: string,
  carried: CarriedRequest,
  goods: OfferGoods,
  asking: string,
): string | undefined {
  if (!tradeOrgHq(world)) return NO_CARAVANS
  for (const id of [senderId, toId]) {
    if (tradeOrgRefuses(world, id)) {
      return `the Trade Organization won’t carry for ${id === asking ? 'you' : 'them'}`
    }
  }
  const problem = offerTermsProblem(goods)
  if (problem) return problem
  if (carried.feeBy !== 'sender' && carried.feeBy !== 'split') {
    return 'the fee is paid by the sender or split'
  }
  const from = world.cities.find((c) => c.id === carried.fromCityId)
  const to = world.cities.find((c) => c.id === carried.toCityId)
  if (from?.realmId !== senderId) return 'the goods are picked up at a city of the sender'
  if (to?.realmId !== toId) return 'the goods go to a city of the realm it is sent to'
  const times = goods.times as number
  return (
    pickUpTransferProblem(
      world,
      senderId,
      carried.fromCityId,
      goods.gives,
      (goods.givesUnits as number) * times,
      carried.toCityId,
    ) ??
    pickUpTransferProblem(
      world,
      toId,
      carried.toCityId,
      goods.wants,
      (goods.wantsUnits as number) * times,
      carried.fromCityId,
    )
  )
}

/**
 * Why `realmId` can't send `toId` a carried Direct offer, or undefined when it can. Its goods aren't
 * set aside, so they needn't be there yet. Whether it knows of `toId` and sees that city's storage
 * is the order's to check.
 */
export function carriedOfferProblem(
  world: WorldState,
  realmId: string,
  toId: unknown,
  carried: CarriedRequest,
  goods: OfferGoods,
): string | undefined {
  const problem = sendingProblem(world, realmId, toId)
  if (problem) return problem
  return carriedProblem(world, realmId, toId as string, carried, goods, realmId)
}

/** Why `realmId` can't accept this carried Direct offer now, or undefined when it can. */
export function acceptCarriedProblem(
  world: WorldState,
  realmId: string,
  offerId: unknown,
): string | undefined {
  const offer = world.offers.find((o) => o.id === offerId)
  if (!offer) return 'that offer is gone'
  if (offer.direct?.toId !== realmId) return 'that offer wasn’t sent to you'
  if (!offer.direct.carried) return 'that offer is fetched in person'
  return carriedProblem(world, offer.realmId, realmId, offer.direct.carried, offer, realmId)
}

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

/** The Direct offers the realm sent or was sent, oldest first. */
export function directOffersFor(
  world: Pick<WorldState, 'offers' | 'buildings' | 'realms' | 'residents' | 'cities'>,
  realmId: string,
): DirectOfferView[] {
  const label = (id: string): RealmLabel => ({
    realmId: id,
    realm: organizationLabel(world, id),
    ...(world.cities.some((c) => c.id === id) && { city: true as const }),
  })
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
        ...(o.direct.carried && {
          toCity:
            world.cities.find((c) => c.id === o.direct.carried!.toCityId)?.name ?? 'a lost city',
        }),
      }
    })
}
