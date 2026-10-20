import {
  handsOf,
  loadOf,
  quoteTrade,
  warehousePrices,
  type Building,
  type BuildingKind,
  type Carriage,
  type PricedGood,
  type TradeQuote,
  type City,
  type RealmLabel,
  type Resident,
  type SeenCity,
  type WarehousePrice,
} from '@csp/shared'

/** What the city inspector says about a city in sight, from what the Player sees of it. */
export interface CityView {
  id: string
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
  seen: { residents: Resident[]; buildings: Building[] },
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
  seen: { residents: Resident[]; buildings: Building[] },
  realmId: string,
): BuyView | undefined {
  if (city.price === undefined) return undefined
  const hall = seen.buildings.find((b) => b.id === city.townHallId)
  if (!hall) return { price: city.price, coins: 0 }
  const here = seen.residents.filter((r) => r.owner === realmId && r.x === hall.x && r.y === hall.y)
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
  x: number
  y: number
  prices: WarehousePrice[]
}

/**
 * The prices of a city's warehouses in sight: anyone with a resident in sight of a warehouse
 * sees its prices. Warehouses that price nothing (the HQ's coin warehouse) are left out.
 */
export function warehousesInSight(
  city: City,
  seen: { cities: City[]; buildings: Building[] },
): WarehouseView[] {
  return seen.buildings
    .filter((b) => b.kind === 'warehouse' && b.cityId === city.id)
    .map((b) => ({ id: b.id, x: b.x, y: b.y, prices: warehousePrices(seen, b) }))
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

/** The Player's residents and carriages on a warehouse's tile. */
export function tradersAt(
  warehouse: { x: number; y: number },
  seen: { residents: Resident[]; carriages: Carriage[] },
  realmId: string,
): TradersView {
  const here = (t: { x: number; y: number }) => t.x === warehouse.x && t.y === warehouse.y
  return {
    residents: seen.residents.filter((r) => r.owner === realmId && here(r)),
    carriages: seen.carriages.filter((k) => k.realmId === realmId && here(k)),
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
