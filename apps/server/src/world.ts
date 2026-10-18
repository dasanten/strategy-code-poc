import {
  MAP_HEIGHT,
  MAP_WIDTH,
  type Direction,
  type Tile,
  type Unit,
  type WorldState,
} from '@csp/shared'

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

export function createWorld(seed = 1): WorldState {
  const rand = mulberry32(seed)
  const tiles: Tile[] = []
  for (let i = 0; i < MAP_WIDTH * MAP_HEIGHT; i++) {
    const r = rand()
    tiles.push(r < 0.08 ? 'rock' : r < 0.13 ? 'water' : r < 0.17 ? 'resource' : 'grass')
  }
  const units: Unit[] = []
  for (let i = 0; i < 6; i++) {
    let x: number, y: number
    do {
      x = Math.floor(rand() * MAP_WIDTH)
      y = Math.floor(rand() * MAP_HEIGHT)
    } while (tiles[y * MAP_WIDTH + x] !== 'grass')
    units.push({ id: `u${i + 1}`, owner: i < 3 ? 'red' : 'blue', x, y, hp: 10 })
  }
  return { tick: 0, seed, width: MAP_WIDTH, height: MAP_HEIGHT, tiles, units }
}

export function isWalkable(world: WorldState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false
  const tile = world.tiles[y * world.width + x]
  return tile === 'grass' || tile === 'resource'
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
export function stepWorld(world: WorldState, rand: () => number = Math.random): StepResult {
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
    if (!isWalkable(world, nx, ny) || occupied.has(`${nx},${ny}`)) continue
    occupied.delete(`${unit.x},${unit.y}`)
    occupied.add(`${nx},${ny}`)
    unit.x = nx
    unit.y = ny
  }
  world.tick++
  return { actions: requested.length }
}
