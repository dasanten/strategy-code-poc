import { describe, expect, it } from 'vitest'
import {
  aboutTime,
  bornIn,
  foalLeft,
  grownIn,
  pairingTicksLeft,
  timeLeft,
  workLeft,
} from './estimates.js'
import { STABLE_BREED_TICKS } from './horse-rules.js'
import { BUILD_WORK } from './narrowed.js'
import {
  TICKS_PER_GAME_HOUR,
  ADULT_AGE,
  CARRYING_TICKS,
  CHILD_YEAR_DAYS,
  CONSTRUCTION_SKILL_EFFECT,
  PAIRING_WAIT_TICKS,
  TICKS_PER_GAME_DAY,
  ticksForAge,
} from '@csp/balance'
import type { Building, Resident } from '@csp/shared-types'

describe('aboutTime', () => {
  const min = 60

  it('says real time first and game time in brackets, one coarse unit each', () => {
    expect(aboutTime(3 * min)).toBe('about 3 min (3 game hours)')
    expect(aboutTime(TICKS_PER_GAME_HOUR)).toBe('about 1 min (a game hour)')
    expect(aboutTime(12 * min + 20)).toBe('about 12 min (half a game day)')
    expect(aboutTime(20 * min)).toBe('about 20 min (a game day)')
    expect(aboutTime(TICKS_PER_GAME_DAY)).toBe('about 24 min (a game day)')
    expect(aboutTime(5 * TICKS_PER_GAME_DAY)).toBe('about 2 h (5 game days)')
  })

  it('says under a minute below one', () => {
    expect(aboutTime(0)).toBe('under a minute')
    expect(aboutTime(59)).toBe('under a minute')
  })
})

describe('meters and countdowns', () => {
  it('say how long is left as aboutTime does', () => {
    expect(timeLeft(5 * TICKS_PER_GAME_DAY)).toBe('about 2 h (5 game days) left')
  })

  it('breeding: what is left of STABLE_BREED_TICKS at one tick a tick', () => {
    expect(foalLeft(0)).toBe(timeLeft(STABLE_BREED_TICKS))
    expect(foalLeft(STABLE_BREED_TICKS / 2)).toBe(timeLeft(STABLE_BREED_TICKS / 2))
  })

  it('carrying: CARRYING_TICKS counted down from when it started', () => {
    expect(bornIn(100, 100)).toBe(`born in ${aboutTime(CARRYING_TICKS)}`)
    expect(bornIn(100, 100 + TICKS_PER_GAME_DAY)).toBe(
      `born in ${aboutTime(CARRYING_TICKS - TICKS_PER_GAME_DAY)}`,
    )
  })

  it('pairing: the wait counted down, never below 0', () => {
    expect(pairingTicksLeft(100, 100)).toBe(PAIRING_WAIT_TICKS)
    expect(pairingTicksLeft(100, 100 + 10 * PAIRING_WAIT_TICKS)).toBe(0)
  })

  it('growing up: a childhood of ADULT_AGE years of CHILD_YEAR_DAYS counted down', () => {
    const childhood = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY
    expect(grownIn({ bornAt: 0 }, 0)).toBe(`grown in ${aboutTime(childhood)}`)
    expect(grownIn({ bornAt: 0 }, childhood - TICKS_PER_GAME_DAY)).toBe(
      `grown in ${aboutTime(TICKS_PER_GAME_DAY)}`,
    )
    expect(grownIn({ bornAt: -ticksForAge(ADULT_AGE) }, 0)).toBeUndefined()
  })

  describe('building and tearing down', () => {
    /** A grown builder of Strength `strength` standing on (5, 5), with an order on it or not. */
    const builder = (id: string, order: Resident['order'], strength = 10, skill = 0) =>
      ({
        id,
        x: 5,
        y: 5,
        bornAt: -ticksForAge(30),
        stats: {
          strength: { base: strength, trained: 0 },
          intellect: { base: 10, trained: 0 },
          endurance: { base: 10, trained: 0 },
          agility: { base: 10, trained: 0 },
        },
        skills: { construction: skill },
        order,
      }) as unknown as Resident
    const work = BUILD_WORK.lumberCamp!
    const site = (done: number): Building => ({
      id: 's1',
      kind: 'lumberCamp',
      cityId: null,
      x: 5,
      y: 5,
      site: { delivered: {}, work: done },
    })
    const building = {
      kind: 'build',
      building: 'lumberCamp',
      at: { x: 5, y: 5 },
      siteId: 's1',
    } as Resident['order']

    it('say nobody is building with nobody on the site', () => {
      expect(workLeft(site(0), [], 0, {})).toBe('nobody is building')
      // One whose order is on another site doesn't count.
      const elsewhere = builder('w1', { ...building!, siteId: 's2' } as Resident['order'])
      expect(workLeft(site(0), [elsewhere], 0, {})).toBe('nobody is building')
    })

    it('divide the work left by the builders on it now, by Strength and Construction', () => {
      const avg = builder('w1', building)
      // An average unskilled builder puts in 1 work a tick.
      expect(workLeft(site(0), [avg], 0, {})).toBe(timeLeft(work))
      expect(workLeft(site(work / 2), [avg], 0, {})).toBe(timeLeft(work / 2))
      // Two of them take half as long.
      expect(workLeft(site(0), [avg, builder('w2', building)], 0, {})).toBe(timeLeft(work / 2))
      // A strong, skilled one goes faster.
      const strong = builder('w3', building, 15, 10)
      const pace = 1.5 * (1 + 10 * CONSTRUCTION_SKILL_EFFECT)
      expect(workLeft(site(0), [strong], 0, {})).toBe(timeLeft(Math.ceil(work / pace)))
    })

    it('tear down at the same pace, from the tear-down work left', () => {
      const b: Building = { id: 'b1', kind: 'lumberCamp', cityId: null, x: 5, y: 5, teardown: 0 }
      const tearing = builder('w1', { kind: 'tearDown', buildingId: 'b1', at: { x: 5, y: 5 } })
      expect(workLeft(b, [], 0, { tearingDown: true })).toBe('nobody is tearing it down')
      expect(workLeft(b, [tearing], 0, { tearingDown: true })).toMatch(/ left$/)
    })
  })
})
