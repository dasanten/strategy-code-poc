import { describe, expect, it } from 'vitest'
import { GAME_DAYS_PER_YEAR, TICKS_PER_GAME_HOUR, formatGameTime, gameTime } from './time.js'
import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR } from './world.js'

describe('game time', () => {
  it('runs 1 game minute per real second, 1 game day per 24 real minutes, 420 game days a year', () => {
    expect(TICKS_PER_GAME_DAY).toBe(24 * 60)
    expect(TICKS_PER_GAME_YEAR).toBe(7 * 24 * 60 * 60)
    expect(GAME_DAYS_PER_YEAR).toBe(420)
    expect(TICKS_PER_GAME_HOUR).toBe(60)
  })

  it('starts at year 1, day 1, midnight', () => {
    expect(gameTime(0)).toEqual({ year: 1, day: 1, hour: 0, minute: 0 })
  })

  it('counts hours and minutes within a day', () => {
    expect(gameTime(TICKS_PER_GAME_HOUR)).toEqual({ year: 1, day: 1, hour: 1, minute: 0 })
    // Half a game day is noon; a game minute is a real second.
    expect(gameTime(TICKS_PER_GAME_DAY / 2 + 5)).toEqual({ year: 1, day: 1, hour: 12, minute: 5 })
    expect(gameTime(TICKS_PER_GAME_DAY - 1)).toEqual({ year: 1, day: 1, hour: 23, minute: 59 })
  })

  it('rolls over into the next day and the next year', () => {
    expect(gameTime(TICKS_PER_GAME_DAY)).toEqual({ year: 1, day: 2, hour: 0, minute: 0 })
    expect(gameTime(TICKS_PER_GAME_YEAR - 1)).toMatchObject({ year: 1, day: 420, hour: 23 })
    expect(gameTime(TICKS_PER_GAME_YEAR)).toEqual({ year: 2, day: 1, hour: 0, minute: 0 })
    expect(gameTime(10 * TICKS_PER_GAME_YEAR + 3 * TICKS_PER_GAME_DAY)).toMatchObject({
      year: 11,
      day: 4,
    })
  })

  it('formats for the top bar', () => {
    expect(formatGameTime(0)).toBe('Year 1 · Day 1 · 00:00')
    expect(formatGameTime(2 * TICKS_PER_GAME_DAY + 14 * TICKS_PER_GAME_HOUR + 50)).toBe(
      'Year 1 · Day 3 · 14:50',
    )
  })
})
