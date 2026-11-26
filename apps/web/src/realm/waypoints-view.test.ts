import { describe, expect, it } from 'vitest'
import { WAYPOINTS_MAX } from '@csp/balance'
import { menuSpot, suggestedWaypointName, waypointCount, waypointPlace } from './waypoints-view.js'

describe('the waypoints view', () => {
  it('suggests the lowest "Waypoint n" no waypoint is named', () => {
    expect(suggestedWaypointName([])).toBe('Waypoint 1')
    expect(suggestedWaypointName([{ name: 'Waypoint 1' }, { name: 'Pass' }])).toBe('Waypoint 2')
    expect(suggestedWaypointName([{ name: 'Waypoint 2' }])).toBe('Waypoint 1')
  })

  it('counts against the cap and says where each one is', () => {
    expect(waypointCount([1, 2])).toBe(`2 of ${WAYPOINTS_MAX}`)
    expect(waypointPlace({ x: 12, y: 40 })).toBe('tile 12, 40')
  })

  it('opens the tile menu at the point pressed, kept inside the screen', () => {
    const menu = { width: 200, height: 100 }
    const view = { width: 800, height: 600 }
    expect(menuSpot({ x: 100, y: 50 }, menu, view)).toEqual({ left: 100, top: 50 })
    expect(menuSpot({ x: 750, y: 580 }, menu, view)).toEqual({ left: 592, top: 492 })
    expect(menuSpot({ x: 2, y: 3 }, menu, view)).toEqual({ left: 8, top: 8 })
  })
})
