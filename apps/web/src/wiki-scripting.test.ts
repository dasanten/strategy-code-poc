import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { checkScript } from '@csp/lang'
import { describe, expect, it } from 'vitest'
import { scriptWarnings } from './script-editor.js'
import { WIKI_TOPICS, Wiki } from './Wiki.js'
import { SCRIPT_LANGUAGE } from './wiki-scripting.js'

const examples = SCRIPT_LANGUAGE.filter((r) => r.example).map((r) => [r.title, r.example!])

describe('the Wiki’s Script language topic', () => {
  it.each(examples)('has an example for %s without syntax errors or warnings', (_, example) => {
    expect(checkScript(example)).toEqual([])
    expect(scriptWarnings(example, false)).toEqual([])
  })

  it('comes before Scripting budgets, with every rule and example on the page', () => {
    const ids = WIKI_TOPICS.map((t) => t.id)
    expect(ids.indexOf('language')).toBe(ids.indexOf('scripts') - 1)
    const html = renderToStaticMarkup(createElement(Wiki))
    expect(html).toContain('id="language"')
    for (const rule of SCRIPT_LANGUAGE) {
      expect(html).toContain(`<h3>${rule.title}</h3>`)
    }
    // Code in a rule's text shows as code.
    expect(html).toContain('<code>return</code>')
  })
})
