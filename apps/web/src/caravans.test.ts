import { describe, expect, it } from 'vitest'
import type { Carriage, Resident, SeenCaravan } from '@csp/shared'
import { caravanAt, caravanParts } from './caravans.js'

const caravan: SeenCaravan = {
  id: 'caravan9',
  postId: 'city2',
  carriageId: 'carriage3',
  driverId: 'r4',
  escortIds: ['r5', 'r6'],
  heading: 'post',
}

describe('caravans on the map', () => {
  it('knows the carriages and crew of the caravans in sight', () => {
    const parts = caravanParts([caravan])
    expect([...parts.carriages]).toEqual(['carriage3'])
    expect([...parts.crew]).toEqual(['r4', 'r5', 'r6'])
  })

  it('finds a caravan on a tile through its carriage or its crew', () => {
    const parts = caravanParts([caravan])
    const world = {
      carriages: [
        { id: 'carriage3', x: 5, y: 5 } as Carriage,
        { id: 'carriage7', x: 1, y: 1 } as Carriage,
      ],
      residents: [{ id: 'r6', x: 8, y: 2 } as Resident, { id: 'r1', x: 3, y: 3 } as Resident],
    }
    expect(caravanAt(parts, world, 5, 5)).toBe(true)
    expect(caravanAt(parts, world, 8, 2)).toBe(true)
    expect(caravanAt(parts, world, 1, 1)).toBe(false)
    expect(caravanAt(parts, world, 3, 3)).toBe(false)
  })
})
