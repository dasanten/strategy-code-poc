import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE,
  TERRAIN_BATCH_MAX,
  TERRAIN_LEVEL_MAX,
  Terrain,
  UNEXPLORED,
  chunksAcross,
} from '../shared/terrain.js'
import type { Building, BuildingKind, City, SeenCarriage, SeenResident } from '@csp/shared-types'
import type { MapWorld } from './map-world.js'
import {
  MINIMAP_MIN_SPAN,
  minimapDots,
  minimapChunks,
  minimapFrame,
  minimapLevel,
  minimapOpenAtStart,
  minimapPixels,
  minimapToTile,
  minimapView,
  rememberMinimapOpen,
  terrainAtLevel,
  tileToMinimap,
} from './minimap.js'
import { TERRAIN_COLORS } from './palette.js'

const size = 256
const across = chunksAcross(size)
const viewer = { realmId: 'me', allies: new Set(['ally']) }

const building = (
  id: string,
  kind: BuildingKind,
  x: number,
  y: number,
  cityId: string | null = null,
): Building => ({ id, kind, cityId, x, y })
const city = (id: string, realmId: string | null, extra: Partial<City> = {}): City => ({
  id,
  name: id,
  realmId,
  townHallId: `${id}-hall`,
  occupation: null,
  ...extra,
})
const resident = (id: string, owner: string | null, x: number, y: number) =>
  ({ id, owner, cityId: null, x, y, carried: {}, order: null }) as unknown as SeenResident
const carriage = (id: string, realmId: string | null, x: number, y: number) =>
  ({ id, realmId, cityId: null, x, y, horseId: null, load: {} }) as SeenCarriage

/** A world seen from realm `me`, home at (40, 40), with a city of each relationship. */
function world(more: Partial<MapWorld> = {}): MapWorld {
  return {
    map: { size },
    exploredChunks: new Set([0]),
    grownChunks: [],
    home: { realmId: 'me', leaderId: null, cityId: 'home', x: 40, y: 40 },
    residents: [],
    cities: [
      city('home', 'me'),
      city('second', 'me'),
      city('allied', 'ally'),
      city('rival', 'them'),
      city('village', null),
      city('post', null, { tradeOrg: 'post' }),
    ],
    buildings: [
      building('home-hall', 'townHall', 40, 40, 'home'),
      building('second-hall', 'townHall', 90, 40, 'second'),
      building('allied-hall', 'townHall', 40, 90, 'allied'),
      building('rival-hall', 'townHall', 90, 90, 'rival'),
      building('village-hall', 'townHall', 140, 40, 'village'),
      building('post-hall', 'townHall', 140, 90, 'post'),
    ],
    horses: [],
    carriages: [],
    piles: [],
    armies: [],
    caravans: [],
    traders: [],
    lastSeen: { cities: [], buildings: [] },
    diplomacy: {},
    region: null,
    ...more,
  }
}

describe('minimap frame', () => {
  it('spans at least MINIMAP_MIN_SPAN tiles around a small explored circle', () => {
    const frame = minimapFrame([0], { x: 16, y: 16 }, size)
    expect(frame).toEqual({ x: 16, y: 16, span: MINIMAP_MIN_SPAN })
  })

  it('takes in every explored chunk, also across the map’s joined sides', () => {
    // Home at the top left corner; explored chunks on both sides of the join.
    const last = across - 1
    const explored = [0, 1, 2, 3, last, last * across, last * across + last]
    const frame = minimapFrame(explored, { x: 5, y: 5 }, size)
    // Four chunks east of the join and one west of it, plus a margin on each side.
    expect(frame.span).toBe(5 * CHUNK_SIZE + 16)
    expect(frame.x).toBe(48)
    expect(frame.y).toBe(0)
  })

  it('never spans more than the whole map', () => {
    const all = Array.from({ length: across * across }, (_, i) => i)
    expect(minimapFrame(all, { x: 0, y: 0 }, size).span).toBe(size)
  })
})

describe('minimap mapping', () => {
  const frame = { x: 100, y: 50, span: 100 }
  const side = 200

  it('puts the frame’s centre in the middle and its corner at the top left', () => {
    expect(tileToMinimap(frame, size, side, 100, 50)).toEqual([100, 100])
    expect(tileToMinimap(frame, size, side, 50, 0)).toEqual([0, 0])
  })

  it('maps a click back to the tile under it, across the join', () => {
    expect(minimapToTile(frame, size, side, 100, 100)).toEqual({ x: 100, y: 50 })
    expect(minimapToTile(frame, size, side, 0, 0)).toEqual({ x: 50, y: 0 })
    // The top rows lie past the map's top side, so they wrap to its bottom.
    expect(minimapToTile(frame, size, side, 100, -2)).toEqual({ x: 100, y: size - 1 })
    const tile = { x: 73, y: 21 }
    const [px, py] = tileToMinimap(frame, size, side, tile.x + 0.5, tile.y + 0.5)
    expect(minimapToTile(frame, size, side, px, py)).toEqual(tile)
  })

  it('draws the view as a rectangle around the camera', () => {
    const rect = minimapView(
      frame,
      size,
      side,
      { x: 100, y: 50, scale: 10 },
      {
        width: 400,
        height: 200,
      },
    )
    // 40 × 20 tiles on screen, at 2 minimap pixels a tile.
    expect(rect).toEqual({ x: 60, y: 80, width: 80, height: 40 })
  })
})

describe('minimap terrain', () => {
  it('colours explored tiles and leaves the rest clear', () => {
    const frame = { x: 2, y: 2, span: 4 }
    const pixels = minimapPixels(frame, size, 4, (x, y) =>
      x === 0 && y === 0 ? Terrain.Forest : x === 1 && y === 0 ? UNEXPLORED : undefined,
    )
    const c = TERRAIN_COLORS[Terrain.Forest]!
    expect([...pixels.slice(0, 4)]).toEqual([c >> 16, (c >> 8) & 0xff, c & 0xff, 255])
    expect(pixels[7]).toBe(0)
    expect(pixels[11]).toBe(0)
  })
})

describe('minimap level (ADR 0034)', () => {
  const big = 5760

  it('stays at full detail for a small frame, as before', () => {
    const frame = { x: 1000, y: 1000, span: MINIMAP_MIN_SPAN }
    expect(minimapLevel(frame, big)).toBe(0)
    expect(minimapChunks(frame, big, 0).length).toBeLessThanOrEqual(16)
  })

  it('picks the finest level whose chunks for the frame fit in one batch', () => {
    const frame = { x: 1000, y: 5700, span: 1500 }
    const level = minimapLevel(frame, big)
    expect(level).toBe(3)
    expect(minimapChunks(frame, big, level).length).toBeLessThanOrEqual(TERRAIN_BATCH_MAX)
    expect(minimapChunks(frame, big, level - 1).length).toBeGreaterThan(TERRAIN_BATCH_MAX)
  })

  it('draws the whole map from the coarsest level, every chunk of it and no padding', () => {
    const frame = { x: 2880, y: 2880, span: big }
    expect(minimapLevel(frame, big)).toBe(TERRAIN_LEVEL_MAX)
    // Six level-5 chunks across, the last one partly padding.
    const chunks = minimapChunks(frame, big, TERRAIN_LEVEL_MAX).sort((a, b) => a - b)
    expect(chunks).toEqual(Array.from({ length: 36 }, (_, i) => i))
  })

  it('reads a tile from the square of its level that holds it', () => {
    // Level 2 on a 256-tile map: 64 squares across, 2 chunks of 32 squares.
    const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(UNEXPLORED)
    tiles[3 * CHUNK_SIZE + 1] = Terrain.Hills
    const asked: Array<[number, number]> = []
    const at = terrainAtLevel(size, 2, (i, level) => {
      asked.push([i, level])
      return i === 3 ? { tiles } : undefined
    })
    // Tile (133, 140) is in square (33, 35): chunk (1, 1), byte (1, 3).
    expect(at(133, 140)).toBe(Terrain.Hills)
    expect(at(132, 141)).toBe(Terrain.Hills)
    expect(at(136, 140)).toBe(UNEXPLORED)
    expect(at(0, 0)).toBeUndefined()
    expect(asked[0]).toEqual([3, 2])
    expect(asked.at(-1)).toEqual([0, 2])
  })
})

describe('minimap dots', () => {
  it('marks the home city and every known city in its relationship colour', () => {
    const dots = minimapDots(world(), viewer)
    const cities = dots.filter((d) => d.kind === 'city' || d.kind === 'home')
    expect(cities.map((d) => [d.kind, d.x, d.y, d.rel])).toEqual([
      ['city', 90, 40, 'own'],
      ['city', 40, 90, 'alliance'],
      ['city', 90, 90, 'other'],
      ['city', 140, 40, 'npc'],
      ['city', 140, 90, 'trade'],
      ['home', 40, 40, 'own'],
    ])
  })

  it('includes cities only remembered, faded', () => {
    const lastSeen = {
      cities: [city('far', 'them')],
      buildings: [building('far-hall', 'townHall', 200, 200, 'far')],
    }
    const dot = minimapDots(world({ lastSeen }), viewer).find((d) => d.x === 200)
    expect(dot).toEqual({ kind: 'city', x: 200, y: 200, rel: 'other', remembered: true })
  })

  it('shows the Player’s residents and carriages away from their cities, not others’', () => {
    const dots = minimapDots(
      world({
        residents: [
          resident('home-bound', 'me', 41, 41),
          resident('scout', 'me', 60, 60),
          resident('stranger', 'them', 61, 61),
        ],
        carriages: [carriage('on-road', 'me', 65, 40), carriage('theirs', 'them', 66, 40)],
      }),
      viewer,
    )
    const away = dots.filter((d) => d.kind === 'resident' || d.kind === 'carriage')
    expect(away).toEqual([
      { kind: 'resident', x: 60, y: 60, rel: 'own' },
      { kind: 'carriage', x: 65, y: 40, rel: 'own' },
    ])
    // Residents first, so cities are drawn over them.
    expect(dots[0]!.kind).toBe('resident')
    expect(dots.at(-1)!.kind).toBe('home')
  })

  it('marks the Player’s waypoints, over everything else (Waypoint)', () => {
    const waypoints = [
      { id: 'wp1', name: 'Pass', x: 70, y: 20 },
      // On their home city, still drawn over its dot.
      { id: 'wp2', name: 'Home', x: 40, y: 40 },
    ]
    const dots = minimapDots(world({ waypoints }), viewer)
    expect(dots.slice(-2)).toEqual([
      { kind: 'waypoint', x: 70, y: 20, rel: 'own' },
      { kind: 'waypoint', x: 40, y: 40, rel: 'own' },
    ])
  })
})

describe('minimap folding', () => {
  const store = (v: string | null) => () => ({ getItem: () => v })

  it('starts open, but folded on a phone', () => {
    expect(minimapOpenAtStart(false, store(null))).toBe(true)
    expect(minimapOpenAtStart(true, store(null))).toBe(false)
  })

  it('starts as the Player left it in this browser', () => {
    expect(minimapOpenAtStart(false, store('0'))).toBe(false)
    expect(minimapOpenAtStart(true, store('1'))).toBe(true)
    let saved = ''
    rememberMinimapOpen(false, () => ({ setItem: (_k: string, v: string) => (saved = v) }))
    expect(saved).toBe('0')
  })

  it('starts as a fresh browser would when storage is off', () => {
    const off = () => {
      throw new Error('no storage')
    }
    expect(minimapOpenAtStart(true, off)).toBe(false)
    expect(() => rememberMinimapOpen(true, off)).not.toThrow()
  })
})
