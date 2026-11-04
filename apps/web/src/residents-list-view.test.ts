import { MAX_HEALTH, MAX_HUNGER, statValue, ticksForAge, type Resident } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { listedResidents, residentRow, rowWindow, scrollToRow } from './residents-list-view.js'

const stat = (base: number) => ({ base, trained: 0 })
const edda = (over: Partial<Resident> = {}) =>
  ({
    id: 'edda',
    name: 'Edda',
    bornAt: 0,
    lifespan: 80,
    stats: {
      strength: stat(5),
      endurance: stat(5),
      agility: stat(5),
      intellect: stat(5),
    },
    skills: {},
    carried: {},
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    order: null,
    ...over,
  }) as Resident
const options = { city: 'Oakford', leaderId: 'lead', tick: ticksForAge(30), doing: 'Idle' }

describe('the residents of the full list', () => {
  it('lists the groups in order, each resident with their group as their city', () => {
    const listed = listedResidents([
      { key: 'c1', label: 'Oakford', residents: ['a', 'b'] },
      { key: 'hired', label: 'Hired', residents: ['c'] },
    ])
    expect(listed).toEqual([
      { resident: 'a', city: 'Oakford', group: 'c1' },
      { resident: 'b', city: 'Oakford', group: 'c1' },
      { resident: 'c', city: 'Hired', group: 'hired' },
    ])
  })
})

describe('a row of the full list', () => {
  it('says who they are: name, Leader mark, whole years and city', () => {
    const row = residentRow(edda(), { ...options, tick: ticksForAge(30.9), leaderId: 'edda' })
    expect(row).toMatchObject({
      id: 'edda',
      name: 'Edda',
      leader: true,
      age: 30,
      city: 'Oakford',
    })
    expect(residentRow(edda(), options).leader).toBe(false)
  })

  it('shows stats as they count now, trained bonus and old age included', () => {
    const stats = {
      strength: { base: 6, trained: 2 },
      endurance: { base: 5, trained: 0 },
      agility: { base: 4, trained: 0 },
      intellect: { base: 3, trained: 0 },
    }
    expect(residentRow(edda({ stats }), options).stats.strength).toBe(8)
    const old = edda({ stats })
    const tick = ticksForAge(70)
    expect(statValue(old, 'strength', tick)).toBeLessThan(8)
    expect(residentRow(old, { ...options, tick }).stats.strength).toBe(
      Math.round(statValue(old, 'strength', tick) * 10) / 10,
    )
  })

  it('lists skills the best first, cut to one decimal, without the ones not learned', () => {
    const row = residentRow(
      edda({ skills: { mining: 1, combat: 3.29, farming: 0, driving: 0.04 } }),
      options,
    )
    expect(row.skills).toBe('Combat 3.2, Mining 1')
    expect(residentRow(edda({ skills: {} }), options).skills).toBe('')
  })

  it('shows the best weapon and all protection as gear', () => {
    const row = residentRow(
      edda({ carried: { spear: 2, sword: 1, armour: 1, shield: 1 } }),
      options,
    )
    expect(row.gear).toBe('Sword, Shield, Armour')
    expect(residentRow(edda({ carried: { shield: 1 } }), options).gear).toBe('Shield')
    expect(residentRow(edda({ carried: { wood: 3 } }), options).gear).toBe('')
  })

  it('says what they carry, the most first, and how heavy it is', () => {
    const row = residentRow(edda({ carried: { food: 2, wood: 4, sword: 1 } }), options)
    expect(row.carrying).toBe('4 Wood, 2 Food, 1 Sword')
    expect(row.weight).toMatch(/ \/ .* kg$/)
    expect(residentRow(edda({ carried: {} }), options).carrying).toBe('')
  })

  it('keeps hunger and health between empty and full', () => {
    const row = residentRow(edda({ hunger: MAX_HUNGER / 4, health: MAX_HEALTH / 2 }), options)
    expect(row.fed).toBe(0.25)
    expect(row.health).toBe(0.5)
    const off = residentRow(edda({ hunger: -1, health: MAX_HEALTH * 2 }), options)
    expect(off.fed).toBe(0)
    expect(off.health).toBe(1)
  })

  it('takes over what they are doing, and the line under it only when there is one', () => {
    const row = residentRow(edda(), { ...options, doing: 'Walking', under: 'Running Gather' })
    expect(row.doing).toBe('Walking')
    expect(row.under).toBe('Running Gather')
    expect(residentRow(edda(), options)).not.toHaveProperty('under')
  })
})

describe('the rows drawn of a long list', () => {
  const list = { count: 1000, rowHeight: 10, viewport: 100, overscan: 5 }

  it('draws the rows in view and the overscan below them at the top', () => {
    expect(rowWindow({ ...list, scrollTop: 0 })).toEqual({
      first: 0,
      end: 16,
      before: 0,
      after: 9840,
    })
  })

  it('draws the overscan on both sides further down, the spaces keeping the height', () => {
    const w = rowWindow({ ...list, scrollTop: 2003 })
    expect(w).toEqual({ first: 195, end: 216, before: 1950, after: 7840 })
    expect(w.before + (w.end - w.first) * 10 + w.after).toBe(10000)
  })

  it('draws a few of hundreds, however far it is scrolled', () => {
    for (const scrollTop of [0, 500, 5000, 9900]) {
      const w = rowWindow({ ...list, scrollTop })
      expect(w.end - w.first).toBeLessThanOrEqual(21)
    }
  })

  it('draws the last rows of a list that got shorter while scrolled far down', () => {
    expect(rowWindow({ ...list, count: 20, scrollTop: 9000 })).toEqual({
      first: 4,
      end: 20,
      before: 40,
      after: 0,
    })
  })

  it('draws everything of a short list and nothing of an empty one', () => {
    expect(rowWindow({ ...list, count: 3, scrollTop: 0 })).toEqual({
      first: 0,
      end: 3,
      before: 0,
      after: 0,
    })
    expect(rowWindow({ ...list, count: 0, scrollTop: 0 })).toEqual({
      first: 0,
      end: 0,
      before: 0,
      after: 0,
    })
  })
})

describe('scrolling to a row', () => {
  it('puts it in the middle of the view, never above the top of the list', () => {
    expect(scrollToRow(100, 10, 110)).toBe(950)
    expect(scrollToRow(0, 10, 110)).toBe(0)
  })
})
