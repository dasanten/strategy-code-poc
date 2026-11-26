// Ported from packages/shared/src/city.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { HOUSING_ROOM } from './narrowed.js'
import { standingOf } from './standing.js'
import {
  NPC_CITY_REFUSES_STANDING,
  OCCUPATION_GAME_DAYS,
  TICKS_PER_GAME_DAY,
} from '@csp/balance'
import type { Building, City, Resident, WorldState } from '@csp/shared-types'
import { cityAreaTileList, cityIdsAtTile, nearCityAreaAll } from '@csp/lang-wasm'

export { idNumber } from '@csp/lang-wasm'

/** World queries about cities (ADR 0002: the game API orders and scripts share). */

export { CITY_BUILDINGS } from '@csp/shared-types'

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
