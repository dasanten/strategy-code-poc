import { describe, expect, it } from 'vitest'
import { rowOffProblem } from './vessels.js'

// Stealing a boat by rowing it off (`CONTEXT.md`: Stealing a carriage or horse, its vessel part),
// as the crates' `row_off_problem` says it.
describe('rowOffProblem', () => {
  const grown = { bornAt: -1e9, order: null, cityId: null, carried: {} }
  const thief = { ...grown, id: 't1', owner: 'r2', x: 1, y: 3 }
  const boat = { id: 'boat1', x: 2, y: 4, realmId: 'r1', passengerIds: [] as string[] }
  const world = (...others: (typeof thief)[]) => ({ tick: 0, residents: [thief, ...others] })

  it('lets a grown resident beside a rival’s empty, unguarded boat take it', () => {
    expect(rowOffProblem(world(), thief, boat, 'r2')).toBeUndefined()
  })

  it('refuses while someone rows it or is aboard', () => {
    expect(rowOffProblem(world(), thief, { ...boat, rowerId: 'w1' }, 'r2')).toBe(
      'someone is rowing that boat',
    )
    expect(rowOffProblem(world(), thief, { ...boat, passengerIds: ['p1'] }, 'r2')).toBe(
      'someone is aboard that boat',
    )
  })

  it('refuses while an armed resident of its owner is beside it and none of the thief’s realm', () => {
    const guard = { ...grown, id: 'w1', owner: 'r1', x: 1, y: 4, carried: { spear: 1 } }
    expect(rowOffProblem(world(guard), thief, boat, 'r2')).toBe(
      'an armed resident guards that boat',
    )
    const armedThief = { ...thief, carried: { sword: 1 } }
    const withArmedThief = { tick: 0, residents: [armedThief, guard] }
    expect(rowOffProblem(withArmedThief, armedThief, boat, 'r2')).toBeUndefined()
    const away = { ...guard, x: 0 }
    expect(rowOffProblem(world(away), thief, boat, 'r2')).toBeUndefined()
  })

  it('needs them grown and beside it', () => {
    expect(rowOffProblem(world(), { ...thief, bornAt: 0 }, boat, 'r2')).toBe('children can’t steal')
    expect(rowOffProblem(world(), { ...thief, x: 0 }, boat, 'r2')).toBe(
      'that boat is not beside the resident',
    )
  })
})
