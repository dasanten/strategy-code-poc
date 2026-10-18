import { isPassableTerrain, terrainAt, wrap, type TerrainMap, type WorldState } from '@csp/shared'
import { placeResourceNodes } from './node-gen.js'
import type { Walking } from './walking.js'
import { stepSurvival, type SurvivalResult } from './survival.js'

/**
 * A new world: terrain's resource nodes and nobody yet. Each Player gets a realm and starting
 * city when they first connect (`foundStartingCity`).
 */
export function createWorld(terrain: TerrainMap, seed = 1): WorldState {
  return {
    tick: 0,
    seed,
    nextId: 1,
    residents: [],
    nodes: placeResourceNodes(terrain, seed),
    realms: [],
    cities: [],
    buildings: [],
    horses: [],
    carriages: [],
    piles: [],
  }
}

export function isWalkable(terrain: TerrainMap, x: number, y: number): boolean {
  return isPassableTerrain(terrainAt(terrain, x, y))
}

/**
 * The walkable tile not in `occupied` closest to (x, y), searching outwards ring by ring across
 * the map's joins.
 * Throws if the whole map is full, which a real map never is.
 */
export function nearestFreeTile(
  terrain: TerrainMap,
  occupied: Set<string>,
  x: number,
  y: number,
): [number, number] {
  const free = (tx: number, ty: number) =>
    isWalkable(terrain, tx, ty) && !occupied.has(`${tx},${ty}`)
  for (let r = 0; r < terrain.size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const [tx, ty] = [wrap(x + dx, terrain.size), wrap(y + dy, terrain.size)]
        if (free(tx, ty)) return [tx, ty]
      }
    }
  }
  throw new Error('no free walkable tile left on the map')
}

export interface StepResult {
  /** Actions requested this tick. */
  actions: number
  /** Who died and which realms ended this tick. */
  survival: SurvivalResult
}

/**
 * Advances the world by one tick (ADR 0002): residents get hungry, eat, heal or starve; then
 * their orders request actions (steps, for now), and the world resolves them together. Without
 * `walking` nobody moves.
 */
export function stepWorld(world: WorldState, _terrain: TerrainMap, walking?: Walking): StepResult {
  const survival = stepSurvival(world)
  const steps = walking?.requestSteps(world) ?? []
  walking?.resolve(world, steps)
  world.tick++
  return { actions: steps.length, survival }
}
