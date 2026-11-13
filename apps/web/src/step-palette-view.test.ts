import { describe, expect, it } from 'vitest'
import { PLAN_STEPS } from './plan-step.js'
import { followInsert, insertPoints, PALETTE_GROUPS, PLAN_STEP_ICONS } from './step-palette-view.js'

/** The Add step palette (`CONTEXT.md`: Planner blocks). */

describe('the palette groups', () => {
  it('puts every kind of step in exactly one group, each with an icon', () => {
    for (const k of PLAN_STEPS) {
      const groups = PALETTE_GROUPS.filter((g) => g.steps.includes(k.id))
      expect(
        groups.map((g) => g.id),
        k.id,
      ).toHaveLength(1)
      expect(PLAN_STEP_ICONS[k.id], k.id).toBeTruthy()
    }
    const listed = PALETTE_GROUPS.flatMap((g) => g.steps)
    expect(listed).toHaveLength(PLAN_STEPS.length)
  })

  it('groups as the Orders tab does', () => {
    expect(PALETTE_GROUPS.map((g) => g.label)).toEqual(['Move', 'Work & build', 'Goods', 'Scripts'])
    const groupOf = (id: string) => PALETTE_GROUPS.find((g) => g.steps.some((s) => s === id))?.id
    expect(groupOf('explore')).toBe('move')
    expect(groupOf('haul')).toBe('move')
    expect(groupOf('fetch')).toBe('goods')
    expect(groupOf('build')).toBe('work')
    expect(groupOf('runScript')).toBe('scripts')
  })
})

describe('the insert point', () => {
  const step = (id: number) => ({ id, kind: 'step' as const })
  const block = (id: number) => ({ id, kind: 'block' as const })

  it('sits between two steps, never after the last row or a block’s head', () => {
    expect(insertPoints([step(1), step(2), step(3)])).toEqual([1, 2])
    expect(insertPoints([step(1), block(4), step(2), step(3)])).toEqual([1, 2])
    expect(insertPoints([step(1)])).toEqual([])
  })

  it('moves after the step just added there, so the next one follows it', () => {
    // Fetch (id 7) added between 1 and 2, after its walk (id 6).
    expect(followInsert([1, 2, 3], [1, 6, 7, 2, 3], 1)).toBe(7)
  })

  it('stays where it was when nothing went in there, and goes with its row', () => {
    expect(followInsert([1, 2, 3], [1, 2, 3, 8], 1)).toBe(1)
    expect(followInsert([1, 2, 3], [2, 3], 1)).toBeUndefined()
    expect(followInsert([1, 2], [1, 2], undefined)).toBeUndefined()
    // Once it would be after the last step, new steps go at the end anyway.
    expect(followInsert([1, 2], [1, 2], 2)).toBeUndefined()
  })
})
