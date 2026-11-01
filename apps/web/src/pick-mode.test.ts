import { describe, expect, it } from 'vitest'
import { pickPrompt, pickTarget } from './pick-mode.js'
import type { Plan } from './plan-step.js'

const none = {
  picking: false,
  groupPicking: false,
  isGroup: false,
  armyPick: undefined,
  paramPick: undefined,
} as const

describe('pickTarget', () => {
  it('waits for nothing when no order needs a target', () => {
    expect(pickTarget(none)).toBeUndefined()
  })

  it('waits for the picked resident’s target', () => {
    expect(pickTarget({ ...none, picking: 'walk' })).toEqual({ kind: 'resident', mode: 'walk' })
  })

  it('waits for the group’s target only while a group is picked', () => {
    expect(pickTarget({ ...none, groupPicking: 'build', isGroup: true })).toEqual({
      kind: 'group',
      mode: 'build',
    })
    expect(pickTarget({ ...none, groupPicking: 'build' })).toBeUndefined()
    expect(pickTarget({ ...none, picking: 'walk', isGroup: true })).toBeUndefined()
  })

  it('puts a script param and an army before the resident’s order', () => {
    const param = { name: 'home', type: 'storage' } as const
    expect(pickTarget({ ...none, picking: 'walk', paramPick: param })).toEqual({
      kind: 'param',
      param,
    })
    const armyPick = { armyId: 'a1', kind: 'armyGuard' } as const
    expect(pickTarget({ ...none, picking: 'walk', armyPick })).toEqual({
      kind: 'army',
      mode: 'armyGuard',
    })
  })

  it('waits for a place of a step planned with Add step, for a resident or a group', () => {
    const plan: Plan = { kind: 'work', picked: [] }
    const target = { kind: 'plan', prompt: 'the workplace to work' }
    expect(pickTarget({ ...none, plan })).toEqual(target)
    expect(pickTarget({ ...none, plan, groupPicking: 'walk', isGroup: true })).toEqual(target)
    // Once its places are picked, the card asks for the rest.
    const picked: Plan = { kind: 'work', picked: [{ x: 1, y: 1, id: 'f1' }] }
    expect(pickTarget({ ...none, plan: picked, isGroup: true })).toBeUndefined()
  })
})

describe('pickPrompt', () => {
  it('says click with a mouse and tap on a touch screen', () => {
    const walk = { kind: 'resident', mode: 'walk' } as const
    expect(pickPrompt(walk, false)).toBe('Click where to walk')
    expect(pickPrompt(walk, true)).toBe('Tap where to walk')
  })

  it('names the param a script waits for', () => {
    const target = { kind: 'param', param: { name: 'home', type: 'storage' } } as const
    expect(pickPrompt(target, false)).toBe('Click the storage, stable or carriage for home')
  })

  it('asks for a Build line’s start, then its end', () => {
    expect(pickPrompt({ kind: 'resident', mode: 'wallFrom' }, true)).toBe(
      'Tap where the wall starts',
    )
    expect(pickPrompt({ kind: 'resident', mode: 'wallTo' }, true)).toBe('Tap where the wall ends')
  })

  it('says what a group or army order waits for', () => {
    expect(pickPrompt({ kind: 'group', mode: 'work' }, true)).toBe('Tap the workplace they work')
    expect(pickPrompt({ kind: 'army', mode: 'armyWalkTo' }, false)).toBe(
      'Click where the army marches',
    )
  })
})
