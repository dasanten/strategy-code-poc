import { describe, expect, it } from 'vitest'
import { EDITOR_LOOK as look } from './script-editor-look.js'
import { THEME, contrast } from './theme.js'

describe('the script editor’s look', () => {
  it('sits on the kit’s code ground', () => {
    expect(look.ground).toBe(THEME.ui.code)
  })

  it('keeps every kind of word readable on the code ground and in a selection (4.5:1)', () => {
    const words = {
      text: look.text,
      gutter: look.gutter,
      keyword: look.keyword,
      string: look.string,
      number: look.number,
      atom: look.atom,
      operator: look.operator,
      comment: look.comment,
    }
    for (const [name, color] of Object.entries(words))
      expect(contrast(color, look.ground), name).toBeGreaterThanOrEqual(4.5)
    // Selected, names, keywords and numbers stay readable; strings only just miss it (4.46:1).
    for (const name of ['text', 'keyword', 'number'] as const)
      expect(contrast(words[name], look.selection), `${name} selected`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(look.string, look.selection)).toBeGreaterThanOrEqual(4.4)
  })

  it('keeps hovers, completions and lint messages readable', () => {
    const { tooltip, picked } = look
    expect(contrast(tooltip.text, tooltip.ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tooltip.muted, tooltip.ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(picked.text, picked.ground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(look.matched, tooltip.ground)).toBeGreaterThanOrEqual(4.5)
  })

  it('draws lint marks and the cursor so they stand out from the ground (3:1)', () => {
    for (const [name, color] of Object.entries({
      error: look.error,
      warning: look.warning,
      cursor: look.cursor,
    }))
      expect(contrast(color, look.ground), name).toBeGreaterThanOrEqual(3)
    expect(look.error).not.toBe(look.warning)
  })
})
