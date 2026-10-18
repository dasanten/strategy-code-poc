import { isPassableTerrain, terrainAt, wrap, type TerrainMap, type WorldState } from '@csp/shared'
import { placeResourceNodes } from './node-gen.js'
import { requestBuilding, resolveBuilding } from './building.js'
import { requestTearingDown, resolveTearingDown } from './teardown.js'
import { requestCarrying, resolveCarrying } from './carrying.js'
import type { Walking } from './walking.js'
import { stepSpoilage } from './spoilage.js'
import { stepSurvival, type SurvivalResult } from './survival.js'
import { stepAging, type AgingResult } from './aging.js'
import { requestWork, resolveWork } from './work.js'

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
    events: [],
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
  /** Who starved and which realms ended through it this tick. */
  survival: SurvivalResult
  /** Who died of old age and which realms ended through it, as the next tick begins. */
  aging: AgingResult
}

/**
 * Advances the world by one tick (ADR 0002): residents get hungry, eat, heal or starve; food
 * spoils at the end of each game day; then their orders request actions (steps, then taking and
 * putting down goods, then laying out and working on construction sites, then tearing down, then
 * working workplaces), and the world resolves them together. As the next tick begins, residents
 * age: the old die, and loads too heavy for declining Strength are put down. Without `walking` nobody moves.
 */
export function stepWorld(world: WorldState, terrain: TerrainMap, walking?: Walking): StepResult {
  const survival = stepSurvival(world, terrain)
  stepSpoilage(world)
  const steps = walking?.requestSteps(world) ?? []
  walking?.resolve(world, steps)
  const carries = requestCarrying(world)
  resolveCarrying(world, carries)
  const builds = requestBuilding(world)
  resolveBuilding(world, builds)
  const teardowns = requestTearingDown(world)
  resolveTearingDown(world, teardowns)
  const work = requestWork(world)
  resolveWork(world, work)
  world.tick++
  const aging = stepAging(world)
  const actions = steps.length + carries.length + builds.length + teardowns.length + work.length
  return { actions, survival, aging }
}
