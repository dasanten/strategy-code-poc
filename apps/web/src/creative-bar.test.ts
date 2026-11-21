import { describe, expect, it } from 'vitest'
import {
  CREATIVE_SPEEDS,
  creativeRunning,
  gameSpan,
  MAX_SKIP_TICKS,
  showsCreativeBar,
  skipLine,
  skipShare,
  skipTicks,
} from './creative-bar.js'

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

describe('skip ahead', () => {
  it('counts game hours or days in ticks, up to a game year', () => {
    expect(skipTicks(1, 'days')).toBe(1440)
    expect(skipTicks(3, 'hours')).toBe(180)
    expect(skipTicks(0, 'hours')).toBeUndefined()
    expect(skipTicks(1.5, 'days')).toBeUndefined()
    expect(skipTicks(420, 'days')).toBe(MAX_SKIP_TICKS)
    expect(skipTicks(421, 'days')).toBeUndefined()
  })

  it('says how far it has come in game time', () => {
    expect(skipLine({ done: 380, total: 1440 })).toBe('Skipping ahead: 6 h 20 min of 1 day (26%)')
    expect(skipLine({ done: 0, total: 120 })).toBe('Skipping ahead: 0 min of 2 h (0%)')
    expect(gameSpan(2 * 1440 + 61)).toBe('2 days 1 h 1 min')
    expect(skipShare({ done: 5, total: 0 })).toBe(1)
  })
})
