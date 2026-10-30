import {
  ADULT_AGE,
  BUILD_WORK,
  CARRYING_TICKS,
  CHILD_YEAR_DAYS,
  CONSTRUCTION_SKILL_EFFECT,
  PAIRING_WAIT_TICKS,
  STABLE_BREED_TICKS,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  TICK_MS,
  ticksForAge,
  type Building,
  type Resident,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  about,
  bornIn,
  foalLeft,
  grownIn,
  pairingTicksLeft,
  roughGameTime,
  roughRealTime,
  timeLeft,
  workLeft,
} from './time-left.js'

/** Estimates (`CONTEXT.md`: Doing, Estimates): real time first, game time in brackets. */

const realOf = (ticks: number) => roughRealTime(ticks)
const ticksOfSeconds = (s: number) => (s * 1000) / TICK_MS

describe('the estimate format', () => {
  it('rounds real time to one coarse unit', () => {
    expect(roughRealTime(ticksOfSeconds(40))).toBe('40 s')
    expect(roughRealTime(ticksOfSeconds(150))).toBe('3 min')
    expect(roughRealTime(ticksOfSeconds(2 * 3600 + 600))).toBe('2 h')
    expect(roughRealTime(ticksOfSeconds(4 * 86_400))).toBe('4 real days')
    expect(roughRealTime(0)).toBe('1 s')
  })

  it('rounds game time to one coarse unit', () => {
    expect(roughGameTime(5 * TICKS_PER_GAME_DAY)).toBe('5 game days')
    expect(roughGameTime(TICKS_PER_GAME_HOUR)).toBe('1 game hour')
    expect(roughGameTime(TICKS_PER_GAME_HOUR / 2)).toBe('30 game minutes')
  })

  it('says real time first, game time in brackets', () => {
    const ticks = 5 * TICKS_PER_GAME_DAY
    expect(about(ticks)).toBe(`about ${realOf(ticks)} (5 game days)`)
    expect(timeLeft(ticks)).toBe(`about ${realOf(ticks)} (5 game days) left`)
  })
})

describe('breeding', () => {
  it('is what is left of STABLE_BREED_TICKS at one tick a tick', () => {
    expect(foalLeft(0)).toBe(timeLeft(STABLE_BREED_TICKS))
    expect(foalLeft(STABLE_BREED_TICKS / 2)).toBe(timeLeft(STABLE_BREED_TICKS / 2))
  })
})

describe('carrying and pairing', () => {
  it('counts CARRYING_TICKS down from when carrying started', () => {
    expect(bornIn(100, 100)).toBe(`born in ${about(CARRYING_TICKS)}`)
    expect(bornIn(100, 100 + TICKS_PER_GAME_DAY)).toBe(
      `born in ${about(CARRYING_TICKS - TICKS_PER_GAME_DAY)}`,
    )
  })

  it('counts the pairing wait down, never below 0', () => {
    expect(pairingTicksLeft(100, 100)).toBe(PAIRING_WAIT_TICKS)
    expect(pairingTicksLeft(100, 100 + 10 * PAIRING_WAIT_TICKS)).toBe(0)
  })
})

describe('growing up', () => {
  it('counts the childhood of ADULT_AGE years of CHILD_YEAR_DAYS down', () => {
    const childhood = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY
    expect(grownIn({ bornAt: 0 }, 0)).toBe(`grown in ${about(childhood)}`)
    expect(grownIn({ bornAt: 0 }, childhood - TICKS_PER_GAME_DAY)).toBe(
      `grown in ${about(TICKS_PER_GAME_DAY)}`,
    )
    expect(grownIn({ bornAt: -ticksForAge(ADULT_AGE) }, 0)).toBeUndefined()
  })
})

describe('building and tearing down', () => {
  const grown = -ticksForAge(30)
  /** A grown builder of Strength `strength` standing on (5, 5), with an order on it or not. */
  const builder = (id: string, order: Resident['order'], strength = 10, skill = 0) =>
    ({
      id,
      x: 5,
      y: 5,
      bornAt: grown,
      stats: {
        strength: { base: strength, trained: 0 },
        intellect: { base: 10, trained: 0 },
        stamina: { base: 10, trained: 0 },
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
  const building = { kind: 'build', building: 'lumberCamp', at: { x: 5, y: 5 }, siteId: 's1' }

  it('says nobody is building with nobody on the site', () => {
    expect(workLeft(site(0), [], 0, {})).toBe('nobody is building')
    // One whose order is on another site doesn't count.
    const elsewhere = builder('w1', { ...building, siteId: 's2' } as Resident['order'])
    expect(workLeft(site(0), [elsewhere], 0, {})).toBe('nobody is building')
  })

  it('divides the work left by the builders on it now, by Strength and Construction', () => {
    const avg = builder('w1', building as Resident['order'])
    // An average unskilled builder puts in 1 work a tick.
    expect(workLeft(site(0), [avg], 0, {})).toBe(timeLeft(work))
    expect(workLeft(site(work / 2), [avg], 0, {})).toBe(timeLeft(work / 2))
    // Two of them take half as long.
    const other = builder('w2', building as Resident['order'])
    expect(workLeft(site(0), [avg, other], 0, {})).toBe(timeLeft(work / 2))
    // A strong, skilled one goes faster.
    const strong = builder('w3', building as Resident['order'], 15, 10)
    const pace = 1.5 * (1 + 10 * CONSTRUCTION_SKILL_EFFECT)
    expect(workLeft(site(0), [strong], 0, {})).toBe(timeLeft(Math.ceil(work / pace)))
  })

  it('tears down at the same pace, from the tear-down work left', () => {
    const b: Building = { id: 'b1', kind: 'lumberCamp', cityId: null, x: 5, y: 5, teardown: 0 }
    const tearing = builder('w1', { kind: 'tearDown', buildingId: 'b1', at: { x: 5, y: 5 } })
    expect(workLeft(b, [], 0, { tearingDown: true })).toBe('nobody is tearing it down')
    const left = workLeft(b, [tearing], 0, { tearingDown: true })
    expect(left).toMatch(/ left$/)
  })
})
