import { DEFAULT_SCRIPTS, type Building } from '@csp/shared'
import { scriptParams } from '@csp/lang'
import { describe, expect, it } from 'vitest'
import {
  effectiveParam,
  paramNote,
  paramOnTile,
  paramPickAt,
  paramValueLabel,
  type ParamWorld,
} from './script-params-view.js'

/**
 * Realm r1's city c1 with a storage, a farm, a site and a carriage; r2's storage beside. Out of
 * sight, r2's mine and storage as last seen.
 */
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
    lastSeen: [b('mine', 'mine', 50, 'c2'), b('far', 'storage', 56, 'c2')],
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
      'pick a building of yours, or a workplace or construction site',
    )
  })

  it('picks a workplace of anyone’s for a building param, as last seen too', () => {
    expect(paramPickAt(world(), 'building', { x: 50, y: 5 })).toEqual({ id: 'mine' })
    expect(paramPickAt(world(), 'building', { x: 56, y: 5 })).toBe(
      'pick a building of yours, or a workplace or construction site',
    )
    expect(paramPickAt(world(), 'storage', { x: 56, y: 5 })).toBe(
      'pick a storage, a stable or a carriage of yours',
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

  it('names what is picked, as last seen out of sight, or nothing once forgotten', () => {
    expect(paramValueLabel(world(), 's1')).toBe('Storage at 2, 5')
    expect(paramValueLabel(world(), 'new')).toBe('Site: Storage at 20, 5')
    expect(paramValueLabel(world(), 'k1')).toBe('Carriage at 40, 5')
    expect(paramValueLabel(world(), 'mine')).toBe('Mine at 50, 5 (last seen)')
    expect(paramValueLabel(world(), 'gone')).toBeNull()
  })
})

describe('a param field’s effective value', () => {
  const label = (id: string) => (id === 'farm' ? 'Farm at 10, 5' : null)
  const work = scriptParams(DEFAULT_SCRIPTS.work.source)
  const param = (name: string) => work.find((p) => p.name === name)!

  it('reads what a param is for and what it is unset from its comment', () => {
    expect(paramNote('the workplace to work; none: the one I stand on')).toEqual({
      purpose: 'the workplace to work',
      unset: 'the one I stand on',
    })
    expect(paramNote("Food the pile keeps for the crew's meals; 0 none")).toEqual({
      purpose: "Food the pile keeps for the crew's meals; 0 none",
    })
    expect(paramNote(undefined)).toEqual({})
  })

  it('names the one picked', () => {
    expect(effectiveParam(param('workplace'), 'farm', { label, target: 'workplace' })).toEqual({
      text: 'Farm at 10, 5',
      set: true,
    })
    expect(effectiveParam(param('storage'), 'gone', { label })).toEqual({
      text: 'out of sight',
      set: true,
    })
    expect(effectiveParam(param('foodAt'), 0, { label })).toEqual({ text: '0', set: true })
  })

  it('says what an unset param uses: the target on their tile, else its comment', () => {
    const at = { label, target: 'workplace' }
    expect(
      effectiveParam(param('workplace'), undefined, { ...at, onTile: 'Farm at 10, 5' }),
    ).toEqual({ text: 'Farm at 10, 5, on their tile', set: false })
    expect(effectiveParam(param('workplace'), undefined, { ...at, onTile: null }).text).toBe(
      'none on their tile',
    )
    expect(effectiveParam(param('storage'), undefined, at)).toEqual({
      text: 'the nearest storage of my realm',
      set: false,
    })
    expect(effectiveParam({ name: 'home', type: 'building' }, undefined, at).text).toBe(
      'none picked',
    )
  })

  it('says a number param’s default while unset', () => {
    expect(effectiveParam(param('foodAt'), undefined, { label }).text).toMatch(/^\d+, the default$/)
    expect(effectiveParam({ name: 'n', type: 'number' }, undefined, { label }).text).toBe(
      'none picked',
    )
  })
})

describe('what a param would be on a tile', () => {
  it('names what fits there, nothing where nothing does', () => {
    expect(paramOnTile(world(), 'building', { x: 10, y: 5 })).toBe('Farm at 10, 5')
    expect(paramOnTile(world(), 'storage', { x: 10, y: 5 })).toBeNull()
  })
})
