// Offers at a storage as the client shows them (`CONTEXT.md`: Offer). Its rules with a Rust
// original are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the
// client asks them per frame or per row.

import type { Building, Good, Stock, Offer, WorldState } from '@csp/shared-types'

/**
 * Whether an offer wants nothing for its goods: what was set aside on accepting a demand, for the
 * demand's sender to fetch (`CONTEXT.md`: Demand). Only such a Direct offer can.
 */
export const wantsNothing = (o: Pick<Offer, 'wantsUnits'>) => o.wantsUnits === 0

/**
 * The offers standing at a storage, oldest first. A carried Direct offer stands at none: it only
 * names a city to pick up from, and sets nothing aside (`CONTEXT.md`: Direct offer).
 */
export function offersAt(world: Pick<WorldState, 'offers'>, storageId: string): Offer[] {
  return world.offers.filter((o) => o.storageId === storageId && !o.direct?.carried)
}

/** The goods its offers set aside at a storage. */
export function setAsideAt(world: Pick<WorldState, 'offers'>, storageId: string): Stock {
  const aside: Stock = {}
  for (const o of offersAt(world, storageId)) {
    aside[o.gives] = (aside[o.gives] ?? 0) + o.times * o.givesUnits
  }
  return aside
}

/**
 * The goods of a storage that aren't set aside for its offers: what workers, builders, Fetch,
 * pick-ups and refills may take (`CONTEXT.md`: Offer). Only to read: without offers it is the
 * stock itself.
 */
export function freeStock(
  world: Pick<WorldState, 'offers'>,
  storage: Pick<Building, 'id' | 'stock'>,
): Stock {
  const stock = storage.stock ?? {}
  if (world.offers.length === 0) return stock
  const aside = setAsideAt(world, storage.id)
  const goods = Object.keys(aside) as Good[]
  if (goods.length === 0) return stock
  const free: Stock = { ...stock }
  for (const good of goods) {
    const left = (stock[good] ?? 0) - aside[good]!
    if (left > 0) free[good] = left
    else delete free[good]
  }
  return free
}

/**
 * How many times over an offer of `givesUnits` a time can be posted at a storage, of the `times`
 * asked for: as many as there are goods not yet set aside.
 */
export function timesToPost(
  world: Pick<WorldState, 'offers'>,
  storage: Pick<Building, 'id' | 'stock'>,
  gives: Good,
  givesUnits: number,
  times: number,
): number {
  return Math.min(times, Math.floor((freeStock(world, storage)[gives] ?? 0) / givesUnits))
}

/**
 * Whether `side` may accept an offer in person, its own aside: anyone, unless it is a Direct offer
 * to another realm or a carried one (`CONTEXT.md`: Direct offer). What goes looking for offers to
 * take asks this first.
 */
export const offerOpenTo = (o: Pick<Offer, 'direct'>, side: string): boolean =>
  !o.direct || (o.direct.toId === side && !o.direct.carried)
