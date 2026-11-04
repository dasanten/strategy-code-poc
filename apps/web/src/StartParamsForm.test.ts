import type { ScriptParam } from '@csp/shared'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StartParamsForm } from './ScriptParams.js'

const PARAMS: ScriptParam[] = [
  { name: 'workplace', type: 'building', description: 'the workplace; none: the one I stand on' },
  {
    name: 'output',
    type: 'storage',
    description: 'where the output goes; none: the nearest storage',
  },
  { name: 'home', type: 'storage' },
  { name: 'crewFood', type: 'number', default: 4, description: 'Food the pile keeps' },
]

const form = (props: Partial<Parameters<typeof StartParamsForm>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(StartParamsForm, {
      script: 'Work',
      params: PARAMS,
      values: { home: 's1', crewFood: 6 },
      target: 'workplace',
      label: (id) => (id === 's1' ? 'Storage at 3, 4' : null),
      waypoints: [],
      canStart: true,
      onPick: () => {},
      onChange: () => {},
      onStart: () => {},
      onCancel: () => {},
      ...props,
    }),
  )

/** The markup of one param's row, up to the next. */
const row = (html: string, name: string) =>
  html.split('class="start-param"').find((r) => r.includes(`<strong>${name}</strong>`)) ?? ''

describe('the form before a script starts', () => {
  it('shows each param’s value at a glance', () => {
    const html = form()
    expect(row(html, 'workplace')).toContain('the one they stand on')
    expect(row(html, 'output')).toContain('the nearest storage')
    expect(row(html, 'home')).toContain('Storage at 3, 4')
    expect(row(html, 'crewFood')).toContain('value="6"')
    expect(row(form({ values: { home: 'gone' } }), 'home')).toContain('out of sight')
  })

  it('keeps the explanation behind a button, only for a param with a comment', () => {
    const output = row(form(), 'output')
    expect(output).toContain('aria-expanded="false"')
    expect(output).toMatch(/<p [^>]*hidden=""[^>]*>where the output goes<\/p>/)
    expect(row(form(), 'home')).not.toContain('start-param-why')
  })

  it('keeps Start and Cancel out of the rows that scroll', () => {
    const [rows, after] = form().split('class="hud-dialog-actions"')
    expect(rows).toContain('start-params-rows')
    expect(rows).not.toContain('>Start<')
    expect(after).toContain('>Start<')
    expect(after).toContain('>Cancel<')
  })

  it('stays in place, out of the way, while a param is picked on the map', () => {
    expect(form()).not.toContain('start-params-backdrop picking')
    const picking = form({ picking: true })
    expect(picking).toContain('start-params-backdrop picking')
    expect(row(picking, 'crewFood')).toContain('value="6"')
  })
})
