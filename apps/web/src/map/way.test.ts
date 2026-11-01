import { describe, expect, it } from 'vitest'
import type { ResidentOrder } from '@csp/shared'
import type { Camera } from './camera.js'
import { selectedWay, wayAhead, wayInView, type Way } from './way.js'

const view = { width: 800, height: 600 }
const size = 1440
// Tiles 60..140 across and 70..130 down are on screen.
const cam: Camera = { x: 100, y: 100, scale: 10 }

describe('the selected resident’s way ahead', () => {
  it('is the walk order’s target and path', () => {
    const order = { kind: 'walkTo', target: { x: 5, y: 6 }, path: [[5, 6]], progress: 0 } as const
    expect(wayAhead({ order } as never)).toMatchObject({ target: { x: 5, y: 6 }, path: [[5, 6]] })
    expect(wayAhead({ order: null } as never)).toBeUndefined()
  })

  it('is the way to the storage or carriage while storing or fetching, none once there', () => {
    const walking = { phase: 'walking', goods: { food: null }, path: [[3, 4], [3, 5]], progress: 0 }
    const store = { kind: 'store', to: { kind: 'storage', storageId: 's1' }, ...walking }
    const fetch = { kind: 'fetch', from: { kind: 'carriage', carriageId: 'k1' }, ...walking }
    for (const order of [store, fetch]) {
      expect(wayAhead({ order } as never)).toEqual({ target: { x: 3, y: 5 }, path: walking.path })
      // While the path is being found there is no way yet.
      expect(wayAhead({ order: { ...order, path: null } } as never)).toBeUndefined()
    }
    expect(wayAhead({ order: { ...store, phase: 'putting', path: null } } as never)).toBeUndefined()
    expect(wayAhead({ order: { ...store, phase: 'refilling', path: null } } as never)).toBeUndefined()
    expect(wayAhead({ order: { ...fetch, phase: 'taking', path: null } } as never)).toBeUndefined()
  })

  it('is the way to the next tile of a road or wall line while walking, none while building', () => {
    for (const kind of ['roadLine', 'wallLine'] as const) {
      const order: ResidentOrder = {
        kind,
        tiles: [[7, 2], [8, 2]],
        phase: 'walking',
        path: [[6, 2], [7, 2]],
        progress: 0,
        siteId: null,
      }
      expect(wayAhead({ order })).toEqual({ target: { x: 7, y: 2 }, path: order.path })
      // The target shows while the path is being found.
      expect(wayAhead({ order: { ...order, path: null } })).toEqual({
        target: { x: 7, y: 2 },
        path: null,
      })
      const building = { ...order, phase: 'building', path: null, siteId: 'b1' } as const
      expect(wayAhead({ order: building })).toBeUndefined()
    }
  })

  it('is the carriage’s for a passenger: the way its driver drives it', () => {
    const order: ResidentOrder = {
      kind: 'drive',
      carriageId: 'k1',
      target: { x: 9, y: 2 },
      path: [[9, 2]],
      progress: 0,
    }
    const driver = { order }
    const passenger = { order: null, aboard: 'k1' }
    expect(selectedWay(passenger, [driver])).toMatchObject({ target: { x: 9, y: 2 } })
    // Standing still, or someone else's carriage driven: no way ahead.
    expect(selectedWay(passenger, [])).toBeUndefined()
    expect(selectedWay({ ...passenger, aboard: 'k2' }, [driver])).toBeUndefined()
    // Anyone else's is their own.
    expect(selectedWay({ order }, [])).toMatchObject({ target: { x: 9, y: 2 } })
  })

  it('is drawn while its resident is on screen', () => {
    const way: Way = { target: { x: 110, y: 100 }, path: [[105, 100], [110, 100]] }
    expect(wayInView(cam, view, size, { x: 100, y: 100 }, way)).toBe(true)
  })

  it('is drawn when its resident is off screen but part of the way is in view', () => {
    // Walking from the far left into the middle: the start is off screen, the target is not.
    const path: [number, number][] = []
    for (let x = 41; x <= 100; x++) path.push([x, 100])
    const into: Way = { target: { x: 100, y: 100 }, path }
    expect(wayInView(cam, view, size, { x: 40, y: 100 }, into)).toBe(true)
    // Walking straight across the screen from one side to the other, both ends off screen.
    const across: Way = { target: { x: 160, y: 100 }, path: [[40, 100], [100, 100], [160, 100]] }
    expect(wayInView(cam, view, size, { x: 40, y: 100 }, across)).toBe(true)
    // Only the target dot is in view (no path yet).
    const dot: Way = { target: { x: 100, y: 100 }, path: null }
    expect(wayInView(cam, view, size, { x: 400, y: 400 }, dot)).toBe(true)
  })

  it('is skipped when none of it is in view', () => {
    const way: Way = { target: { x: 300, y: 300 }, path: [[250, 250], [300, 300]] }
    expect(wayInView(cam, view, size, { x: 200, y: 200 }, way)).toBe(false)
    const dot: Way = { target: { x: 300, y: 300 }, path: null }
    expect(wayInView(cam, view, size, { x: 100, y: 100 }, dot)).toBe(false)
  })

  it('counts the way across the map’s join', () => {
    // The view sits on the west join; the way runs on the map's east side, just over the join.
    const west: Camera = { x: 10, y: 100, scale: 10 }
    const way: Way = { target: { x: 1430, y: 100 }, path: [[1430, 100]] }
    expect(wayInView(west, view, size, { x: 1400, y: 100 }, way)).toBe(true)
  })
})
