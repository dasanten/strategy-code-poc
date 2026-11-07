import {
  TERRAIN_BATCH_MAX,
  TERRAIN_BATCH_PATH,
  decodeChunk,
  decodeChunkBatch,
  type TerrainChunk,
} from '@csp/shared'

/** How many chunk requests (each a batch of chunks) may be in flight at once. */
const MAX_IN_FLIGHT = 6

/** Where a `ChunkStore` loads chunks from. */
export interface ChunkSource {
  /** The most chunks one request asks for. */
  batch: number
  /** Asks for these chunks; answers those it has, each with its index and `encodeChunk` bytes. */
  load(indices: number[]): Promise<Array<[number, Uint8Array]>>
}

/** The Player's explored terrain, up to `TERRAIN_BATCH_MAX` chunks a request. */
export function exploredChunkBatches(
  post: (path: string, body: string) => Promise<ArrayBuffer> = defaultPost,
): ChunkSource {
  return {
    batch: TERRAIN_BATCH_MAX,
    load: async (indices) =>
      decodeChunkBatch(
        new Uint8Array(await post(TERRAIN_BATCH_PATH, JSON.stringify({ chunks: indices }))),
      ),
  }
}

/** One chunk a request from `path`: the admin map's terrain (`adminTerrainChunkPath`). */
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

/**
 * The client's copy of explored terrain, loaded in batches as the view needs it (ADR 0006).
 * Only chunks the server listed as explored are asked for, nearest to the view first; each is
 * loaded once, and again after `forget` when its explored terrain grew.
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

  constructor(
    private readonly explored: () => ReadonlySet<number>,
    private readonly across: number,
    private readonly onLoaded: (chunk: TerrainChunk) => void,
    private readonly source: ChunkSource = exploredChunkBatches(),
  ) {}

  get(index: number): TerrainChunk | undefined {
    return this.chunks.get(index)
  }

  /**
   * Asks for the given chunks, nearest to `view` first (or in the order given without one);
   * drops earlier wishes that weren't started.
   */
  want(indices: number[], view?: ChunkView): void {
    const explored = this.explored()
    const queue = indices.filter(
      (i) =>
        explored.has(i) && !this.requested.has(i) && (!this.chunks.has(i) || this.outdated.has(i)),
    )
    if (view) {
      const away = (i: number) =>
        Math.hypot(
          wrapped((i % this.across) + 0.5 - view.cx, this.across),
          wrapped(Math.floor(i / this.across) + 0.5 - view.cy, this.across),
        )
      const distance = new Map(queue.map((i) => [i, away(i)]))
      queue.sort((a, b) => distance.get(a)! - distance.get(b)!)
    }
    this.queue = queue
    this.pump()
  }

  /**
   * The explored chunks among these that are not here yet, so the map has nothing to draw there:
   * it shows them as loading. A chunk loading again after `forget` keeps its older copy meanwhile.
   */
  waiting(indices: readonly number[]): number[] {
    const explored = this.explored()
    return indices.filter((i) => explored.has(i) && !this.chunks.has(i))
  }

  /** Marks these chunks as outdated, so the next `want` loads them again. */
  forget(indices: readonly number[]): void {
    for (const i of indices) {
      if (this.chunks.has(i)) this.outdated.add(i)
      this.requested.delete(i)
    }
  }

  stop(): void {
    this.stopped = true
    this.queue = []
  }

  private pump(): void {
    let next = 0
    while (!this.stopped && this.inFlight < MAX_IN_FLIGHT && next < this.queue.length) {
      const batch: number[] = []
      while (batch.length < this.source.batch && next < this.queue.length) {
        const index = this.queue[next++]!
        if (this.requested.has(index)) continue
        this.requested.add(index)
        batch.push(index)
      }
      if (batch.length === 0) break
      this.inFlight++
      this.source
        .load(batch)
        .then((found) => {
          if (this.stopped) return
          for (const [index, bytes] of found) {
            if (!batch.includes(index)) continue
            const chunk = decodeChunk(index % this.across, Math.floor(index / this.across), bytes)
            this.chunks.set(index, chunk)
            this.outdated.delete(index)
            this.onLoaded(chunk)
          }
        })
        .catch(() => {
          for (const index of batch) this.requested.delete(index)
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
