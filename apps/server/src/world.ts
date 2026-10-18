import {
  isPassableTerrain,
  terrainAt,
  type Direction,
  type TerrainMap,
  type Unit,
  type WorldState,
} from '@csp/shared'
import { placeResourceNodes } from './node-gen.js'

/** Small seeded PRNG so a fresh world always looks the same. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** How far from the disc's centre the placeholder units start, in tiles. */
const START_SPREAD = 8

export function createWorld(terrain: TerrainMap, seed = 1): WorldState {
  const rand = mulberry32(seed)
  const centre = Math.floor(terrain.diameter / 2)
  const occupied = new Set<string>()
  const units: Unit[] = []
  for (let i = 0; i < 6; i++) {
    const x = centre + Math.floor((rand() * 2 - 1) * START_SPREAD)
    const y = centre + Math.floor((rand() * 2 - 1) * START_SPREAD)
    const [ux, uy] = nearestFreeTile(terrain, occupied, x, y)
    occupied.add(`${ux},${uy}`)
    units.push({ id: `u${i + 1}`, owner: i < 3 ? 'red' : 'blue', x: ux, y: uy, hp: 10 })
  }
  return { tick: 0, seed, units, nodes: placeResourceNodes(terrain, seed) }
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

const DIRS: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/**
 * Advances the world by one tick. Until the interpreter exists, every unit asks for a
 * random move; the moves are collected first and then resolved together, as scripts will be.
 * Returns what happened this tick, for tick-health reporting.
 */
export function stepWorld(
  world: WorldState,
  terrain: TerrainMap,
  rand: () => number = Math.random,
): StepResult {
  const dirs = Object.keys(DIRS) as Direction[]
  const requested = world.units.map((u) => ({
    unit: u,
    dir: dirs[Math.floor(rand() * dirs.length)]!,
  }))

  const occupied = new Set(world.units.map((u) => `${u.x},${u.y}`))
  for (const { unit, dir } of requested) {
    const [dx, dy] = DIRS[dir]
    const nx = unit.x + dx
    const ny = unit.y + dy
    if (!isWalkable(terrain, nx, ny) || occupied.has(`${nx},${ny}`)) continue
    occupied.delete(`${unit.x},${unit.y}`)
    occupied.add(`${nx},${ny}`)
    unit.x = nx
    unit.y = ny
  }
  world.tick++
  return { actions: requested.length }
}
