import { describe, expect, it } from 'vitest'
import { PLAN_STEPS } from './plan-step.js'
import { FLOW_STEPS, followInsert, PALETTE_GROUPS, PLAN_STEP_ICONS } from './step-palette-view.js'

/** The Add step palette (`CONTEXT.md`: Planner blocks). */

describe('the palette groups', () => {
  it('puts every kind of step in exactly one group, each with an icon', () => {
    for (const k of PLAN_STEPS) {
      const groups = PALETTE_GROUPS.filter((g) => g.steps.includes(k.id))
      if (FLOW_STEPS.includes(k.id)) {
        expect(groups, k.id).toEqual([])
        expect(PLAN_STEP_ICONS[k.id], k.id).toBeTruthy()
        continue
      }
      expect(
        groups.map((g) => g.id),
        k.id,
      ).toHaveLength(1)
      expect(PLAN_STEP_ICONS[k.id], k.id).toBeTruthy()
    }
    const listed = PALETTE_GROUPS.flatMap((g) => g.steps)
    expect(listed).toHaveLength(PLAN_STEPS.length - FLOW_STEPS.length)
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

describe('rallying the crew (ADR 0042)', () => {
  it('is no step of the queue planner: it is given by hand only', () => {
    expect(PLAN_STEPS.some((k) => (k.id as string) === 'rally')).toBe(false)
    expect(PALETTE_GROUPS.flatMap((g) => g.steps as readonly string[])).not.toContain('rally')
  })
})

describe('the palette read from the steps and their orders (T121.8)', () => {
  it('lists the same steps in the same groups and order as the hand-written lists did', () => {
    expect(Object.fromEntries(PALETTE_GROUPS.map((g) => [g.id, g.steps]))).toEqual({
      move: [
        'walk',
        'explore',
        'relocate',
        'mount',
        'dismount',
        'drive',
        'board',
        'boardBoat',
        'boardCrew',
        'row',
        'sail',
        'getOff',
        'hitch',
        'unhitch',
        'haul',
        'haulBoat',
      ],
      work: [
        'work',
        'gather',
        'build',
        'road',
        'wall',
        'tearDown',
        'feedStable',
        'feedStableOnce',
        'breed',
        'teach',
        'train',
      ],
      goods: ['store', 'fetch', 'pickUp', 'drop', 'feed', 'equip', 'takeOff'],
      scripts: ['runScript'],
    })
    expect(FLOW_STEPS).toEqual(['waitUntil', 'if'])
  })
})
