import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { frameText, inArrivalOrder, onClose, type Frame } from './socket-frames.js'
import {
  WS_CLOSE_LOGGED_OUT,
  WS_CLOSE_TOO_MANY_REQUESTS,
  WS_CLOSE_UPDATED,
} from './shared/protocol.js'

/** A binary frame as the server sends it: the gzipped JSON. */
function gzipped(json: string): ArrayBuffer {
  const bytes = gzipSync(json)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Waits until every promise queued so far has settled. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('frameText', () => {
  it('reads a text frame as it is and gunzips a binary one, as an ArrayBuffer or a Blob', async () => {
    const json = JSON.stringify({ type: 'welcome', tick: 3 })
    expect(await frameText(json)).toBe(json)
    expect(await frameText(gzipped(json))).toBe(json)
    expect(await frameText(new Blob([gzipped(json)]))).toBe(json)
  })
})

describe('inArrivalOrder', () => {
  it('applies text and binary frames in arrival order however long gunzipping takes', async () => {
    const applied: string[] = []
    const waits: Array<() => void> = []
    // The welcome's gunzipping finishes only when told to, after the tick behind it arrived.
    const slow = (data: Frame) =>
      typeof data === 'string'
        ? Promise.resolve(data)
        : new Promise<string>((resolve) => waits.push(() => void frameText(data).then(resolve)))
    const receive = inArrivalOrder((text) => applied.push(text), slow)
    receive(gzipped('welcome'))
    receive('tick 1')
    receive('tick 2')
    await settled()
    expect(applied).toEqual([])
    waits.forEach((go) => go())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(applied).toEqual(['welcome', 'tick 1', 'tick 2'])
  })

  it('reports a frame it cannot read and goes on with the next', async () => {
    const applied: string[] = []
    const errors: unknown[] = []
    const receive = inArrivalOrder(
      (text) => applied.push(text),
      undefined,
      (err) => errors.push(err),
    )
    receive(new Uint8Array([1, 2, 3]).buffer)
    receive('tick 1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(errors).toHaveLength(1)
    expect(applied).toEqual(['tick 1'])
  })
})

describe('onClose', () => {
  it('shows the Reload dialog when the game was updated, and reconnects on any other close', () => {
    expect(onClose(WS_CLOSE_UPDATED)).toBe('updated')
    expect(onClose(WS_CLOSE_LOGGED_OUT)).toBe('loggedOut')
    expect(onClose(WS_CLOSE_TOO_MANY_REQUESTS)).toBe('throttled')
    for (const code of [1000, 1001, 1006, 1011, 4000]) expect(onClose(code)).toBe('reconnect')
  })
})
