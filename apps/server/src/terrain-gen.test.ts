import {
  MAP_DIAMETER,
  OFF_MAP,
  SEA_EDGE_SHARE,
  TERRAIN_SHARES,
  Terrain,
  isInsideDisc,
  isPassableTerrain,
  terrainAt,
  type TerrainMap,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkTerrain, generateTerrain } from './terrain-gen.js'

/** Sizes of the 8-connected groups of tiles with the given terrain. */
function groupSizes({ diameter, tiles }: TerrainMap, terrain: Terrain): number[] {
  const seen = new Uint8Array(tiles.length)
  const sizes: number[] = []
  for (let start = 0; start < tiles.length; start++) {
    if (tiles[start] !== terrain || seen[start]) continue
    let size = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const t = stack.pop()!
      size++
      const x = t % diameter
      const y = Math.floor(t / diameter)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= diameter || ny >= diameter) continue
          const nt = ny * diameter + nx
          if (tiles[nt] === terrain && !seen[nt]) {
            seen[nt] = 1
            stack.push(nt)
          }
        }
      }
    }
    sizes.push(size)
  }
  return sizes
}

describe('generateTerrain', () => {
  it('makes the same map from the same seed, and a different one from another', () => {
    const a = generateTerrain(42, 300)
    expect(generateTerrain(42, 300).tiles).toEqual(a.tiles)
    expect(generateTerrain(43, 300).tiles).not.toEqual(a.tiles)
  })

  describe('a full-size map', () => {
    let map: TerrainMap
    let ms: number

    beforeAll(() => {
      const start = performance.now()
      map = generateTerrain(1)
      ms = performance.now() - start
    }, 120_000)

    it('generates well under a minute', () => {
      expect(ms).toBeLessThan(20_000)
    })

    it('is a disc ~1,440 tiles across with nothing passable outside it', () => {
      expect(map.diameter).toBe(MAP_DIAMETER)
      expect(MAP_DIAMETER).toBeGreaterThanOrEqual(1400)
      expect(MAP_DIAMETER).toBeLessThanOrEqual(1480)
      const d = map.diameter
      const wrong: string[] = []
      for (let y = -1; y <= d; y++) {
        for (let x = -1; x <= d; x++) {
          const t = terrainAt(map, x, y)
          if (isInsideDisc(d, x, y)) {
            if (t === OFF_MAP) wrong.push(`(${x}, ${y}) is missing`)
          } else {
            if (t !== OFF_MAP || isPassableTerrain(t)) wrong.push(`(${x}, ${y}) exists`)
            const inGrid = x >= 0 && y >= 0 && x < d && y < d
            if (inGrid && map.tiles[y * d + x] !== OFF_MAP) wrong.push(`(${x}, ${y}) has terrain`)
          }
        }
      }
      expect(wrong).toEqual([])
      // The disc touches all four sides of its square.
      expect(isInsideDisc(d, d / 2, 0)).toBe(true)
      expect(isInsideDisc(d, 0, 0)).toBe(false)
    })

    it('keeps the terrain shares from the balance file', () => {
      const counts = new Map<number, number>()
      let disc = 0
      for (const t of map.tiles) {
        if (t === OFF_MAP) continue
        disc++
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
      const share = (t: Terrain) => (counts.get(t) ?? 0) / disc
      const near = (actual: number, wanted: number) =>
        expect(Math.abs(actual - wanted)).toBeLessThan(0.005)
      near(share(Terrain.Sea), TERRAIN_SHARES.sea)
      near(share(Terrain.Lake), TERRAIN_SHARES.lake)
      near(share(Terrain.Mountain), TERRAIN_SHARES.mountain)
      near(share(Terrain.Hills), TERRAIN_SHARES.hills)
      near(share(Terrain.Forest), TERRAIN_SHARES.forest)
      const rest = 1 - Object.values(TERRAIN_SHARES).reduce((a, b) => a + b, 0)
      near(share(Terrain.Plains), rest)
    })

    it('puts sea along parts of the edge, not all of it', () => {
      const d = map.diameter
      let edge = 0
      let sea = 0
      for (let y = 0; y < d; y++) {
        for (let x = 0; x < d; x++) {
          if (!isInsideDisc(d, x, y)) continue
          const atEdge = [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
          ].some(([nx, ny]) => !isInsideDisc(d, nx!, ny!))
          if (!atEdge) continue
          edge++
          if (terrainAt(map, x, y) === Terrain.Sea) sea++
        }
      }
      expect(Math.abs(sea / edge - SEA_EDGE_SHARE)).toBeLessThan(0.05)
    })

    it('forms mountains into ranges', () => {
      const sizes = groupSizes(map, Terrain.Mountain)
      const total = sizes.reduce((a, b) => a + b, 0)
      const inRanges = sizes.filter((s) => s >= 200).reduce((a, b) => a + b, 0)
      expect(inRanges / total).toBeGreaterThan(0.8)
    })

    it('keeps every map rule: sea reaches the edge, lakes are inland', () => {
      expect(checkTerrain(map)).toEqual([])
      expect(groupSizes(map, Terrain.Lake).length).toBeGreaterThan(3)
    })
  })
})

describe('checkTerrain', () => {
  it('reports sea cut off from the edge and lakes on the shore', () => {
    const d = 21
    const map = generateTerrain(5, d)
    map.tiles.fill(OFF_MAP)
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) if (isInsideDisc(d, x, y)) map.tiles[y * d + x] = Terrain.Plains
    }
    map.tiles[10 * d + 10] = Terrain.Sea
    map.tiles[10 * d + 0] = Terrain.Lake
    map.tiles[0] = Terrain.Plains
    expect(
      checkTerrain(map)
        .map((p) => p.rule)
        .sort(),
    ).toEqual(['lakes-inland', 'nothing-off-map', 'sea-at-edge'])
  })
})
