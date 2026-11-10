import { DEFAULT_SCRIPTS } from '@csp/lang-wasm'
import type { ScriptSummary } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCRIPT,
  SCRIPT_HELP_LINKS,
  templateChoices,
  templateName,
  templateSource,
} from './script-templates.js'

const script = (s: Partial<ScriptSummary> & Pick<ScriptSummary, 'id' | 'name'>): ScriptSummary => ({
  activeVersion: 1,
  latestVersion: 1,
  task: null,
  followsDefault: false,
  params: [],
  ...s,
})

describe('the templates a new script starts from', () => {
  const library = [
    script({ id: 1, name: 'Work', task: 'work', followsDefault: true }),
    script({ id: 2, name: 'Gatherer' }),
    script({ id: 3, name: 'Build', task: 'build', activeVersion: null }),
  ]

  it('offers empty first, then copies of the Player’s defaults, then the Wiki’s examples', () => {
    const choices = templateChoices(library)
    expect(choices[0]).toMatchObject({ value: 'empty', label: 'Empty' })
    // Their own scripts are no template, nor a default without a version that runs.
    expect(choices.filter((c) => c.group === 'Your default scripts')).toEqual([
      {
        value: 'mine-1',
        label: 'Copy of your Work',
        group: 'Your default scripts',
        template: { kind: 'mine', scriptId: 1, task: 'work' },
      },
    ])
    const examples = choices.filter((c) => c.group === 'Example scripts (Wiki)')
    expect(examples).toHaveLength(Object.keys(DEFAULT_SCRIPTS).length)
    expect(examples[0]).toMatchObject({
      label: 'Work (the game’s default)',
      template: { kind: 'example', task: 'work' },
    })
  })

  it('starts each from its source: empty, or the Wiki’s example as the Wiki shows it', () => {
    expect(templateSource({ kind: 'empty' })).toBe(EMPTY_SCRIPT)
    expect(templateSource({ kind: 'example', task: 'haul' })).toBe(DEFAULT_SCRIPTS.haul.source)
    // A copy of their own is fetched from the library.
    expect(templateSource({ kind: 'mine', scriptId: 1, task: 'work' })).toBeUndefined()
  })

  it('prefills a name the library doesn’t have yet', () => {
    const taken = library.map((s) => s.name)
    expect(templateName({ kind: 'empty' }, taken)).toBe('')
    expect(templateName({ kind: 'mine', scriptId: 1, task: 'work' }, taken)).toBe('Work copy')
    expect(templateName({ kind: 'example', task: 'build' }, taken)).toBe('Build example')
    expect(
      templateName({ kind: 'example', task: 'build' }, [
        ...taken,
        'build EXAMPLE',
        'Build example 2',
      ]),
    ).toBe('Build example 3')
  })

  it('links the Wiki’s Script language and Game API sections', () => {
    expect(SCRIPT_HELP_LINKS.map((l) => l.href)).toEqual(['/wiki#language', '/wiki#api'])
  })
})
