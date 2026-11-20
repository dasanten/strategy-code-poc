import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_HOUR, ZEAL_CAP_HOURS } from '@csp/balance'
import type { Building } from '@csp/shared-types'
import { rallyProblem, untilFull, zealLasts, zealShown } from './zeal.js'

describe('the Zeal meter (CONTEXT.md: Zeal)', () => {
  it('shows a full pool as full', () => {
    const shown = zealShown(ZEAL_CAP_HOURS)
    expect(shown.share).toBe(1)
    expect(shown.label).toBe('Zeal 100%')
    expect(shown.title).toMatch(/^Zeal: full\. /)
    expect(shown.title).toContain(`${ZEAL_CAP_HOURS} game hours`)
  })

  it('shows how full a lowered pool is and about how long until full', () => {
    const shown = zealShown(ZEAL_CAP_HOURS * 0.75)
    expect(shown.share).toBe(0.75)
    expect(shown.label).toBe('Zeal 75%')
    // A quarter of two real hours.
    expect(shown.title).toMatch(/^Zeal: full in about 30 min\. /)
  })

  it('counts long waits in half hours and the last minute as within a minute', () => {
    expect(untilFull(0)).toBe('in about 2 h')
    expect(untilFull(ZEAL_CAP_HOURS * 0.25)).toBe('in about 1.5 h')
    expect(untilFull(ZEAL_CAP_HOURS - 0.001)).toBe('within a minute')
  })

  it('keeps the meter between empty and full', () => {
    expect(zealShown(-1).share).toBe(0)
    expect(zealShown(ZEAL_CAP_HOURS * 2).share).toBe(1)
  })
})

describe('rallying the crew (CONTEXT.md: Rallying the crew)', () => {
  const at = (more: Partial<Building> & Pick<Building, 'kind'>) =>
    ({ id: 'b1', cityId: null, x: 0, y: 0, ...more }) as Building

  it('can be given at a workplace, a site or a building being torn down, with Zeal left', () => {
    expect(rallyProblem(at({ kind: 'farm' }), 10, null)).toBeUndefined()
    expect(
      rallyProblem(at({ kind: 'house', site: { delivered: {}, work: 0 } }), 10, null),
    ).toBeUndefined()
    expect(rallyProblem(at({ kind: 'house', teardown: 0 }), 10, null)).toBeUndefined()
  })

  it('says why not elsewhere, a second time, or with no Zeal left', () => {
    expect(rallyProblem(undefined, 10, null)).toBe('not at a workplace or construction site')
    expect(rallyProblem(at({ kind: 'house' }), 10, null)).toBe(
      'not at a workplace or construction site',
    )
    expect(rallyProblem(at({ kind: 'farm', ruinedAt: 3 }), 10, null)).toBe(
      'not at a workplace or construction site',
    )
    expect(rallyProblem(at({ kind: 'farm' }), 0, null)).toBe('no Zeal left')
    expect(rallyProblem(at({ kind: 'farm' }), 10, { kind: 'rally', buildingId: 'b1' })).toBe(
      'already rallying the crew here',
    )
  })

  it('says about how long the Zeal lasts while it drains, filling nothing meanwhile', () => {
    const perTick = 1 / TICKS_PER_GAME_HOUR
    // A full pool: drained at a game hour an hour, a real second a tick (Daniel, 2026-11-20).
    // Under an hour of real time: 48 game hours are 48 real minutes.
    expect(zealLasts(ZEAL_CAP_HOURS)).toBe(`about ${Math.ceil(ZEAL_CAP_HOURS / perTick / 60)} min`)
    expect(zealLasts(perTick * 600)).toBe('about 10 min')
    expect(zealLasts(0)).toBe('under a minute')
  })

  it('shows the meter draining', () => {
    const shown = zealShown(ZEAL_CAP_HOURS / 2, true)
    expect(shown.draining).toBe(true)
    expect(shown.label).toBe('Zeal 50% ↓')
    expect(shown.title).toMatch(
      /^Zeal: not filling while your Leader rallies the crew; lasts about /,
    )
    expect(zealShown(ZEAL_CAP_HOURS / 2).draining).toBeUndefined()
  })
})
