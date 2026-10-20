import { StringStream } from '@codemirror/language'
import { checkScript } from '@csp/lang'
import { describe, expect, it } from 'vitest'
import {
  canMakeActive,
  describeDiagnostic,
  diagnosticRange,
  hasUnsavedChanges,
  savedMessage,
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
