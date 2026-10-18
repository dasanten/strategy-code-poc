import { decodeChunk, terrainChunkPath, type TerrainChunk } from '@csp/shared'

/** How many chunk requests may be in flight at once. */
const MAX_IN_FLIGHT = 6

/**
 * The client's copy of explored terrain, loaded chunk by chunk as the view needs it (ADR 0006).
 * Only chunks the server listed as explored are asked for; each is loaded once, and again after
 * `forget` when its explored terrain grew.
 */
export class ChunkStore {
  private chunks = new Map<number, TerrainChunk>()
  private queue: number[] = []
  private inFlight = 0
  private stopped = false

  constructor(
    private readonly explored: () => ReadonlySet<number>,
    private readonly across: number,
    private readonly onLoaded: (chunk: TerrainChunk) => void,
    private readonly fetchChunk: (path: string) => Promise<ArrayBuffer> = defaultFetch,
  ) {}

  get(index: number): TerrainChunk | undefined {
    return this.chunks.get(index)
  }

  /** Asks for the given chunks, most wanted first; drops earlier wishes that weren't started. */
  want(indices: number[]): void {
    const explored = this.explored()
    this.queue = indices.filter((i) => explored.has(i) && !this.chunks.has(i))
    this.pump()
  }

  /** Drops loaded copies of these chunks, so the next `want` loads them again. */
  forget(indices: readonly number[]): void {
    for (const i of indices) {
      this.chunks.delete(i)
      this.requested.delete(i)
    }
  }

  stop(): void {
    this.stopped = true
    this.queue = []
  }

  private requested = new Set<number>()

  private pump(): void {
    while (!this.stopped && this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const index = this.queue.shift()!
      if (this.requested.has(index)) continue
      this.requested.add(index)
      this.inFlight++
      const cx = index % this.across
      const cy = Math.floor(index / this.across)
      this.fetchChunk(terrainChunkPath(cx, cy))
        .then((buf) => {
          if (this.stopped) return
          const chunk = decodeChunk(cx, cy, new Uint8Array(buf))
          this.chunks.set(index, chunk)
          this.onLoaded(chunk)
        })
        .catch(() => this.requested.delete(index))
        .finally(() => {
          this.inFlight--
          this.pump()
        })
    }
  }
}

async function defaultFetch(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`chunk ${path}: ${res.status}`)
  return res.arrayBuffer()
}
