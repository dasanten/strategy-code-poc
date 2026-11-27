import { describe, expect, it } from 'vitest'
import { barBesideTile, dockCovers } from './dock-view.js'

describe('barBesideTile', () => {
  it('keeps the command bar and its keys with no tile card open', () => {
    expect(barBesideTile(false, false)).toEqual({ shows: true, keys: true })
    expect(barBesideTile(true, false)).toEqual({ shows: true, keys: true })
  })

  it('keeps the bar beside a tile card on a desktop, its keys off', () => {
    expect(barBesideTile(false, true)).toEqual({ shows: true, keys: false })
  })

  it('lets the tile card take the bottom sheet on a phone', () => {
    expect(barBesideTile(true, true)).toEqual({ shows: false, keys: false })
  })
})

describe('dockCovers', () => {
  it('covers nothing while the dock is empty', () => {
    expect(dockCovers([], 1440)).toBe(0)
  })

  it('covers up to the left edge of its widest card', () => {
    expect(dockCovers([1092], 1440)).toBe(348)
    expect(dockCovers([1092, 1000], 1440)).toBe(440)
  })

  it('never covers less than nothing', () => {
    expect(dockCovers([1500], 1440)).toBe(0)
  })
})
