import { OFF_MAP, Terrain, isPassableTerrain, terrainAt, type TerrainMap } from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CARRIAGE_COSTS,
  PathFinder,
  WALKING_COSTS,
  type Point,
  type TerrainCosts,
} from './pathfinding.js'
import { generateTerrain } from './terrain-gen.js'
import { nearestFreeTile } from './world.js'

/** A map drawn as text: . plains, f forest, h hills, m mountain, ~ lake, x outside. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = {
    '.': Terrain.Plains,
    f: Terrain.Forest,
    h: Terrain.Hills,
    m: Terrain.Mountain,
    '~': Terrain.Lake,
    x: OFF_MAP,
  }
  const d = rows.length
  return { diameter: d, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

/** Checks a path step by step: neighbouring tiles only, all enterable, ending at the goal. */
function checkPath(map: TerrainMap, from: Point, to: Point, path: Point[], costs: TerrainCosts) {
  let [x, y] = from
  let cost = 0
  for (const [nx, ny] of path) {
    expect(Math.abs(nx - x) + Math.abs(ny - y)).toBe(1)
    const t = terrainAt(map, nx, ny)
    expect(isPassableTerrain(t)).toBe(true)
    expect(costs[t]).toBeLessThan(Infinity)
    cost += costs[t]!
    ;[x, y] = [nx, ny]
  }
  expect([x, y]).toEqual([...to])
  return cost
}

describe('PathFinder on a drawn map', () => {
  // The middle of a 9×9 disc; the corners are outside it.
  const map = draw([
    'xx.....xx',
    'x.......x',
    '...mmm...',
    '...m~m...',
    '...m~m...',
    '...m~m...',
    '...fff...',
    'x.......x',
    'xx.....xx',
  ])

  it('takes the cheapest way, not the shortest', () => {
    const finder = new PathFinder(map)
    // Straight down is lake; over the mountains costs ~16, around them on plains 12.
    const r = finder.findPath([4, 1], [4, 7])
    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    const cost = checkPath(map, [4, 1], [4, 7], r.path, WALKING_COSTS)
    expect(r.cost).toBeCloseTo(cost)
    expect(r.path.some(([x, y]) => terrainAt(map, x, y) === Terrain.Mountain)).toBe(false)
  })

  it('never puts lakes, sea or off-map tiles on a path, and says when there is no way', () => {
    const finder = new PathFinder(map)
    expect(finder.findPath([4, 1], [4, 4]).status).toBe('unreachable') // into the lake
    expect(finder.findPath([4, 1], [0, 0]).status).toBe('unreachable') // off the disc
    expect(finder.findPath([4, 1], [4, 1])).toEqual({ status: 'found', path: [], cost: 0 })
  })

  it('keeps carriages out of the mountains', () => {
    const finder = new PathFinder(map)
    expect(finder.findPath([4, 1], [4, 2], CARRIAGE_COSTS).status).toBe('unreachable')
    expect(finder.findPath([4, 1], [4, 2], WALKING_COSTS).status).toBe('found')
  })

  it('hands out each finished result once and forgets cancelled requests', () => {
    const finder = new PathFinder(map)
    finder.request('a', [1, 2], [7, 2])
    finder.request('b', [1, 2], [7, 6])
    finder.cancel('b')
    expect(finder.result('a')).toEqual({ status: 'searching' })
    finder.advance(1000)
    expect(finder.pending).toBe(0)
    expect(finder.result('a')?.status).toBe('found')
    expect(finder.result('a')).toBeUndefined()
    expect(finder.result('b')).toBeUndefined()
  })
})

describe('PathFinder across the full disc', () => {
  let map: TerrainMap
  let west: Point
  let east: Point

  beforeAll(() => {
    map = generateTerrain(1)
    west = nearestFreeTile(map, new Set(), 60, 720)
    east = nearestFreeTile(map, new Set(), 1380, 720)
  }, 120_000)

  it('finds a path across the whole disc in steps that stay within the tick budget', () => {
    const finder = new PathFinder(map)
    const budgetMs = 20
    finder.request('across', west, east)
    let worst = 0
    let ticks = 0
    while (finder.pending > 0) {
      const start = performance.now()
      finder.advance(budgetMs)
      worst = Math.max(worst, performance.now() - start)
      ticks++
      expect(ticks).toBeLessThan(100)
    }
    // One batch of expansions may run past the deadline; it is small.
    expect(worst).toBeLessThan(budgetMs + 15)
    const r = finder.result('across')
    expect(r?.status).toBe('found')
    if (r?.status !== 'found') return
    expect(r.path.length).toBeGreaterThan(1300)
    expect(checkPath(map, west, east, r.path, WALKING_COSTS)).toBeCloseTo(r.cost)
  })

  it('finds a carriage path across with no mountain on it', () => {
    const finder = new PathFinder(map)
    const r = finder.findPath(west, east, CARRIAGE_COSTS)
    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    checkPath(map, west, east, r.path, CARRIAGE_COSTS)
    expect(r.path.some(([x, y]) => terrainAt(map, x, y) === Terrain.Mountain)).toBe(false)
    const walking = finder.findPath(west, east)
    expect(walking.status === 'found' && walking.cost).toBeLessThanOrEqual(r.cost)
  })
})
