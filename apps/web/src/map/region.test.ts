import { CHUNK_SIZE } from '../shared/terrain.js'
import type { RegionMap } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import {
  applyRegionMap,
  colourKey,
  holderAt,
  holderLabel,
  regionChunkPixels,
  regionChunks,
  regionColour,
  regionBorders,
  regionGroups,
  regionLook,
} from './region.js'

const size = 64
const north = { id: 'a1', name: 'North' }

/** Ann and Bo in North, Oakmoor alone; Ann in chunks 0 and 1, the others in chunk 0. */
const whole: RegionMap = {
  tick: 120,
  chunks: null,
  holders: [
    { id: 'c3', name: 'Oakmoor', alliance: null, tiles: [3] },
    { id: 'r1', name: 'Ann', alliance: north, tiles: [1, CHUNK_SIZE + 1] },
    { id: 'r2', name: 'Bo', alliance: north, tiles: [2] },
  ],
}

describe('region map', () => {
  it('keeps who holds each tile', () => {
    const state = applyRegionMap(null, whole, size)
    expect(state.changed).toBeNull()
    expect(holderAt(state, size, 1, 0)?.name).toBe('Ann')
    expect(holderAt(state, size, 4, 0)).toBeUndefined()
    expect(regionChunks(state, size)).toEqual(new Set([0, 1]))
  })

  it('replaces only the chunks a part covers', () => {
    const before = applyRegionMap(null, whole, size)
    const part: RegionMap = {
      tick: 120,
      chunks: [0],
      holders: [{ id: 'r3', name: 'Cy', alliance: null, tiles: [5] }],
    }
    const after = applyRegionMap(before, part, size)
    expect(after.changed).toEqual([0])
    expect(holderAt(after, size, 1, 0)).toBeUndefined()
    expect(holderAt(after, size, 5, 0)?.name).toBe('Cy')
    expect(holderAt(after, size, CHUNK_SIZE + 1, 0)?.name).toBe('Ann')
    // A whole map replaces everything.
    const again = applyRegionMap(after, { ...whole, holders: [] }, size)
    expect(again.owners.size).toBe(0)
  })

  it("colours alliance members in the alliance's colour, and names the member holding a tile", () => {
    const state = applyRegionMap(null, whole, size)
    const [ann, bo, oak] = ['r1', 'r2', 'c3'].map((id) => state.holders.get(id)!)
    expect(colourKey(ann!)).toBe(colourKey(bo!))
    expect(colourKey(oak!)).not.toBe(colourKey(ann!))
    expect(regionColour('a1')).toBe(regionColour('a1'))
    expect(regionColour('a1')).not.toBe(regionColour('c3'))
    expect(holderLabel(ann)).toBe('held by Ann (North)')
    expect(holderLabel(oak)).toBe('held by Oakmoor')
    expect(holderLabel(undefined)).toBe('held by nobody')
    expect(regionGroups(state)).toEqual([
      { key: 'a1', colour: regionColour('a1'), name: 'North', members: ['Ann', 'Bo'] },
      { key: 'c3', colour: regionColour('c3'), name: 'Oakmoor', members: [] },
    ])
  })

  it('paints held tiles of a chunk in their colour and leaves the rest clear', () => {
    const state = applyRegionMap(null, whole, size)
    const pixels = regionChunkPixels(state, size, 0, 0)!
    const c = regionColour('a1')
    expect([...pixels.slice(4, 8)]).toEqual([c >> 16, (c >> 8) & 0xff, c & 0xff, 140])
    expect(pixels[3]).toBe(0)
    expect(regionChunkPixels(state, size, 0, 1)).toBeUndefined()
  })
})

describe('region look by tier', () => {
  it('fills territory in the far tier and draws only borders nearer in', () => {
    expect(regionLook('far', false)).toBe('fill')
    expect(regionLook('middle', false)).toBe('borders')
    expect(regionLook('close', false)).toBe('borders')
  })

  it('fills at every tier while the Region map button forces it on', () => {
    for (const tier of ['far', 'middle', 'close'] as const)
      expect(regionLook(tier, true)).toBe('fill')
  })

  it('shows territory on the admin map only when toggled on', () => {
    expect(regionLook('far', false, true)).toBe('none')
    expect(regionLook('close', false, true)).toBe('none')
    expect(regionLook('close', true, true)).toBe('fill')
  })
})

describe('region borders', () => {
  /** Oakmoor holds a 2×2 square at (1, 1); Ann the tile right of it. */
  const square: RegionMap = {
    tick: 1,
    chunks: null,
    holders: [
      { id: 'c3', name: 'Oakmoor', alliance: null, tiles: [65, 66, 129, 130] },
      { id: 'r1', name: 'Ann', alliance: north, tiles: [67] },
    ],
  }
  const state = applyRegionMap(null, square, size)
  const oak = regionColour('c3')
  const ann = regionColour('a1')

  it('runs along the edges of a holder’s tiles, joined where they line up', () => {
    const runs = regionBorders(state, size, 0, 0).get(oak)!
    expect(runs).toHaveLength(4)
    expect(runs).toContainEqual({ x0: 1, y0: 1, x1: 3, y1: 1, nx: 0, ny: 1 })
    expect(runs).toContainEqual({ x0: 1, y0: 3, x1: 3, y1: 3, nx: 0, ny: -1 })
    expect(runs).toContainEqual({ x0: 1, y0: 1, x1: 1, y1: 3, nx: 1, ny: 0 })
    expect(runs).toContainEqual({ x0: 3, y0: 1, x1: 3, y1: 3, nx: -1, ny: 0 })
  })

  it('gives each holder its own line where two meet, each on its own side', () => {
    const runs = regionBorders(state, size, 0, 0).get(ann)!
    expect(runs).toContainEqual({ x0: 3, y0: 1, x1: 3, y1: 2, nx: 1, ny: 0 })
    expect(runs).toHaveLength(4)
  })

  it('looks across the map’s joined sides for the neighbour', () => {
    const across: RegionMap = {
      tick: 1,
      chunks: null,
      holders: [{ id: 'c3', name: 'Oakmoor', alliance: null, tiles: [0, size - 1] }],
    }
    const s = applyRegionMap(null, across, size)
    const left = regionBorders(s, size, 0, 0).get(oak)!
    // Tile (0, 0) has no border on its left: (size - 1, 0) across the join is Oakmoor's too.
    expect(left.some((r) => r.x0 === 0 && r.x1 === 0)).toBe(false)
  })

  it('has none for a chunk with no territory', () => {
    expect(regionBorders(state, size, 1, 1).size).toBe(0)
  })
})
