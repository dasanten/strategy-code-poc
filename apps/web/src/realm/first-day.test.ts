import { describe, expect, it } from 'vitest'
import { FIRST_DAY_LINES } from '@csp/shared-types'
import { firstDayShown } from './first-day.js'
import type { FirstDay } from '@csp/shared-types'
const fresh: FirstDay = { done: [], dismissed: false }

describe('the first-day card', () => {
  it('shows for a new Player, with nothing ticked', () => {
    expect(firstDayShown(fresh)).toBe(true)
  })

  it('goes for good once every line is ticked', () => {
    const card: FirstDay = { done: [...FIRST_DAY_LINES], dismissed: false }
    expect(firstDayShown(card)).toBe(false)
  })

  it('goes for good once dismissed, however few lines are ticked', () => {
    expect(firstDayShown({ done: ['claimHorses'], dismissed: true })).toBe(false)
  })
})
