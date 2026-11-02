import { TICKS_PER_GAME_YEAR, ticksForAge } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { labelled, nameLabels } from './name-labels.js'

const tick = 40 * TICKS_PER_GAME_YEAR
const resident = (id: string, name: string, age: number, cityId: string | null = 'c1') => ({
  id,
  name,
  bornAt: tick - ticksForAge(age),
  cityId,
})
const cities = [
  { id: 'c1', name: 'Ashford' },
  { id: 'c2', name: 'Coldwater' },
]

describe('nameLabels (`CONTEXT.md`: Game-given names)', () => {
  it('leaves a name of its own alone and tells two of one name apart by age', () => {
    const labels = nameLabels(
      [resident('a', 'Edda', 24), resident('b', 'Edda', 31), resident('c', 'Bram', 20)],
      tick,
      cities,
    )
    expect([...labels.values()]).toEqual(['Edda (24)', 'Edda (31)', 'Bram'])
  })

  it('adds the city when those of one name live in more than one', () => {
    const labels = nameLabels(
      [resident('a', 'Edda', 24), resident('b', 'Edda', 24, 'c2'), resident('c', 'Edda', 5, null)],
      tick,
      cities,
    )
    expect([...labels.values()]).toEqual([
      'Edda (24, Ashford)',
      'Edda (24, Coldwater)',
      'Edda (5, homeless)',
    ])
  })

  it('gives copies with those names, keeping the ones of a name of their own as they are', () => {
    const bram = resident('c', 'Bram', 20)
    const list = labelled([resident('a', 'Edda', 24), resident('b', 'Edda', 31), bram], tick)
    expect(list.map((r) => r.name)).toEqual(['Edda (24)', 'Edda (31)', 'Bram'])
    expect(list[2]).toBe(bram)
  })
})
