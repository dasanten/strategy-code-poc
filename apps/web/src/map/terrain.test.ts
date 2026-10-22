import { CHUNK_SIZE, Terrain, UNEXPLORED, type TerrainChunk } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { TERRAIN_COLORS } from './palette.js'
import {
  TERRAIN_TEXELS,
  UNEXPLORED_TILES,
  edgeOffset,
  noiseField,
  shadeAt,
  smoothNoise,
  terrainMarks,
  terrainPixels,
} from './terrain.js'

/** A 2 × 2 chunk map. */
const size = CHUNK_SIZE * 2
const side = CHUNK_SIZE * TERRAIN_TEXELS

const filled = (cx: number, cy: number, t: number): TerrainChunk => ({
  cx,
  cy,
  tiles: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(t),
  nodes: [],
})

const rgb = (pixels: Uint8ClampedArray, px: number, py: number) => {
  const i = (py * side + px) * 4
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
}

/** Whether a pixel shows terrain `t`, allowing for its shading. */
const shows = (pixels: Uint8ClampedArray, px: number, py: number, t: number) => {
  const c = TERRAIN_COLORS[t]!
  const want = [c >> 16, (c >> 8) & 0xff, c & 0xff]
  return rgb(pixels, px, py).every((v, k) => Math.abs(v - want[k]!) <= want[k]! * 0.1 + 1)
}

describe('terrain noise', () => {
  it('repeats where the map sides join', () => {
    const period = size * TERRAIN_TEXELS
    for (const [x, y] of [
      [0, 0],
      [3.5, 100],
      [period - 1, 17],
    ] as const) {
      expect(smoothNoise(x + period, y, 6, period, 1)).toBeCloseTo(smoothNoise(x, y, 6, period, 1))
      expect(smoothNoise(x, y - period, 6, period, 1)).toBeCloseTo(smoothNoise(x, y, 6, period, 1))
    }
  })

  it('works out a whole square of noise the same as pixel by pixel', () => {
    const period = size * TERRAIN_TEXELS
    for (const cell of [3, 6, 28]) {
      const field = noiseField(side, side, side, cell, period, 7)
      for (let p = 0; p < side * side; p += 97) {
        const [px, py] = [side + (p % side), side + Math.floor(p / side)]
        expect(field[p]).toBe(smoothNoise(px, py, cell, period, 7))
      }
    }
  })

  it('pushes a pixel at most one tile, and only near the tile border', () => {
    const seen = new Set<string>()
    for (let p = 0; p < 400; p++) {
      const [px, py] = [(p * 37) % (size * TERRAIN_TEXELS), (p * 91) % (size * TERRAIN_TEXELS)]
      const [ex, ey] = edgeOffset(px, py, size)
      expect(Math.abs(ex)).toBeLessThanOrEqual(1)
      expect(Math.abs(ey)).toBeLessThanOrEqual(1)
      seen.add(`${ex},${ey}`)
    }
    // Edges are ragged: pixels do get pushed into the tiles next to them.
    expect(seen.size).toBeGreaterThan(3)
  })

  it('shades only slightly', () => {
    for (let p = 0; p < 400; p++) {
      const s = shadeAt(p * 13, p * 7, size)
      expect(s).toBeGreaterThan(0.9)
      expect(s).toBeLessThan(1.1)
    }
  })
})

describe('terrain chunk textures', () => {
  it('paints a chunk in its terrain colour, shaded a little', () => {
    const plains = filled(0, 0, Terrain.Plains)
    const { pixels, missing } = terrainPixels(plains, size, (cx, cy) => filled(cx, cy, 0).tiles)
    expect(pixels.length).toBe(side * side * 4)
    expect(missing).toEqual([])
    const colours = new Set<string>()
    for (let py = 0; py < side; py += 5) {
      for (let px = 0; px < side; px += 5) {
        expect(shows(pixels, px, py, Terrain.Plains)).toBe(true)
        colours.add(rgb(pixels, px, py).join())
      }
    }
    expect(colours.size).toBeGreaterThan(10)
  })

  it('bends the border between terrain types into a ragged edge', () => {
    // Forest on the left half of the chunk, plains on the right.
    const chunk = filled(0, 0, Terrain.Plains)
    for (let y = 0; y < CHUNK_SIZE; y++)
      chunk.tiles.fill(Terrain.Forest, y * CHUNK_SIZE, y * CHUNK_SIZE + 16)
    const { pixels } = terrainPixels(chunk, size, () => UNEXPLORED_TILES)
    const border = 16 * TERRAIN_TEXELS
    const firstPlains: number[] = []
    for (let py = 8; py < side - 8; py++) {
      let px = border - TERRAIN_TEXELS
      while (!shows(pixels, px, py, Terrain.Plains)) px++
      firstPlains.push(px)
      // Never further than a tile from the border.
      expect(Math.abs(px - border)).toBeLessThanOrEqual(TERRAIN_TEXELS)
      expect(shows(pixels, border - TERRAIN_TEXELS - 1, py, Terrain.Forest)).toBe(true)
      expect(shows(pixels, border + TERRAIN_TEXELS, py, Terrain.Plains)).toBe(true)
    }
    expect(new Set(firstPlains).size).toBeGreaterThan(2)
  })

  it('reaches into the chunks around it, across the map sides', () => {
    // Chunk (0, 0) is plains; its left neighbour across the map's side, (1, 0), is sea.
    const tilesOf = (cx: number) => filled(cx, 0, cx === 1 ? Terrain.Sea : Terrain.Plains).tiles
    const { pixels } = terrainPixels(filled(0, 0, Terrain.Plains), size, tilesOf)
    let sea = 0
    for (let py = 0; py < side; py++) {
      if (shows(pixels, 0, py, Terrain.Sea)) sea++
      expect(shows(pixels, TERRAIN_TEXELS * 2, py, Terrain.Plains)).toBe(true)
    }
    expect(sea).toBeGreaterThan(0)
    expect(sea).toBeLessThan(side)
  })

  it('joins up with the neighbour on the other side of a chunk border', () => {
    // Two chunks side by side, with sea in the three columns left of their border.
    const left = filled(0, 0, Terrain.Plains)
    const right = filled(1, 0, Terrain.Plains)
    for (let y = 0; y < CHUNK_SIZE; y++)
      left.tiles.fill(Terrain.Sea, (y + 1) * CHUNK_SIZE - 3, (y + 1) * CHUNK_SIZE)
    const tiles = (cx: number) => (cx === 0 ? left : right).tiles
    const a = terrainPixels(left, size, tiles).pixels
    const b = terrainPixels(right, size, tiles).pixels
    // The sea spills over the border into the right chunk, and the left chunk keeps its own.
    let spilled = 0
    for (let py = 0; py < side; py++) {
      if (shows(b, 0, py, Terrain.Sea)) spilled++
      expect(shows(a, side - 6, py, Terrain.Sea)).toBe(true)
    }
    expect(spilled).toBeGreaterThan(0)
  })

  it('lists neighbours not loaded yet and shows its own tiles there instead', () => {
    const forest = filled(1, 1, Terrain.Forest)
    const { pixels, missing } = terrainPixels(forest, size, (cx, cy) =>
      cx === 0 && cy === 1 ? undefined : filled(cx, cy, Terrain.Forest).tiles,
    )
    // The left and right neighbour are both (0, 1) on a map two chunks across.
    expect(missing).toEqual([1 * 2 + 0])
    for (let py = 0; py < side; py += 3) expect(shows(pixels, 0, py, Terrain.Forest)).toBe(true)
  })

  it('leaves unexplored terrain flat', () => {
    const { pixels } = terrainPixels(filled(0, 0, UNEXPLORED), size, () => UNEXPLORED_TILES)
    const c = TERRAIN_COLORS[UNEXPLORED]!
    for (let p = 0; p < side; p += 7) {
      expect(rgb(pixels, p, (p * 3) % side)).toEqual([c >> 16, (c >> 8) & 0xff, c & 0xff])
    }
  })
})

describe('terrain marks', () => {
  it('puts trees on every forest tile and fewer marks elsewhere', () => {
    const count = (t: number) => terrainMarks(filled(0, 0, t)).length
    const tiles = CHUNK_SIZE * CHUNK_SIZE
    expect(count(Terrain.Forest)).toBe(tiles)
    expect(count(Terrain.Plains)).toBeLessThan(tiles * 0.25)
    expect(count(Terrain.Plains)).toBeGreaterThan(0)
    expect(count(Terrain.Sea)).toBeLessThan(tiles * 0.5)
    expect(count(UNEXPLORED)).toBe(0)
  })

  it('gives each terrain its own kind of mark', () => {
    const kinds = (t: number) => new Set(terrainMarks(filled(0, 0, t)).map((m) => m.kind))
    expect(kinds(Terrain.Forest)).toEqual(new Set(['tree', 'trees']))
    expect(kinds(Terrain.Hills)).toEqual(new Set(['hill']))
    expect(kinds(Terrain.Mountain)).toEqual(new Set(['peak']))
    expect(kinds(Terrain.Lake)).toEqual(new Set(['wave']))
    expect(kinds(Terrain.Plains)).toEqual(new Set(['tuft']))
  })

  it('places marks inside their tile, the same way each time', () => {
    const chunk = filled(1, 0, Terrain.Mountain)
    const marks = terrainMarks(chunk)
    expect(terrainMarks(chunk)).toEqual(marks)
    for (const m of marks) {
      expect(m.x % 1).toBeGreaterThanOrEqual(0.3)
      expect(m.x % 1).toBeLessThanOrEqual(0.7)
      expect(m.y % 1).toBeGreaterThanOrEqual(0.3)
      expect(m.y % 1).toBeLessThanOrEqual(0.7)
    }
  })
})
