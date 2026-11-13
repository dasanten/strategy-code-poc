import { coarseChunkOf } from '../shared/terrain.js'
import type { ChunkSource } from './chunks.js'

/*
 * Explored terrain kept in the browser between visits (ADR 0034, T99.9). Terrain never changes and
 * explored terrain only grows, so a chunk at the same count of explored tiles is the same bytes:
 * a chunk kept at the count the welcome gives is used without a request. It is a cache, never the
 * truth: any failure to open, read or write it loads the map as it does without it, and nobody
 * sees the failure. It holds one Player's terrain of one world at a time.
 */

/** A kept chunk: the count of explored tiles it was loaded at, and its bytes as served. */
export interface KeptChunk {
  count: number
  bytes: Uint8Array
}

/** Where kept chunks live: IndexedDB in the browser. Anything may throw or reject. */
export interface CacheBackend {
  /** Whose terrain it holds (`ownerOf`), if anyone's. */
  owner(): Promise<string | undefined>
  setOwner(owner: string): Promise<void>
  getMany(keys: readonly string[]): Promise<Array<KeptChunk | undefined>>
  put(key: string, chunk: KeptChunk): Promise<void>
  /** Drops every kept chunk and the owner. */
  clear(): Promise<void>
}

/** Who a cache's chunks belong to: the Player in the world of that seed. */
export const ownerOf = (seed: number, player: string) => `${seed}/${player}`

const keyOf = (level: number, index: number) => `${level}:${index}`

/** The kept terrain of one Player in one world, opened by `openTerrainCache`. */
export interface TerrainCache {
  get(level: number, indices: readonly number[]): Promise<Array<KeptChunk | undefined>>
  put(level: number, index: number, chunk: KeptChunk): Promise<void>
}

/**
 * The kept terrain of `player` in the world of `seed`; what another Player or world left is
 * dropped first. None when the storage can't be opened.
 */
export async function openTerrainCache(
  seed: number,
  player: string,
  backend: () => Promise<CacheBackend> = indexedDbBackend,
): Promise<TerrainCache | undefined> {
  try {
    const b = await backend()
    const owner = ownerOf(seed, player)
    if ((await b.owner()) !== owner) {
      await b.clear()
      await b.setOwner(owner)
    }
    return {
      get: (level, indices) => b.getMany(indices.map((i) => keyOf(level, i))),
      put: (level, index, chunk) => b.put(keyOf(level, index), chunk),
    }
  } catch {
    return undefined
  }
}

/** Drops the kept terrain (logging out). Never fails. */
export async function clearTerrainCache(
  backend: () => Promise<CacheBackend> = indexedDbBackend,
): Promise<void> {
  try {
    await (await backend()).clear()
  } catch {
    // Nothing kept, or nothing to keep it in.
  }
}

/**
 * `source`, answering from `cache` the chunks kept at the count they have now (`countOf`) and
 * keeping what it fetches at the count asked with. A chunk without a count is fetched as before.
 * The count is read before the request: if the chunk grows meanwhile, it is kept at a lower count
 * than its bytes show and fetched again next time, never the other way round.
 */
export function cachedSource(
  source: ChunkSource,
  cache: Promise<TerrainCache | undefined>,
  countOf: (index: number, level: number) => number | undefined,
): ChunkSource {
  return {
    batch: source.batch,
    async load(indices, level) {
      const c = await cache.catch(() => undefined)
      const counts = indices.map((i) => countOf(i, level))
      let kept: Array<KeptChunk | undefined> = []
      if (c) kept = await c.get(level, indices).catch(() => [])
      const found: Array<[number, Uint8Array]> = []
      const missing: number[] = []
      const askedAt = new Map<number, number | undefined>()
      indices.forEach((i, at) => {
        const k = kept[at]
        if (k && counts[at] !== undefined && k.count === counts[at]) found.push([i, k.bytes])
        else {
          missing.push(i)
          askedAt.set(i, counts[at])
        }
      })
      if (missing.length === 0) return found
      const fetched = await source.load(missing, level)
      if (c) {
        for (const [i, bytes] of fetched) {
          const count = askedAt.get(i)
          if (count !== undefined) void c.put(level, i, { count, bytes }).catch(() => {})
        }
      }
      return [...found, ...fetched]
    },
  }
}

/**
 * The count of explored tiles of each chunk of `level`, from the level-0 counts: a coarse chunk's
 * is the sum over the level-0 chunks in it (ADR 0034).
 */
export function countsAt(
  counts: ReadonlyMap<number, number>,
  across: number,
  level: number,
): ReadonlyMap<number, number> {
  if (level === 0) return counts
  const out = new Map<number, number>()
  for (const [i, n] of counts) {
    const c = coarseChunkOf(i, across, level)
    out.set(c, (out.get(c) ?? 0) + n)
  }
  return out
}

const DB_NAME = 'csp-terrain'
const CHUNKS = 'chunks'
const META = 'meta'

/** The browser's IndexedDB as a `CacheBackend`. */
export function indexedDbBackend(): Promise<CacheBackend> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(CHUNKS)
      open.result.createObjectStore(META)
    }
    open.onerror = () => reject(open.error ?? new Error('indexedDB'))
    open.onsuccess = () => {
      const db = open.result
      const done = <T>(r: IDBRequest<T>) =>
        new Promise<T>((ok, fail) => {
          r.onsuccess = () => ok(r.result)
          r.onerror = () => fail(r.error ?? new Error('indexedDB'))
        })
      const store = (name: string, mode: IDBTransactionMode) =>
        db.transaction(name, mode).objectStore(name)
      resolve({
        owner: async () => (await done(store(META, 'readonly').get('owner'))) as string | undefined,
        setOwner: async (owner) => void (await done(store(META, 'readwrite').put(owner, 'owner'))),
        getMany: (keys) => {
          const s = store(CHUNKS, 'readonly')
          return Promise.all(keys.map((k) => done(s.get(k)) as Promise<KeptChunk | undefined>))
        },
        put: async (key, chunk) => void (await done(store(CHUNKS, 'readwrite').put(chunk, key))),
        clear: async () => {
          const t = db.transaction([CHUNKS, META], 'readwrite')
          t.objectStore(CHUNKS).clear()
          t.objectStore(META).clear()
          await new Promise<void>((ok, fail) => {
            t.oncomplete = () => ok()
            t.onerror = () => fail(t.error ?? new Error('indexedDB'))
          })
        },
      })
    }
  })
}
