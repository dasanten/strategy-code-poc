import { describe, expect, it } from 'vitest'
import { feedMirror, worldMirror } from './world-mirror.js'

/** The client feeds the rules module's mirror the server's messages as they come (T122.4). */
describe('the world mirror the client feeds', () => {
  const building = { is: 'building', id: 'b1', kind: 'farm', cityId: null, x: 10, y: 10 }
  const welcome = JSON.stringify({
    type: 'welcome',
    tick: 1,
    map: { size: 64 },
    entities: [building],
  })
  const tick = JSON.stringify({
    type: 'tick',
    tick: 2,
    changed: [{ ...building, x: 20 }],
    gone: [],
  })

  it('takes in the welcome and the ticks after it, and nothing else', async () => {
    feedMirror('ack', '{"type":"ack"}')
    feedMirror('welcome', welcome)
    feedMirror('tick', tick)
    // In Node the module is loaded already; the first message still waits for the promise.
    await new Promise((done) => setTimeout(done, 0))
    expect(worldMirror()?.buildingAt(21, 11)).toBe('b1')
    expect(worldMirror()?.buildingAt(10, 10)).toBeUndefined()
  })
})
