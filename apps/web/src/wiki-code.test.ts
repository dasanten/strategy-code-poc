import { describe, expect, it } from 'vitest'
import { highlightScript } from './wiki-code.js'

describe('highlightScript', () => {
  it('colours keywords, strings, numbers and comments as the workshop does', () => {
    expect(highlightScript('if (me.food < 20) { fetch(["food"]) } // eat')).toEqual([
      { text: 'if', kind: 'kw' },
      { text: ' (me.food < ' },
      { text: '20', kind: 'n' },
      { text: ') { fetch([' },
      { text: '"food"', kind: 's' },
      { text: ']) } ' },
      { text: '// eat', kind: 'c' },
    ])
  })

  it('keeps a block comment coloured across lines', () => {
    expect(highlightScript('/* one\ntwo */ x')).toEqual([
      { text: '/* one', kind: 'c' },
      { text: '\n' },
      { text: 'two */', kind: 'c' },
      { text: ' x' },
    ])
  })

  it('gives the source back whole, blank lines included', () => {
    const source = 'param storage: storage\n\nif (params.storage != null) { store(["wood"]) }\n'
    expect(
      highlightScript(source)
        .map((p) => p.text)
        .join(''),
    ).toBe(source)
  })
})
