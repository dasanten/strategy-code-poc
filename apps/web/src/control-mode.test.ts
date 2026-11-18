import { describe, expect, it } from 'vitest'
import {
  controlPickAt,
  flipped,
  flipsControlMode,
  modeAfterPick,
  rememberControlMode,
  rememberedControlMode,
  type ControlMode,
} from './control-mode.js'
import { pickables, type PickWorld } from './map/selection.js'
import type { Spot } from './map/unit-tokens.js'

describe('control mode (CONTEXT.md: Control mode)', () => {
  const store = () => {
    const kept = new Map<string, string>()
    return {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    }
  }

  it('starts a fresh browser in unit control mode', () => {
    expect(rememberedControlMode(store)).toBe('unit')
  })

  it('is kept per browser', () => {
    const s = store()
    rememberControlMode('realm', () => s)
    expect(rememberedControlMode(() => s)).toBe('realm')
    rememberControlMode('unit', () => s)
    expect(rememberedControlMode(() => s)).toBe('unit')
  })

  it('starts in unit control mode when storage is off', () => {
    const off = () => {
      throw new Error('no storage')
    }
    expect(rememberedControlMode(off)).toBe('unit')
    expect(() => rememberControlMode('realm', off)).not.toThrow()
  })

  it('the switch and Tab flip it, but not Tab while typing or with a modifier', () => {
    expect(flipped('unit')).toBe('realm')
    expect(flipped('realm')).toBe('unit')
    const tab = { key: 'Tab', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
    expect(flipsControlMode({ ...tab, typing: false })).toBe(true)
    expect(flipsControlMode({ ...tab, typing: true })).toBe(false)
    expect(flipsControlMode({ ...tab, shiftKey: true, typing: false })).toBe(false)
    expect(flipsControlMode({ ...tab, ctrlKey: true, typing: false })).toBe(false)
    expect(flipsControlMode({ ...tab, key: 'a', typing: false })).toBe(false)
  })

  it('picking a resident, a group or an army some other way switches to unit control mode', () => {
    const modes: ControlMode[] = ['unit', 'realm']
    for (const mode of modes) {
      expect(modeAfterPick(mode, { residents: 1, army: false })).toBe('unit')
      expect(modeAfterPick(mode, { residents: 3, army: false })).toBe('unit')
      expect(modeAfterPick(mode, { residents: 0, army: true })).toBe('unit')
      expect(modeAfterPick(mode, { residents: 0, army: false })).toBe(mode)
    }
  })
})

describe('what a click picks in each control mode', () => {
  // A camera of 10 pixels per tile with tile (0, 0) at the screen's corner. Tile (5, 5) runs from
  // pixel 50 to 60; a house covers (5, 5) to (6, 6).
  const place = (x: number, y: number) => [x * 10, y * 10] as const
  const house = { id: 'house', kind: 'house' as const, x: 5, y: 5, cityId: null }
  const ana = { id: 'ana', owner: 'me', x: 5, y: 5 }
  const bo = { id: 'bo', owner: 'me', x: 5, y: 5 }
  const world = (more: Partial<PickWorld> = {}): PickWorld => ({
    realmId: 'me',
    size: 64,
    residents: [ana],
    buildings: [house],
    carriages: [],
    horses: [],
    ...more,
  })
  const spots = new Map<string, Spot>([['ana', { x: 55, y: 55, r: 3 }]])
  const click = (mode: ControlMode, w: PickWorld, sx: number, sy: number, drawn = spots) =>
    controlPickAt(
      mode,
      pickables(w.residents, 'me', drawn, place, 10, true),
      sx,
      sy,
      Math.floor(sx / 10),
      Math.floor(sy / 10),
      w,
    )

  it('a click on a resident in a building picks the resident in unit control mode', () => {
    expect(click('unit', world(), 55, 55)).toEqual({ kind: 'resident', id: 'ana' })
  })

  it('a click on a tile with a resident and a building picks the building in realm control mode', () => {
    expect(click('realm', world(), 55, 55)).toEqual({
      kind: 'tile',
      x: 5,
      y: 5,
      on: { kind: 'building', building: house },
    })
  })

  it('a stack of residents is never picked as a group in realm control mode', () => {
    const w = world({ buildings: [], residents: [ana, bo] })
    // Nobody drawn up close: the tile's own residents are a stack.
    expect(click('unit', w, 51, 51, new Map())).toEqual({ kind: 'group', ids: ['ana', 'bo'] })
    expect(click('realm', w, 51, 51)).toEqual({ kind: 'tile', x: 5, y: 5 })
  })

  it('a carriage or loose horse of the Player’s counts as a building in realm control mode', () => {
    const k = { id: 'k', realmId: 'me', x: 5, y: 5, horseId: null }
    expect(click('realm', world({ buildings: [], carriages: [k] }), 55, 55)).toEqual({
      kind: 'tile',
      x: 5,
      y: 5,
      on: { kind: 'carriage', id: 'k' },
    })
    const h = { id: 'h', realmId: 'me', x: 5, y: 5 }
    expect(click('realm', world({ buildings: [], horses: [h] }), 55, 55)).toEqual({
      kind: 'tile',
      x: 5,
      y: 5,
      on: { kind: 'horse', id: 'h' },
    })
  })

  it('a click on a lone resident on bare ground picks the tile in realm control mode', () => {
    expect(click('realm', world({ buildings: [] }), 55, 55)).toEqual({ kind: 'tile', x: 5, y: 5 })
  })

  it('wraps the tile at the map’s edge', () => {
    expect(click('realm', world({ buildings: [], residents: [] }), -5, -5)).toEqual({
      kind: 'tile',
      x: 63,
      y: 63,
    })
  })
})
