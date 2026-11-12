import { describe, expect, it } from 'vitest'
import { CITY_SCALE, cityPlace, cityScale } from './cities-drawer-view.js'
import { showBeside } from './hud-view.js'
import { FAR_SCALE, zoomTier } from './map/camera.js'

const cities = [
  { id: 'c1', townHallId: 'h1' },
  { id: 'c2', townHallId: 'h2' },
]

describe('opening a city in the Cities drawer', () => {
  it('centres on its town hall, in sight or last seen', () => {
    const inSight = [{ id: 'h1', x: 10, y: 20 }]
    const lastSeen = [{ id: 'h2', x: 90, y: 5 }]
    expect(cityPlace('c1', cities, [...inSight, ...lastSeen])).toEqual({ x: 10, y: 20 })
    expect(cityPlace('c2', cities, [...inSight, ...lastSeen])).toEqual({ x: 90, y: 5 })
  })

  it('has no place without a known town hall or city', () => {
    expect(cityPlace('c2', cities, [{ id: 'h1', x: 1, y: 1 }])).toBeUndefined()
    expect(cityPlace('c9', cities, [{ id: 'h1', x: 1, y: 1 }])).toBeUndefined()
  })

  it('zooms out to the far tier, where the city is outlined, and no further', () => {
    expect(zoomTier(CITY_SCALE)).toBe('far')
    expect(cityScale(20)).toBe(CITY_SCALE)
    expect(cityScale(FAR_SCALE)).toBe(CITY_SCALE)
    expect(cityScale(3)).toBe(3)
  })

  it('centres in the map left free beside the open drawer', () => {
    // The drawer covers the left; the city shows in the map beside it.
    expect(showBeside(1280, 428, 0)).toEqual({ left: 428, right: 0, closeDrawer: false })
    // A phone has no map beside the drawer: it closes so the city shows.
    expect(showBeside(375, 375, 0)).toEqual({ left: 0, right: 0, closeDrawer: true })
  })
})
