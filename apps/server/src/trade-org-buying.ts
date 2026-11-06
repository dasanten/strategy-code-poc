import {
  TRADE_ORG,
  TRADE_ORG_PUNISH,
  forSale,
  handsOf,
  isAt,
  npcCityRefuses,
  offerRate,
  owedBy,
  quoteNpcTrade,
  quoteOffer,
  quoteTrade,
  tradeOrgRefuses,
  unitsThatFit,
  warehouseKeeps,
  wrapDistance,
  type Building,
  type City,
  type Punishment,
  type Resident,
  type ResidentOrder,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { cityOrganization } from './crimes.js'
import { headFor } from './trade-org-punishment.js'

/*
 * A Trade Org army buys Food on the way (`CONTEXT.md`: Trade Org debt). Each soldier packs Coins at
 * the HQ, and one short of Food with Coins left goes to a trading post, NPC city or Player's Food
 * offer near them and buys, by the same trade and accept orders anyone uses (ADR 0002). Their purse
 * and what they buy are their own (`Punishment.members`), so neither counts as taken.
 */

/**
 * A soldier packing at the HQ takes Coins from its coin warehouse, up to `TRADE_ORG_PUNISH.purse`, as
 * far as they fit and it has them. What they take for this is their own, not what the army came to
 * take. Answers whether they are seeing to it.
 */
export function packPurse(
  world: WorldState,
  hq: City,
  r: Resident,
  own: Stock,
  size: number,
): boolean {
  const short = Math.min(
    TRADE_ORG_PUNISH.purse - Math.floor(r.carried.coins ?? 0),
    unitsThatFit(r, 'coins', world.tick),
  )
  if (short < 1) return false
  const warehouse = world.buildings.find(
    (b) =>
      b.cityId === hq.id &&
      warehouseKeeps(world, b).includes('coins') &&
      (b.stock?.coins ?? 0) >= 1,
  )
  if (!warehouse) return false
  if (!isAt(r, warehouse, size)) {
    headFor(r, warehouse)
    return true
  }
  const coins = Math.min(short, Math.floor(warehouse.stock!.coins!))
  r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: warehouse.id }, goods: { coins } }
  own.coins = (own.coins ?? 0) + coins
  return true
}

/** A place a soldier could buy Food at, what they would get there, and the order that buys it. */
interface Sale {
  place: Building
  units: number
  order: ResidentOrder
}

/**
 * Whether the army deals with an Organization at all: not with the one it is punishing, nor with one
 * the Trade Organization refuses to trade with (`CONTEXT.md`: Trade Org reaction).
 */
const dealsWith = (world: WorldState, p: Punishment, org: string) =>
  org !== p.culpritOrg && !tradeOrgRefuses(world, org)

/**
 * What a soldier could buy up to `units` of Food for at `b`, if it is a building that sells: a trading
 * post's warehouse, or the storage of an NPC city that doesn't refuse the Trade Organization.
 */
function saleAt(
  world: WorldState,
  hq: City,
  p: Punishment,
  r: Resident,
  b: Building,
  units: number,
): Sale | undefined {
  const city = world.cities.find((c) => c.id === b.cityId)
  if (!city) return undefined
  const hands = handsOf(r, world.tick)
  let got = 0
  if (b.kind === 'warehouse' && city.tradeOrg && city.id !== hq.id) {
    got = quoteTrade(world, b, hands, 'buy', 'food', units, owedBy(world, b.id, 'food')).units
  } else if (
    b.kind === 'storage' &&
    forSale(city) &&
    city.id !== p.cityId &&
    dealsWith(world, p, cityOrganization(city)) &&
    !npcCityRefuses(world, city, TRADE_ORG)
  ) {
    got = quoteNpcTrade(world, city, b, hands, 'buy', 'food', units, TRADE_ORG).units
  }
  if (got < 1) return undefined
  return {
    place: b,
    units: got,
    order: { kind: 'trade', side: 'buy', good: 'food', units: got, carriageId: null },
  }
}

/**
 * Where a soldier could buy up to `units` of Food within `TRADE_ORG_PUNISH.postReach` tiles of them
 * (`saleAt`), and at Players' Food offers for Coins there. A Direct offer is for its named realm alone,
 * and one asking more than `TRADE_ORG_PUNISH.offerFoodPrice` a unit they pass by.
 */
function salesNear(
  world: WorldState,
  hq: City,
  p: Punishment,
  r: Resident,
  units: number,
  size: number,
): Sale[] {
  const reach = TRADE_ORG_PUNISH.postReach
  const sales: Sale[] = []
  for (const b of world.buildings) {
    if (b.site || (b.stock?.food ?? 0) < 1 || wrapDistance(size, r, b) > reach) continue
    const sale = saleAt(world, hq, p, r, b, units)
    if (sale) sales.push(sale)
  }
  const hands = handsOf(r, world.tick)
  for (const o of world.offers) {
    if (o.gives !== 'food' || o.wants !== 'coins' || o.direct) continue
    if (offerRate(o) > TRADE_ORG_PUNISH.offerFoodPrice) continue
    if (wrapDistance(size, r, o) > reach || !dealsWith(world, p, o.realmId)) continue
    const place = world.buildings.find((b) => b.id === o.storageId)
    if (!place) continue
    const wanted = Math.ceil(units / o.givesUnits)
    const q = quoteOffer(o, hands, wanted, place.stock?.food ?? 0)
    if (q.times < 1) continue
    sales.push({
      place,
      units: q.gives,
      order: { kind: 'acceptOffer', offerId: o.id, times: q.times, carriageId: null },
    })
  }
  return sales
}

/**
 * A soldier short of `units` of Food with Coins in hand goes to the nearest place selling it
 * (`salesNear`) and buys. A place they found no way to is out for the rest of the trip. Coins they
 * spend go out of what they brought as they eat (`eatFromOwn`) and the Food is their own at once,
 * as the trade can only come out less than this. Answers whether they are seeing to it.
 */
export function buyFood(
  world: WorldState,
  hq: City,
  p: Punishment,
  member: Punishment['members'][number],
  r: Resident,
  units: number,
  size: number,
): boolean {
  const sales =
    units >= 1 && (r.carried.coins ?? 0) >= 1 ? salesNear(world, hq, p, r, units, size) : []
  const open = sales.filter((s) => !member.noWay?.includes(s.place.id))
  if (open.length === 0) {
    delete member.seller
    return false
  }
  const sale = open.reduce((a, b) =>
    wrapDistance(size, r, b.place) < wrapDistance(size, r, a.place) ? b : a,
  )
  if (!isAt(r, sale.place, size)) {
    // The walk there ended without them getting there: there is no way.
    if (member.seller === sale.place.id && r.order === null) {
      member.noWay = [...(member.noWay ?? []), sale.place.id]
      delete member.seller
      return false
    }
    member.seller = sale.place.id
    headFor(r, sale.place)
    return true
  }
  delete member.seller
  r.order = sale.order
  member.own.food = (member.own.food ?? 0) + sale.units
  return true
}
