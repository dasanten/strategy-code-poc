import { describe, expect, it } from 'vitest'
import { SHIP_MIN_CREW } from '@csp/balance'
import { besideVessel, boardBoatProblem, crewShort, rowOffProblem } from './vessels.js'

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

// Docking and crew (`CONTEXT.md`: Docked, Crew), as the crates' `queries/vessels.rs` say them.
describe('a ship docked at a haven', () => {
  // Haven h1 covers (6, 9)–(8, 11); ship s1 lies at (9, 10), touching it.
  const havens = [{ id: 'h1', kind: 'haven' as const, x: 6, y: 9 }]
  const s1 = {
    id: 's1',
    kind: 'ship' as const,
    x: 9,
    y: 10,
    dockedAt: 'h1',
    load: {},
    passengerIds: [] as string[],
  }

  it('has those on its haven beside it, and nobody else', () => {
    expect(besideVessel(s1, { x: 6, y: 9 }, 100, havens)).toBe(true)
    expect(besideVessel(s1, { x: 9, y: 9 }, 100, havens)).toBe(false)
    // At sea nothing is beside it.
    expect(besideVessel({ ...s1, dockedAt: undefined }, { x: 8, y: 10 }, 100, havens)).toBe(false)
  })

  it('takes crew and passengers from its haven, only grown crew, a boat no crew', () => {
    const r = { x: 6, y: 9 }
    const opts = { buildings: havens, size: 100 }
    expect(boardBoatProblem(r, s1, opts)).toBeUndefined()
    expect(boardBoatProblem(r, s1, { ...opts, asCrew: true })).toBeUndefined()
    expect(boardBoatProblem(r, s1, { ...opts, asCrew: true, child: true })).toBe(
      'children can’t crew a ship',
    )
    expect(boardBoatProblem({ x: 9, y: 9 }, s1, opts)).toBe(
      'not at the haven the ship is docked at',
    )
    expect(boardBoatProblem(r, { ...s1, dockedAt: undefined }, opts)).toBe(
      'the ship is not docked at a haven',
    )
    const boat = { ...s1, kind: 'boat' as const, x: 7, y: 9 }
    expect(boardBoatProblem({ x: 6, y: 9 }, boat, { asCrew: true })).toBe(
      'only a ship takes a crew',
    )
  })

  it('sails with at least the minimum crew', () => {
    expect(crewShort({ kind: 'ship', crewIds: [] })).toBe(SHIP_MIN_CREW)
    expect(crewShort({ kind: 'ship', crewIds: ['a'] })).toBe(SHIP_MIN_CREW - 1)
    expect(crewShort({ kind: 'boat', crewIds: [] })).toBe(0)
  })
})
