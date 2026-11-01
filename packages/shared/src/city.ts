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
  MAP_SIZE,
  NPC_CITY_REFUSES_STANDING,
  NPC_CITY_WONT_SELL_STANDING,
  OCCUPATION_GAME_DAYS,
  STANDING_RANGE,
} from './balance.js'
import { allied } from './alliance.js'
import { standingOf } from './standing.js'
import { TRADE_ORG } from './trade-org.js'
import { FOOTPRINT, footprintsNear, isAt, nearFootprint } from './footprint.js'
import { wrap, wrapDelta, wrapDistance } from './terrain.js'
import {
  TICKS_PER_GAME_DAY,
  type Building,
  type BuildingKind,
  type City,
  type Resident,
  type WorldState,
} from './world.js'

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
  // City buildings in square cells of the map, each wide enough that the buildings a footprint
  // reaches lie in its own cell or one next to it.
  const city = world.buildings.filter(isCityBuilding)
  const widest = Math.max(1, ...city.map((b) => FOOTPRINT[b.kind]))
  const cell = CITY_BUILDING_REACH + widest
  const cells = Math.max(1, Math.floor(size / cell))
  const cellOf = (v: number) => Math.min(cells - 1, Math.floor(wrap(v, size) / cell))
  const grid = new Map<number, Building[]>()
  for (const b of city) {
    const k = cellOf(b.y) * cells + cellOf(b.x)
    grid.set(k, [...(grid.get(k) ?? []), b])
  }
  /** The city buildings within reach of `b`'s footprint, in the order of their tiles from it. */
  const near = (b: Building) => {
    const keys = new Set<number>()
    for (const dy of [-1, 0, 1]) {
      for (const dx of [-1, 0, 1]) {
        const cy = (((cellOf(b.y) + dy) % cells) + cells) % cells
        const cx = (((cellOf(b.x) + dx) % cells) + cells) % cells
        keys.add(cy * cells + cx)
      }
    }
    const out: { n: Building; dy: number; dx: number }[] = []
    for (const k of keys) {
      for (const n of grid.get(k) ?? []) {
        if (n === b || n.kind === 'townHall' || !footprintsNear(b, n, CITY_BUILDING_REACH, size))
          continue
        out.push({ n, dy: wrapDelta(b.y, n.y, size), dx: wrapDelta(b.x, n.x, size) })
      }
    }
    return out.sort((p, q) => p.dy - q.dy || p.dx - q.dx).map((p) => p.n)
  }
  // Claims waiting to be settled: a building a city's chain reaches, and how far its hall is. The
  // nearest is settled first, then the older city's, then the one made first (`ClaimHeap`).
  const claims = new ClaimHeap()
  // Per city, the buildings it has claimed: a claim made again is the same but later, so it never
  // settles first, and a dense city (walls) would otherwise make many of each.
  const claimed = new Map<string, Set<Building>>()
  const claim = (from: Building, cityId: string) => {
    const hall = halls.get(cityId)!
    const mine = claimed.get(cityId) ?? new Set<Building>()
    claimed.set(cityId, mine)
    for (const b of near(from)) {
      if (members.has(b.id) || mine.has(b)) continue
      mine.add(b)
      claims.push({ b, cityId, d: wrapDistance(size, hall, b), age: idNumber(cityId), seq: 0 })
    }
  }
  for (const [cityId, hall] of halls) members.set(hall.id, cityId)
  for (const [cityId, hall] of halls) claim(hall, cityId)
  for (let next = claims.pop(); next; next = claims.pop()) {
    const { b, cityId } = next
    if (members.has(b.id)) continue
    members.set(b.id, cityId)
    claim(b, cityId)
  }
  return members
}

/** A building a city's chain reaches, how far that city's town hall is, and when it was made. */
interface Claim {
  b: Building
  cityId: string
  d: number
  age: number
  seq: number
}

/**
 * The claims `cityMembership` has yet to settle, the first to settle on top: nearest town hall,
 * then the older city, then the claim made first. A binary heap, as a large city makes many.
 */
class ClaimHeap {
  private readonly items: Claim[] = []
  private made = 0

  push(c: Claim): void {
    c.seq = this.made++
    const a = this.items
    a.push(c)
    let i = a.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (!before(a[i]!, a[up]!)) break
      ;[a[i], a[up]] = [a[up]!, a[i]!]
      i = up
    }
  }

  pop(): Claim | undefined {
    const a = this.items
    const top = a[0]
    const last = a.pop()
    if (a.length > 0 && last) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && before(a[l]!, a[m]!)) m = l
        if (r < a.length && before(a[r]!, a[m]!)) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m]!, a[i]!]
        i = m
      }
    }
    return top
  }
}

const before = (p: Claim, q: Claim) =>
  p.d < q.d || (p.d === q.d && (p.age < q.age || (p.age === q.age && p.seq < q.seq)))

/**
 * Whether a tile lies in a city's area (`CONTEXT.md`: City area): within `CITY_AREA_MARGIN` of
 * the footprint of one of its finished city buildings, the footprints included. `size` is the
 * map's.
 */
export function inCityArea(
  world: { buildings: readonly Building[] },
  city: City,
  x: number,
  y: number,
  size: number,
): boolean {
  return world.buildings.some(
    (b) =>
      b.cityId === city.id &&
      isCityBuilding(b) &&
      nearFootprint(b, { x, y }, CITY_AREA_MARGIN, size),
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
  world: { buildings: readonly Building[] },
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

/**
 * The realm a building belongs to: its city's realm, or an outpost storage's own (`CONTEXT.md`:
 * Outpost storage); null for one of no realm, such as an NPC city's or a workplace on a node. A
 * construction site laid out by a realm's resident is that realm's until it is finished
 * (`CONTEXT.md`: Construction site).
 */
export function buildingRealm(
  world: { cities: readonly Pick<City, 'id' | 'realmId'>[] },
  b: Pick<Building, 'cityId' | 'realmId' | 'site'>,
): string | null {
  if (b.site && b.realmId !== undefined) return b.realmId
  if (b.cityId !== null) return world.cities.find((c) => c.id === b.cityId)?.realmId ?? null
  return b.realmId ?? null
}

/** Whether a building is an outpost storage (`CONTEXT.md`: Outpost storage): one of no city. */
export function isOutpostStorage(b: Building): boolean {
  return b.kind === 'storage' && !b.site && b.cityId === null
}

/**
 * Whether an outpost storage's stock is guarded (`CONTEXT.md`: Outpost storage): an armed, living
 * resident of its realm stands on or next to it, and nobody else's armed resident does. Only its
 * realm's residents can take from it then. `size` is the map's.
 */
export function outpostStorageGuarded(
  world: Pick<WorldState, 'residents'>,
  b: Building,
  size = MAP_SIZE,
): boolean {
  if (!isOutpostStorage(b) || !b.realmId) return false
  let guarded = false
  for (const r of world.residents) {
    if (r.health <= 0 || !isArmed(r) || !nearFootprint(b, r, 1, size)) continue
    if (r.owner !== b.realmId) return false
    guarded = true
  }
  return guarded
}

/** A city's town hall, if it stands. */
export function townHallOf(world: Pick<WorldState, 'buildings'>, city: City): Building | undefined {
  return world.buildings.find((b) => b.id === city.townHallId)
}

/** The residents who live in a city, wherever they are standing. */
export function cityResidents<R extends Pick<Resident, 'cityId'>>(
  world: { residents: readonly R[] },
  city: Pick<City, 'id'>,
): R[] {
  return world.residents.filter((r) => r.cityId === city.id)
}

/** How many residents a city's finished buildings house (`HOUSING_ROOM`); sites house nobody. */
export function housingRoom(
  world: { buildings: readonly Building[] },
  city: Pick<City, 'id'>,
): number {
  return world.buildings
    .filter((b) => b.cityId === city.id && !b.site)
    .reduce((room, b) => room + (HOUSING_ROOM[b.kind] ?? 0), 0)
}

/** A city's free housing (`CONTEXT.md`: House): its room minus its residents. Can be below 0. */
export function freeHousing(
  world: { buildings: readonly Building[]; residents: readonly Pick<Resident, 'cityId'>[] },
  city: Pick<City, 'id'>,
): number {
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
 * The realm occupying a city's town hall (`CONTEXT.md`: Occupying a town hall), if any: armed
 * residents of exactly one realm not on the city's side stand on the hall's footprint, and no
 * defender of the city (`defendsCity`) does. An ally of that realm there is another realm, so
 * nobody occupies it; armed residents elsewhere in the city don't count. Mercenaries the Trade
 * Organization hired occupy nothing, and defend its HQ (`CONTEXT.md`: Trade Org army). None while
 * the hall is gone. `size` is the map's.
 */
export function occupierOf(
  world: Pick<WorldState, 'buildings' | 'alliances' | 'residents' | 'contracts'>,
  city: City,
  size: number,
): string | null {
  const hall = townHallOf(world, city)
  if (!hall) return null
  let occupier: string | null = null
  for (const r of world.residents) {
    if (!isArmed(r) || !isAt(r, hall, size)) continue
    if (defendsCity(world, city, r, size)) return null
    const forTradeOrg = world.contracts.some(
      (c) => c.startedAt !== null && c.hirerId === TRADE_ORG && c.residentIds.includes(r.id),
    )
    if (forTradeOrg && city.tradeOrg === 'hq') return null
    if (forTradeOrg || r.owner === null || onCitySide(world, city, r.owner)) continue
    if (occupier !== null && occupier !== r.owner) return null
    occupier = r.owner
  }
  return occupier
}

/** Ticks a city's town hall has to be occupied (`OCCUPATION_GAME_DAYS`) before it is captured. */
export const OCCUPATION_TICKS = OCCUPATION_GAME_DAYS * TICKS_PER_GAME_DAY

/** Ticks left before the occupation of a city's town hall captures it; null with none running. */
export function occupationTicksLeft(
  world: Pick<WorldState, 'tick'>,
  city: Pick<City, 'occupation'>,
): number | null {
  const o = city.occupation
  return o ? Math.max(0, o.since + OCCUPATION_TICKS - world.tick) : null
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
