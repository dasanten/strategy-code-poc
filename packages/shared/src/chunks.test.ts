import { describe, expect, it } from 'vitest'
import { decodeChunk, decodeChunkBatch, encodeChunk, encodeChunkBatch } from './chunks.js'
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

  it('puts many chunks in one body, each with its index and length in front', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE + 3).fill(7)
    const body = encodeChunkBatch([
      [70000, a],
      [5, b],
    ])
    expect(body).toHaveLength(8 + 3 + 8 + b.length)
    // Little-endian: index 70000 is 0x00011170.
    expect([...body.subarray(0, 11)]).toEqual([0x70, 0x11, 0x01, 0, 3, 0, 0, 0, 1, 2, 3])
    expect(decodeChunkBatch(body)).toEqual([
      [70000, a],
      [5, b],
    ])
    expect(decodeChunkBatch(new Uint8Array())).toEqual([])
  })
})
