import {
  deliveryStorage,
  nearestWarehouse,
  quoteTransfer,
  transferTiles,
  handsOf,
  loadOf,
  quoteDelivery,
  quotePickUp,
  quoteTrade,
  tradeCoinWarehouse,
  wrapDistance,
  type Building,
  type BuildingKind,
  type Carriage,
  GOOD_WEIGHT,
  type DeliveryQuote,
  type Good,
  type NpcCityPrice,
  type PricedGood,
  type TradeQuote,
  type City,
  type RealmLabel,
  type Resident,
  type SeenCity,
  type WarehousePrice,
  isAt,
  type SeenResident,
  type SeenCarriage,
  type SeenBuilding,
  type Shown,
} from '@csp/shared'
import { faresKnown, loadKnown } from './seen.js'

/** What the city inspector says about a city in sight, from what the Player sees of it. */
export interface CityView {
  id: string
  /** A warehouse, or an NPC city’s storage: its footprint is where traders stand. */
  name: string
  /** Whose city it is (`CONTEXT.md`: City, NPC city). */
  whose: string
  /** Residents in sight who live there. */
  residents: number
  /** Its buildings in sight, by kind, most first. */
  buildings: [BuildingKind, number][]
}

/** Building names as the city inspector shows them. */
export const BUILDING_NAMES: Record<BuildingKind, string> = {
  townHall: 'town hall',
  house: 'house',
  storage: 'storage',
  warehouse: 'warehouse',
  wall: 'wall',
  gate: 'gate',
  farm: 'farm',
  stable: 'stable',
  mine: 'mine',
  quarry: 'quarry',
  lumberCamp: 'lumber camp',
  smelter: 'smelter',
  mint: 'mint',
  smithy: 'smithy',
  road: 'road',
  carriage: 'carriage site',
}

/** "3 houses", "1 storage". */
export function buildingCount(kind: BuildingKind, n: number): string {
  const name = BUILDING_NAMES[kind]
  return `${n} ${n === 1 ? name : name.endsWith('s') ? `${name}es` : `${name}s`}`
}

/**
 * Describes a city in sight: your own, a city of another realm (by its name when the Player
 * knows it), the Trade Org HQ, a trading post, or an NPC city run by the game.
 */
export function describeCity(
  city: City,
  seen: { residents: SeenResident[]; buildings: Building[] },
  realmId: string,
  realms: RealmLabel[],
): CityView {
  const whose =
    city.tradeOrg === 'hq'
      ? 'Trade Org HQ'
      : city.tradeOrg === 'post'
        ? 'Trading post'
        : city.realmId === null
          ? 'NPC city'
          : city.realmId === realmId
            ? 'Your city'
            : `City of the realm of ${realms.find((r) => r.realmId === city.realmId)?.realm ?? 'another Player'}`
  const counts = new Map<BuildingKind, number>()
  for (const b of seen.buildings) {
    if (b.cityId === city.id && !b.site) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1)
  }
  return {
    id: city.id,
    name: city.name,
    whose,
    residents: seen.residents.filter((r) => r.cityId === city.id).length,
    buildings: [...counts].sort((a, b) => b[1] - a[1]),
  }
}

/** What the city inspector offers for buying an NPC city (`CONTEXT.md`: Buying a city). */
export interface BuyView {
  /** The price in Coins it names. */
  price: number
  /** Its town hall, where the coins have to be carried; missing when it isn't in sight. */
  townHall?: { x: number; y: number }
  /** Coins the Player's residents on its town hall carry together. */
  coins: number
  /** One of the Player's residents on its town hall, to give the buy order; none when nobody is. */
  buyerId?: string
}

/** How the Player could buy a city in sight, or undefined when it isn't for sale. */
export function describeBuying(
  city: SeenCity,
  seen: { residents: SeenResident[]; buildings: Building[] },
  realmId: string,
): BuyView | undefined {
  if (city.price === undefined) return undefined
  const hall = seen.buildings.find((b) => b.id === city.townHallId)
  if (!hall) return { price: city.price, coins: 0 }
  const here = seen.residents.filter((r) => r.owner === realmId && isAt(r, hall))
  return {
    price: city.price,
    townHall: { x: hall.x, y: hall.y },
    coins: here.reduce((n, r) => n + (r.carried.coins ?? 0), 0),
    ...(here[0] ? { buyerId: here[0].id } : {}),
  }
}

/** A Trade Org warehouse in sight and its prices (`CONTEXT.md`: Warehouse prices). */
export interface WarehouseView {
  id: string
  /** A warehouse, or an NPC city’s storage: its footprint is where traders stand. */
  kind: BuildingKind
  x: number
  y: number
  prices: Shown<WarehousePrice>[]
}

/**
 * The prices of a city's warehouses in sight, as the server names them: anyone with a resident in
 * sight of a warehouse sees its prices, and what it holds only when they see inside
 * (`CONTEXT.md`: Seeing inside a storage). Warehouses that price nothing (the HQ's coin warehouse)
 * are left out.
 */
export function warehousesInSight(
  city: City,
  seen: { cities: City[]; buildings: SeenBuilding[] },
): WarehouseView[] {
  return seen.buildings
    .filter((b) => b.kind === 'warehouse' && b.cityId === city.id)
    .map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, prices: b.prices ?? [] }))
    .filter((w) => w.prices.length > 0)
}

/**
 * Who of the Player's could trade at a warehouse in sight (`CONTEXT.md`: Trading with the Trade
 * Organization): their residents on its tile, and their carriages there to trade from instead of
 * hands.
 */
export interface TradersView {
  residents: Resident[]
  carriages: Carriage[]
}

/** The Player’s residents and carriages at a warehouse (or an NPC city’s storage). */
export function tradersAt(
  warehouse: Pick<Building, 'kind' | 'x' | 'y'>,
  seen: { residents: SeenResident[]; carriages: SeenCarriage[] },
  realmId: string,
): TradersView {
  const here = (t: { x: number; y: number }) => isAt(t, warehouse)
  return {
    residents: seen.residents.filter((r) => r.owner === realmId && here(r)).filter(faresKnown),
    carriages: seen.carriages.filter((k) => k.realmId === realmId && here(k)).filter(loadKnown),
  }
}

/**
 * What buying and selling up to `units` of a good would move for one of the Player's residents,
 * from their hands or `carriage` (`quoteTrade`), from what the Player sees. The server decides;
 * this is the preview.
 */
export function previewTrade(
  seen: { cities: City[]; buildings: Building[] },
  warehouseId: string,
  resident: Resident,
  carriage: Carriage | undefined,
  good: PricedGood,
  units: number,
  tick: number,
): { buy: TradeQuote; sell: TradeQuote } {
  const warehouse = seen.buildings.find((b) => b.id === warehouseId)
  const none = { units: 0, coins: 0 }
  if (!warehouse || !(units > 0)) return { buy: none, sell: none }
  const holder = carriage ? loadOf(carriage) : handsOf(resident, tick)
  return {
    buy: quoteTrade(seen, warehouse, holder, 'buy', good, units),
    sell: quoteTrade(seen, warehouse, holder, 'sell', good, units),
  }
}

/** A city of the Player's that a delivery can go to or a pick-up come from, and its storage. */
export interface DeliveryCity {
  id: string
  /** A warehouse, or an NPC city’s storage: its footprint is where traders stand. */
  name: string
  storage: Building
}

/** The Player's cities with a storage in sight (`deliveryStorage`; `CONTEXT.md`: Delivery). */
export function deliveryCities(
  seen: { cities: City[]; buildings: Building[] },
  realmId: string,
): DeliveryCity[] {
  return seen.cities
    .filter((c) => c.realmId === realmId)
    .flatMap((c) => {
      const storage = deliveryStorage(seen, c.id)
      return storage ? [{ id: c.id, name: c.name, storage }] : []
    })
}

/**
 * What buying up to `units` of a good for delivery to `city`, paid from the resident's hands or
 * `carriage`, and selling up to `units` from its storage for a pick-up would come to
 * (`quoteDelivery`, `quotePickUp`), from what the Player sees. The server decides; this is the
 * preview. `mapSize` is the map's.
 */
export function previewDelivery(
  seen: { cities: City[]; buildings: Building[] },
  warehouseId: string,
  resident: Resident,
  carriage: Carriage | undefined,
  good: PricedGood,
  units: number,
  city: DeliveryCity,
  mapSize: number,
): { buy: DeliveryQuote; sell: DeliveryQuote } {
  const warehouse = seen.buildings.find((b) => b.id === warehouseId)
  const none = { units: 0, coins: 0, fee: 0 }
  if (!warehouse || !(units > 0)) return { buy: none, sell: none }
  const tiles = wrapDistance(mapSize, warehouse, city.storage)
  const payer = carriage ? carriage.load : resident.carried
  const held = city.storage.stock?.[good] ?? 0
  const budget = tradeCoinWarehouse(seen, warehouse)?.stock?.coins ?? 0
  return {
    buy: quoteDelivery(seen, warehouse, payer, good, units, tiles),
    sell: quotePickUp(seen, warehouse, good, units, held, tiles, budget),
  }
}

/**
 * Whether the Player can send a transfer to the city (`CONTEXT.md`: Transfer): it is another
 * realm's, with a storage the Player sees.
 */
export function takesTransfers(
  city: City,
  seen: { buildings: Building[] },
  realmId: string,
): boolean {
  return city.realmId !== null && city.realmId !== realmId && !!deliveryStorage(seen, city.id)
}

/**
 * What a transfer of up to `units` of a good picked up at the Player's city `from` for the city
 * `toCityId` would take there (`quoteTransfer`, `CONTEXT.md`: Transfer), from what the Player
 * sees: the units and fee, coming from the warehouse in sight nearest `from`. Undefined when no
 * warehouse or the recipient's storage is in sight. The server decides; this is the preview.
 */
export function previewTransfer(
  seen: { cities: City[]; buildings: Building[] },
  from: DeliveryCity,
  toCityId: string,
  good: Good,
  units: number,
  mapSize: number,
): { units: number; fee: number } | undefined {
  const to = deliveryStorage(seen, toCityId)
  const warehouse = nearestWarehouse(seen, from.storage, mapSize)
  if (!to || !warehouse || !(units > 0)) return undefined
  const tiles = transferTiles(mapSize, warehouse, from.storage, to)
  return quoteTransfer(from.storage.stock ?? {}, good, units, tiles)
}

/**
 * The storages of an NPC city in sight, each with the city's prices to the Player
 * (`CONTEXT.md`: Trading with an NPC city). None when the city names no prices: it refuses the
 * Player, or no storage of it is in sight.
 */
export function npcStoragesInSight(
  city: SeenCity,
  seen: { buildings: Building[] },
): WarehouseView[] {
  const prices = city.trade
  if (!prices) return []
  return seen.buildings
    .filter((b) => b.kind === 'storage' && !b.site && b.cityId === city.id)
    .map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, prices }))
}

/**
 * About what a trade with an NPC city at its `storage` would move (`CONTEXT.md`: Trading with an
 * NPC city), from the prices it names the Player: each unit at today's price, cut down to its
 * surplus or what it lacks of its reserve, what that storage holds, the coins on either side and
 * what fits. The server prices each unit as the stock moves, so the coins may differ a little.
 */
export function previewNpcTrade(
  prices: NpcCityPrice[],
  storage: Building,
  resident: Resident,
  carriage: Carriage | undefined,
  good: PricedGood,
  units: number,
  tick: number,
): { buy: TradeQuote; sell: TradeQuote } {
  const line = prices.find((p) => p.good === good)
  const none = { units: 0, coins: 0 }
  if (!line || !(units > 0)) return { buy: none, sell: none }
  const holder = carriage ? loadOf(carriage) : handsOf(resident, tick)
  // How many units fit when each adds `per` kg to the holder.
  const fits = (per: number) => (per > 0 ? (holder.room + 1e-9) / per : Infinity)
  const perBuy = GOOD_WEIGHT[good] - line.sell * GOOD_WEIGHT.coins
  const perSell = line.buy * GOOD_WEIGHT.coins - GOOD_WEIGHT[good]
  const buyUnits = Math.floor(
    Math.min(
      units,
      line.forSale,
      storage.stock?.[good] ?? 0,
      (holder.stock.coins ?? 0) / line.sell,
      fits(perBuy),
    ),
  )
  const sellUnits = Math.floor(
    Math.min(
      units,
      line.wanted,
      holder.stock[good] ?? 0,
      (storage.stock?.coins ?? 0) / line.buy,
      fits(perSell),
    ),
  )
  return {
    buy: { units: buyUnits, coins: buyUnits * line.sell },
    sell: { units: sellUnits, coins: sellUnits * line.buy },
  }
}
