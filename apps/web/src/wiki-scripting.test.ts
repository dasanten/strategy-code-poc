import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { checkScript } from '@csp/lang'
import { ARMY_SCRIPT_API, DEFAULT_SCRIPTS, SCRIPT_API, SCRIPT_VIEWS } from '@csp/shared'
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

  it('shows every rule and example on the page', () => {
    const html = renderToStaticMarkup(createElement(Wiki))
    expect(html).toContain('id="language"')
    for (const rule of SCRIPT_LANGUAGE) {
      expect(html).toContain(`<h3>${rule.title}</h3>`)
    }
    // Code in a rule's text shows as code.
    expect(html).toContain('<code>return</code>')
  })
})

describe('the Wiki’s Game API and example scripts', () => {
  const html = renderToStaticMarkup(createElement(Wiki))
  const between = (from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to))

  it('reads in order: language, game API, params, budgets, examples', () => {
    const ids = WIKI_TOPICS.map((t) => t.id)
    expect(ids.slice(ids.indexOf('language'))).toEqual([
      'language',
      'api',
      'params',
      'scripts',
      'examples',
    ])
  })

  it('lists every binding of both APIs with its cost, and marks one-API names', () => {
    const api = between('id="api"', 'id="view-')
    for (const b of [...SCRIPT_API, ...ARMY_SCRIPT_API]) {
      const call = b.is === 'value' ? b.name : `${b.name}(${b.params.join(', ')})`
      expect(api, b.name).toContain(`<code>${call}</code>`)
    }
    expect(api).toContain('<em>army only.</em>')
    expect(api).toContain('<em>resident only.</em>')
  })

  it('lists every field of every view, and when it is null', () => {
    const names = Object.keys(SCRIPT_VIEWS)
    names.forEach((name, i) => {
      const next = names[i + 1] ? `id="view-${names[i + 1]}"` : 'id="scripts"'
      const view = between(`id="view-${name}"`, next)
      for (const f of SCRIPT_VIEWS[name as keyof typeof SCRIPT_VIEWS].fields) {
        expect(view, `${name}.${f.name}`).toContain(`<td><code>${f.name}</code></td>`)
      }
    })
  })

  it('shows the default scripts as they are', () => {
    const examples = html.slice(html.indexOf('id="examples"'))
    for (const s of Object.values(DEFAULT_SCRIPTS)) {
      expect(examples).toContain(`<h3>${s.name}</h3>`)
      expect(examples).toContain(s.source.split('\n')[0]!)
    }
  })
})
