import {
  isPassableTerrain,
  terrainAt,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { placeResourceNodes } from './node-gen.js'
import { mulberry32, newResident } from './residents.js'

/** How far from the disc's centre the placeholder residents start, in tiles. */
const START_SPREAD = 8

/**
 * A new world: resource nodes, and six placeholder residents near the centre on two sides,
 * until Players get their own starting cities (T2.2).
 */
export function createWorld(terrain: TerrainMap, seed = 1): WorldState {
  const rand = mulberry32(seed)
  const centre = Math.floor(terrain.diameter / 2)
  const occupied = new Set<string>()
  const residents: Resident[] = []
  for (let i = 0; i < 6; i++) {
    const x = centre + Math.floor((rand() * 2 - 1) * START_SPREAD)
    const y = centre + Math.floor((rand() * 2 - 1) * START_SPREAD)
    const [rx, ry] = nearestFreeTile(terrain, occupied, x, y)
    occupied.add(`${rx},${ry}`)
    const owner = i < 3 ? 'red' : 'blue'
    residents.push(newResident(rand, { id: `r${i + 1}`, owner, x: rx, y: ry, tick: 0 }))
  }
  return { tick: 0, seed, residents, nodes: placeResourceNodes(terrain, seed) }
}

export function isWalkable(terrain: TerrainMap, x: number, y: number): boolean {
  return isPassableTerrain(terrainAt(terrain, x, y))
}

/**
 * The walkable tile not in `occupied` closest to (x, y), searching outwards ring by ring.
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
  for (let r = 0; r < terrain.diameter; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (free(x + dx, y + dy)) return [x + dx, y + dy]
      }
    }
  }
  throw new Error('no free walkable tile left on the map')
}

export interface StepResult {
  /** Actions requested this tick. */
  actions: number
}

/**
 * Advances the world by one tick. Nothing requests actions yet: orders and scripts will, and
 * the world resolves them here (ADR 0002).
 */
export function stepWorld(world: WorldState, _terrain: TerrainMap): StepResult {
  world.tick++
  return { actions: 0 }
}
