import { SCRIPT_STEP_BUDGET, TICKS_PER_GAME_HOUR, type ScriptSummary } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  alarmChoices,
  defenceChoices,
  errorWhen,
  groupAlarmScript,
  groupDefenceScript,
  rememberLastScript,
  rememberedLastScript,
  runScriptPick,
  stepsText,
  waitingText,
} from './script-run-view.js'

describe('stepsText', () => {
  it('shows the steps used against the budget, and why it stopped when it ran out', () => {
    expect(stepsText({ steps: 312 })).toBe(`312 / ${SCRIPT_STEP_BUDGET} steps`)
    expect(stepsText({ steps: SCRIPT_STEP_BUDGET, outOfSteps: 'own' })).toBe(
      `${SCRIPT_STEP_BUDGET} / ${SCRIPT_STEP_BUDGET} steps: ran out, stopped for the tick`,
    )
    expect(stepsText({ steps: 0, outOfSteps: 'realm' })).toMatch(/realm’s scripts used up/)
  })
})

describe('waitingText', () => {
  it('says the script waits on the order, and since when in game time', () => {
    expect(waitingText(100, 100)).toBe('Waiting until the order ends · began just now')
    expect(waitingText(100, 100 + 2 * TICKS_PER_GAME_HOUR)).toBe(
      'Waiting until the order ends · began 2 hours ago',
    )
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

describe('The Alarm script picker', () => {
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
    script(1, 'Alarm (default)', { task: 'alarm', followsDefault: true }),
    script(2, 'Defend (default)', { task: 'defend', followsDefault: true }),
    script(3, 'Bell'),
    script(4, 'Draft', { activeVersion: null }),
  ]

  it('offers the Player’s scripts that can run, but for Alarm, which is the default', () => {
    expect(alarmChoices(scripts).map((s) => s.id)).toEqual([2, 3])
    expect(alarmChoices(scripts, 'none').map((s) => s.id)).toEqual([2, 3])
  })

  it('keeps one picked that is gone from the library listed', () => {
    expect(alarmChoices(scripts, 9)).toMatchObject([
      { id: 2 },
      { id: 3 },
      { id: 9, name: 'a script no longer in your library' },
    ])
  })

  it('shows for a group the one all of them keep, None too, or none when they differ', () => {
    expect(groupAlarmScript([{}, { alarmScriptId: undefined }])).toBeNull()
    expect(groupAlarmScript([{ alarmScriptId: 3 }, { alarmScriptId: 3 }])).toBe(3)
    expect(groupAlarmScript([{ alarmScriptId: 'none' }, { alarmScriptId: 'none' }])).toBe('none')
    expect(groupAlarmScript([{ alarmScriptId: 'none' }, {}])).toBeUndefined()
  })
})

describe('Run script’s starting pick', () => {
  const runnable = [{ id: 1 }, { id: 2 }, { id: 3 }]
  it('starts on what the resident runs, else what they last ran, else nothing', () => {
    expect(runScriptPick(runnable, { running: 2, last: 3 })).toBe(2)
    expect(runScriptPick(runnable, { last: 3 })).toBe(3)
    expect(runScriptPick(runnable, {})).toBeUndefined()
    expect(runScriptPick(runnable, { picked: 1, running: 2 })).toBe(1)
  })

  it('skips a script that can no longer run', () => {
    expect(runScriptPick(runnable, { running: 9, last: 3 })).toBe(3)
    expect(runScriptPick(runnable, { last: 9 })).toBeUndefined()
  })

  it('remembers the last script run for each resident in the browser', () => {
    const kept = new Map<string, string>()
    const storage = () => ({
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    })
    expect(rememberedLastScript('r1', storage)).toBeUndefined()
    rememberLastScript('r1', 4, storage)
    rememberLastScript('r2', 5, storage)
    expect(rememberedLastScript('r1', storage)).toBe(4)
    expect(rememberedLastScript('r2', storage)).toBe(5)
    const off = () => ({
      getItem: () => {
        throw new Error('off')
      },
      setItem: () => {
        throw new Error('off')
      },
    })
    expect(() => rememberLastScript('r1', 4, off)).not.toThrow()
    expect(rememberedLastScript('r1', off)).toBeUndefined()
  })
})
