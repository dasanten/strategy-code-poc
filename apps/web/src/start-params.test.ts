import type { ScriptParam, ScriptSummary } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  groupStartValues,
  startedScript,
  startParamValues,
  startValues,
  startValuesValid,
} from './start-params.js'

const PARAMS: ScriptParam[] = [
  { name: 'storage', type: 'storage' },
  { name: 'rounds', type: 'number', default: 5 },
  { name: 'take', type: 'number' },
]

const summary = (id: number, task: ScriptSummary['task']): ScriptSummary => ({
  id,
  name: `script ${id}`,
  activeVersion: 1,
  latestVersion: 1,
  task,
  followsDefault: task !== null,
  params: PARAMS,
})

describe('the form before a script starts', () => {
  it('knows the script Run script or a task starts', () => {
    const scripts = [summary(1, null), summary(2, 'work')]
    expect(startedScript({ kind: 'runScript', scriptId: 1 }, scripts)?.id).toBe(1)
    expect(startedScript({ kind: 'task', task: 'work' }, scripts)?.id).toBe(2)
    expect(startedScript({ kind: 'task', task: 'build' }, scripts)).toBeUndefined()
    expect(startedScript({ kind: 'walkTo', x: 1, y: 1 }, scripts)).toBeUndefined()
  })

  it('starts from the kept value, else the default, else empty', () => {
    expect(startValues(PARAMS, undefined)).toEqual({
      storage: undefined,
      rounds: 5,
      take: undefined,
    })
    expect(startValues(PARAMS, { storage: 's1', rounds: 3, take: 0 })).toEqual({
      storage: 's1',
      rounds: 3,
      take: 0,
    })
    // A kept value of another type, from before the param changed, isn't shown.
    expect(startValues(PARAMS, { storage: 4, rounds: 'farm' })).toEqual({
      storage: undefined,
      rounds: 5,
      take: undefined,
    })
  })

  it('for a group, starts from a value all of them keep', () => {
    const values = groupStartValues(PARAMS, [
      { storage: 's1', rounds: 3, take: 2 },
      { storage: 's1', rounds: 4 },
    ])
    expect(values).toEqual({ storage: 's1', rounds: 5, take: undefined })
    expect(groupStartValues(PARAMS, [undefined, undefined])).toEqual(startValues(PARAMS, {}))
  })

  it('gives every param, null for empty fields and for a number equal to its default', () => {
    expect(startParamValues(PARAMS, { storage: 's1', rounds: 5, take: undefined })).toEqual({
      storage: 's1',
      rounds: null,
      take: null,
    })
    expect(startParamValues(PARAMS, { storage: undefined, rounds: 3, take: 0 })).toEqual({
      storage: null,
      rounds: 3,
      take: 0,
    })
  })

  it('can start only with whole numbers of zero or more', () => {
    expect(startValuesValid(PARAMS, { rounds: 3, take: undefined })).toBe(true)
    expect(startValuesValid(PARAMS, { rounds: -1 })).toBe(false)
    expect(startValuesValid(PARAMS, { take: 1.5 })).toBe(false)
  })
})
