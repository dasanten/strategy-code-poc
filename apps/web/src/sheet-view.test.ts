import { describe, expect, it } from 'vitest'
import { keyboardInset, nextSheet, snapSheet, stepSheet } from './sheet-view.js'

describe('keyboardInset', () => {
  it('is what the keyboard covers of the page', () => {
    expect(keyboardInset(812, { height: 812, offsetTop: 0, scale: 1 })).toBe(0)
    expect(keyboardInset(812, { height: 480, offsetTop: 0, scale: 1 })).toBe(332)
  })

  it('counts the page panned up to show the focused field', () => {
    expect(keyboardInset(812, { height: 480, offsetTop: 100, scale: 1 })).toBe(232)
  })

  it('is none while zoomed in, and never below none', () => {
    expect(keyboardInset(812, { height: 400, offsetTop: 0, scale: 2 })).toBe(0)
    expect(keyboardInset(700, { height: 812, offsetTop: 0, scale: 1 })).toBe(0)
  })
})

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
