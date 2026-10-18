import { describe, expect, it } from 'vitest'
import { decodeChunk, encodeChunk } from './chunks.js'
import { CHUNK_SIZE, Terrain } from './terrain.js'

describe('chunk encoding', () => {
  it('round-trips terrain and resource nodes', () => {
    const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(Terrain.Forest)
    tiles[5] = Terrain.Hills
    const nodes = [
      { kind: 'forest' as const, x: 64, y: 96 },
      { kind: 'goldOre' as const, x: 95, y: 127 },
    ]
    const bytes = encodeChunk(tiles, nodes, 2, 3)
    expect(bytes).toHaveLength(CHUNK_SIZE * CHUNK_SIZE + 6)
    expect(decodeChunk(2, 3, bytes)).toEqual({ cx: 2, cy: 3, tiles, nodes })
  })

  it('reads a chunk without nodes', () => {
    const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
    expect(decodeChunk(0, 0, tiles).nodes).toEqual([])
  })
})
