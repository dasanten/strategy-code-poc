import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR, TICKS_PER_GAME_YEAR } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { lastSeenByKind, lastSeenText } from './last-seen.js'

describe('lastSeenText', () => {
  const day12 = 11 * TICKS_PER_GAME_DAY + 14.5 * TICKS_PER_GAME_HOUR

  it('says the game day and time it was seen and how long ago', () => {
    expect(lastSeenText(day12, day12 + 3 * TICKS_PER_GAME_DAY)).toBe(
      'Last seen: day 12, 14:30 (3 days ago)',
    )
    expect(lastSeenText(day12, day12 + TICKS_PER_GAME_HOUR)).toBe(
      'Last seen: day 12, 14:30 (1 hour ago)',
    )
    expect(lastSeenText(day12, day12 + 5 * (TICKS_PER_GAME_HOUR / 60))).toBe(
      'Last seen: day 12, 14:30 (5 minutes ago)',
    )
    expect(lastSeenText(day12, day12)).toBe('Last seen: day 12, 14:30 (just now)')
  })

  it('names the year when it was another one', () => {
    expect(lastSeenText(day12, day12 + TICKS_PER_GAME_YEAR)).toMatch(/^Last seen: year 1, day 12/)
  })
})

describe('lastSeenByKind', () => {
  it('sorts buildings from cities and drops the tag', () => {
    const sorted = lastSeenByKind([
      { is: 'building', id: 'b', kind: 'house', cityId: 'c', x: 1, y: 2, seenAt: 5 },
      { is: 'city', id: 'c', name: 'Far', realmId: null, townHallId: 'h', seenAt: 5 },
    ])
    expect(sorted.buildings).toEqual([
      { id: 'b', kind: 'house', cityId: 'c', x: 1, y: 2, seenAt: 5 },
    ])
    expect(sorted.cities.map((c) => c.name)).toEqual(['Far'])
  })
})
