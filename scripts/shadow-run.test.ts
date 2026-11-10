import { describe, expect, it } from 'vitest'
import { differences, genericPath } from './shadow-run.mjs'

describe('shadow-run differences', () => {
  it('finds none between equal worlds, whatever the key order or 5 against 5.0', () => {
    expect(differences({ a: 5, b: [1, { c: 'x' }] }, { b: [1.0, { c: 'x' }], a: 5.0 })).toEqual([])
  })

  it('names the path, with the id of an array element beside its index', () => {
    const ts = {
      tick: 3,
      residents: [
        { id: 'r1', x: 1 },
        { id: 'r2', x: 2 },
      ],
    }
    const rust = {
      tick: 3,
      residents: [
        { id: 'r1', x: 1 },
        { id: 'r2', x: 3 },
      ],
    }
    expect(differences(ts, rust)).toEqual([{ path: 'world.residents[1]{r2}.x', ts: 2, rust: 3 }])
  })

  it('tells a missing field and an array of another length', () => {
    expect(differences({ a: 1, list: [1, 2] }, { b: null, list: [1] })).toEqual([
      { path: 'world.a', ts: 1, rust: '(missing)' },
      { path: 'world.list.length', ts: 2, rust: 1 },
      { path: 'world.b', ts: '(missing)', rust: null },
    ])
  })

  it('skips the paths allowed to differ, matched with indices as []', () => {
    expect(genericPath('world.residents[4]{r9}.memory[2].at')).toBe('world.residents[].memory[].at')
    const ts = { residents: [{ id: 'r1', took: 1, x: 1 }] }
    const rust = { residents: [{ id: 'r1', took: 2, x: 1 }] }
    expect(differences(ts, rust, 'world', [/^world\.residents\[\]\.took$/])).toEqual([])
  })

  it('stops at the limit', () => {
    expect(differences([1, 2, 3], [4, 5, 6], 'world', [], 2)).toHaveLength(2)
  })
})
