import { describe, expect, it } from 'vitest'
import type { RealmEvent } from '@csp/shared'
import {
  NEW_REALM_TICKS,
  isNewRealm,
  legendOpenAtStart,
  readoutText,
  rememberLegendOpen,
} from './legend.js'

const founded = (tick: number) =>
  ({
    kind: 'founded',
    tick,
    seq: 1,
    userId: 1,
    residentId: 'l',
    name: 'Ann',
    cityId: 'c',
    city: 'Ashford',
    x: 0,
    y: 0,
  }) as RealmEvent

describe('new realm', () => {
  it('is new for NEW_REALM_TICKS after its starting city was founded', () => {
    expect(isNewRealm([founded(100)], 100)).toBe(true)
    expect(isNewRealm([founded(100)], 100 + NEW_REALM_TICKS - 1)).toBe(true)
    expect(isNewRealm([founded(100)], 100 + NEW_REALM_TICKS)).toBe(false)
    expect(isNewRealm([], 5)).toBe(false)
  })
})

describe('legend folding', () => {
  const store = (v: string | null) => () => ({ getItem: () => v })

  it('opens by itself only on a new realm', () => {
    expect(legendOpenAtStart('r1', true, store(null))).toBe(true)
    expect(legendOpenAtStart('r1', false, store(null))).toBe(false)
  })

  it('stays as the Player left it for their realm in this browser', () => {
    expect(legendOpenAtStart('r1', true, store('r1 0'))).toBe(false)
    expect(legendOpenAtStart('r1', false, store('r1 1'))).toBe(true)
    // Left for a realm that has ended: the new one opens it again.
    expect(legendOpenAtStart('r2', true, store('r1 0'))).toBe(true)
    let saved = ''
    rememberLegendOpen('r1', true, () => ({ setItem: (_k: string, v: string) => (saved = v) }))
    expect(saved).toBe('r1 1')
  })
})

describe('readout', () => {
  const hover = { x: 12, y: 7, terrain: 'Forest', holder: 'held by Oakmoor' }

  it('says the terrain, coordinates and zoom tier', () => {
    expect(readoutText(hover, 'middle', false)).toBe('Forest · 12, 7 · middle zoom')
  })

  it('adds who holds the tile while territory shows, and what stands there', () => {
    expect(readoutText({ ...hover, node: 'Stone', caravan: true }, 'far', true)).toBe(
      'Forest · 12, 7 · Stone · Trade Org caravan · held by Oakmoor · far zoom',
    )
  })

  it('says when a wandering trader stands there', () => {
    expect(readoutText({ ...hover, trader: true }, 'far', false)).toBe(
      'Forest · 12, 7 · Wandering trader · far zoom',
    )
  })

  it('says just the tier with nothing under the pointer', () => {
    expect(readoutText(null, 'close', true)).toBe('close zoom')
  })
})
