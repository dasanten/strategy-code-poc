import {
  PATH_DETOUR_LIMIT,
  PATH_DETOUR_SLACK,
  Terrain,
  isPassableTerrain,
  terrainAt,
  wrapDelta,
  type TerrainMap,
  type WallMap,
} from '@csp/shared'
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

/** A square map drawn as text (its sides join): . plains, f forest, h hills, m mountain, ~ lake. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = {
    '.': Terrain.Plains,
    f: Terrain.Forest,
    h: Terrain.Hills,
    m: Terrain.Mountain,
    '~': Terrain.Lake,
  }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

/**
 * Checks a path step by step: neighbouring tiles only (across the joins too), all enterable,
 * ending at the goal.
 */
function checkPath(map: TerrainMap, from: Point, to: Point, path: Point[], costs: TerrainCosts) {
  let [x, y] = from
  let cost = 0
  for (const [nx, ny] of path) {
    expect(Math.abs(wrapDelta(x, nx, map.size)) + Math.abs(wrapDelta(y, ny, map.size))).toBe(1)
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
  // Lake along the top and bottom rows, so no way leads round the north–south join.
  const map = draw([
    '~~~~~~~~~',
    '.........',
    '...mmm...',
    '...m~m...',
    '...m~m...',
    '...m~m...',
    '...fff...',
    '.........',
    '~~~~~~~~~',
  ])

  it('takes the cheapest way, not the shortest', () => {
    const finder = new PathFinder(map)
    // Straight down is lake; over the mountains costs ~16, around them on plains 10.
    const r = finder.findPath([4, 1], [4, 7])
    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    const cost = checkPath(map, [4, 1], [4, 7], r.path, WALKING_COSTS)
    expect(r.cost).toBeCloseTo(cost)
    expect(r.path.some(([x, y]) => terrainAt(map, x, y) === Terrain.Mountain)).toBe(false)
  })

  it('never puts lakes or sea on a path, and says when there is no way', () => {
    const finder = new PathFinder(map)
    expect(finder.findPath([4, 1], [4, 4]).status).toBe('unreachable') // into the lake
    expect(finder.findPath([4, 1], [0, 0]).status).toBe('unreachable') // onto the lake row
    expect(finder.findPath([4, 1], [4, 1])).toEqual({ status: 'found', path: [], cost: 0 })
  })

  it('keeps carriages out of the mountains', () => {
    const finder = new PathFinder(map)
    expect(finder.findPath([4, 1], [4, 2], CARRIAGE_COSTS).status).toBe('unreachable')
    expect(finder.findPath([4, 1], [4, 2], WALKING_COSTS).status).toBe('found')
  })

  it('takes the short way across a join', () => {
    // Lake everywhere between the two plains columns, which meet across the east–west join.
    const strip = draw([
      '.~~~~~~~.',
      '.~~~~~~~.',
      '.~~~~~~~.',
      '.~~~~~~~.',
      '.~~~~~~~.',
      '.~~~~~~~.',
      '.~~~~~~~.',
      '.~~~~~~~.',
      '.~~~~~~~.',
    ])
    const r = new PathFinder(strip).findPath([0, 4], [8, 4])
    expect(r).toEqual({ status: 'found', path: [[8, 4]], cost: 1 })
    // Coordinates past a side mean the same tiles.
    expect(new PathFinder(strip).findPath([9, 4], [-1, 4])).toEqual(r)
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

/** A square map of one terrain, with `paint` changing tiles on it. */
function blank(size: number, terrain = Terrain.Plains) {
  const map: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(terrain) }
  const paint = (x: number, y: number, t: Terrain) => (map.tiles[y * size + x] = t)
  return { map, paint }
}

/** A wall of nobody's on each of the given tiles. */
function wallsOn(size: number, tiles: number[]): WallMap {
  const wall = () => ({
    kind: 'wall' as const,
    realmId: null,
    realms: [],
    closed: false,
    shutTo: [],
  })
  return { size, tiles: new Map(tiles.map((t) => [t, wall()])), inside: new Set() }
}

/** One turn of the finder's loop: one request checked, or one batch of one search. */
function oneTurn(finder: PathFinder) {
  let t = 0
  finder.advance(2, () => t++)
}

describe('PathFinder settling requests before any search', () => {
  it('a goal on land the start can never reach is unreachable at once', () => {
    // An island in a lake, and an island ringed by mountains: open plains all round.
    const { map, paint } = blank(200)
    for (let i = 0; i <= 20; i++)
      for (const [x, y] of [
        [i, 0],
        [i, 20],
        [0, i],
        [20, i],
      ] as const) {
        paint(140 + x, 140 + y, Terrain.Lake)
        paint(40 + x, 140 + y, Terrain.Mountain)
      }
    const finder = new PathFinder(map)
    finder.request('island', [20, 20], [150, 150])
    finder.request('cart', [20, 20], [50, 150], CARRIAGE_COSTS)
    oneTurn(finder)
    expect(finder.result('island')).toEqual({ status: 'unreachable' })
    oneTurn(finder)
    expect(finder.result('cart')).toEqual({ status: 'unreachable' })
    // On foot, over the mountains.
    expect(finder.findPath([20, 20], [50, 150]).status).toBe('found')
  })

  it('an attacker needs only reachable land next to the goal', () => {
    const { map, paint } = blank(64)
    for (let x = 0; x < 64; x++) {
      paint(x, 0, Terrain.Lake)
      paint(x, 32, Terrain.Lake)
    }
    const finder = new PathFinder(map)
    // Across the lake from the start, a row off its shore.
    const options = { near: true }
    expect(finder.findPath([10, 10], [10, 33]).status).toBe('unreachable')
    expect(finder.findPath([10, 10], [10, 33], WALKING_COSTS, options).status).toBe('unreachable')
    // On the lake itself, but beside the start's shore.
    expect(finder.findPath([10, 10], [10, 32], WALKING_COSTS, options).status).toBe('found')
  })

  it('gives up on a way dearer than the detour limit allows', () => {
    // Lake columns with gaps at alternate ends: the corridors between them make one long
    // winding way. Lake round the edges, so no way leads across the joins.
    const { map, paint } = blank(100)
    for (let i = 0; i < 100; i++) {
      paint(i, 0, Terrain.Lake)
      paint(i, 99, Terrain.Lake)
      paint(99, i, Terrain.Lake)
    }
    for (let x = 1; x < 99; x += 2) {
      const gap = ((x - 1) / 2) % 2 === 0 ? 1 : 98
      for (let y = 1; y < 99; y++) if (y !== gap) paint(x, y, Terrain.Lake)
    }
    const finder = new PathFinder(map)
    // Two corridors over: about 200 steps, well within the limit.
    expect(finder.findPath([0, 50], [4, 50]).status).toBe('found')
    // Twenty corridors over: about 2000 steps for 40 as the crow flies, past the limit.
    expect(PATH_DETOUR_LIMIT * 40 + PATH_DETOUR_SLACK).toBeLessThan(1900)
    expect(finder.findPath([0, 50], [40, 50]).status).toBe('unreachable')
  })

  it('forgets walls that are gone when the walls change', () => {
    const { map } = blank(9)
    const column = (x: number) => Array.from({ length: 9 }, (_, y) => y * 9 + x)
    const finder = new PathFinder(map)
    // Walls on two columns shut the way off, across the join too.
    finder.setWalls(wallsOn(9, [...column(0), ...column(4)]))
    expect(finder.findPath([2, 4], [6, 4]).status).toBe('unreachable')
    finder.setWalls(wallsOn(9, column(0)))
    expect(finder.findPath([2, 4], [6, 4])).toMatchObject({ status: 'found', cost: 4 })
    finder.setWalls(undefined)
    expect(finder.findPath([2, 4], [6, 4])).toMatchObject({ status: 'found', cost: 4 })
  })
})

describe('PathFinder lanes', () => {
  it('finds a short path while a long search is under way', () => {
    // Forest everywhere: dear ground, so a long search goes through a great many tiles.
    const { map } = blank(256, Terrain.Forest)
    const finder = new PathFinder(map, 32)
    finder.request('long', [0, 0], [120, 120])
    finder.request('short', [200, 200], [205, 203])
    let t = 0
    finder.advance(6, () => t++)
    expect(finder.result('short')?.status).toBe('found')
    expect(finder.result('long')).toEqual({ status: 'searching' })
    while (finder.pending > 0) finder.advance(Infinity)
    expect(finder.result('long')?.status).toBe('found')
  })

  it('finds a short path whose only way leaves its window', () => {
    // A lake wall between the ends, longer than the window: the way goes round outside it.
    const { map, paint } = blank(256)
    for (let y = 60; y <= 140; y++) paint(100, y, Terrain.Lake)
    const finder = new PathFinder(map, 32)
    const r = finder.findPath([98, 100], [102, 100])
    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    expect(checkPath(map, [98, 100], [102, 100], r.path, WALKING_COSTS)).toBeCloseTo(r.cost)
    expect(r.cost).toBe(4 + 2 * 41)
  })

  it('gives the same paths as one lane for the whole map', () => {
    const { map, paint } = blank(128)
    let seed = 5
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const rough = [Terrain.Forest, Terrain.Hills, Terrain.Lake]
    for (let i = 0; i < 3000; i++)
      paint(Math.floor(rnd() * 128), Math.floor(rnd() * 128), rough[i % 3]!)
    const lanes = new PathFinder(map, 32)
    const one = new PathFinder(map, 128)
    for (let i = 0; i < 30; i++) {
      const from: Point = [Math.floor(rnd() * 128), Math.floor(rnd() * 128)]
      const to: Point = [from[0] + Math.floor(rnd() * 16) - 8, from[1] + Math.floor(rnd() * 16) - 8]
      const a = lanes.findPath(from, to)
      const b = one.findPath(from, to)
      expect(a.status).toBe(b.status)
      if (a.status === 'found' && b.status === 'found') expect(a.cost).toBeCloseTo(b.cost)
    }
  })
})

describe('PathFinder across the full map', () => {
  let map: TerrainMap
  let west: Point
  let east: Point

  beforeAll(() => {
    map = generateTerrain(1)
    // As far apart as two places get: half the map along each direction.
    west = nearestFreeTile(map, new Set(), 100, 100)
    east = nearestFreeTile(map, new Set(), 820, 820)
  }, 300_000)

  it('finds a path between the farthest places in steps that stay within the tick budget', () => {
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
    // The finder sums costs in 32-bit floats: close, not exact, over a path this long.
    expect(checkPath(map, west, east, r.path, WALKING_COSTS)).toBeCloseTo(r.cost, 1)
  })

  it('finds a carriage path across with no mountain on it', () => {
    const finder = new PathFinder(map)
    const r = finder.findPath(west, east, CARRIAGE_COSTS)
    expect(r.status).toBe('found')
    if (r.status !== 'found') return
    expect(checkPath(map, west, east, r.path, CARRIAGE_COSTS)).toBeCloseTo(r.cost, 1)
    expect(r.path.some(([x, y]) => terrainAt(map, x, y) === Terrain.Mountain)).toBe(false)
  })
})
