import { describe, expect, it } from 'vitest'
import { Terrain } from '@csp/shared'
import { RELATIONSHIP_COLORS, TERRAIN_COLORS, VOID_COLOR } from './map/palette.js'
import { THEME, applyTheme, cssVariables, hex } from './theme.js'

describe('theme', () => {
  it('turns #rrggbb into a Pixi colour and refuses anything else', () => {
    expect(hex('#f2b630')).toBe(0xf2b630)
    expect(() => hex('rgba(0, 0, 0, 0.5)')).toThrow()
  })

  it('gives the map palette the same colours as the CSS', () => {
    const vars = cssVariables()
    expect(RELATIONSHIP_COLORS.own).toBe(hex(vars['--rel-own']!))
    expect(RELATIONSHIP_COLORS.otherRealm).toBe(hex(vars['--rel-other-realm']!))
    expect(RELATIONSHIP_COLORS.tradeOrg).toBe(hex(vars['--rel-trade-org']!))
    expect(TERRAIN_COLORS[Terrain.Sea]).toBe(hex(vars['--terrain-sea']!))
    expect(VOID_COLOR).toBe(hex(vars['--terrain-void']!))
  })

  it('has a CSS variable for every relationship colour', () => {
    const vars = cssVariables()
    for (const color of Object.values(THEME.relationship))
      expect(Object.values(vars)).toContain(color)
    expect(Object.keys(vars).filter((k) => k.startsWith('--rel-'))).toHaveLength(5)
  })

  it('sets its variables on an element', () => {
    const set = new Map<string, string>()
    applyTheme({ setProperty: (name: string, value: string | null) => set.set(name, value!) })
    expect(set.get('--font-ui')).toContain('Inter')
    expect(set.get('--ui-panel')).toBe(THEME.ui.panel)
  })
})
