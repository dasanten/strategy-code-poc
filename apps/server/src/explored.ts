import { sql } from 'drizzle-orm'
import {
  CHUNK_SIZE,
  OVERVIEW_SCALE,
  UNEXPLORED,
  chunksAcross,
  encodeChunk,
  overviewAcross,
  tileIndex,
  type ResourceNode,
  type TerrainMap,
  wrap,
} from '@csp/shared'
import type { SessionUser } from './auth.js'
import { schema, type Db } from './db/index.js'

/** Who is asking: a Player's id. */
type Viewer = Pick<SessionUser, 'id'>

/**
 * Every Player's explored terrain (`CONTEXT.md`: Explored terrain), one bit per tile, kept in
 * memory and saved with the world. It grows as the Player's residents see new tiles (sight.ts).
 */
export class ExploredTerrain {
  private bits = new Map<number, Uint8Array>()
  /**
   * Per Player, the chunks in which they explored at least one tile: kept beside the bitmap so a
   * welcome looks them up instead of scanning every tile of the map. Scratch memory, rebuilt from
   * the bitmap on load.
   */
  private chunks = new Map<number, Set<number>>()
  private dirty = new Set<number>()

  /** Resource nodes by chunk index; nodes never move, so this is built once. */
  private nodesByChunk = new Map<number, ResourceNode[]>()

  constructor(
    private terrain: TerrainMap,
    nodes: ResourceNode[] = [],
  ) {
    const n = chunksAcross(terrain.size)
    for (const node of nodes) {
      const c = Math.floor(node.y / CHUNK_SIZE) * n + Math.floor(node.x / CHUNK_SIZE)
      this.nodesByChunk.set(c, [...(this.nodesByChunk.get(c) ?? []), node])
    }
  }

  /** Loads every Player's explored terrain from the database. */
  static load(db: Db, terrain: TerrainMap, nodes: ResourceNode[] = []): ExploredTerrain {
    const explored = new ExploredTerrain(terrain, nodes)
    for (const row of db.select().from(schema.explored).all()) {
      const bits = new Uint8Array(row.data)
      explored.bits.set(row.userId, bits)
      explored.chunks.set(row.userId, explored.chunksIn(bits))
    }
    return explored
  }

  /** The chunks with an explored tile in a bitmap: only its non-zero bytes are looked at. */
  private chunksIn(bits: Uint8Array): Set<number> {
    const { size } = this.terrain
    const n = chunksAcross(size)
    const last = size * size - 1
    const chunkOf = (t: number) =>
      Math.floor(Math.floor(t / size) / CHUNK_SIZE) * n + Math.floor((t % size) / CHUNK_SIZE)
    const found = new Set<number>()
    for (let i = 0; i < bits.length; i++) {
      const byte = bits[i]!
      if (byte === 0) continue
      const first = i * 8
      const c = chunkOf(first)
      // On a map whose side is a whole number of bytes, a byte's eight tiles share one chunk.
      if (c === chunkOf(Math.min(first + 7, last))) {
        found.add(c)
        continue
      }
      for (let b = 0; b < 8; b++) if (byte & (1 << b)) found.add(chunkOf(first + b))
    }
    return found
  }

  /** Writes the Players whose explored terrain changed since the last save. */
  save(db: Db): void {
    const now = new Date()
    for (const userId of this.dirty) {
      const data = Buffer.from(this.bits.get(userId)!)
      db.insert(schema.explored)
        .values({ userId, data, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.explored.userId,
          set: { data: sql`excluded.data`, updatedAt: now },
        })
        .run()
    }
    this.dirty.clear()
  }

  /**
   * Marks every tile within `radius` of (x, y) as explored by the Player, across the joins.
   * Returns the chunks in which tiles were newly explored.
   */
  explore(userId: number, x: number, y: number, radius: number): Set<number> {
    const { size } = this.terrain
    let bits = this.bits.get(userId)
    if (!bits) {
      bits = new Uint8Array(Math.ceil((size * size) / 8))
      this.bits.set(userId, bits)
    }
    let chunks = this.chunks.get(userId)
    if (!chunks) {
      chunks = new Set()
      this.chunks.set(userId, chunks)
    }
    const n = chunksAcross(size)
    const grown = new Set<number>()
    for (let dy = -radius; dy <= radius; dy++) {
      // The disc's row: every tile with dx² + dy² ≤ radius².
      let w = Math.floor(Math.sqrt(radius * radius - dy * dy))
      while (w * w + dy * dy > radius * radius) w--
      const row = wrap(y + dy, size)
      const chunkRow = Math.floor(row / CHUNK_SIZE) * n
      for (let tx = x - w; tx <= x + w; ) {
        const col = wrap(tx, size)
        const t = row * size + col
        const i = t >> 3
        if (bits[i] === 0xff) {
          // Eight tiles already explored: skip to the byte's end, or the row's if that comes first.
          tx += Math.min(8 - (t & 7), size - col)
          continue
        }
        const bit = 1 << (t & 7)
        if (!(bits[i]! & bit)) {
          bits[i]! |= bit
          grown.add(chunkRow + Math.floor(col / CHUNK_SIZE))
        }
        tx++
      }
    }
    if (grown.size > 0) this.dirty.add(userId)
    for (const c of grown) chunks.add(c)
    return grown
  }

  isExplored(viewer: Viewer, x: number, y: number): boolean {
    const bits = this.bits.get(viewer.id)
    const t = tileIndex(this.terrain.size, x, y)
    return bits !== undefined && (bits[t >> 3]! & (1 << (t & 7))) !== 0
  }

  /**
   * One chunk of terrain as the Player knows it, encoded as `encodeChunk` describes: tiles they
   * haven't explored are `UNEXPLORED`, and only resource nodes on explored tiles are included
   * (they stay known like the terrain). Undefined when they have explored nothing in it.
   */
  chunk(viewer: Viewer, cx: number, cy: number): Uint8Array | undefined {
    return this.encode(cx, cy, (x, y) => this.isExplored(viewer, x, y))
  }

  /**
   * One chunk of terrain as it is, for admins only (`CONTEXT.md`: admin map): every tile and every
   * resource node, explored or not. Undefined for a chunk off the map.
   */
  wholeChunk(cx: number, cy: number): Uint8Array | undefined {
    return this.encode(cx, cy, () => true)
  }

  private overviewBytes: Uint8Array | undefined

  /**
   * The whole map for the admin map's far zoom (`terrainOverview`). Terrain never changes once
   * generated (roads lie on top of it), so this is built on first request and kept.
   */
  overview(): Uint8Array {
    return (this.overviewBytes ??= terrainOverview(this.terrain))
  }

  /** A chunk with the tiles and nodes `known` lets through; undefined if none or off the map. */
  private encode(
    cx: number,
    cy: number,
    known: (x: number, y: number) => boolean,
  ): Uint8Array | undefined {
    const n = chunksAcross(this.terrain.size)
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx >= n || cy >= n) {
      return undefined
    }
    const { size, tiles } = this.terrain
    const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
    let any = false
    for (let dy = 0; dy < CHUNK_SIZE; dy++) {
      for (let dx = 0; dx < CHUNK_SIZE; dx++) {
        const x = cx * CHUNK_SIZE + dx
        const y = cy * CHUNK_SIZE + dy
        const i = dy * CHUNK_SIZE + dx
        // A map whose side isn't a whole number of chunks leaves its last chunks part empty.
        if (x >= size || y >= size) {
          out[i] = UNEXPLORED
        } else if (known(x, y)) {
          out[i] = tiles[y * size + x]!
          any = true
        } else {
          out[i] = UNEXPLORED
        }
      }
    }
    if (!any) return undefined
    const nodes = (this.nodesByChunk.get(cy * n + cx) ?? []).filter((node) => known(node.x, node.y))
    return encodeChunk(out, nodes, cx, cy)
  }

  /** The chunks in which the Player has explored at least one tile (see `chunksAcross`). */
  exploredChunks(viewer: Viewer): number[] {
    return [...(this.chunks.get(viewer.id) ?? [])].sort((a, b) => a - b)
  }
}

/**
 * The whole map downsampled for the admin map (`ADMIN_TERRAIN_OVERVIEW_PATH`): one byte per
 * `OVERVIEW_SCALE`² tiles, the terrain most of them have (the lower code on a tie). A square at
 * the edge of a map whose side isn't a whole number of squares counts only the tiles it has.
 */
export function terrainOverview(terrain: TerrainMap): Uint8Array {
  const { size, tiles } = terrain
  const n = overviewAcross(size)
  const out = new Uint8Array(n * n)
  const counts = new Uint32Array(256)
  for (let oy = 0; oy < n; oy++) {
    for (let ox = 0; ox < n; ox++) {
      counts.fill(0)
      const yEnd = Math.min(size, (oy + 1) * OVERVIEW_SCALE)
      const xEnd = Math.min(size, (ox + 1) * OVERVIEW_SCALE)
      for (let y = oy * OVERVIEW_SCALE; y < yEnd; y++) {
        for (let x = ox * OVERVIEW_SCALE; x < xEnd; x++) counts[tiles[y * size + x]!]!++
      }
      let best = 0
      for (let t = 1; t < counts.length; t++) if (counts[t]! > counts[best]!) best = t
      out[oy * n + ox] = best
    }
  }
  return out
}
