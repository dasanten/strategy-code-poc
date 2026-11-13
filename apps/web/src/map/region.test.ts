import { CHUNK_SIZE, chunksAcross } from '../shared/terrain.js'
import type { RegionHolder, RegionMap } from '@csp/shared-types'
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
  type RegionState,
} from './region.js'

const size = 64
const north = { id: 'a1', name: 'North' }

/** A holder with the tiles it holds, `y * size + x`: the Region map as it travelled before T99.8. */
type HeldBy = RegionHolder & { tiles: number[] }

/**
 * A Region map update as the server sends it (ADR 0034): the chunks holding the tiles given (or
 * the chunks named), each as runs of one holder along its rows.
 */
function regionOf(
  tick: number,
  held: HeldBy[],
  opts: { whole?: boolean; chunks?: number[]; gone?: number[] } = {},
): RegionMap {
  const across = chunksAcross(size)
  const byChunk = new Map<number, Map<number, number>>()
  held.forEach((h, holder) => {
    for (const t of h.tiles) {
      const [x, y] = [t % size, Math.floor(t / size)]
      const chunk = Math.floor(y / CHUNK_SIZE) * across + Math.floor(x / CHUNK_SIZE)
      const at = (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)
      byChunk.set(chunk, (byChunk.get(chunk) ?? new Map<number, number>()).set(at, holder))
    }
  })
  const named = opts.chunks ?? [...byChunk.keys()]
  const chunks = named
    .sort((a, b) => a - b)
    .map((chunk) => {
      const tiles = byChunk.get(chunk) ?? new Map<number, number>()
      const runs: number[] = []
      let last = -2
      for (let at = 0; at <= Math.max(-1, ...tiles.keys()); at++) {
        const holder = tiles.get(at) ?? -1
        if (holder === last) runs[runs.length - 2]! += 1
        else runs.push(1, holder)
        last = holder
      }
      return { chunk, runs }
    })
  const holders = held.map(({ id, name, alliance }) => ({ id, name, alliance }))
  return { tick, whole: opts.whole ?? true, holders, chunks, gone: opts.gone ?? [] }
}

/** The client's copy as it was built from the tile lists before T99.8. */
function stateOf(held: HeldBy[]): RegionState {
  const holders = new Map(held.map(({ id, name, alliance }) => [id, { id, name, alliance }]))
  const owners = new Map(held.flatMap((h) => h.tiles.map((t) => [t, h.id] as const)))
  return { tick: 1, holders, owners, changed: null }
}

/** Ann and Bo in North, Oakmoor alone; Ann in chunks 0 and 1, the others in chunk 0. */
const territory: HeldBy[] = [
  { id: 'c3', name: 'Oakmoor', alliance: null, tiles: [3] },
  { id: 'r1', name: 'Ann', alliance: north, tiles: [1, CHUNK_SIZE + 1] },
  { id: 'r2', name: 'Bo', alliance: north, tiles: [2] },
]
const whole = regionOf(120, territory)

describe('region map', () => {
  it('keeps who holds each tile', () => {
    const state = applyRegionMap(null, whole, size)
    expect(state.changed).toBeNull()
    expect(holderAt(state, size, 1, 0)?.name).toBe('Ann')
    expect(holderAt(state, size, 4, 0)).toBeUndefined()
    expect(regionChunks(state, size)).toEqual(new Set([0, 1]))
    expect(state.owners).toEqual(stateOf(territory).owners)
  })

  it('replaces only the chunks a part covers, and clears those named as gone', () => {
    const before = applyRegionMap(null, whole, size)
    const cy = { id: 'r3', name: 'Cy', alliance: null, tiles: [5] }
    const after = applyRegionMap(before, regionOf(180, [cy], { whole: false }), size)
    expect(after.changed).toEqual([0])
    expect(holderAt(after, size, 1, 0)).toBeUndefined()
    expect(holderAt(after, size, 5, 0)?.name).toBe('Cy')
    expect(holderAt(after, size, CHUNK_SIZE + 1, 0)?.name).toBe('Ann')
    // Chunk 1 lost its territory.
    const gone = applyRegionMap(after, regionOf(240, [], { whole: false, gone: [1] }), size)
    expect(gone.changed).toEqual([1])
    expect(holderAt(gone, size, CHUNK_SIZE + 1, 0)).toBeUndefined()
    expect(holderAt(gone, size, 5, 0)?.name).toBe('Cy')
    // A whole map replaces everything.
    const again = applyRegionMap(after, regionOf(300, []), size)
    expect(again.owners.size).toBe(0)
  })

  it('takes a holder renamed without its tiles, and redraws all when its colour changes', () => {
    const before = applyRegionMap(null, whole, size)
    const elmford = { id: 'c3', name: 'Elmford', alliance: null }
    const renamed = { tick: 180, whole: false, holders: [elmford], chunks: [], gone: [] }
    const after = applyRegionMap(before, renamed, size)
    expect(holderAt(after, size, 3, 0)?.name).toBe('Elmford')
    expect(after.changed).toEqual([])
    const joined = { ...renamed, holders: [{ ...elmford, alliance: north }] }
    expect(applyRegionMap(after, joined, size).changed).toBeNull()
  })

  it('shows the same fill, borders and legend as the tile lists did on the same territory', () => {
    const held: HeldBy[] = ['c3', 'r1', 'r2', 'r3'].map((id, i) => ({
      id,
      name: id,
      alliance: i < 2 ? null : north,
      tiles: [],
    }))
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if ((x * 7 + y * 3) % 5 === 0) continue
        held[(Math.floor(x / 3) + Math.floor(y / 5)) % 4]!.tiles.push(y * size + x)
      }
    }
    const old = stateOf(held)
    const now = applyRegionMap(null, regionOf(120, held), size)
    expect(now.owners).toEqual(old.owners)
    const across = chunksAcross(size)
    for (let c = 0; c < across * across; c++) {
      const [cx, cy] = [c % across, Math.floor(c / across)]
      expect(regionChunkPixels(now, size, cx, cy)).toEqual(regionChunkPixels(old, size, cx, cy))
      expect(regionBorders(now, size, cx, cy)).toEqual(regionBorders(old, size, cx, cy))
    }
    expect(regionGroups(now)).toEqual(regionGroups(old))
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
  const square = regionOf(1, [
    { id: 'c3', name: 'Oakmoor', alliance: null, tiles: [65, 66, 129, 130] },
    { id: 'r1', name: 'Ann', alliance: north, tiles: [67] },
  ])
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
    const across = regionOf(1, [
      { id: 'c3', name: 'Oakmoor', alliance: null, tiles: [0, size - 1] },
    ])
    const s = applyRegionMap(null, across, size)
    const left = regionBorders(s, size, 0, 0).get(oak)!
    // Tile (0, 0) has no border on its left: (size - 1, 0) across the join is Oakmoor's too.
    expect(left.some((r) => r.x0 === 0 && r.x1 === 0)).toBe(false)
  })

  it('has none for a chunk with no territory', () => {
    expect(regionBorders(state, size, 1, 1).size).toBe(0)
  })
})
