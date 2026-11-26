// Ported from packages/shared/src/direct-offer.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { GOOD_WEIGHT } from './narrowed.js'
import { feeAtPickUp, transferFee } from './transfer.js'
import { deliveryStorage } from './warehouse.js'
import type { CarriedFeeBy, CarriedWay, Good, Offer, WorldState } from '@csp/shared-types'
import { carriedUnloadShares } from '@csp/lang-wasm'

export { carriedUnloadShares } from '@csp/lang-wasm'

/*
 * Direct offers (`CONTEXT.md`: Direct offer): in person, an offer at a storage of the sender's that
 * only the named realm can accept; carried, two Transfers once they accept. World queries orders,
 * scripts and the UI share (ADR 0002).
 */

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
