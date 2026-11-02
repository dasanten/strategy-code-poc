import { CHUNK_SIZE } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { ChunkStore } from './chunks.js'

/** A chunk store over chunks 0–3 of a 2-across map, whose requests answer when `answer` says. */
function store(explored: number[]) {
  const pending = new Map<string, (buf: ArrayBuffer) => void>()
  const loaded: number[] = []
  const chunks = new ChunkStore(
    () => new Set(explored),
    2,
    (c) => loaded.push(c.cy * 2 + c.cx),
    (cx, cy) => `${cx},${cy}`,
    (path) => new Promise((resolve) => pending.set(path, resolve)),
  )
  const answer = async (index: number) => {
    const path = `${index % 2},${Math.floor(index / 2)}`
    pending.get(path)!(new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).buffer)
    pending.delete(path)
    await new Promise((resolve) => setTimeout(resolve))
  }
  return { chunks, answer, loaded, asked: () => [...pending.keys()] }
}

describe('ChunkStore', () => {
  it('says which explored chunks on screen are still on their way', async () => {
    const { chunks, answer } = store([0, 1, 2])
    chunks.want([0, 1, 2, 3])
    // Chunk 3 was never explored: nothing loads there, it isn't waited for.
    expect(chunks.waiting([0, 1, 2, 3])).toEqual([0, 1, 2])
    await answer(1)
    expect(chunks.waiting([0, 1, 2, 3])).toEqual([0, 2])
    await answer(0)
    await answer(2)
    expect(chunks.waiting([0, 1, 2, 3])).toEqual([])
  })

  it('only waits for the chunks it is asked about', () => {
    const { chunks } = store([0, 1, 2])
    expect(chunks.waiting([1])).toEqual([1])
    expect(chunks.waiting([])).toEqual([])
  })

  it('keeps a forgotten chunk until its newer copy arrives, so the map never waits for it', async () => {
    const { chunks, answer, loaded, asked } = store([0])
    chunks.want([0])
    await answer(0)
    chunks.forget([0])
    expect(chunks.get(0)).toBeDefined()
    expect(chunks.waiting([0])).toEqual([])
    chunks.want([0])
    expect(asked()).toEqual(['0,0'])
    await answer(0)
    expect(loaded).toEqual([0, 0])
    // Loaded again and up to date: wanting it asks for nothing more.
    chunks.want([0])
    expect(asked()).toEqual([])
  })
})
