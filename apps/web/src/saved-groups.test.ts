import { describe, expect, it } from 'vitest'
import { ACTION_KEYS } from './selection-view.js'
import {
  DOUBLE_PRESS_MS,
  groupKey,
  groupsKey,
  isDoublePress,
  loadGroups,
  parseGroups,
  recallGroup,
  saveGroup,
  storeGroups,
} from './saved-groups.js'

const press = (
  code: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
) => groupKey({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

describe('saved groups', () => {
  it('reads Ctrl+1–9 as saving and 1–9 as picking again, on the top row or the keypad', () => {
    expect(press('Digit1', { ctrlKey: true })).toEqual({ save: true, slot: 1 })
    expect(press('Digit9')).toEqual({ save: false, slot: 9 })
    expect(press('Numpad4')).toEqual({ save: false, slot: 4 })
    expect(press('Digit0')).toBeUndefined()
    expect(press('KeyW')).toBeUndefined()
    expect(press('Digit1', { metaKey: true })).toBeUndefined()
    expect(press('Digit1', { altKey: true })).toBeUndefined()
    expect(press('Digit1', { shiftKey: true })).toBeUndefined()
  })

  it("doesn't take a key the card's actions use", () => {
    for (const key of Object.values(ACTION_KEYS)) expect(key).not.toMatch(/^[0-9]$/)
  })

  it('saves the picked residents under a number and picks them again', () => {
    const groups = saveGroup({}, 1, ['a', 'b', 'a'])
    expect(groups).toEqual({ 1: ['a', 'b'] })
    const again = recallGroup(groups, 1, new Set(['a', 'b', 'c']))
    expect(again.ids).toEqual(['a', 'b'])
    expect(again.groups).toBe(groups)
    expect(recallGroup(groups, 2, new Set(['a'])).ids).toBeUndefined()
  })

  it('saving over a number replaces its group, and saving nobody forgets it', () => {
    const groups = saveGroup(saveGroup({}, 3, ['a']), 3, ['b'])
    expect(groups).toEqual({ 3: ['b'] })
    expect(saveGroup(groups, 3, [])).toEqual({})
  })

  it('drops residents who are dead or no longer the Player’s when the group is picked again', () => {
    const groups = saveGroup({}, 2, ['a', 'b', 'c'])
    const again = recallGroup(groups, 2, new Set(['b']))
    expect(again.ids).toEqual(['b'])
    expect(again.groups).toEqual({ 2: ['b'] })
    const gone = recallGroup(again.groups, 2, new Set())
    expect(gone.ids).toEqual([])
    expect(gone.groups).toEqual({})
  })

  it('counts a second press of the same number soon after as a double press', () => {
    expect(isDoublePress(undefined, 1, 100)).toBe(false)
    expect(isDoublePress({ slot: 1, at: 100 }, 1, 100 + DOUBLE_PRESS_MS)).toBe(true)
    expect(isDoublePress({ slot: 1, at: 100 }, 1, 101 + DOUBLE_PRESS_MS)).toBe(false)
    expect(isDoublePress({ slot: 2, at: 100 }, 1, 200)).toBe(false)
  })

  it('keeps them per realm in browser storage', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    storeGroups(storage, 'r1', { 1: ['a'], 5: ['b', 'c'] })
    expect(loadGroups(storage, 'r1')).toEqual({ 1: ['a'], 5: ['b', 'c'] })
    expect(loadGroups(storage, 'r2')).toEqual({})
    expect(store.has(groupsKey('r1'))).toBe(true)
  })

  it('starts empty when storage is missing, refuses, or holds something else', () => {
    expect(loadGroups(undefined, 'r')).toEqual({})
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadGroups(throwing, 'r')).toEqual({})
    expect(() => storeGroups(throwing, 'r', { 1: ['a'] })).not.toThrow()
    expect(parseGroups('not json')).toEqual({})
    expect(parseGroups('[1,2]')).toEqual({})
    expect(parseGroups('{"1":["a",2],"0":["x"],"4":"b","7":[]}')).toEqual({ 1: ['a'] })
  })
})
