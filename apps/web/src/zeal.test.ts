import { describe, expect, it } from 'vitest'
import { ZEAL_CAP_HOURS } from '@csp/balance'
import { untilFull, zealShown } from './zeal.js'

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
