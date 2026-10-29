import { describe, expect, it } from 'vitest'
import { nextSheet, snapSheet, stepSheet } from './sheet-view.js'

describe('snapSheet', () => {
  it('settles at the nearest of peek, half and full', () => {
    expect(snapSheet(100, 812)).toBe('peek')
    expect(snapSheet(406, 812)).toBe('half')
    expect(snapSheet(700, 812)).toBe('full')
  })

  it('settles at peek on a screen it cannot measure', () => {
    expect(snapSheet(300, 0)).toBe('peek')
  })
})

describe('nextSheet', () => {
  it('goes up one height a tap, and from full back to peek', () => {
    expect(nextSheet('peek')).toBe('half')
    expect(nextSheet('half')).toBe('full')
    expect(nextSheet('full')).toBe('peek')
  })
})

describe('stepSheet', () => {
  it('goes one height up or down and stops at the ends', () => {
    expect(stepSheet('half', true)).toBe('full')
    expect(stepSheet('half', false)).toBe('peek')
    expect(stepSheet('full', true)).toBe('full')
    expect(stepSheet('peek', false)).toBe('peek')
  })
})
