import { CHUNK_SIZE } from './terrain.js'
import type { ResourceKind } from './world.js'

/** Resource node kinds by the byte that stands for them in a served chunk. Only add to the end. */
export const NODE_KINDS: readonly ResourceKind[] = ['forest', 'stone', 'ironOre', 'goldOre']

/** A resource node as a Player knows it from explored terrain. */
export interface KnownNode {
  kind: ResourceKind
  x: number
  y: number
}

/** One chunk of explored terrain as the client gets it. */
export interface TerrainChunk {
  cx: number
  cy: number
  /** `CHUNK_SIZE`² terrain bytes, row-major; `UNEXPLORED` where the Player hasn't been. */
  tiles: Uint8Array
  /** Resource nodes on explored tiles of this chunk, in map coordinates. */
  nodes: KnownNode[]
}

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
