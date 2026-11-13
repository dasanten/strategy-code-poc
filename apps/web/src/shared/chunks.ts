// Ported from packages/shared/src/chunks.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { CHUNK_SIZE } from './terrain.js'
import type { KnownNode, ResourceKind, TerrainChunk } from '@csp/shared-types'

/** Resource node kinds by the byte that stands for them in a served chunk. Only add to the end. */
export const NODE_KINDS: readonly ResourceKind[] = ['forest', 'stone', 'ironOre', 'goldOre']

/**
 * A chunk as served from `terrainChunkPath`: the `CHUNK_SIZE`² terrain bytes, then three bytes
 * per resource node (x and y within the chunk, and its kind's index in `NODE_KINDS`).
 */
export function encodeChunk(tiles: Uint8Array, nodes: KnownNode[], cx: number, cy: number) {
  const out = new Uint8Array(tiles.length + nodes.length * 3)
  out.set(tiles)
  nodes.forEach((n, i) => {
    const at = tiles.length + i * 3
    out[at] = n.x - cx * CHUNK_SIZE
    out[at + 1] = n.y - cy * CHUNK_SIZE
    out[at + 2] = NODE_KINDS.indexOf(n.kind)
  })
  return out
}

/**
 * Many chunks in one body, as served from `TERRAIN_BATCH_PATH`: for each, its index (see
 * `chunksAcross`) and the length of its bytes, both unsigned 32-bit little-endian, then the bytes
 * `encodeChunk` gives.
 */
export function encodeChunkBatch(chunks: ReadonlyArray<readonly [number, Uint8Array]>): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, [, bytes]) => sum + 8 + bytes.length, 0))
  const view = new DataView(out.buffer)
  let at = 0
  for (const [index, bytes] of chunks) {
    view.setUint32(at, index, true)
    view.setUint32(at + 4, bytes.length, true)
    out.set(bytes, at + 8)
    at += 8 + bytes.length
  }
  return out
}

/** The chunks of an `encodeChunkBatch` body, each as its index and its `encodeChunk` bytes. */
export function decodeChunkBatch(body: Uint8Array): Array<[number, Uint8Array]> {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  const chunks: Array<[number, Uint8Array]> = []
  for (let at = 0; at + 8 <= body.length;) {
    const index = view.getUint32(at, true)
    const length = view.getUint32(at + 4, true)
    if (at + 8 + length > body.length) break
    chunks.push([index, body.subarray(at + 8, at + 8 + length)])
    at += 8 + length
  }
  return chunks
}

export function decodeChunk(cx: number, cy: number, bytes: Uint8Array): TerrainChunk {
  const size = CHUNK_SIZE * CHUNK_SIZE
  const nodes: KnownNode[] = []
  for (let at = size; at + 2 < bytes.length; at += 3) {
    const kind = NODE_KINDS[bytes[at + 2]!]
    if (!kind) continue
    nodes.push({ kind, x: cx * CHUNK_SIZE + bytes[at]!, y: cy * CHUNK_SIZE + bytes[at + 1]! })
  }
  return { cx, cy, tiles: bytes.slice(0, size), nodes }
}

/**
 * The chunks and their counts of explored tiles in an `encode_explored_counts` list (ADR 0034):
 * for each chunk, the step from the index before (from 0 for the first), then its count.
 */
export function decodeExploredCounts(list: readonly number[]): Map<number, number> {
  const out = new Map<number, number>()
  let at = 0
  for (let i = 0; i + 1 < list.length; i += 2) {
    at += list[i]!
    out.set(at, list[i + 1]!)
  }
  return out
}
