import {
  TERRAIN_BATCH_MAX,
  TERRAIN_BATCH_PATH,
  TERRAIN_LEVEL_MAX,
  coarseChunkOf,
  levelChunksAcross,
} from '../shared/terrain.js'
import { decodeChunk, decodeChunkBatch } from '../shared/chunks.js'
import type { TerrainChunk } from '@csp/shared-types'

/** How many chunk requests (each a batch of chunks) may be in flight at once. */
const MAX_IN_FLIGHT = 6

/** Where a `ChunkStore` loads chunks from. */
export interface ChunkSource {
  /** The most chunks one request asks for. */
  batch: number
  /**
   * Asks for these chunks of `level` (ADR 0034; 0 is full detail); answers those it has, each
   * with its index and `encodeChunk` bytes.
   */
  load(indices: number[], level: number): Promise<Array<[number, Uint8Array]>>
}

/** The Player's explored terrain, up to `TERRAIN_BATCH_MAX` chunks of one level a request. */
export function exploredChunkBatches(
  post: (path: string, body: string) => Promise<ArrayBuffer> = defaultPost,
): ChunkSource {
  return {
    batch: TERRAIN_BATCH_MAX,
    load: async (indices, level) =>
      decodeChunkBatch(
        new Uint8Array(
          await post(
            TERRAIN_BATCH_PATH,
            JSON.stringify(level === 0 ? { chunks: indices } : { chunks: indices, level }),
          ),
        ),
      ),
  }
}

/** One chunk a request from `path`: the admin map's terrain (`adminTerrainChunkPath`), level 0. */
export function chunkByChunk(
  path: (cx: number, cy: number) => string,
  across: number,
  get: (path: string) => Promise<ArrayBuffer> = defaultGet,
): ChunkSource {
  return {
    batch: 1,
    load: async (indices) =>
      Promise.all(
        indices.map(async (i): Promise<[number, Uint8Array]> => [
          i,
          new Uint8Array(await get(path(i % across, Math.floor(i / across)))),
        ]),
      ),
  }
}

/** The view's centre in chunks (map tiles / `CHUNK_SIZE`), to load the nearest chunks first. */
export interface ChunkView {
  cx: number
  cy: number
}

/** Chunks of a coarse level to load after the level-0 ones, in the order given. */
export interface LevelWish {
  level: number
  indices: readonly number[]
}

/** A chunk's key in the store: its index and its level together. */
const keyOf = (index: number, level: number) => index * 8 + level
const levelOf = (key: number) => key % 8
const indexOf = (key: number) => Math.floor(key / 8)

/**
 * The client's copy of explored terrain, loaded in batches as the view needs it (ADR 0006), at
 * full detail (level 0) or at a coarse level (ADR 0034), each level kept apart. Only chunks the
 * server listed as explored are asked for (a coarse chunk counts as explored when a level-0 chunk
 * in it is), nearest to the view first; each is loaded once, and again after `forget` when its
 * explored terrain grew, at every level.
 */
export class ChunkStore {
  private chunks = new Map<number, TerrainChunk>()
  /** Loaded chunks whose explored terrain grew: kept until their newer copy arrives. */
  private outdated = new Set<number>()
  /** Chunks asked for and not forgotten since; one the server left out stays here. */
  private requested = new Set<number>()
  private queue: number[] = []
  private inFlight = 0
  private stopped = false
  /** The explored chunks of each coarse level, for the set of level-0 chunks they came from. */
  private coarse: { from?: ReadonlySet<number>; levels: Map<number, Set<number>> } = {
    levels: new Map(),
  }

  constructor(
    private readonly explored: () => ReadonlySet<number>,
    private readonly across: number,
    private readonly onLoaded: (chunk: TerrainChunk, level: number) => void,
    private readonly source: ChunkSource = exploredChunkBatches(),
  ) {}

  get(index: number, level = 0): TerrainChunk | undefined {
    return this.chunks.get(keyOf(index, level))
  }

  /** The explored chunks of `level`: those holding an explored level-0 chunk. */
  exploredAt(level: number): ReadonlySet<number> {
    const explored = this.explored()
    if (level === 0) return explored
    if (this.coarse.from !== explored) this.coarse = { from: explored, levels: new Map() }
    let set = this.coarse.levels.get(level)
    if (!set) {
      set = new Set([...explored].map((i) => coarseChunkOf(i, this.across, level)))
      this.coarse.levels.set(level, set)
    }
    return set
  }

  /**
   * Asks for the given level-0 chunks, nearest to `view` first (or in the order given without
   * one), then the chunks of coarse levels in `more`; drops earlier wishes that weren't started.
   */
  want(indices: number[], view?: ChunkView, more: readonly LevelWish[] = []): void {
    const wanted = (level: number) => {
      const explored = this.exploredAt(level)
      return (i: number) => {
        const key = keyOf(i, level)
        return (
          explored.has(i) &&
          !this.requested.has(key) &&
          (!this.chunks.has(key) || this.outdated.has(key))
        )
      }
    }
    const queue = indices.filter(wanted(0))
    if (view) {
      const away = (i: number) =>
        Math.hypot(
          wrapped((i % this.across) + 0.5 - view.cx, this.across),
          wrapped(Math.floor(i / this.across) + 0.5 - view.cy, this.across),
        )
      const distance = new Map(queue.map((i) => [i, away(i)]))
      queue.sort((a, b) => distance.get(a)! - distance.get(b)!)
    }
    this.queue = queue.map((i) => keyOf(i, 0))
    for (const { level, indices } of more) {
      this.queue.push(...indices.filter(wanted(level)).map((i) => keyOf(i, level)))
    }
    this.pump()
  }

  /**
   * The explored chunks among these that are not here yet, so the map has nothing to draw there:
   * it shows them as loading. A chunk loading again after `forget` keeps its older copy meanwhile.
   */
  waiting(indices: readonly number[], level = 0): number[] {
    const explored = this.exploredAt(level)
    return indices.filter((i) => explored.has(i) && !this.chunks.has(keyOf(i, level)))
  }

  /**
   * Marks these level-0 chunks, and the coarse chunks holding them, as outdated, so the next
   * `want` loads them again.
   */
  forget(indices: readonly number[]): void {
    for (const i of indices) {
      for (let level = 0; level <= TERRAIN_LEVEL_MAX; level++) {
        const key = keyOf(level === 0 ? i : coarseChunkOf(i, this.across, level), level)
        if (this.chunks.has(key)) this.outdated.add(key)
        this.requested.delete(key)
      }
    }
  }

  stop(): void {
    this.stopped = true
    this.queue = []
  }

  private pump(): void {
    let next = 0
    while (!this.stopped && this.inFlight < MAX_IN_FLIGHT && next < this.queue.length) {
      // One request asks for chunks of one level.
      const level = levelOf(this.queue[next]!)
      const batch: number[] = []
      while (
        batch.length < this.source.batch &&
        next < this.queue.length &&
        levelOf(this.queue[next]!) === level
      ) {
        const key = this.queue[next++]!
        if (this.requested.has(key)) continue
        this.requested.add(key)
        batch.push(indexOf(key))
      }
      if (batch.length === 0) continue
      this.inFlight++
      const across = levelChunksAcross(this.across, level)
      this.source
        .load(batch, level)
        .then((found) => {
          if (this.stopped) return
          for (const [index, bytes] of found) {
            if (!batch.includes(index)) continue
            const chunk = decodeChunk(index % across, Math.floor(index / across), bytes)
            this.chunks.set(keyOf(index, level), chunk)
            this.outdated.delete(keyOf(index, level))
            this.onLoaded(chunk, level)
          }
        })
        .catch(() => {
          for (const index of batch) this.requested.delete(keyOf(index, level))
        })
        .finally(() => {
          this.inFlight--
          this.pump()
        })
    }
    this.queue = this.queue.slice(next)
  }
}

/** `d` brought into (-n/2, n/2] on a map that wraps every `n`. */
function wrapped(d: number, n: number): number {
  const m = ((d % n) + n) % n
  return m > n / 2 ? m - n : m
}

async function defaultGet(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`chunk ${path}: ${res.status}`)
  return res.arrayBuffer()
}

async function defaultPost(path: string, body: string): Promise<ArrayBuffer> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body,
  })
  if (!res.ok) throw new Error(`chunks ${path}: ${res.status}`)
  return res.arrayBuffer()
}
