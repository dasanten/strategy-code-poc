import type { StreamParser, StringStream } from '@codemirror/language'
import { tokenize, type Diagnostic } from '@csp/lang'
import type { ScriptDetail, ScriptSummary, ScriptVersion } from '@csp/shared'

/** Where a block comment is still open at the end of a line. */
export interface HighlightState {
  inComment: boolean
}

/** Whether a word is one of the language's keywords, as the lexer reads it. */
function isKeyword(word: string): boolean {
  try {
    return tokenize(word)[0]?.type === 'keyword'
  } catch {
    return false
  }
}

/**
 * Highlighting for the script language (`CONTEXT.md`: Script), following the lexer's rules:
 * comments, strings, numbers, keywords, names and operators.
 */
export const scriptHighlighting: StreamParser<HighlightState> = {
  name: 'script',
  startState: () => ({ inComment: false }),
  copyState: (state) => ({ ...state }),
  token(stream: StringStream, state: HighlightState): string | null {
    if (state.inComment) {
      if (stream.skipTo('*/')) {
        stream.pos += 2
        state.inComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inComment = true
      return this.token(stream, state)
    }
    const quote = stream.peek()
    if (quote === '"' || quote === "'") {
      stream.next()
      let ch: string | void
      while ((ch = stream.next()) !== undefined) {
        if (ch === '\\') stream.next()
        else if (ch === quote) break
      }
      return 'string'
    }
    if (stream.match(/^\d+(\.\d+)?/)) return 'number'
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null
    if (word) {
      if (word[0] === 'true' || word[0] === 'false' || word[0] === 'null') return 'atom'
      return isKeyword(word[0]) ? 'keyword' : 'variableName'
    }
    if (stream.match(/^(==|!=|<=|>=|&&|\|\||[=<>+\-*/%!])/)) return 'operator'
    stream.next()
    return 'punctuation'
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
}

/**
 * Where in the source a syntax error sits, as offsets: from its line and column (1-based) to the
 * end of the word there, or one character if there is none, kept inside the source.
 */
export function diagnosticRange(source: string, d: Diagnostic): { from: number; to: number } {
  const lines = source.split('\n')
  const lineIndex = Math.min(Math.max(d.line, 1), lines.length) - 1
  let lineStart = 0
  for (let i = 0; i < lineIndex; i++) lineStart += lines[i]!.length + 1
  const line = lines[lineIndex]!
  const col = Math.min(Math.max(d.column, 1) - 1, line.length)
  const from = lineStart + col
  const word = /^[A-Za-z0-9_]+/.exec(line.slice(col))
  const to = Math.min(from + (word ? word[0].length : 1), source.length)
  return { from, to: Math.max(to, from) }
}

/** An error the way the server words it: `line:column message`. */
export function describeDiagnostic(d: Diagnostic): string {
  return `${d.line}:${d.column} ${d.message}`
}

/** How a saved version shows in the history list. */
export function versionStatus(
  script: Pick<ScriptSummary, 'activeVersion'>,
  version: Pick<ScriptVersion, 'version' | 'errors'>,
): 'active' | 'has errors' | 'saved' {
  if (version.version === script.activeVersion) return 'active'
  return version.errors.length > 0 ? 'has errors' : 'saved'
}

/** Whether a version can be made the one that runs (`CONTEXT.md`: active version). */
export function canMakeActive(
  script: Pick<ScriptSummary, 'activeVersion'>,
  version: Pick<ScriptVersion, 'version' | 'errors'>,
): boolean {
  return versionStatus(script, version) === 'saved'
}

/** Whether the editor holds something that isn't saved yet as the script's newest version. */
export function hasUnsavedChanges(
  versions: Pick<ScriptVersion, 'source'>[],
  source: string,
): boolean {
  return versions.at(-1)?.source !== source
}

/** What a save did: a version without errors becomes active; one with errors is only kept. */
export function savedMessage(
  detail: Pick<ScriptDetail, 'activeVersion' | 'latestVersion'>,
): string {
  const latest = detail.latestVersion
  if (detail.activeVersion === latest) return `Saved version ${latest}; it is the active version.`
  const active =
    detail.activeVersion === null
      ? 'the script has no active version yet'
      : `version ${detail.activeVersion} stays active`
  return `Saved version ${latest}, but it has syntax errors, so ${active}.`
}

/** One line of a line diff: kept, or only in the old or only in the new source. */
export interface DiffLine {
  op: ' ' | '-' | '+'
  text: string
}

/**
 * The lines that changed from `before` to `after`, by longest common subsequence: what the
 * editor shows when the game's default changed since the Player edited theirs.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  // common[i][j]: the longest common subsequence of a[i..] and b[j..].
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i]![j] =
        a[i] === b[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, common[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: ' ', text: a[i++]! })
      j++
    } else if (j < b.length && (i === a.length || common[i]![j + 1]! >= common[i + 1]![j]!)) {
      out.push({ op: '+', text: b[j++]! })
    } else {
      out.push({ op: '-', text: a[i++]! })
    }
  }
  return out
}

/** How a default script stands against the game's default, for the editor's head. */
export function defaultStatus(
  detail: Pick<ScriptDetail, 'followsDefault' | 'gameDefault'>,
): 'follows' | 'edited' | 'default changed' {
  if (detail.followsDefault) return 'follows'
  const { gameDefault } = detail
  return gameDefault?.editedFrom != null && gameDefault.editedFrom !== gameDefault.source
    ? 'default changed'
    : 'edited'
}
