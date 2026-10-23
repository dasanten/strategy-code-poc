import {
  CITY_PRICE_STANDING_SWING,
  buyersAtTownHall,
  buyProblem,
  cityPrice,
  coinsAtTownHall,
  commands,
  forSale,
  sellsTo,
  townHallOf,
  type WorldState,
  isAt,
} from '@csp/shared'
import { joinRealm } from './capture.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/**
 * The buy order (`CONTEXT.md`: Buying a city): one of the Player's residents, standing on an NPC
 * city's town hall, buys it with the coins the realm's residents there carry. It happens this
 * tick.
 */
export const buyCity: OrderKind = {
  validate(world, sender, order) {
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === order.residentId)
    if (!r || !realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return buyProblem(world, realm.id, r, order.cityId)
  },
  apply(world, _sender, order) {
    const r = world.residents.find((x) => x.id === order.residentId)
    if (r) r.order = { kind: 'buyCity', cityId: order.cityId as string }
  },
}

/**
 * Carries out buy orders (`CONTEXT.md`: Buying a city). Where the city still sells to the realm
 * (`sellsTo`: for sale, and its standing toward the realm not too low), the
 * buyer still on its town hall and the realm's residents there carry its price, the coins are
 * used up, the buyer's own first, and the city joins the realm with everything in it, as when
 * captured (`joinRealm`). Too few coins, and the deal falls through with a line in the realm log.
 * Either way the order is done. Returns how many cities were bought.
 */
export function resolvePurchases(world: WorldState, size: number): number {
  let bought = 0
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'buyCity') continue
    r.order = null
    const city = world.cities.find((c) => c.id === o.cityId)
    const hall = city && townHallOf(world, city)
    const realm = r.owner
    if (!city || !hall || realm === null || !sellsTo(world, city, realm)) continue
    if (!isAt(r, hall, size)) continue
    const price = cityPrice(world, city, realm)
    const coins = coinsAtTownHall(world, city, realm)
    if (coins < price) {
      recordEvent(world, realm, {
        kind: 'cityNotBought',
        cityId: city.id,
        city: city.name,
        price,
        coins,
      })
      continue
    }
    let owed = price
    for (const p of [r, ...buyersAtTownHall(world, city, realm).filter((x) => x !== r)]) {
      const paid = Math.min(owed, p.carried.coins ?? 0)
      owed -= paid
      const left = (p.carried.coins ?? 0) - paid
      if (left > 0) p.carried.coins = left
      else delete p.carried.coins
      if (owed === 0) break
    }
    const residents = joinRealm(world, city, realm, size)
    recordEvent(world, realm, {
      kind: 'cityBought',
      cityId: city.id,
      city: city.name,
      price,
      residents,
      x: hall.x,
      y: hall.y,
    })
    bought++
  }
  return bought
}

/**
 * An NPC city's price to every Organization it holds a standing toward (`CONTEXT.md`: NPC city
 * reaction) is a whole number of coins within `CITY_PRICE_STANDING_SWING` of what it is worth:
 * standing moves the price, never past half again or below half.
 */
export const cityPricesSound: Invariant = {
  name: 'city-prices-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const city of world.cities) {
      if (!forSale(city)) continue
      const worth = cityPrice(world, city)
      for (const s of world.standings) {
        if (s.of !== city.id) continue
        const price = cityPrice(world, city, s.toward)
        const low = Math.floor(worth * (1 - CITY_PRICE_STANDING_SWING))
        const high = Math.ceil(worth * (1 + CITY_PRICE_STANDING_SWING))
        if (Number.isInteger(price) && price >= low && price <= high) continue
        out.push({
          invariant: this.name,
          message: `${city.id} asks ${s.toward} ${price} coins, worth ${worth}`,
          entityIds: [city.id, s.toward],
        })
      }
    }
    return out
  },
}

/** Every buy order is done the tick it is given (`resolvePurchases`): none outlasts a tick. */
export const buyOrdersDone: Invariant = {
  name: 'buy-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'buyCity')
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} still holds a buy order after the tick`,
        entityIds: [r.id],
      }))
  },
}
