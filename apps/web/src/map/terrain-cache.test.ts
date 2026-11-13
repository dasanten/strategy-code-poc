import { describe, expect, it } from 'vitest'
import type { ChunkSource } from './chunks.js'
import {
  cachedSource,
  clearTerrainCache,
  countsAt,
  openTerrainCache,
  ownerOf,
  type CacheBackend,
  type KeptChunk,
} from './terrain-cache.js'
import { decodeExploredCounts } from '../shared/chunks.js'

/** Kept chunks in memory, as IndexedDB keeps them across page loads. */
function memory() {
  const chunks = new Map<string, KeptChunk>()
  let owner: string | undefined
  const backend: CacheBackend = {
    owner: async () => owner,
    setOwner: async (o) => void (owner = o),
    getMany: async (keys) => keys.map((k) => chunks.get(k)),
    put: async (k, c) => void chunks.set(k, c),
    clear: async () => {
      chunks.clear()
      owner = undefined
    },
  }
  return { chunks, backend: async () => backend }
}

/** A storage that fails at `step`, as a private window or a full disk does. */
function failing(step: 'open' | 'read' | 'write') {
  const m = memory()
  return async (): Promise<CacheBackend> => {
    if (step === 'open') throw new Error('no storage')
    const b = await m.backend()
    return {
      ...b,
      getMany: step === 'read' ? () => Promise.reject(new Error('read')) : b.getMany,
      put: step === 'write' ? () => Promise.reject(new Error('write')) : b.put,
    }
  }
}

const bytes = (n: number) => new Uint8Array([n, n, n])

/** A server that answers every chunk asked for, recording each request. */
function server() {
  const asked: Array<{ indices: number[]; level: number }> = []
  const source: ChunkSource = {
    batch: 64,
    load: async (indices, level) => {
      asked.push({ indices, level })
      return indices.map((i): [number, Uint8Array] => [i, bytes(i)])
    },
  }
  return { asked, source }
}

/** Lets fire-and-forget writes land. */
const settle = () => new Promise((resolve) => setTimeout(resolve))

describe('terrain kept in the browser (ADR 0034)', () => {
  it('answers a chunk kept at the same count without a request', async () => {
    const m = memory()
    const counts = new Map([
      [3, 1024],
      [4, 10],
    ])
    const first = server()
    const visit = (s: ReturnType<typeof server>) =>
      cachedSource(s.source, openTerrainCache(7, 'Mara', m.backend), (i) => counts.get(i))
    expect(await visit(first).load([3, 4], 0)).toEqual([
      [3, bytes(3)],
      [4, bytes(4)],
    ])
    await settle()
    // The next visit: nothing asked.
    const second = server()
    expect(await visit(second).load([3, 4], 0)).toEqual([
      [3, bytes(3)],
      [4, bytes(4)],
    ])
    expect(second.asked).toEqual([])
  })

  it('fetches and replaces a chunk kept at another count, or not kept, and one that grew', async () => {
    const m = memory()
    const counts = new Map([
      [3, 1024],
      [4, 10],
    ])
    const s = server()
    const source = cachedSource(s.source, openTerrainCache(7, 'Mara', m.backend), (i) =>
      counts.get(i),
    )
    await source.load([3], 0)
    await settle()
    // Chunk 4 was never kept; chunk 3 is.
    await source.load([3, 4], 0)
    expect(s.asked.at(-1)).toEqual({ indices: [4], level: 0 })
    await settle()
    // Chunk 4 grows during play: fetched again and kept at its new count.
    counts.set(4, 25)
    await source.load([3, 4], 0)
    expect(s.asked.at(-1)).toEqual({ indices: [4], level: 0 })
    await settle()
    expect(m.chunks.get('0:4')?.count).toBe(25)
    await source.load([4], 0)
    expect(s.asked).toHaveLength(3)
  })

  it('keeps levels apart, a coarse chunk at the sum of the counts in it', async () => {
    const m = memory()
    // Four level-0 chunks across; at level 1 they are all in chunk 0.
    const counts = new Map([
      [0, 100],
      [5, 20],
    ])
    const s = server()
    const source = cachedSource(s.source, openTerrainCache(7, 'Mara', m.backend), (i, level) =>
      countsAt(counts, 4, level).get(i),
    )
    await source.load([0], 1)
    await settle()
    expect(m.chunks.get('1:0')?.count).toBe(120)
    await source.load([0], 0)
    expect(s.asked).toHaveLength(2)
  })

  it('fetches as before when storage fails to open, read or write, and never throws', async () => {
    for (const step of ['open', 'read', 'write'] as const) {
      const backend = failing(step)
      for (let visit = 0; visit < 2; visit++) {
        const s = server()
        const source = cachedSource(s.source, openTerrainCache(7, 'Mara', backend), () => 5)
        expect(await source.load([1, 2], 0)).toEqual([
          [1, bytes(1)],
          [2, bytes(2)],
        ])
        expect(s.asked).toHaveLength(1)
        await settle()
      }
    }
    await expect(clearTerrainCache(failing('open'))).resolves.toBeUndefined()
  })

  it('is cleared on logout and when another Player or world opens it', async () => {
    const m = memory()
    const keep = async (seed: number, player: string) => {
      const c = await openTerrainCache(seed, player, m.backend)
      await c!.put(0, 1, { count: 1, bytes: bytes(1) })
    }
    await keep(7, 'Mara')
    expect(m.chunks.size).toBe(1)
    // The same Player again keeps it.
    await openTerrainCache(7, 'Mara', m.backend)
    expect(m.chunks.size).toBe(1)
    await openTerrainCache(7, 'Tomas', m.backend)
    expect(m.chunks.size).toBe(0)
    expect(await (await m.backend()).owner()).toBe(ownerOf(7, 'Tomas'))
    await keep(7, 'Tomas')
    await openTerrainCache(8, 'Tomas', m.backend)
    expect(m.chunks.size).toBe(0)
    await keep(8, 'Tomas')
    await clearTerrainCache(m.backend)
    expect(m.chunks.size).toBe(0)
    expect(await (await m.backend()).owner()).toBeUndefined()
  })

  it('reads the welcome’s counts', () => {
    expect([...decodeExploredCounts([3, 1024, 1, 12, 176, 1])]).toEqual([
      [3, 1024],
      [4, 12],
      [180, 1],
    ])
  })
})
