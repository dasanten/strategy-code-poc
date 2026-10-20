import { CHUNK_SIZE, type RegionMap } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  applyRegionMap,
  colourKey,
  holderAt,
  holderLabel,
  regionChunkPixels,
  regionChunks,
  regionColour,
  regionGroups,
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
