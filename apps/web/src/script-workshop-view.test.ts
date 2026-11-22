import { describe, expect, it } from 'vitest'
import type { ScriptSummary } from '@csp/shared-types'
import { libraryGroups, libraryLine, workshopSteps } from './script-workshop-view.js'

const script = (s: Partial<ScriptSummary> & Pick<ScriptSummary, 'id' | 'name'>): ScriptSummary => ({
  activeVersion: 1,
  latestVersion: 1,
  task: null,
  followsDefault: false,
  params: [],
  ...s,
})

describe('the script workshop', () => {
  const library = [
    script({ id: 1, name: 'Work', task: 'work', followsDefault: true, activeVersion: 2 }),
    script({ id: 2, name: 'Mine run', activeVersion: 7 }),
    script({ id: 3, name: 'Haul', task: 'haul', activeVersion: 4 }),
    script({ id: 4, name: 'Draft', activeVersion: null }),
  ]

  it('lists the default scripts, then the Player’s own, each in the server’s order', () => {
    expect(libraryGroups(library).map((g) => [g.label, g.scripts.map((s) => s.id)])).toEqual([
      ['Default scripts', [1, 3]],
      ['Your scripts', [2, 4]],
    ])
  })

  it('leaves out a group with no scripts', () => {
    expect(libraryGroups(library.filter((s) => s.task !== null)).map((g) => g.label)).toEqual([
      'Default scripts',
    ])
    expect(libraryGroups([])).toEqual([])
  })

  it('says under each name whose it is and which version runs', () => {
    expect(library.map(libraryLine)).toEqual(['game’s · v2', 'v7', 'edited · v4', 'none active'])
  })

  it('has three steps on a phone, the last History or the New script form', () => {
    expect(workshopSteps(true).map((s) => s.label)).toEqual(['Library', 'Editor', 'History'])
    expect(workshopSteps(false).map((s) => s.label)).toEqual(['Library', 'Editor', 'New script'])
  })
})
