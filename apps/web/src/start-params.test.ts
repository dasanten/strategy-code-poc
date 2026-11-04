import type { ScriptParam, ScriptSummary } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  canCustomise,
  groupStartValues,
  overrideParamValues,
  startedScript,
  startFormOpens,
  startFormParams,
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

describe('starting at once', () => {
  const task = { kind: 'task', task: 'work' }
  const named = (name: string, description?: string): ScriptParam => ({
    name,
    type: 'storage',
    ...(description === undefined ? {} : { description }),
  })

  it('opens the form by itself only for a param with no default and no none:', () => {
    expect(startFormOpens(task, [{ name: 'n', type: 'number', default: 2 }], false)).toBe(false)
    expect(startFormOpens(task, [named('s', 'where; none: the nearest')], false)).toBe(false)
    // With nothing after it, none: still says the script can go without.
    expect(startFormOpens(task, [named('s', 'none:')], false)).toBe(false)
    expect(startFormOpens(task, [named('s')], false)).toBe(true)
    expect(startFormOpens(task, [named('s', 'where to go')], false)).toBe(true)
    expect(startFormOpens(task, [{ name: 'n', type: 'number' }], false)).toBe(true)
    // One such param among those that can go without is enough.
    const some = [{ name: 'n', type: 'number', default: 2 } as ScriptParam, named('s')]
    expect(startFormOpens(task, some, false)).toBe(true)
  })

  it('reads a word like nonetheless as no none:', () => {
    expect(startFormOpens(task, [named('s', 'nonetheless: here')], false)).toBe(true)
  })

  it('opens the form for Customise while there are params to show', () => {
    expect(startFormOpens(task, [{ name: 'n', type: 'number', default: 2 }], true)).toBe(true)
    expect(startFormOpens(task, [], true)).toBe(false)
    expect(startFormOpens(task, [], false)).toBe(false)
  })

  it('still asks for a defence script’s params when it is picked', () => {
    const pick = { kind: 'setDefenceScript', scriptId: 1 }
    expect(startFormOpens(pick, [{ name: 'n', type: 'number', default: 2 }], false)).toBe(true)
    expect(startFormOpens(pick, [], false)).toBe(false)
  })

  it('offers Customise only for a script with params to show', () => {
    const work = {
      ...summary(2, 'work'),
      params: [{ name: 'workplace', type: 'building' as const }],
    }
    const own = { ...summary(3, null), params: [] }
    const mine = summary(4, null)
    const scripts = [work, own, mine]
    // Work's only param is the target its task fills.
    expect(canCustomise(task, scripts)).toBe(false)
    expect(canCustomise({ kind: 'runScript', scriptId: 2 }, scripts)).toBe(true)
    expect(canCustomise({ kind: 'runScript', scriptId: 3 }, scripts)).toBe(false)
    expect(canCustomise({ kind: 'runScript', scriptId: 4 }, scripts)).toBe(true)
    expect(canCustomise({ kind: 'walkTo', x: 1, y: 1 }, scripts)).toBe(false)
    // By the workplace's work script.
    const worker = {
      ...mine,
      params: [{ name: 'workplace', type: 'building' as const }, ...PARAMS],
    }
    const at = { kind: 'task', task: 'work', workplaceId: 'farm' }
    expect(canCustomise(at, [work, worker], { farm: { scriptId: 4 } })).toBe(true)
    expect(canCustomise(at, [work, worker])).toBe(false)
  })
})

describe('the form before Work starts', () => {
  const work = (id: number, params: ScriptParam[]) => ({ ...summary(id, null), params })
  const notes = work(3, [{ name: 'workplace', type: 'building' }, ...PARAMS])
  const home = work(4, [{ name: 'home', type: 'building' }])
  const scripts = [summary(1, null), summary(2, 'work'), notes, home]
  const at = { kind: 'task', task: 'work', workplaceId: 'farm' }

  it('starts the workplace’s work script, else the Work default', () => {
    expect(startedScript(at, scripts, { farm: { scriptId: 3 } })?.id).toBe(3)
    expect(startedScript(at, scripts, { mine: { scriptId: 3 } })?.id).toBe(2)
    expect(startedScript(at, scripts)?.id).toBe(2)
    // One that is no work script any more, or gone, isn't run.
    expect(startedScript(at, scripts, { farm: { scriptId: 4 } })?.id).toBe(2)
    expect(startedScript(at, scripts, { farm: { scriptId: 9 } })?.id).toBe(2)
  })

  it('never shows workplace, which Work fills', () => {
    expect(startFormParams(at, notes).map((p) => p.name)).toEqual(['storage', 'rounds', 'take'])
  })

  it('is filled with the workplace’s values, and gives only what the Player changed', () => {
    const base = startValues(PARAMS, { storage: 's1', take: 4 })
    expect(base).toEqual({ storage: 's1', rounds: 5, take: 4 })
    expect(overrideParamValues(PARAMS, base, base)).toEqual({})
    expect(overrideParamValues(PARAMS, base, { ...base, take: 2, rounds: 6 })).toEqual({
      take: 2,
      rounds: 6,
    })
    // Emptied, it reads the workplace's value: nothing of their own.
    expect(overrideParamValues(PARAMS, base, { ...base, storage: undefined })).toEqual({})
  })
})

describe('the form before a script starts', () => {
  it('knows the script Run script or a task starts', () => {
    const scripts = [summary(1, null), summary(2, 'work')]
    expect(startedScript({ kind: 'runScript', scriptId: 1 }, scripts)?.id).toBe(1)
    expect(startedScript({ kind: 'task', task: 'work' }, scripts)?.id).toBe(2)
    expect(startedScript({ kind: 'task', task: 'build' }, scripts)).toBeUndefined()
    expect(startedScript({ kind: 'walkTo', x: 1, y: 1 }, scripts)).toBeUndefined()
    // A defence script's params are picked when it is picked; Defend has none to pick.
    expect(startedScript({ kind: 'setDefenceScript', scriptId: 1 }, scripts)?.id).toBe(1)
    expect(startedScript({ kind: 'setDefenceScript', scriptId: null }, scripts)).toBeUndefined()
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

  it('starts a default’s target param empty, and leaves it out for its task, which fills it', () => {
    const work = {
      ...summary(2, 'work'),
      params: [{ name: 'workplace', type: 'building' as const }, ...PARAMS],
    }
    const runScript = startFormParams({ kind: 'runScript', scriptId: 2 }, work)
    expect(runScript.map((p) => p.name)).toEqual(['workplace', 'storage', 'rounds', 'take'])
    // Never kept between starts: empty is the one they stand on.
    expect(startValues(runScript, { workplace: 'f1', storage: 's1' }, 'workplace')).toEqual({
      workplace: undefined,
      storage: 's1',
      rounds: 5,
      take: undefined,
    })
    expect(
      groupStartValues(runScript, [{ workplace: 'f1' }, { workplace: 'f1' }], 'workplace'),
    ).toMatchObject({ workplace: undefined })
    const task = startFormParams({ kind: 'task', task: 'work' }, work)
    expect(task.map((p) => p.name)).toEqual(['storage', 'rounds', 'take'])
    // A script of the Player's own has no target param.
    expect(startFormParams({ kind: 'task', task: 'work' }, summary(1, null))).toEqual(PARAMS)
  })

  it('can start only with whole numbers of zero or more', () => {
    expect(startValuesValid(PARAMS, { rounds: 3, take: undefined })).toBe(true)
    expect(startValuesValid(PARAMS, { rounds: -1 })).toBe(false)
    expect(startValuesValid(PARAMS, { take: 1.5 })).toBe(false)
  })
})

describe('the form with choice and waypoint params', () => {
  const CHOSEN: ScriptParam[] = [
    { name: 'toward', type: 'choice', choices: ['north', 'south'], default: 'north' },
    { name: 'pace', type: 'choice', choices: ['slow', 'fast'] },
    { name: 'to', type: 'waypoint' },
  ]

  it('starts from a kept word still listed and a kept waypoint, else the default', () => {
    expect(startValues(CHOSEN, { toward: 'south', pace: 'fast', to: 'wp1' })).toEqual({
      toward: 'south',
      pace: 'fast',
      to: 'wp1',
    })
    expect(startValues(CHOSEN, { toward: 'west', pace: 3 })).toEqual({
      toward: 'north',
      pace: undefined,
      to: undefined,
    })
  })

  it('gives the word and waypoint, null for empty fields and for a choice’s default', () => {
    expect(startParamValues(CHOSEN, { toward: 'north', pace: 'slow', to: 'wp1' })).toEqual({
      toward: null,
      pace: 'slow',
      to: 'wp1',
    })
    expect(startValuesValid(CHOSEN, { toward: 'south', pace: undefined })).toBe(true)
  })
})
