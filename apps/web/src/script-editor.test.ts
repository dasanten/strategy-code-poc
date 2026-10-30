import { StringStream } from '@codemirror/language'
import { checkScript } from '@csp/lang'
import { describe, expect, it } from 'vitest'
import {
  apiHover,
  apiNames,
  canMakeActive,
  defaultStatus,
  describeDiagnostic,
  diagnosticsText,
  fieldCompletions,
  fieldHover,
  diagnosticRange,
  hasUnsavedChanges,
  lineDiff,
  nameCompletions,
  namesInScope,
  olderVersions,
  savedMessage,
  scriptWarnings,
  scriptHighlighting,
  versionStatus,
} from './script-editor.js'

/** Runs the highlighter over source, giving each non-space token's text and style. */
function highlight(source: string): [string, string | null][] {
  const state = scriptHighlighting.startState!(2)
  const out: [string, string | null][] = []
  for (const line of source.split('\n')) {
    const stream = new StringStream(line, 2, 2)
    while (!stream.eol()) {
      const style = scriptHighlighting.token(stream, state)
      const text = stream.current()
      if (text.trim() !== '') out.push([text, style])
      stream.start = stream.pos
    }
  }
  return out
}

describe('script highlighting', () => {
  it('tells keywords, names, numbers, strings and operators apart', () => {
    expect(highlight('let x = 3.5 + "a\\"b"')).toEqual([
      ['let', 'keyword'],
      ['x', 'variableName'],
      ['=', 'operator'],
      ['3.5', 'number'],
      ['+', 'operator'],
      ['"a\\"b"', 'string'],
    ])
    expect(highlight('if (memory.role == null) { return true }')).toEqual([
      ['if', 'keyword'],
      ['(', 'punctuation'],
      ['memory', 'variableName'],
      ['.', 'punctuation'],
      ['role', 'variableName'],
      ['==', 'operator'],
      ['null', 'atom'],
      [')', 'punctuation'],
      ['{', 'punctuation'],
      ['return', 'keyword'],
      ['true', 'atom'],
      ['}', 'punctuation'],
    ])
  })

  it('reads line comments and block comments across lines', () => {
    expect(highlight('x // let\n/* a\nlet */ y')).toEqual([
      ['x', 'variableName'],
      ['// let', 'comment'],
      ['/* a', 'comment'],
      ['let */', 'comment'],
      ['y', 'variableName'],
    ])
  })

  it('treats words that only start like keywords as names', () => {
    expect(highlight('letter iffy')).toEqual([
      ['letter', 'variableName'],
      ['iffy', 'variableName'],
    ])
  })
})

describe('inline errors', () => {
  it('marks the word where the server finds the error', () => {
    const source = 'let a = 1\nlet b = c ) d'
    const [error] = checkScript(source)
    expect(error).toMatchObject({ line: 2, column: 11 })
    const { from, to } = diagnosticRange(source, error!)
    expect(source.slice(from, to)).toBe(')')
    expect(diagnosticRange('x\n  foo bar', { message: 'x', line: 2, column: 3 })).toEqual({
      from: 4,
      to: 7,
    })
  })

  it('marks one character where there is no word, kept inside the source', () => {
    expect(diagnosticRange('a + (', { message: 'x', line: 1, column: 5 })).toEqual({
      from: 4,
      to: 5,
    })
    expect(diagnosticRange('a +', { message: 'x', line: 1, column: 4 })).toEqual({
      from: 3,
      to: 3,
    })
    expect(diagnosticRange('a\nb', { message: 'x', line: 9, column: 9 })).toEqual({
      from: 3,
      to: 3,
    })
  })

  it('words errors the way the server does', () => {
    expect(describeDiagnostic({ message: 'Expected )', line: 2, column: 7 })).toBe('2:7 Expected )')
  })
})

describe('script history', () => {
  const script = { activeVersion: 2 }
  const ok = { version: 1, errors: [] }
  const active = { version: 2, errors: [] }
  const broken = { version: 3, errors: [{ message: 'x', line: 1, column: 1 }] }

  it('shows which version runs and which have errors', () => {
    expect(versionStatus(script, ok)).toBe('saved')
    expect(versionStatus(script, active)).toBe('active')
    expect(versionStatus(script, broken)).toBe('has errors')
  })

  it('lets only an inactive version without errors be made active', () => {
    expect(canMakeActive(script, ok)).toBe(true)
    expect(canMakeActive(script, active)).toBe(false)
    expect(canMakeActive(script, broken)).toBe(false)
    expect(canMakeActive({ activeVersion: null }, ok)).toBe(true)
  })

  it('finds the versions older than the active one', () => {
    const versions = [{ version: 1 }, { version: 4 }, { version: 6 }, { version: 7 }]
    expect(olderVersions({ activeVersion: 6, versions })).toEqual([{ version: 1 }, { version: 4 }])
    expect(olderVersions({ activeVersion: 1, versions })).toEqual([])
    expect(olderVersions({ activeVersion: null, versions })).toEqual([])
  })

  it('says whether a save became the active version', () => {
    expect(savedMessage({ activeVersion: 3, latestVersion: 3 })).toBe(
      'Saved version 3; it is the active version.',
    )
    expect(savedMessage({ activeVersion: 2, latestVersion: 3 })).toBe(
      'Saved version 3, but it has syntax errors, so version 2 stays active.',
    )
    expect(savedMessage({ activeVersion: null, latestVersion: 1 })).toContain(
      'no active version yet',
    )
  })

  it('knows when the editor differs from the newest saved version', () => {
    expect(hasUnsavedChanges([], '')).toBe(true)
    expect(hasUnsavedChanges([{ source: 'a' }, { source: 'b' }], 'b')).toBe(false)
    expect(hasUnsavedChanges([{ source: 'a' }, { source: 'b' }], 'a')).toBe(true)
  })
})

describe('lineDiff', () => {
  it('keeps common lines and marks removed and added ones', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { op: ' ', text: 'a' },
      { op: '+', text: 'x' },
      { op: '-', text: 'b' },
      { op: ' ', text: 'c' },
      { op: '+', text: 'd' },
    ])
    expect(lineDiff('same', 'same')).toEqual([{ op: ' ', text: 'same' }])
  })
})

describe('defaultStatus', () => {
  const gameDefault = (editedFrom: string | null) => ({ source: 'new', editedFrom })
  it('tells following, edited, and edited before the game’s default changed apart', () => {
    expect(defaultStatus({ followsDefault: true, gameDefault: gameDefault(null) })).toBe('follows')
    expect(defaultStatus({ followsDefault: false, gameDefault: gameDefault('new') })).toBe('edited')
    expect(defaultStatus({ followsDefault: false, gameDefault: gameDefault('old') })).toBe(
      'default changed',
    )
  })
})

/** The source with `|` taken out, and where it stood. */
function cursor(marked: string): [string, number] {
  const at = marked.indexOf('|')
  return [marked.slice(0, at) + marked.slice(at + 1), at]
}

/** The labels offered for the word before `|`. */
function labels(marked: string, defaultScript = false): string[] {
  const [source, at] = cursor(marked)
  const prefix = /\w*$/.exec(source.slice(0, at))![0]
  return nameCompletions(source, at - prefix.length, prefix, { defaultScript }).map((c) => c.label)
}

describe('name completions', () => {
  it('offers matching keywords, game API names and locals in scope', () => {
    const offered = labels('let resting = 1\nre|')
    expect(offered).toEqual(expect.arrayContaining(['resting', 'residents', 'return']))
    expect(offered).not.toContain('walkTo')
    expect(labels('wh|')).toContain('while')
  })

  it('leaves out names not in scope at the cursor', () => {
    const source = `
      if (true) { let inner = 1 }
      for (r of residents()) { let looped = r }
      fn helper(param) { let local = param }
      let later = 2
      |`
    const offered = labels(source)
    expect(offered).toEqual(expect.arrayContaining(['helper']))
    for (const gone of ['inner', 'looped', 'r', 'param', 'local'])
      expect(offered).not.toContain(gone)
    expect(offered).toContain('later')
    expect(labels('|\nlet later = 2')).not.toContain('later')
  })

  it('knows parameters, loop variables and functions declared later in the block', () => {
    const [source, at] = cursor(`
      for (r of residents()) {
        fn go(target, speed) { | }
      }
      fn after() {}`)
    expect(namesInScope(source, at)).toEqual(
      expect.arrayContaining(['r', 'go', 'target', 'speed', 'after']),
    )
  })

  it('does not count the name being typed, and works while the script does not parse', () => {
    expect(labels('let resi|')).not.toContain('resi')
    expect(labels('let held = 1\nif (me.|')).toEqual(expect.arrayContaining(['held']))
    expect(labels('let held = 1\nhe| "unclosed')).toContain('held')
  })

  it('completes a query or action with its required parameters', () => {
    const [source, at] = cursor('walk|')
    const walk = nameCompletions(source, 0, 'walk', { defaultScript: false })
    expect(walk.find((c) => c.label === 'walkTo')?.snippet).toBe('walkTo(${x}, ${y})')
    expect(walk.find((c) => c.label === 'walkTime')?.snippet).toBe('walkTime(${a}, ${b})')
    const storages = nameCompletions(source, at, 'stor', { defaultScript: false })[0]!
    expect(storages.snippet).toBe('storages()')
  })

  it('tells what a query costs and does', () => {
    const residents = nameCompletions('res', 0, 'res', { defaultScript: false }).find(
      (c) => c.label === 'residents',
    )!
    expect(residents.detail).toBe('query, +20 steps')
    expect(residents.info).toContain('residents()')
    expect(residents.info).toContain('The residents the Player sees')
  })
})

describe('the game API in the editor', () => {
  it('marks army-only and resident-only names', () => {
    const names = apiNames(false)
    const mark = (name: string) => names.find((n) => n.name === name)?.mark
    expect(mark('guard')).toBe('army only')
    expect(mark('follow')).toBe('army only')
    expect(mark('build')).toBe('resident only')
    expect(mark('walkTo')).toBeNull()
    expect(mark('residents')).toBeNull()
    expect(nameCompletions('gu', 0, 'gu', { defaultScript: false })[0]?.detail).toContain(
      'army only',
    )
  })

  it('gives a default script the resident’s API only', () => {
    const names = apiNames(true)
    expect(names.map((n) => n.name)).not.toContain('guard')
    expect(names.every((n) => n.mark === null && n.army === null)).toBe(true)
    expect(labels('gu|', true)).not.toContain('guard')
  })

  it('shows a name’s signature, cost and description on hover, not a field’s', () => {
    const source = 'walkTo(me.x, 3)'
    const hover = apiHover(source, 2, { defaultScript: false })!
    expect(hover).toMatchObject({ from: 0, to: 6 })
    expect(hover.text).toMatch(/^walkTo\(x, y\) · action, \+10 steps\nResident: Walk to a tile\./)
    expect(hover.text).toContain('Army: The army walks to a tile together.')
    expect(apiHover(source, 10, { defaultScript: false })).toBeNull()
    expect(apiHover(source, 8, { defaultScript: false })?.text).toMatch(/^me · value/)
  })
})

describe('script warnings in the editor', () => {
  it('warns of a typo in a field, never of a syntax error', () => {
    expect(scriptWarnings('me.hungr', false)).toEqual([
      { message: '"hungr" is not a field of a resident or an army', line: 1, column: 4 },
    ])
    expect(scriptWarnings('me.hungr', true)[0]?.message).toBe(
      '"hungr" is not a field of a resident',
    )
    expect(scriptWarnings('let = me.hungr', false)).toEqual([])
  })

  it('says how many warnings there are, and that they don’t stop a version running', () => {
    const w = { message: 'x', line: 1, column: 1 }
    expect(diagnosticsText([], [])).toBe('No syntax errors.')
    expect(diagnosticsText([], [w])).toMatch(/^No syntax errors; 1 warning, .*don’t stop/)
    expect(diagnosticsText([w], [w])).toMatch(/^1:1 x\n.*never runs/)
  })
})

/** The fields offered at `|`, which follows a `.` and maybe part of a field. */
function fieldLabels(marked: string, defaultScript = false): string[] | null {
  const [source, at] = cursor(marked)
  const typed = /\w*$/.exec(source.slice(0, at))![0]
  const out = fieldCompletions(source, at - typed.length, at, { defaultScript })
  return out && out.map((c) => c.label)
}

describe('field completions', () => {
  it('offer the fields of `me`, both views marked in a Player’s script', () => {
    const all = nameCompletionsOf('me.|')
    expect(all.map((c) => c.label)).toEqual(
      expect.arrayContaining(['hunger', 'carried', 'members']),
    )
    expect(all.find((c) => c.label === 'hunger')?.detail).toBe('number · resident only')
    expect(all.find((c) => c.label === 'members')?.detail).toBe('list of resident · army only')
    expect(all.find((c) => c.label === 'x')?.detail).toBe('number · resident only')
    expect(fieldLabels('me.|', true)).not.toContain('members')
    expect(fieldLabels('me.hu|')).toEqual(['hunger'])
  })

  it('follow a loop over a query, a let holding one, and fields to their views', () => {
    expect(fieldLabels('for (r of residents()) { r.| }')).toEqual(
      expect.arrayContaining(['name', 'stats', 'order']),
    )
    expect(fieldLabels('for (r of residents()) {\n  if (r.|')).toContain('hunger')
    expect(fieldLabels('let b = building("x")\nb.site.|')).toEqual(['delivered', 'work'])
    expect(fieldLabels('storages()[0].st|')).toEqual(['stock'])
    expect(fieldLabels('me.stats.strength.|', true)).toEqual(['base', 'trained'])
  })

  it('offer the script’s own params after `params.`, and a building param’s fields', () => {
    const top = 'param storage: storage\nparam home: building\n'
    expect(fieldLabels(`${top}params.|`)).toEqual(['storage', 'home'])
    expect(fieldLabels(`${top}if (params.h|`)).toEqual(['home'])
    expect(fieldLabels(`${top}params.home.ki|`)).toEqual(['kind'])
    expect(fieldLabels(`${top}params.storage.|`)).toBeNull()
    expect(fieldLabels('params.|')).toEqual([])
    expect(scriptWarnings(`${top}let a = params.storage\nlet b = params.other`, true)).toEqual([
      {
        message: 'No param "other": declare it with a "param" line at the top',
        line: 4,
        column: 16,
      },
    ])
  })

  it('offer nothing for a value it isn’t sure of', () => {
    expect(fieldLabels('memory.|')).toBeNull()
    expect(fieldLabels('fn f(p) { return p.| }')).toBeNull()
    expect(fieldLabels('let x = {a: 1}\nx.|')).toBeNull()
  })

  it('show a field’s kind, description and when it is null on hover', () => {
    const hover = fieldHover('me.hunger', 5, { defaultScript: true })!
    expect(hover).toMatchObject({ from: 3, to: 9 })
    expect(hover.text).toBe(
      'hunger: number\nFully fed is 100, empty 0.\nnull for a resident of another realm that isn’t allied.',
    )
    expect(fieldHover('memory.hunger', 9, { defaultScript: true })).toBeNull()
  })
})

function nameCompletionsOf(marked: string) {
  const [source, at] = cursor(marked)
  return fieldCompletions(source, at, at, { defaultScript: false }) ?? []
}
