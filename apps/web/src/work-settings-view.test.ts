import type { ScriptSummary } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import { workScriptOf, workScripts, workSettingsParams } from './work-settings-view.js'

const script = (id: number, name: string, fields: Partial<ScriptSummary>): ScriptSummary => ({
  id,
  name,
  activeVersion: 1,
  latestVersion: 1,
  task: null,
  followsDefault: false,
  params: [],
  ...fields,
})

const WORKPLACE = { name: 'workplace', type: 'building' } as const
const LIBRARY = [
  script(1, 'Build', { task: 'build', params: [{ name: 'site', type: 'building' }] }),
  script(2, 'Farming', { params: [WORKPLACE, { name: 'out', type: 'storage' }] }),
  script(3, 'Home', { params: [{ name: 'home', type: 'building' }] }),
  script(4, 'Odd', { params: [{ name: 'workplace', type: 'storage' }] }),
  script(5, 'Work', { task: 'work', params: [WORKPLACE, { name: 'storage', type: 'storage' }] }),
]

describe('Work settings on a workplace’s card', () => {
  it('offers the Work default first, then the scripts declaring `param workplace: building`', () => {
    expect(workScripts(LIBRARY).map((s) => s.name)).toEqual(['Work', 'Farming'])
  })

  it('runs the script picked while it still is a work script, else the Work default', () => {
    expect(workScriptOf(LIBRARY, undefined)?.name).toBe('Work')
    expect(workScriptOf(LIBRARY, { scriptId: 2 })?.name).toBe('Farming')
    expect(workScriptOf(LIBRARY, { scriptId: 3 })?.name).toBe('Work')
    expect(workScriptOf(LIBRARY, { scriptId: 99 })?.name).toBe('Work')
    expect(workScriptOf([], undefined)).toBeUndefined()
  })

  it('shows every param but workplace, which is the building itself', () => {
    expect(workSettingsParams(LIBRARY[1]).map((p) => p.name)).toEqual(['out'])
    expect(workSettingsParams(undefined)).toEqual([])
  })
})
