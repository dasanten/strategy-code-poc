import { describe, expect, it } from 'vitest'
import { CREATIVE_SPEEDS, creativeRunning, showsCreativeBar } from './creative-bar.js'

describe('the Creative bar', () => {
  it('shows only for an admin on a creative server', () => {
    expect(showsCreativeBar({ name: 'Daniel', isAdmin: true, creative: true })).toBe(true)
    expect(showsCreativeBar({ name: 'Daniel', isAdmin: true })).toBe(false)
    expect(showsCreativeBar({ name: 'Mara', isAdmin: false, creative: true })).toBe(false)
  })

  it('offers every speed the server knows, normal first', () => {
    expect(CREATIVE_SPEEDS.map((s) => s.speed)).toEqual(['normal', 'x10', 'x60', 'max'])
  })

  it('says whether the world is paused or how fast it runs', () => {
    expect(creativeRunning(true, 'x60')).toBe('Paused')
    expect(creativeRunning(false, 'normal')).toBe('Running')
    expect(creativeRunning(false, 'x60')).toBe('Running ×60')
    expect(creativeRunning(false, 'max')).toBe('Running Max')
  })
})
