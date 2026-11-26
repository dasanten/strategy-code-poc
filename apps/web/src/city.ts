// Ported from packages/shared/src/city.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { isRuin } from './decay.js'
import { HOUSING_ROOM } from './narrowed.js'
import { OCCUPATION_GAME_DAYS, TICKS_PER_GAME_DAY } from '@csp/balance'
import type { Building, City, Resident, WorldState } from '@csp/shared-types'

/** World queries about cities (ADR 0002: the game API orders and scripts share). */

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

/** How many residents a city's standing buildings house (`HOUSING_ROOM`); sites and ruins house nobody. */
export function housingRoom(
  world: { buildings: readonly Building[] },
  city: Pick<City, 'id'>,
): number {
  return world.buildings
    .filter((b) => b.cityId === city.id && !b.site && !isRuin(b))
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
