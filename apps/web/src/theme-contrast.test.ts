import { describe, expect, it } from 'vitest'
import { THEME, contrast } from './theme.js'

const { palette: p, ui, relationship, relationshipText } = THEME
/** Where words sit on parchment: panels, buttons and inputs. */
const LIGHT = { panel: ui.panel, raised: ui.raised, well: ui.well }

describe('contrast', () => {
  it('measures as WCAG 2 does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21)
    expect(contrast('#777777', '#777777')).toBe(1)
  })

  it('keeps every text colour readable on parchment, buttons and inputs (4.5:1)', () => {
    const texts = {
      text: ui.text,
      muted: ui.muted,
      live: ui.live,
      bad: ui.bad,
      warnText: ui.warnText,
      ...Object.fromEntries(Object.entries(relationshipText).map(([k, v]) => [`rel ${k}`, v])),
    }
    for (const [name, color] of Object.entries(texts))
      for (const [ground, bg] of Object.entries(LIGHT))
        expect(contrast(color, bg), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps text on the dark bars, the header bars and on code readable', () => {
    for (const color of [ui.barText, ui.barMuted]) {
      expect(contrast(color, ui.bar)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(color, p.wood)).toBeGreaterThanOrEqual(4.5)
    }
    // What a bar says in colour: live, offline (orange: red is too dark there), the Player's own.
    for (const color of [p.grass, p.orange, p.gold])
      expect(contrast(color, ui.bar)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.mist, ui.code)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the kit atoms that put text on a colour readable', () => {
    const pairs: [string, string, string][] = [
      ['header bar', p.parch, p.wood],
      ['primary button', '#ffffff', p.pine],
      ['gold button, pressed button', p.ink, p.gold],
      ['danger button', '#ffffff', p.blood],
      ['button on dark bars', '#ffffff', p.slate],
      ['picked row', p.bark, p.sun],
      ['tab', p.bark, p.tan],
      ['chip, navy', '#ffffff', p.navy],
      ['name tag', '#ffffff', p.ink],
    ]
    for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5)
  })

  it('draws every relationship in its own palette colour, with ink readable on it', () => {
    expect(relationship).toEqual({
      own: p.gold,
      alliance: p.sky,
      otherRealm: p.red,
      npcCity: p.fog,
      tradeOrg: p.cyan,
    })
    // A mark is not text, but the dark ring of a token must still stand out from it (3:1).
    for (const [name, color] of Object.entries(relationship))
      expect(contrast(color, p.ink), name).toBeGreaterThanOrEqual(3)
  })
})
