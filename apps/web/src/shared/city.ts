// Ported from packages/shared/src/city.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { allied } from './alliance.js'
import { FOOTPRINT, footprintsNear, isAt } from './footprint.js'
import { HOUSING_ROOM } from './narrowed.js'
import { standingOf } from './standing.js'
import { isArmed } from './stats.js'
import { wrap, wrapDelta, wrapDistance } from './terrain.js'
import { TRADE_ORG } from './trade-org.js'
import {
  CITY_BUILDING_REACH,
  NPC_CITY_REFUSES_STANDING,
  OCCUPATION_GAME_DAYS,
  TICKS_PER_GAME_DAY,
} from '@csp/balance'
import type { Building, City, Resident, WorldState } from '@csp/shared-types'
import { CITY_BUILDINGS } from '@csp/shared-types'
import { cityAreaTileList, cityIdsAtTile, idNumber, nearCityAreaAll } from '@csp/lang-wasm'

export { idNumber } from '@csp/lang-wasm'

/** World queries about cities (ADR 0002: the game API orders and scripts share). */

export { CITY_BUILDINGS } from '@csp/shared-types'

/** Whether a building counts toward a city's shape: a finished city building. */
export function isCityBuilding(b: Building): boolean {
  return CITY_BUILDINGS.includes(b.kind) && !b.site
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
 * map's. The rule is the server's (`nearCityAreaAll`); to ask of many tiles, ask that once.
 */
export function inCityArea(
  world: { buildings: readonly Building[] },
  city: Pick<City, 'id'>,
  x: number,
  y: number,
  size: number,
): boolean {
  return nearCityAreaAll(world.buildings, city.id, [[x, y]], 0, size)[0]!
}

/** The cities whose area the tile lies in; areas can overlap where cities meet. */
export function citiesAt(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  x: number,
  y: number,
  size: number,
): City[] {
  const ids = cityIdsAt(world, x, y, size)
  return world.cities.filter((c) => ids.includes(c.id))
}

/** The ids of the cities whose area the tile lies in (`citiesAt`), going through the buildings once. */
export function cityIdsAt(
  world: { buildings: readonly Building[] },
  x: number,
  y: number,
  size: number,
): string[] {
  return cityIdsAtTile(world.buildings, x, y, size)
}

/** Every tile in a city's area, as "x,y" keys on the map. */
export function cityAreaTiles(
  world: { buildings: readonly Building[] },
  city: Pick<City, 'id'>,
  size: number,
): Set<string> {
  return new Set(cityAreaTileList(world.buildings, city.id, size).map(([x, y]) => `${x},${y}`))
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
 * Organization hired occupy nothing, and defend its HQ (`CONTEXT.md`: Trade Org army). Its own
 * soldiers occupy only as an army come to take the city (`cityTakers`). None while the hall is gone.
 * `size` is the map's.
 */
export function occupierOf(world: OccupationWorld, city: City, size: number): string | null {
  return occupationOf(world, city, size)?.realm ?? null
}

/**
 * The armed residents occupying a city's town hall (`occupierOf`), by whose standing there it is
 * occupied; none while nobody occupies it. `size` is the map's.
 */
export function occupiersOf(world: OccupationWorld, city: City, size: number): Resident[] {
  return occupationOf(world, city, size)?.residents ?? []
}

/** What of the world decides who occupies a town hall. */
type OccupationWorld = Pick<
  WorldState,
  'buildings' | 'alliances' | 'residents' | 'contracts' | 'punishments' | 'debts'
>

/** Who occupies a city's town hall right now: `occupierOf` and `occupiersOf`. */
function occupationOf(
  world: OccupationWorld,
  city: City,
  size: number,
): { realm: string; residents: Resident[] } | null {
  const hall = townHallOf(world, city)
  if (!hall) return null
  const takers = cityTakers(world, city)
  let occupier: string | null = null
  const residents: Resident[] = []
  for (const r of world.residents) {
    if (!isArmed(r) || !isAt(r, hall, size)) continue
    if (defendsCity(world, city, r, size)) return null
    const forTradeOrg = world.contracts.some(
      (c) => c.startedAt !== null && c.hirerId === TRADE_ORG && c.residentIds.includes(r.id),
    )
    if (forTradeOrg && city.tradeOrg === 'hq') return null
    const realm = takers.has(r.id) ? TRADE_ORG : r.owner
    if (forTradeOrg || realm === null || (realm !== TRADE_ORG && onCitySide(world, city, realm)))
      continue
    if (occupier !== null && occupier !== realm) return null
    occupier = realm
    residents.push(r)
  }
  return occupier === null ? null : { realm: occupier, residents }
}

/**
 * The soldiers of the Trade Organization's army come to take `city` (`CONTEXT.md`: Trade Org debt):
 * on their way there or at it, for a debt the city's Organization still owes. Paid in full, they stop
 * occupying at once, so the debt can't be paid and the city lost in one tick.
 */
export function cityTakers(
  world: Pick<WorldState, 'punishments' | 'debts'>,
  city: City,
): Set<string> {
  const org = city.realmId ?? city.id
  const takers = new Set<string>()
  for (const p of world.punishments) {
    if (!p.takes || p.heading !== 'out' || p.cityId !== city.id || p.culpritOrg !== org) continue
    if (!world.debts.some((d) => d.org === org)) continue
    for (const m of p.members) takers.add(m.residentId)
  }
  return takers
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
