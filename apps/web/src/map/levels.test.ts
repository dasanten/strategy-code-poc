import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE,
  TERRAIN_LEVEL_MAX,
  Terrain,
  UNEXPLORED,
  chunksAcross,
  levelChunksAcross,
} from '../shared/terrain.js'
import { MAX_SCALE, minScale, visibleChunks } from './camera.js'
import {
  LEVEL_SQUARE_PX,
  MAX_CHUNKS_ON_SCREEN,
  coarseTexels,
  coarserCover,
  levelChunkRect,
  levelChunkToScreen,
  levelForScale,
  visibleLevelChunks,
} from './levels.js'
import { TERRAIN_COLORS } from './palette.js'

const size = 5760
const across = chunksAcross(size)
const hd = { width: 1920, height: 1080 }

describe('the level drawn at a zoom (ADR 0034)', () => {
  it('is full detail from LEVEL_SQUARE_PX / 2 pixels a tile up', () => {
    expect(levelForScale(MAX_SCALE)).toBe(0)
    expect(levelForScale(LEVEL_SQUARE_PX / 2 + 0.01)).toBe(0)
  })

  it('is the coarsest level whose squares are at most LEVEL_SQUARE_PX pixels', () => {
    expect(levelForScale(3)).toBe(1)
    expect(levelForScale(1.5)).toBe(2)
    expect(levelForScale(1)).toBe(2)
    expect(levelForScale(0.75)).toBe(3)
    // Zoomed all the way out on a 1920-wide screen: squares of 16 tiles, 5.3 pixels.
    expect(levelForScale(minScale(size, hd))).toBe(4)
    // On a phone, the coarsest level.
    expect(levelForScale(minScale(size, { width: 375, height: 812 }))).toBe(TERRAIN_LEVEL_MAX)
    expect(levelForScale(0.001)).toBe(TERRAIN_LEVEL_MAX)
    for (let scale = 0.05; scale < 3; scale *= 1.1) {
      const level = levelForScale(scale)
      if (level === TERRAIN_LEVEL_MAX) continue
      const square = 2 ** level * scale
      expect(square).toBeLessThanOrEqual(LEVEL_SQUARE_PX)
      expect(square).toBeGreaterThan(LEVEL_SQUARE_PX / 2)
    }
  })

  it('never wants more than MAX_CHUNKS_ON_SCREEN chunks on a 1920 × 1080 screen', () => {
    let most = 0
    for (let scale = minScale(size, hd); scale <= MAX_SCALE; scale *= 1.03) {
      for (const [x, y] of [
        [0, 0],
        [2000, 3000],
        [5759, 17],
      ] as const) {
        const cam = { x, y, scale }
        const level = levelForScale(scale)
        const n =
          level === 0
            ? visibleChunks(cam, hd, size).length
            : visibleLevelChunks(cam, hd, size, level).length
        most = Math.max(most, n)
      }
    }
    expect(most).toBeLessThanOrEqual(MAX_CHUNKS_ON_SCREEN)
    expect(most).toBeGreaterThan(MAX_CHUNKS_ON_SCREEN / 2)
  })
})

describe('chunks of a level on screen', () => {
  // Level 3: chunks of 256 tiles, 23 across; the last holds 128 tiles of the map, then padding.
  const level = 3

  it('crosses the join from the last chunk of a row, cut at the map side, to the first', () => {
    const cam = { x: 0, y: 2000, scale: 0.75 }
    const chunks = visibleLevelChunks(cam, hd, size, level)
    const n = levelChunksAcross(across, level)
    expect(n).toBe(23)
    const cols = [...new Set(chunks.map((i) => i % n))]
    expect(cols).toEqual([17, 18, 19, 20, 21, 22, 0, 1, 2, 3, 4, 5])
    expect(levelChunkRect(size, level, 22)).toEqual({ x: 5632, y: 0, w: 128, h: 256 })
    // On screen, the last chunk ends where the first begins: no padding between.
    const row = 7 * n
    const last = levelChunkToScreen(cam, hd, size, level, row + 22)
    const first = levelChunkToScreen(cam, hd, size, level, row)
    expect(last.width).toBe(128 * 0.75)
    expect(last.x + last.width).toBeCloseTo(first.x)
  })

  it('takes each chunk once when the view spans the whole map', () => {
    const cam = { x: 100, y: 100, scale: minScale(size, hd) }
    const chunks = visibleLevelChunks(cam, hd, size, 4)
    expect(new Set(chunks).size).toBe(chunks.length)
    // The map fills the screen's width: every column, each once.
    const n = levelChunksAcross(across, 4)
    expect(new Set(chunks.map((i) => i % n)).size).toBe(n)
  })
})

describe('a coarser chunk under one still loading', () => {
  it('is the finest coarser chunk loaded that holds it', () => {
    // Level-1 chunk (5, 7): at level 2 it is in (2, 3), at level 3 in (1, 1).
    const n1 = levelChunksAcross(across, 1)
    const at = (level: number, cx: number, cy: number) => cy * levelChunksAcross(across, level) + cx
    const index = 7 * n1 + 5
    const loaded = new Set([`3:${at(3, 1, 1)}`])
    const has = (i: number, k: number) => loaded.has(`${k}:${i}`)
    expect(coarserCover(size, 1, index, has)).toEqual({ level: 3, index: at(3, 1, 1) })
    loaded.add(`2:${at(2, 2, 3)}`)
    expect(coarserCover(size, 1, index, has)).toEqual({ level: 2, index: at(2, 2, 3) })
    // From full detail too: level-0 chunk (40, 90) is in level-5 chunk (1, 2).
    const five = new Set([at(5, 1, 2)])
    expect(coarserCover(size, 0, 90 * across + 40, (i, k) => k === 5 && five.has(i))).toEqual({
      level: 5,
      index: at(5, 1, 2),
    })
  })

  it('is none when no coarser one is loaded, or for the coarsest level', () => {
    expect(coarserCover(size, 2, 0, () => false)).toBeUndefined()
    expect(coarserCover(size, TERRAIN_LEVEL_MAX, 0, () => true)).toBeUndefined()
  })
})

describe('a coarse chunk’s picture', () => {
  it('is one texel a square, clear where nothing was explored, the map’s squares only', () => {
    const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(UNEXPLORED)
    tiles[0] = Terrain.Forest
    tiles[CHUNK_SIZE + 1] = Terrain.Sea
    const texels = coarseTexels(tiles, 2, 2)
    expect(texels.length).toBe(2 * 2 * 4)
    const c = TERRAIN_COLORS[Terrain.Forest]!
    expect([...texels.slice(0, 4)]).toEqual([c >> 16, (c >> 8) & 0xff, c & 0xff, 255])
    expect(texels[7]).toBe(0)
    expect(texels[15]).toBe(255)
  })
})
