import type { Building, City, TerrainMap, WorldState } from '@csp/shared'
import { foundStartingCity } from './starting-city.js'
import { generateTerrain } from './terrain-gen.js'
import { createWorld } from './world.js'

let small: TerrainMap | undefined
let medium: TerrainMap | undefined

/** A small generated map for tests, so they don't pay for a full-size one. */
export function smallTerrain(): TerrainMap {
  return (small ??= generateTerrain(1, 128))
}

/** A map big enough for a few starting cities, still quick to generate. */
export function cityTerrain(): TerrainMap {
  return (medium ??= generateTerrain(1, 1536))
}

/**
 * Adds a city with its town hall at (x, y) to a test world (`CONTEXT.md`: City, Town hall); its
 * area is the tiles around the town hall until more city buildings join it. The town hall's id is
 * `${id}-hall`.
 */
export function addCity(
  world: WorldState,
  city: { id: string; realmId: string | null; x: number; y: number; name?: string },
): City {
  const hall: Building = {
    id: `${city.id}-hall`,
    kind: 'townHall',
    cityId: city.id,
    x: city.x,
    y: city.y,
  }
  const c: City = {
    id: city.id,
    name: city.name ?? 'Ashford',
    realmId: city.realmId,
    townHallId: hall.id,
  }
  world.buildings.push(hall)
  world.cities.push(c)
  return c
}

/** A fresh world on `cityTerrain` where Player 1 has founded their starting city. */
export function worldWithCity(): { world: WorldState; terrain: TerrainMap } {
  const terrain = cityTerrain()
  const world = createWorld(terrain)
  foundStartingCity(world, terrain, 1)
  return { world, terrain }
}
