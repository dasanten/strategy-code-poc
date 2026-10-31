import { SCRIPT_STEP_BUDGET, TICKS_PER_GAME_HOUR, type ScriptSummary } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { defenceChoices, errorWhen, groupDefenceScript, stepsText } from './script-run-view.js'

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

describe('the Defence script picker', () => {
  const script = (id: number, name: string, more: Partial<ScriptSummary> = {}): ScriptSummary => ({
    id,
    name,
    activeVersion: 1,
    latestVersion: 1,
    task: null,
    followsDefault: false,
    params: [],
    ...more,
  })
  const scripts = [
    script(1, 'Work (default)', { task: 'work', followsDefault: true }),
    script(2, 'Defend (default)', { task: 'defend', followsDefault: true }),
    script(3, 'Shout'),
    script(4, 'Draft', { activeVersion: null }),
  ]

  it('offers the Player’s scripts that can run, but for Defend, which is the default', () => {
    expect(defenceChoices(scripts).map((s) => s.id)).toEqual([1, 3])
  })

  it('keeps one picked that is gone from the library listed', () => {
    expect(defenceChoices(scripts, 9)).toMatchObject([
      { id: 1 },
      { id: 3 },
      { id: 9, name: 'a script no longer in your library' },
    ])
    expect(defenceChoices(scripts, 3).map((s) => s.id)).toEqual([1, 3])
  })

  it('shows for a group the one all of them keep, or none when they differ', () => {
    expect(groupDefenceScript([{}, { defenceScriptId: undefined }])).toBeNull()
    expect(groupDefenceScript([{ defenceScriptId: 3 }, { defenceScriptId: 3 }])).toBe(3)
    expect(groupDefenceScript([{ defenceScriptId: 3 }, {}])).toBeUndefined()
  })
})
