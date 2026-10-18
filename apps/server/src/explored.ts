import { sql } from 'drizzle-orm'
import {
  CHUNK_SIZE,
  OFF_MAP,
  UNEXPLORED,
  chunksAcross,
  encodeChunk,
  isInsideDisc,
  type ResourceNode,
  type TerrainMap,
} from '@csp/shared'
import type { SessionUser } from './auth.js'
import { schema, type Db } from './db/index.js'

/** Who is asking: a Player's id, and whether they are an admin. */
type Viewer = Pick<SessionUser, 'id' | 'isAdmin'>

/**
 * Every Player's explored terrain (`CONTEXT.md`: Explored terrain), one bit per tile, kept in
 * memory and saved with the world. Until residents with sight exist (Epic 2), admins have the
 * whole map explored and nothing explores terrain for anyone else.
 */
export class ExploredTerrain {
  private bits = new Map<number, Uint8Array>()
  private dirty = new Set<number>()

  /** Resource nodes by chunk index; nodes never move, so this is built once. */
  private nodesByChunk = new Map<number, ResourceNode[]>()

  constructor(
    private terrain: TerrainMap,
    nodes: ResourceNode[] = [],
  ) {
    const n = chunksAcross(terrain.diameter)
    for (const node of nodes) {
      const c = Math.floor(node.y / CHUNK_SIZE) * n + Math.floor(node.x / CHUNK_SIZE)
      this.nodesByChunk.set(c, [...(this.nodesByChunk.get(c) ?? []), node])
    }
  }

  /** Loads every Player's explored terrain from the database. */
  static load(db: Db, terrain: TerrainMap, nodes: ResourceNode[] = []): ExploredTerrain {
    const explored = new ExploredTerrain(terrain, nodes)
    for (const row of db.select().from(schema.explored).all()) {
      explored.bits.set(row.userId, new Uint8Array(row.data))
    }
    return explored
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

  /** Marks every disc tile within `radius` of (x, y) as explored by the Player. */
  explore(userId: number, x: number, y: number, radius: number): void {
    const { diameter } = this.terrain
    let bits = this.bits.get(userId)
    if (!bits) {
      bits = new Uint8Array(Math.ceil((diameter * diameter) / 8))
      this.bits.set(userId, bits)
    }
    for (let ty = y - radius; ty <= y + radius; ty++) {
      for (let tx = x - radius; tx <= x + radius; tx++) {
        const dx = tx - x
        const dy = ty - y
        if (dx * dx + dy * dy > radius * radius || !isInsideDisc(diameter, tx, ty)) continue
        const t = ty * diameter + tx
        bits[t >> 3]! |= 1 << (t & 7)
      }
    }
    this.dirty.add(userId)
  }

  isExplored(viewer: Viewer, x: number, y: number): boolean {
    const { diameter } = this.terrain
    if (!isInsideDisc(diameter, x, y)) return false
    if (viewer.isAdmin) return true
    const bits = this.bits.get(viewer.id)
    const t = y * diameter + x
    return bits !== undefined && (bits[t >> 3]! & (1 << (t & 7))) !== 0
  }

  /**
   * One chunk of terrain as the Player knows it, encoded as `encodeChunk` describes: tiles they
   * haven't explored are `UNEXPLORED`, and only resource nodes on explored tiles are included
   * (they stay known like the terrain). Undefined when they have explored nothing in it.
   */
  chunk(viewer: Viewer, cx: number, cy: number): Uint8Array | undefined {
    const n = chunksAcross(this.terrain.diameter)
    if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx >= n || cy >= n) {
      return undefined
    }
    const { diameter, tiles } = this.terrain
    const out = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)
    let any = false
    for (let dy = 0; dy < CHUNK_SIZE; dy++) {
      for (let dx = 0; dx < CHUNK_SIZE; dx++) {
        const x = cx * CHUNK_SIZE + dx
        const y = cy * CHUNK_SIZE + dy
        const i = dy * CHUNK_SIZE + dx
        if (!isInsideDisc(diameter, x, y)) {
          out[i] = OFF_MAP
        } else if (this.isExplored(viewer, x, y)) {
          out[i] = tiles[y * diameter + x]!
          any = true
        } else {
          out[i] = UNEXPLORED
        }
      }
    }
    if (!any) return undefined
    const nodes = (this.nodesByChunk.get(cy * n + cx) ?? []).filter((node) =>
      this.isExplored(viewer, node.x, node.y),
    )
    return encodeChunk(out, nodes, cx, cy)
  }

  /** The chunks in which the Player has explored at least one tile (see `chunksAcross`). */
  exploredChunks(viewer: Viewer): number[] {
    const { diameter } = this.terrain
    const n = chunksAcross(diameter)
    const found = new Set<number>()
    for (let y = 0; y < diameter; y++) {
      for (let x = 0; x < diameter; x++) {
        const c = Math.floor(y / CHUNK_SIZE) * n + Math.floor(x / CHUNK_SIZE)
        if (!found.has(c) && this.isExplored(viewer, x, y)) found.add(c)
      }
    }
    return [...found].sort((a, b) => a - b)
  }
}
