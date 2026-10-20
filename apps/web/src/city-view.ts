import {
  warehousePrices,
  type Building,
  type BuildingKind,
  type City,
  type RealmLabel,
  type Resident,
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
