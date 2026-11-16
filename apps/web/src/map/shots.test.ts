import { describe, expect, it } from 'vitest'
import { SHOT_REACH } from '@csp/balance'
import { shots } from './shots.js'

const reach = (SHOT_REACH as Record<string, number>).bow!

function archer(x: number, carried: Record<string, number> = {}) {
  return {
    id: 'a',
    x,
    y: 0,
    order: { kind: 'attack', targetId: 'b', path: null, progress: 0, strike: 0, started: true },
    equipped: { weapon: 'bow' },
    carried,
  } as never
}
const target = { id: 'b', x: 0, y: 0, order: null, carried: {} } as never

describe('shots', () => {
  it('draws an archer shooting at a target within reach, not in contact nor beyond', () => {
    expect(shots([archer(reach), target], 256)).toEqual([{ from: 'a', to: 'b' }])
    expect(shots([archer(1), target], 256)).toEqual([])
    expect(shots([archer(reach + 1), target], 256)).toEqual([])
  })

  it('draws none for one of yours out of Arrows, and one for another realm whose Arrows are hidden', () => {
    expect(shots([archer(3, { bow: 1 }), target], 256)).toEqual([])
    expect(shots([archer(3, { bow: 1, arrows: 4 }), target], 256)).toHaveLength(1)
    expect(shots([archer(3), target], 256)).toHaveLength(1)
  })

  it('draws none for a fighter without a Bow or Crossbow, nor for a target out of sight', () => {
    const spear = { ...(archer(3) as object), equipped: { weapon: 'spear' } } as never
    expect(shots([spear, target], 256)).toEqual([])
    expect(shots([archer(3)], 256)).toEqual([])
  })

  it('measures the short way round the map', () => {
    expect(shots([archer(255), target], 256)).toEqual([])
    expect(shots([archer(256 - 3), target], 256)).toHaveLength(1)
  })
})
