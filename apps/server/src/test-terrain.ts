import type { TerrainMap } from '@csp/shared'
import { generateTerrain } from './terrain-gen.js'

let small: TerrainMap | undefined

/** A small generated map for tests, so they don't pay for a full-size one. */
export function smallTerrain(): TerrainMap {
  return (small ??= generateTerrain(1, 120))
}
