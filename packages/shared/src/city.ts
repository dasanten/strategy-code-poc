import {
  CITY_AREA_MARGIN,
  CITY_PRICE_BY_BUILDING,
  CITY_PRICE_PER_RESIDENT,
  CITY_PRICE_STANDING_SWING,
  CITY_BUILDING_REACH,
  FOOD_PER_DAY,
  FOOD_SURPLUS_DAYS,
  HOUSING_ROOM,
  hungerFactor,
  isArmed,
  NPC_CITY_REFUSES_STANDING,
  NPC_CITY_WONT_SELL_STANDING,
  STANDING_RANGE,
} from './balance.js'
import { allied } from './alliance.js'
import { standingOf } from './standing.js'
import { TRADE_ORG } from './trade-org.js'
import { FOOTPRINT, footprintsNear, isAt, nearFootprint } from './footprint.js'
import { wrap, wrapDistance } from './terrain.js'
import type { Building, BuildingKind, City, Resident, WorldState } from './world.js'

/** World queries about cities (ADR 0002: the game API orders and scripts share). */

/**
 * Kinds of city building (`CONTEXT.md`: City building): what a city is made of. Farms,
 * workplaces and stables are not. A Trade Org warehouse is a storage of its kind.
 */
export const CITY_BUILDINGS: readonly BuildingKind[] = [
  'townHall',
  'house',
  'storage',
  'warehouse',
  'wall',
  'gate',
]

/** Whether a building counts toward a city's shape: a finished city building. */
export function isCityBuilding(b: Building): boolean {
  return CITY_BUILDINGS.includes(b.kind) && !b.site
}

/** The number in an entity's id; ids are numbered in the order things came to be. */
export function idNumber(id: string): number {
  return Number(id.replace(/^\D+/, ''))
}


/**
 * Which city each finished city building belongs to (`CONTEXT.md`: City building), by id; a
 * building missing from it belongs to none. A town hall belongs to its own city. Cities grow
 * outward in a chain from their town halls: a building whose footprint comes within
 * `CITY_BUILDING_REACH` of the footprint of a building already part of a city can join it. Claims
 * are settled nearest town hall first,
 * the older city first on a tie, so a building both chains reach goes to the city whose town hall
 * is nearer, and a chain only goes on through buildings that are its own. `size` is the map's.
 */
export function cityMembership(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  size: number,
): Map<string, string> {
  const members = new Map<string, string>()
  const halls = new Map<string, Building>()
  for (const c of world.cities) {
    const hall = world.buildings.find((b) => b.id === c.townHallId)
    if (hall) halls.set(c.id, hall)
  }
  // City buildings by the north-west tile of their footprint, to find the ones within reach.
  const byTile = new Map<string, Building>()
  for (const b of world.buildings) if (isCityBuilding(b)) byTile.set(`${b.x},${b.y}`, b)
  const widest = Math.max(1, ...[...byTile.values()].map((b) => FOOTPRINT[b.kind]))
  const near = (b: Building) => {
    const out: Building[] = []
    const from = -CITY_BUILDING_REACH - widest + 1
    const to = CITY_BUILDING_REACH + FOOTPRINT[b.kind] - 1
    for (let dy = from; dy <= to; dy++) {
      for (let dx = from; dx <= to; dx++) {
        const n = byTile.get(`${wrap(b.x + dx, size)},${wrap(b.y + dy, size)}`)
        if (n && n !== b && n.kind !== 'townHall' && footprintsNear(b, n, CITY_BUILDING_REACH, size))
          out.push(n)
      }
    }
    return out
  }
  // Claims waiting to be settled: a building a city's chain reaches, and how far its hall is.
  type Claim = { b: Building; cityId: string; d: number; age: number }
  const claims: Claim[] = []
  const claim = (from: Building, cityId: string) => {
    const hall = halls.get(cityId)!
    for (const b of near(from)) {
      if (!members.has(b.id))
        claims.push({ b, cityId, d: wrapDistance(size, hall, b), age: idNumber(cityId) })
    }
  }
  for (const [cityId, hall] of halls) members.set(hall.id, cityId)
  for (const [cityId, hall] of halls) claim(hall, cityId)
  while (claims.length > 0) {
    let best = 0
    for (let i = 1; i < claims.length; i++) {
      const c = claims[i]!
      const b = claims[best]!
      if (c.d < b.d || (c.d === b.d && c.age < b.age)) best = i
    }
    const { b, cityId } = claims[best]!
    claims.splice(best, 1)
    if (members.has(b.id)) continue
    members.set(b.id, cityId)
    claim(b, cityId)
  }
  return members
}

/**
 * Whether a tile lies in a city's area (`CONTEXT.md`: City area): within `CITY_AREA_MARGIN` of
 * the footprint of one of its finished city buildings, the footprints included. `size` is the
 * map's.
 */
export function inCityArea(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  x: number,
  y: number,
  size: number,
): boolean {
  return world.buildings.some(
    (b) =>
      b.cityId === city.id && isCityBuilding(b) && nearFootprint(b, { x, y }, CITY_AREA_MARGIN, size),
  )
}

/** The cities whose area the tile lies in; areas can overlap where cities meet. */
export function citiesAt(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  x: number,
  y: number,
  size: number,
): City[] {
  return world.cities.filter((c) => inCityArea(world, c, x, y, size))
}

/** Every tile in a city's area, as "x,y" keys on the map. */
export function cityAreaTiles(
  world: Pick<WorldState, 'buildings'>,
  city: City,
  size: number,
): Set<string> {
  const out = new Set<string>()
  for (const b of world.buildings) {
    if (b.cityId !== city.id || !isCityBuilding(b)) continue
    const side = FOOTPRINT[b.kind]
    for (let dy = -CITY_AREA_MARGIN; dy < side + CITY_AREA_MARGIN; dy++) {
      for (let dx = -CITY_AREA_MARGIN; dx < side + CITY_AREA_MARGIN; dx++) {
        out.add(`${wrap(b.x + dx, size)},${wrap(b.y + dy, size)}`)
      }
    }
  }
  return out
}

/** A city's town hall, if it stands. */
export function townHallOf(world: Pick<WorldState, 'buildings'>, city: City): Building | undefined {
  return world.buildings.find((b) => b.id === city.townHallId)
}

/** The residents who live in a city, wherever they are standing. */
export function cityResidents(world: WorldState, city: City): Resident[] {
  return world.residents.filter((r) => r.cityId === city.id)
}

/** How many residents a city's finished buildings house (`HOUSING_ROOM`); sites house nobody. */
export function housingRoom(world: WorldState, city: City): number {
  return world.buildings
    .filter((b) => b.cityId === city.id && !b.site)
    .reduce((room, b) => room + (HOUSING_ROOM[b.kind] ?? 0), 0)
}

/** A city's free housing (`CONTEXT.md`: House): its room minus its residents. Can be below 0. */
export function freeHousing(world: WorldState, city: City): number {
  return housingRoom(world, city) - cityResidents(world, city).length
}

/** Food in a city's storages. Food its residents carry is not counted. */
export function storedFood(world: WorldState, city: City): number {
  return world.buildings
    .filter((b) => b.cityId === city.id && b.kind === 'storage' && !b.site)
    .reduce((food, b) => food + (b.stock?.food ?? 0), 0)
}

/** Food all of a city's residents eat in `days` game days, by their Endurance. */
export function cityFoodUse(world: WorldState, city: City, days: number): number {
  return cityResidents(world, city).reduce(
    (food, r) => food + FOOD_PER_DAY * hungerFactor(r, world.tick) * days,
    0,
  )
}

/** Food all of a city's residents eat in `FOOD_SURPLUS_DAYS` game days, by their Endurance. */
export function surplusFoodLine(world: WorldState, city: City): number {
  return cityFoodUse(world, city, FOOD_SURPLUS_DAYS)
}

/**
 * Whether a city has a food surplus (`CONTEXT.md`: Food surplus): its storages hold more Food
 * than all its residents eat in `FOOD_SURPLUS_DAYS` game days.
 */
export function hasFoodSurplus(world: WorldState, city: City): boolean {
  return storedFood(world, city) > surplusFoodLine(world, city)
}

/**
 * Whether a realm stands with a city in a fight over it (`CONTEXT.md`: Capturing a city): the
 * city's own realm, or a member of its alliance. An NPC city has nobody on its side but its own
 * residents (`defendsCity`).
 */
function onCitySide(world: Pick<WorldState, 'alliances'>, city: City, realmId: string): boolean {
  if (city.realmId === null) return false
  return allied(world, city.realmId, realmId)
}

/**
 * Whether a resident is one of a city's defenders (`CONTEXT.md`: Capturing a city): armed,
 * standing in its area, and on its side: of its realm or an allied one, or, for an NPC city, one
 * of its own residents. `size` is the map's.
 */
export function defendsCity(
  world: Pick<WorldState, 'buildings' | 'alliances'>,
  city: City,
  r: Resident,
  size: number,
): boolean {
  const side =
    r.owner === null
      ? city.realmId === null && r.cityId === city.id
      : onCitySide(world, city, r.owner)
  return side && isArmed(r) && inCityArea(world, city, r.x, r.y, size)
}

/**
 * The realm about to capture a city (`CONTEXT.md`: Capturing a city), if any: no defender of it
 * is left in its area (`defendsCity`), and armed residents of exactly one other realm, not
 * allied with it, stand there. With two such realms inside, neither has it yet. Mercenaries the
 * Trade Organization hired capture nothing, and defend its HQ (`CONTEXT.md`: Trade Org army).
 * `size` is the map's.
 */
export function captorOf(
  world: Pick<WorldState, 'buildings' | 'alliances' | 'residents' | 'contracts'>,
  city: City,
  size: number,
): string | null {
  const captors = new Set<string>()
  for (const r of world.residents) {
    if (!isArmed(r) || !inCityArea(world, city, r.x, r.y, size)) continue
    if (defendsCity(world, city, r, size)) return null
    const forTradeOrg = world.contracts.some(
      (c) => c.startedAt !== null && c.hirerId === TRADE_ORG && c.residentIds.includes(r.id),
    )
    if (forTradeOrg && city.tradeOrg === 'hq') return null
    if (forTradeOrg) continue
    if (r.owner !== null && !onCitySide(world, city, r.owner)) captors.add(r.owner)
  }
  return captors.size === 1 ? [...captors][0]! : null
}

/**
 * Whether a city can be bought (`CONTEXT.md`: Buying a city): an NPC city. The Trade
 * Organization doesn't sell its cities, and a Player's city is not for sale.
 */
export function forSale(city: City): boolean {
  return city.realmId === null && !city.tradeOrg
}

/**
 * Whether an NPC city refuses an Organization (`CONTEXT.md`: NPC city reaction): its standing
 * toward it is below `NPC_CITY_REFUSES_STANDING`, so it won't trade with it or hire out to it and
 * keeps its gates shut to its residents. Only NPC cities react so: a city of a realm or of the
 * Trade Organization never refuses here.
 */
export function npcCityRefuses(
  world: Pick<WorldState, 'standings' | 'cities'>,
  city: City,
  org: string,
): boolean {
  return forSale(city) && standingOf(world, city.id, org) < NPC_CITY_REFUSES_STANDING
}

/**
 * Whether an NPC city sells itself to a realm (`CONTEXT.md`: NPC city reaction): it is for sale
 * and its standing toward the realm is not below `NPC_CITY_WONT_SELL_STANDING`.
 */
export function sellsTo(
  world: Pick<WorldState, 'standings' | 'cities'>,
  city: City,
  realmId: string,
): boolean {
  return forSale(city) && standingOf(world, city.id, realmId) >= NPC_CITY_WONT_SELL_STANDING
}

/**
 * The price in Coins an NPC city names (`CONTEXT.md`: Buying a city), from what it is worth: its
 * residents (`CITY_PRICE_PER_RESIDENT`) and its finished buildings (`CITY_PRICE_BY_BUILDING`).
 * Named to a buyer, its standing toward them moves it (`CITY_PRICE_STANDING_SWING`): the better,
 * the lower.
 */
export function cityPrice(
  world: Pick<WorldState, 'residents' | 'buildings' | 'standings' | 'cities'>,
  city: City,
  buyerId?: string,
): number {
  const residents = world.residents.filter((r) => r.cityId === city.id).length
  const buildings = world.buildings
    .filter((b) => b.cityId === city.id && !b.site)
    .reduce((sum, b) => sum + (CITY_PRICE_BY_BUILDING[b.kind] ?? 0), 0)
  // Whole coins: a stretch of wall is worth less than one (`CITY_PRICE_BY_BUILDING`).
  const worth = Math.round(residents * CITY_PRICE_PER_RESIDENT + buildings)
  if (buyerId === undefined) return worth
  const standing = standingOf(world, city.id, buyerId)
  return Math.round(worth * (1 - (CITY_PRICE_STANDING_SWING * standing) / STANDING_RANGE))
}

/**
 * The realm's residents standing at a city's town hall (`CONTEXT.md`: Buying a city): the ones
 * whose coins count toward buying it. None when its town hall is gone.
 */
export function buyersAtTownHall(
  world: Pick<WorldState, 'residents' | 'buildings'>,
  city: City,
  realmId: string,
): Resident[] {
  const hall = townHallOf(world, city)
  if (!hall) return []
  return world.residents.filter((r) => r.owner === realmId && isAt(r, hall))
}

/** The coins the realm's residents carry on a city's town hall (`buyersAtTownHall`). */
export function coinsAtTownHall(
  world: Pick<WorldState, 'residents' | 'buildings'>,
  city: City,
  realmId: string,
): number {
  return buyersAtTownHall(world, city, realmId).reduce((n, r) => n + (r.carried.coins ?? 0), 0)
}

/**
 * Why the realm's resident `r` can't buy the city `cityId` now, if anything stops it
 * (`CONTEXT.md`: Buying a city): the city must be for sale to the realm (`sellsTo`), the resident
 * of the realm and standing on its town hall, and the realm's residents there must carry its
 * price to the realm in coins together.
 */
export function buyProblem(
  world: Pick<WorldState, 'residents' | 'buildings' | 'cities' | 'standings'>,
  realmId: string,
  r: Resident,
  cityId: unknown,
): string | undefined {
  const city = world.cities.find((c) => c.id === cityId)
  if (!city) return 'no such city'
  if (city.tradeOrg) return 'the Trade Organization doesn’t sell its cities'
  if (!forSale(city)) return 'only NPC cities are for sale'
  if (!sellsTo(world, city, realmId))
    return 'it won’t sell to you: it holds you in too low standing'
  if (r.owner !== realmId) return 'only a resident of your own realm can buy a city'
  const hall = townHallOf(world, city)
  if (!hall || !isAt(r, hall)) return 'the resident must stand at its town hall'
  const price = cityPrice(world, city, realmId)
  const coins = coinsAtTownHall(world, city, realmId)
  if (coins < price) {
    return `it costs ${price} coins; your residents at its town hall carry ${coins}`
  }
  return undefined
}
