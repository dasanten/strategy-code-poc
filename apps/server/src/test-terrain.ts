import type { TerrainMap, WorldState } from '@csp/shared'
import { foundStartingCity } from './starting-city.js'
import { generateTerrain } from './terrain-gen.js'
import { createWorld } from './world.js'

let small: TerrainMap | undefined
let medium: TerrainMap | undefined

/** A small generated map for tests, so they don't pay for a full-size one. */
export function smallTerrain(): TerrainMap {
  return (small ??= generateTerrain(1, 120))
}

/** A map big enough for a few starting cities, still quick to generate. */
export function cityTerrain(): TerrainMap {
  return (medium ??= generateTerrain(1, 400))
}

/** A fresh world on `cityTerrain` where Player 1 has founded their starting city. */
export function worldWithCity(): { world: WorldState; terrain: TerrainMap } {
  const terrain = cityTerrain()
  const world = createWorld(terrain)
  foundStartingCity(world, terrain, 1)
  return { world, terrain }
}
