import { describe, expect, it } from 'vitest'
import { groupHorses } from './horses-view.js'

const h = (id: string, x: number, y: number) => ({ id, x, y })
// Stables are 2 by 2 (`FOOTPRINT`); the one at 10, 10 covers 10–11.
const stable = (id: string, x: number, y: number, cityId: string | null = 'c1') => ({
  id,
  kind: 'stable' as const,
  x,
  y,
  cityId,
})
const cities = [
  { id: 'c1', name: 'Oakford' },
  { id: 'c2', name: 'Ashby' },
]
const ann = { id: 'ann', name: 'Ann', riding: undefined, order: null }

describe('groupHorses', () => {
  it('puts a horse on a stable’s footprint under that stable, anywhere on it', () => {
    const groups = groupHorses(
      [h('a', 10, 10), h('b', 11, 11)],
      [stable('s', 10, 10)],
      [],
      [],
      cities,
    )
    expect(groups).toEqual([
      {
        key: 's',
        label: 'Stable, Oakford',
        rows: [
          { horse: h('a', 10, 10), place: 'In the stable' },
          { horse: h('b', 11, 11), place: 'In the stable' },
        ],
      },
    ])
  })

  it('says the carriage a hitched horse pulls and who drives it', () => {
    const driving = { ...ann, order: { kind: 'drive', carriageId: 'k1' } as never }
    const [hitched] = groupHorses(
      [h('a', 3, 3), h('b', 4, 4)],
      [],
      [
        { id: 'k1', horseId: 'a' },
        { id: 'k2', horseId: 'b' },
      ],
      [driving],
    )
    expect(hitched).toEqual({
      key: 'hitched',
      label: 'Hitched',
      rows: [
        { horse: h('a', 3, 3), place: 'Pulling the carriage Ann drives' },
        { horse: h('b', 4, 4), place: 'Hitched to a carriage nobody drives' },
      ],
    })
  })

  it('says who rides a ridden horse, and leaves the rest loose', () => {
    const groups = groupHorses(
      [h('a', 3.5, 3.2), h('b', 7, 8)],
      [],
      [],
      [{ ...ann, riding: 'a' }],
    )
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.place)])).toEqual([
      ['ridden', ['Ridden by Ann']],
      ['loose', ['Loose at 7, 8']],
    ])
  })

  it('keeps a hitched or ridden horse in its stable, saying so', () => {
    const groups = groupHorses(
      [h('a', 10, 10)],
      [stable('s', 10, 10)],
      [{ id: 'k1', horseId: 'a' }],
      [],
      cities,
    )
    expect(groups.map((g) => [g.key, g.rows[0]!.place])).toEqual([
      ['s', 'In the stable · Hitched to a carriage nobody drives'],
    ])
  })

  it('orders stables by name, then Hitched, Ridden, Loose, leaving empty groups out', () => {
    const groups = groupHorses(
      [h('loose', 50, 50), h('o2', 30, 30), h('o1', 20, 20), h('ash', 40, 40), h('hit', 60, 60)],
      [stable('o1', 20, 20), stable('o2', 30, 30), stable('ash', 40, 40, 'c2'), stable('empty', 0, 0, 'c2')],
      [{ id: 'k', horseId: 'hit' }],
      [],
      cities,
    )
    expect(groups.map((g) => g.label)).toEqual([
      'Stable, Ashby (40, 40)',
      'Stable, Oakford (20, 20)',
      'Stable, Oakford (30, 30)',
      'Hitched',
      'Loose',
    ])
  })

  it('keeps the order horses came in within a group', () => {
    const [loose] = groupHorses([h('c', 1, 1), h('a', 2, 2), h('b', 3, 3)], [], [], [])
    expect(loose!.rows.map((r) => r.horse.id)).toEqual(['c', 'a', 'b'])
  })

  it('is empty without horses', () => {
    expect(groupHorses([], [stable('s', 0, 0)], [], [], cities)).toEqual([])
  })
})
