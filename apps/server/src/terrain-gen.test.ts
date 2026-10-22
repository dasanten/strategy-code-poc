import {
  MAP_SIZE,
  SEA_COUNT,
  TERRAIN_SHARES,
  Terrain,
  terrainAt,
  type TerrainMap,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkTerrain, generateTerrain, landGroups, neighbours } from './terrain-gen.js'

/** Sizes of the connected groups (4 neighbours, across the joins) of one terrain. */
function groupSizes({ size, tiles }: TerrainMap, terrain: number): number[] {
  const seen = new Uint8Array(tiles.length)
  const sizes: number[] = []
  for (let start = 0; start < tiles.length; start++) {
    if (tiles[start] !== terrain || seen[start]) continue
    let count = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const t = stack.pop()!
      count++
      for (const n of neighbours(size, t)) {
        if (tiles[n] === terrain && !seen[n]) {
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    sizes.push(count)
  }
  return sizes
}

/** Share of neighbouring tile pairs that differ, across one column boundary or one row's. */
function changeAcross(map: TerrainMap, axis: 'x' | 'y', at: number): number {
  let changed = 0
  for (let i = 0; i < map.size; i++) {
    const [a, b] =
      axis === 'x'
        ? [terrainAt(map, at - 1, i), terrainAt(map, at, i)]
        : [terrainAt(map, i, at - 1), terrainAt(map, i, at)]
    if (a !== b) changed++
  }
  return changed / map.size
}

describe('generateTerrain', () => {
  it('makes the same map from the same seed, and a different one from another', () => {
    const a = generateTerrain(42, 256)
    expect(generateTerrain(42, 256).tiles).toEqual(a.tiles)
    expect(generateTerrain(43, 256).tiles).not.toEqual(a.tiles)
  })

  describe('a full-size map', () => {
    let map: TerrainMap
    let ms: number

    beforeAll(() => {
      const start = performance.now()
      map = generateTerrain(1)
      ms = performance.now() - start
    }, 300_000)

    it('generates in under a minute', () => {
      expect(ms).toBeLessThan(60_000)
    })

    it('is a 5,760 × 5,760 square whose coordinates run on past every side', () => {
      expect(map.size).toBe(MAP_SIZE)
      expect(MAP_SIZE).toBe(5760)
      expect(map.tiles).toHaveLength(5760 * 5760)
      expect(terrainAt(map, -1, 5)).toBe(terrainAt(map, 5759, 5))
      expect(terrainAt(map, 5760, 5)).toBe(terrainAt(map, 0, 5))
      expect(terrainAt(map, 7, -1)).toBe(terrainAt(map, 7, 5759))
    })

    it('has no seams where the sides join', () => {
      // Across a join the terrain changes about as often as anywhere else.
      const inside = (changeAcross(map, 'x', 2880) + changeAcross(map, 'y', 2880)) / 2
      for (const across of [changeAcross(map, 'x', 0), changeAcross(map, 'y', 0)]) {
        expect(across).toBeLessThan(inside * 2 + 0.02)
      }
    })

    it('keeps the terrain shares from the balance file', () => {
      const count = (t: number) => map.tiles.filter((x) => x === t).length / map.tiles.length
      const near = (actual: number, wanted: number) =>
        expect(Math.abs(actual - wanted)).toBeLessThan(0.005)
      near(count(Terrain.Sea), TERRAIN_SHARES.sea)
      near(count(Terrain.Lake), TERRAIN_SHARES.lake)
      near(count(Terrain.Mountain), TERRAIN_SHARES.mountain)
      near(count(Terrain.Hills), TERRAIN_SHARES.hills)
      near(count(Terrain.Forest), TERRAIN_SHARES.forest)
      const rest = 1 - Object.values(TERRAIN_SHARES).reduce((a, b) => a + b, 0)
      near(count(Terrain.Plains), rest)
    })

    it('makes a few large seas, not scattered puddles', () => {
      const seas = groupSizes(map, Terrain.Sea).sort((a, b) => b - a)
      const total = seas.reduce((a, b) => a + b, 0)
      const big = seas.slice(0, SEA_COUNT).reduce((a, b) => a + b, 0)
      expect(big / total).toBeGreaterThan(0.95)
    })

    it('forms mountains into ranges', () => {
      const sizes = groupSizes(map, Terrain.Mountain)
      const total = sizes.reduce((a, b) => a + b, 0)
      const inRanges = sizes.filter((s) => s >= 3200).reduce((a, b) => a + b, 0)
      expect(inRanges / total).toBeGreaterThan(0.7)
    })

    it('keeps all land joined and lakes inland', () => {
      expect(landGroups(map).sizes).toHaveLength(1)
      expect(checkTerrain(map)).toEqual([])
      expect(groupSizes(map, Terrain.Lake).length).toBeGreaterThan(3)
    })
  })
})

describe('checkTerrain', () => {
  it('reports cut-off land, a lake on the sea and unknown terrain', () => {
    const size = 8
    const tiles = new Uint8Array(size * size).fill(Terrain.Plains)
    // A ring of sea around one plains tile cuts it off.
    for (const [x, y] of [
      [3, 2],
      [2, 3],
      [4, 3],
      [3, 4],
    ]) {
      tiles[y * size + x!] = Terrain.Sea
    }
    tiles[6 * size + 6] = Terrain.Lake
    tiles[6 * size + 7] = Terrain.Sea
    tiles[0] = 99
    expect(
      checkTerrain({ size, tiles })
        .map((p) => p.rule)
        .sort(),
    ).toEqual(['known-terrain', 'lakes-inland', 'land-joined'])
  })
})
