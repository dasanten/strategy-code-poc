import { describe, expect, it } from 'vitest'
import type { PlayerLand } from '@csp/shared-types'
import { describeTile } from '../selection-view.js'
import { GOOD_LABELS } from '../Residents.js'
import {
  LAND_BRIDGE_MARK_COLOR,
  PASS_MARK_COLOR,
  applyLand,
  landMarks,
  regionAt,
  regionLine,
  type TileRegion,
} from './land.js'

// A 64-tile map: 2 by 2 chunks of 32.
const SIZE = 64

/** Runs over a chunk: `[length, id, …]`, the rest of its 1024 tiles none. */
const runs = (...parts: number[]) => parts

const land: PlayerLand = {
  regions: [
    { id: 0, kind: 'heartland', name: 'Ashvale' },
    { id: 3, kind: 'frontier', name: 'Greywold' },
  ],
  ways: [{ kind: 'pass', x: 34, y: 1, tiles: [1 * SIZE + 34, 1 * SIZE + 35] }],
  chunks: [
    // Chunk 0: its first row Ashvale, the rest unknown.
    { chunk: 0, runs: runs(32, 0, 992, -1) },
    // Chunk 1 (x 32–63): its first two rows Greywold.
    { chunk: 1, runs: runs(64, 3) },
  ],
}

const card = (region: TileRegion | undefined) =>
  describeTile(
    {
      x: 34,
      y: 1,
      buildings: [],
      carriages: [],
      horses: [],
      piles: [],
      node: undefined,
      strangers: [],
      cities: [],
      viewer: { realmId: 'me', allies: new Set<string>() },
      workers: () => 0,
      ...(region ? { region } : {}),
    },
    GOOD_LABELS,
  )

describe('the land the Player knows', () => {
  const state = applyLand(null, land, SIZE)

  it('knows the region of each explored tile and nothing of the rest', () => {
    expect(regionAt(state, SIZE, 5, 0)).toEqual({ name: 'Ashvale', kind: 'heartland' })
    expect(regionAt(state, SIZE, 5, 1)).toBeUndefined()
    expect(regionAt(state, SIZE, 40, 1)).toEqual({ name: 'Greywold', kind: 'frontier' })
    // Unloaded chunks, and no land at all, know nothing.
    expect(regionAt(state, SIZE, 5, 40)).toBeUndefined()
    expect(regionAt(null, SIZE, 5, 0)).toBeUndefined()
    // Past a side the map goes on from the other.
    expect(regionAt(state, SIZE, 5 + SIZE, -SIZE)).toEqual({ name: 'Ashvale', kind: 'heartland' })
  })

  it('says pass or land bridge on a tile of one', () => {
    expect(regionAt(state, SIZE, 34, 1)).toEqual({ name: 'Greywold', kind: 'frontier', way: 'pass' })
  })

  it('names the region and its kind on the tile card', () => {
    expect(regionLine({ name: 'Ashvale', kind: 'heartland' })).toBe('Heartland of Ashvale')
    expect(regionLine({ name: 'Greywold', kind: 'frontier' })).toBe('Frontier: Greywold')
    expect(regionLine({ name: 'Tern', kind: 'island' })).toBe('Island: Tern')
    expect(regionLine({ name: 'Greywold', kind: 'frontier', way: 'landBridge' })).toBe(
      'Frontier: Greywold · land bridge',
    )
    const lines = card(regionAt(state, SIZE, 34, 1)).lines
    expect(lines).toContain('Frontier: Greywold · pass')
    expect(lines.indexOf('Frontier: Greywold · pass')).toBe(lines.indexOf('Tile 34, 1') - 1)
    // An unexplored tile's card says nothing of a region.
    expect(card(undefined).lines.some((l) => l.includes('Greywold'))).toBe(false)
  })

  it('writes each region’s name over a tile of it the Player explored', () => {
    expect(state.labels).toEqual([
      { id: 0, name: 'Ashvale', x: 15, y: 0 },
      { id: 3, name: 'Greywold', x: 47, y: 0 },
    ])
    for (const l of state.labels) expect(regionAt(state, SIZE, l.x, l.y)?.name).toBe(l.name)
  })

  it('marks the passes and land bridges it knows', () => {
    const more = applyLand(
      state,
      {
        regions: [],
        ways: [...land.ways, { kind: 'landBridge', x: 3, y: 0, tiles: [3] }],
        chunks: [],
      },
      SIZE,
    )
    expect(landMarks(more)).toEqual([
      { x: 34, y: 1, color: PASS_MARK_COLOR },
      { x: 3, y: 0, color: LAND_BRIDGE_MARK_COLOR },
    ])
    expect(regionAt(more, SIZE, 3, 0)?.way).toBe('landBridge')
    expect(landMarks(null)).toEqual([])
  })

  it('replaces the chunks an update sends and keeps the rest', () => {
    const grown = applyLand(
      state,
      {
        regions: [{ id: 7, kind: 'island', name: 'Tern' }],
        ways: land.ways,
        chunks: [{ chunk: 0, runs: runs(64, 0, 32, 7) }],
      },
      SIZE,
    )
    expect(regionAt(grown, SIZE, 5, 1)).toEqual({ name: 'Ashvale', kind: 'heartland' })
    expect(regionAt(grown, SIZE, 5, 2)).toEqual({ name: 'Tern', kind: 'island' })
    expect(regionAt(grown, SIZE, 40, 0)?.name).toBe('Greywold')
    expect(grown.labels.map((l) => l.name)).toEqual(['Ashvale', 'Greywold', 'Tern'])
  })
})
