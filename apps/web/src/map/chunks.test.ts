import { CHUNK_SIZE, TERRAIN_BATCH_PATH, encodeChunkBatch } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { ChunkStore, chunkByChunk, exploredChunkBatches, type ChunkSource } from './chunks.js'

const tiles = () => new Uint8Array(CHUNK_SIZE * CHUNK_SIZE)

/**
 * A chunk store over a map `across` chunks wide, whose batches answer when `answer` says. Each
 * request is recorded as the chunks it asked for.
 */
function store(explored: number[], { across = 2, batch = 64 } = {}) {
  const pending: Array<{ indices: number[]; resolve: (r: Array<[number, Uint8Array]>) => void }> =
    []
  const loaded: number[] = []
  const source: ChunkSource = {
    batch,
    load: (indices) => new Promise((resolve) => pending.push({ indices, resolve })),
  }
  const chunks = new ChunkStore(
    () => new Set(explored),
    across,
    (c) => loaded.push(c.cy * across + c.cx),
    source,
  )
  /** Answers the oldest request still open, with all its chunks or only `only`. */
  const answer = async (only?: number[]) => {
    const req = pending.shift()!
    req.resolve(req.indices.filter((i) => !only || only.includes(i)).map((i) => [i, tiles()]))
    await new Promise((resolve) => setTimeout(resolve))
  }
  return { chunks, answer, loaded, asked: () => pending.map((p) => p.indices) }
}

describe('ChunkStore', () => {
  it('says which explored chunks on screen are still on their way', async () => {
    const { chunks, answer } = store([0, 1, 2], { batch: 1 })
    chunks.want([1, 0, 2, 3])
    // Chunk 3 was never explored: nothing loads there, it isn't waited for.
    expect(chunks.waiting([0, 1, 2, 3])).toEqual([0, 1, 2])
    await answer()
    expect(chunks.waiting([0, 1, 2, 3])).toEqual([0, 2])
    await answer()
    await answer()
    expect(chunks.waiting([0, 1, 2, 3])).toEqual([])
  })

  it('only waits for the chunks it is asked about', () => {
    const { chunks } = store([0, 1, 2])
    expect(chunks.waiting([1])).toEqual([1])
    expect(chunks.waiting([])).toEqual([])
  })

  it('asks for many chunks in one request, nearest to the view first', async () => {
    // A 10-across map, everything explored, batches of 4.
    const all = Array.from({ length: 100 }, (_, i) => i)
    const { chunks, answer, asked, loaded } = store(all, { across: 10, batch: 4 })
    // The view's centre is in the middle of chunk 55 at (5, 5); its four neighbours come next
    // (ties in the order asked), then 99 at (9, 9), then 1 and 9 on the top row, then 0 in the
    // corner, five chunks away both ways (the map wraps, so it is no nearer the other way).
    chunks.want([0, 1, 9, 55, 56, 65, 99, 54, 45], { cx: 5.5, cy: 5.5 })
    expect(asked()).toEqual([[55, 56, 65, 54], [45, 99, 1, 9], [0]])
    await answer()
    expect(loaded).toEqual([55, 56, 65, 54])
    // Asked for again before the rest arrived: nothing is asked twice.
    chunks.want([0, 1, 9, 55, 56, 65, 99, 54, 45], { cx: 5.5, cy: 5.5 })
    expect(asked()).toHaveLength(2)
  })

  it('keeps no more than six requests in flight', async () => {
    const all = Array.from({ length: 100 }, (_, i) => i)
    const { chunks, answer, asked } = store(all, { across: 10, batch: 10 })
    chunks.want(all)
    expect(asked()).toHaveLength(6)
    await answer()
    // One answered, the next batch goes out: chunks 60–69.
    expect(asked()).toHaveLength(6)
    expect(asked()[5]).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69])
  })

  it('does not ask again for a chunk the server left out, until it is forgotten', async () => {
    const { chunks, answer, asked, loaded } = store([0, 1])
    chunks.want([0, 1])
    await answer([0])
    expect(loaded).toEqual([0])
    chunks.want([0, 1])
    expect(asked()).toEqual([])
    chunks.forget([1])
    chunks.want([0, 1])
    expect(asked()).toEqual([[1]])
  })

  it('asks again for the chunks of a request that failed', async () => {
    const pending: Array<(e: Error) => void> = []
    const chunks = new ChunkStore(
      () => new Set([0, 1]),
      2,
      () => {},
      { batch: 64, load: () => new Promise((_, reject) => pending.push(reject)) },
    )
    chunks.want([0, 1])
    pending.shift()!(new Error('offline'))
    await new Promise((resolve) => setTimeout(resolve))
    chunks.want([0, 1])
    expect(pending).toHaveLength(1)
  })

  it('keeps a forgotten chunk until its newer copy arrives, so the map never waits for it', async () => {
    const { chunks, answer, loaded, asked } = store([0])
    chunks.want([0])
    await answer()
    chunks.forget([0])
    expect(chunks.get(0)).toBeDefined()
    expect(chunks.waiting([0])).toEqual([])
    chunks.want([0])
    expect(asked()).toEqual([[0]])
    await answer()
    expect(loaded).toEqual([0, 0])
    // Loaded again and up to date: wanting it asks for nothing more.
    chunks.want([0])
    expect(asked()).toEqual([])
  })
})

describe('chunk sources', () => {
  it('posts the indices to the batch endpoint and reads the chunks from its body', async () => {
    const sent: Array<[string, string]> = []
    const source = exploredChunkBatches(async (path, body) => {
      sent.push([path, body])
      return encodeChunkBatch([[3, tiles()]]).buffer as ArrayBuffer
    })
    expect(await source.load([3, 4])).toEqual([[3, tiles()]])
    expect(sent).toEqual([[TERRAIN_BATCH_PATH, '{"chunks":[3,4]}']])
  })

  it('loads the admin map one chunk at a time', async () => {
    const asked: string[] = []
    const source = chunkByChunk(
      (cx, cy) => `/admin/${cx}/${cy}`,
      4,
      async (path) => {
        asked.push(path)
        return tiles().buffer
      },
    )
    expect(source.batch).toBe(1)
    expect(await source.load([6])).toEqual([[6, tiles()]])
    expect(asked).toEqual(['/admin/2/1'])
  })
})
