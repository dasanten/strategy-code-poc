import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DIPLOMACY_TABS, SIDE_TABS } from '../screen/hud-view.js'
import { pixelArt, type PixelSheet, type SliceRect } from '../map/pixel-art.js'
import { PIXEL_SLICES } from '../map/pixel-slices.js'
import {
  PLACEHOLDER_COLUMNS,
  PLACEHOLDER_ROWS,
  TAB_ICONS,
  UI_ICONS,
  iconDrawing,
  iconHasArt,
  type UiIconArt,
} from './ui-icons.js'

const icons = UI_ICONS as Readonly<Record<string, UiIconArt>>
const exported = (sheet: PixelSheet) =>
  PIXEL_SLICES[sheet].slices as Readonly<Record<string, SliceRect>>
const all = () => true
const none = () => false

describe('UI icons', () => {
  it('draws the slice once Daniel has drawn it', () => {
    expect(iconDrawing('close', all)).toEqual({
      from: 'sheet',
      sheet: 'ui',
      rect: exported('ui').close,
    })
    expect(iconDrawing('horse', all)).toEqual({
      from: 'sheet',
      sheet: 'units',
      rect: exported('units').horse,
    })
  })

  it('shows the placeholder while the slice is still empty', () => {
    expect(iconDrawing('close', none)).toEqual({ from: 'placeholder', rect: [80, 48, 16, 16] })
    // Only the slice that is drawn counts.
    const onlyAdd = (key: string) => key === pixelArt('ui', 'add')
    expect(iconDrawing('add', onlyAdd).from).toBe('sheet')
    expect(iconDrawing('close', onlyAdd).from).toBe('placeholder')
  })

  it('shows the placeholder when the slice is deleted from the sheet', () => {
    const withoutClose = (sheet: PixelSheet) => {
      const rest = { ...exported(sheet) }
      delete rest.close
      return rest
    }
    expect(iconDrawing('close', all, withoutClose)).toEqual({
      from: 'placeholder',
      rect: [80, 48, 16, 16],
    })
  })

  it('fails for an icon with neither a slice nor a placeholder', () => {
    expect(() => iconDrawing('no-such-icon', all)).toThrow(/neither/)
    expect(iconHasArt('no-such-icon')).toBe(false)
  })

  it('has a slice or a placeholder for every icon', () => {
    for (const name of Object.keys(icons)) expect(iconHasArt(name), name).toBe(true)
  })

  it('names only slices that are on their sheet, and places placeholders on the placeholder sheet', () => {
    for (const [name, art] of Object.entries(icons)) {
      if (art.slice !== undefined)
        expect(exported(art.sheet ?? 'ui')[art.slice], `${name}: ${art.slice}`).toBeDefined()
      if (art.placeholder) {
        const [c, r] = art.placeholder
        expect(c >= 0 && c < PLACEHOLDER_COLUMNS && r >= 0 && r < PLACEHOLDER_ROWS, name).toBe(true)
      }
    }
  })

  it('uses every slice of the ui sheet', () => {
    const used = new Set(
      Object.values(icons)
        .filter((a) => (a.sheet ?? 'ui') === 'ui')
        .map((a) => a.slice),
    )
    for (const slice of Object.keys(exported('ui'))) expect(used.has(slice), slice).toBe(true)
  })

  it('has an icon for every sidebar tab and every Diplomacy tab', () => {
    for (const t of [...SIDE_TABS, ...DIPLOMACY_TABS])
      expect(iconHasArt(TAB_ICONS[t.id]), t.id).toBe(true)
  })

  it('is drawn only by the Icon component, and only by names it knows', () => {
    const dir = new URL('../', import.meta.url)
    const files = fs
      .readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .map((f) => f.replaceAll('\\', '/'))
      .filter((f) => f.endsWith('.tsx') && f !== 'ui/Icon.tsx')
    for (const file of files) {
      const source = fs.readFileSync(new URL(file, dir), 'utf8')
      // No kit icon class by hand: `.ic` boxes and `.i-…` cells come from the Icon component.
      expect(source.match(/className=[{"'`][^>]*\bic\b[^-]/g) ?? [], file).toEqual([])
      expect(source.match(/['"`]i-[a-z]+/g) ?? [], file).toEqual([])
      for (const m of source.matchAll(/<Icon\s+name="([^"]+)"/g))
        expect(iconHasArt(m[1]!), `${file}: ${m[1]}`).toBe(true)
    }
  })
})
