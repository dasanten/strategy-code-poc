import { SCRIPT_STEP_BUDGET, TICKS_PER_GAME_HOUR } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { errorWhen, stepsText } from './script-run-view.js'

describe('stepsText', () => {
  it('shows the steps used against the budget, and why it stopped when it ran out', () => {
    expect(stepsText({ steps: 312 })).toBe(`312 / ${SCRIPT_STEP_BUDGET} steps`)
    expect(stepsText({ steps: SCRIPT_STEP_BUDGET, outOfSteps: 'own' })).toBe(
      `${SCRIPT_STEP_BUDGET} / ${SCRIPT_STEP_BUDGET} steps: ran out, stopped for the tick`,
    )
    expect(stepsText({ steps: 0, outOfSteps: 'realm' })).toMatch(/realm’s scripts used up/)
  })
})

describe('errorWhen', () => {
  const error = { message: 'Can’t read "x" of null', tick: 100, version: 2 }

  it('says the line and how long ago in game time', () => {
    const at = { ...error, line: 3, column: 9 }
    expect(errorWhen(at, 100)).toBe('Line 3, column 9 · Just now')
    expect(errorWhen(at, 100 + 2 * TICKS_PER_GAME_HOUR)).toBe('Line 3, column 9 · 2 hours ago')
  })

  it('leaves out the line for an error outside the script, such as memory it couldn’t keep', () => {
    expect(errorWhen(error, 100 + TICKS_PER_GAME_HOUR)).toBe('1 hour ago')
  })
})
