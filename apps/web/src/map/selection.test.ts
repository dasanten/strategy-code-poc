import { describe, expect, it } from 'vitest'
import { inBox, pickableAt, pickables, toggled } from './selection.js'

// A camera of 10 pixels per tile with tile (0, 0) at the screen's corner.
const place = (x: number, y: number) => [x * 10, y * 10] as const

const residents = [
  { id: 'a', owner: 'me', x: 1, y: 1 },
  { id: 'b', owner: 'me', x: 3, y: 2 },
  { id: 'c', owner: 'me', x: 8, y: 8 },
  { id: 'stranger', owner: 'them', x: 2, y: 2 },
]

describe('selecting residents on the map', () => {
  const list = pickables(residents, 'me', new Map(), place, 10, false)

  it('only offers the Player’s own residents', () => {
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('boxes the own residents inside, dragged either way', () => {
    expect(inBox(list, { x: 0, y: 0 }, { x: 40, y: 30 })).toEqual(['a', 'b'])
    expect(inBox(list, { x: 40, y: 30 }, { x: 0, y: 0 })).toEqual(['a', 'b'])
    // The stranger at (2, 2) is inside too, but not the Player's.
    expect(inBox(list, { x: 20, y: 20 }, { x: 30, y: 30 })).toEqual([])
  })

  it('clicks the nearest own resident in reach, never a stranger', () => {
    expect(pickableAt(list, 16, 16)).toBe('a')
    expect(pickableAt(list, 25, 28)).toBe(undefined)
  })

  it('Shift-click adds a resident or takes them out', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggled(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('up close, only residents drawn as a figure can be picked, where it was drawn', () => {
    const spots = new Map([['b', { x: 100, y: 100, r: 10 }]])
    const close = pickables(residents, 'me', spots, place, 40, true)
    expect(close).toEqual([{ id: 'b', x: 100, y: 100, reach: 14 }])
    expect(inBox(close, { x: 0, y: 0 }, { x: 200, y: 200 })).toEqual(['b'])
  })

  it('boxes a passenger at their carriage, but a click there is the carriage’s', () => {
    const spots = new Map([['p', { x: 50, y: 50, r: 10 }]])
    const aboard = [{ id: 'p', owner: 'me', x: 5, y: 5, aboard: 'k1' }]
    const list = pickables(aboard, 'me', spots, place, 40, true)
    expect(pickableAt(list, 50, 50)).toBeUndefined()
    expect(inBox(list, { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual(['p'])
  })
})
