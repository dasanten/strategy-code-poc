import { describe, expect, it } from 'vitest'
import { PANEL_WIDTHS, panelLeft, panelSize, panelTitle } from './order-panel-view.js'

describe('panelSize', () => {
  it('opens Goods and Build wide, short forms narrow, the rest in between', () => {
    expect(panelSize('goods')).toBe('lg')
    expect(panelSize('build')).toBe('lg')
    expect(panelSize('rename')).toBe('sm')
    expect(panelSize('makeLeader')).toBe('sm')
    expect(panelSize('haul')).toBe('md')
    expect(panelSize('walls')).toBe('md')
  })

  it('has a width for each size, widest last', () => {
    expect(PANEL_WIDTHS.sm).toBeLessThan(PANEL_WIDTHS.md)
    expect(PANEL_WIDTHS.md).toBeLessThan(PANEL_WIDTHS.lg)
  })
})

describe('panelTitle', () => {
  it('drops the ellipsis an order that opens a panel ends with', () => {
    expect(panelTitle('Feed…')).toBe('Feed')
    expect(panelTitle('Board ship...')).toBe('Board ship')
    expect(panelTitle('Goods')).toBe('Goods')
  })
})

describe('panelLeft', () => {
  it('sits at the left end without an order to sit over', () => {
    expect(panelLeft(undefined, 420, 1000)).toBe(0)
  })

  it('starts over the order that opened it', () => {
    expect(panelLeft(300.4, 420, 1000)).toBe(300)
  })

  it('stays inside the bar on the right and on the left', () => {
    expect(panelLeft(800, 420, 1000)).toBe(580)
    expect(panelLeft(-20, 420, 1000)).toBe(0)
  })

  it('sits at the left end when the bar is narrower than the panel', () => {
    expect(panelLeft(200, 560, 400)).toBe(0)
  })
})
