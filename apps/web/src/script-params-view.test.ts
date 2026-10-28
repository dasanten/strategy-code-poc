import type { Building } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { paramPickAt, paramValueLabel, type ParamWorld } from './script-params-view.js'

/** Realm r1's city c1 with a storage, a farm, a site and a carriage; r2's storage beside. */
function world(): ParamWorld {
  const b = (id: string, kind: Building['kind'], x: number, cityId = 'c1', site = false) =>
    ({
      id,
      kind,
      cityId,
      x,
      y: 5,
      ...(site ? { site: { delivered: {}, work: 0 } } : {}),
    }) as Building
  return {
    buildings: [
      b('s1', 'storage', 2),
      b('farm', 'farm', 10),
      b('new', 'storage', 20, 'c1', true),
      b('theirs', 'storage', 30, 'c2'),
    ],
    carriages: [{ id: 'k1', realmId: 'r1', x: 40, y: 5 }],
    cities: [
      { id: 'c1', realmId: 'r1' },
      { id: 'c2', realmId: 'r2' },
    ],
    realmId: 'r1',
    size: 64,
  }
}

describe('picking a script param on the map', () => {
  it('picks a building of the realm for a building param, a site too', () => {
    expect(paramPickAt(world(), 'building', { x: 10, y: 5 })).toEqual({ id: 'farm' })
    expect(paramPickAt(world(), 'building', { x: 20, y: 5 })).toEqual({ id: 'new' })
    expect(paramPickAt(world(), 'building', { x: 30, y: 5 })).toBe(
      'pick a building or construction site of yours',
    )
  })

  it('picks a finished storage or a carriage of the realm for a storage param', () => {
    expect(paramPickAt(world(), 'storage', { x: 2, y: 5 })).toEqual({ id: 's1' })
    expect(paramPickAt(world(), 'storage', { x: 40, y: 5 })).toEqual({ id: 'k1' })
    for (const x of [10, 20, 30, 50]) {
      expect(paramPickAt(world(), 'storage', { x, y: 5 })).toBe(
        'pick a storage, a stable or a carriage of yours',
      )
    }
  })

  it('names what is picked, or nothing once out of sight', () => {
    expect(paramValueLabel(world(), 's1')).toBe('Storage at 2, 5')
    expect(paramValueLabel(world(), 'new')).toBe('Site: Storage at 20, 5')
    expect(paramValueLabel(world(), 'k1')).toBe('Carriage at 40, 5')
    expect(paramValueLabel(world(), 'gone')).toBeNull()
  })
})
