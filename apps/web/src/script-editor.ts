import type { StreamParser, StringStream } from '@codemirror/language'
import { KEYWORDS, tokenize, type Diagnostic, type Token } from '@csp/lang'
import {
  ARMY_SCRIPT_API,
  SCRIPT_API,
  type ScriptBinding,
  type ScriptDetail,
  type ScriptSummary,
  type ScriptVersion,
} from '@csp/shared'

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

/**
 * A game API name as the editor offers it. A script isn't typed as a resident's or an army's, so
 * the editor offers both APIs; `mark` says when a name is only in one of them. A default script
 * (it has a task) only ever runs as a resident's, so it gets the resident's API alone.
 */
export interface ApiName {
  name: string
  is: ScriptBinding['is']
  /** The resident's binding of this name, if it has one. */
  resident: ScriptBinding | null
  /** The army's binding of this name, if it has one. */
  army: ScriptBinding | null
  mark: 'resident only' | 'army only' | null
}

/** The game API names a script can use: both APIs together, unless it is a default script. */
export function apiNames(defaultScript: boolean): ApiName[] {
  const army = new Map((defaultScript ? [] : ARMY_SCRIPT_API).map((b) => [b.name, b]))
  const names: ApiName[] = SCRIPT_API.map((b) => {
    const a = army.get(b.name) ?? null
    army.delete(b.name)
    return {
      name: b.name,
      is: b.is,
      resident: b,
      army: a,
      mark: defaultScript || a ? null : 'resident only',
    }
  })
  for (const a of army.values()) {
    names.push({ name: a.name, is: a.is, resident: null, army: a, mark: 'army only' })
  }
  return names
}

/** Either binding of a name: they share their kind and parameters. */
const bindingOf = (n: ApiName): ScriptBinding => (n.resident ?? n.army)!

/** How a name is written: `me`, `walkTo(x, y)`, `storages(from?, goods?)`. */
function signature(b: ScriptBinding): string {
  return b.is === 'value' ? b.name : `${b.name}(${b.params.join(', ')})`
}

/** The short line beside a name: its kind, what a call costs, and which API it is from. */
export function apiDetail(n: ApiName): string {
  const b = bindingOf(n)
  const parts = [b.is === 'value' ? 'value' : `${b.is}, +${b.cost} step${b.cost === 1 ? '' : 's'}`]
  if (n.mark) parts.push(n.mark)
  return parts.join(' · ')
}

/**
 * What hovering a name, or a completion's info, shows: its signature, kind, cost and
 * description, both descriptions where the resident's and the army's differ.
 */
export function apiInfo(n: ApiName): string {
  const lines = [`${signature(bindingOf(n))} · ${apiDetail(n)}`]
  if (n.resident && n.army && n.resident.description !== n.army.description) {
    lines.push(`Resident: ${n.resident.description}`, `Army: ${n.army.description}`)
  } else {
    lines.push(bindingOf(n).description)
  }
  return lines.join('\n')
}

/** A completion the editor offers, kept free of CodeMirror so it can be tested. */
export interface NameCompletion {
  label: string
  type: 'keyword' | 'variable' | 'function' | 'constant'
  detail?: string
  info?: string
  /** A snippet to insert instead of the label: a call, with its required parameters to fill. */
  snippet?: string
}

/** The source's tokens, or those before `offset` when the rest doesn't lex yet. */
function tokensFor(source: string, offset: number): Token[] {
  for (const text of [source, source.slice(0, offset)]) {
    try {
      return tokenize(text)
    } catch {
      // An unclosed string or a stray character: try less.
    }
  }
  return []
}

type Named = Token & { value: string }

/**
 * The names the script declares itself that are in scope at `offset`: `let`s before it, `fn`s
 * anywhere in a block around it (they can be called before their declaration), and the
 * parameters and loop variables of the functions and `for … of` loops around it. Read from the
 * tokens, so it works while the script doesn't parse yet.
 */
export function namesInScope(source: string, offset: number): string[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
  const at = (t: Token) => starts[t.line - 1]! + t.column - 1
  const tokens = tokensFor(source, offset)
  const is = (t: Token | undefined, type: Token['type'], value?: string): t is Named =>
    t !== undefined &&
    t.type === type &&
    (value === undefined || ('value' in t && t.value === value))
  // A name written before the cursor, not the word being completed.
  const declared = (t: Token | undefined): t is Named => is(t, 'identifier') && at(t) < offset

  let scopes: Set<string>[] = [new Set()]
  let atCursor: Set<string>[] | null = null
  // The parameters or loop variable of the block that opens next.
  let pending: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (atCursor === null && (t.type === 'end' || at(t) >= offset)) atCursor = scopes
    const before = atCursor === null
    const top = scopes.at(-1)!
    if (is(t, 'punctuator', '{')) {
      scopes = [...scopes, new Set(before ? pending : [])]
      pending = []
    } else if (is(t, 'punctuator', '}')) {
      if (scopes.length > 1) scopes = scopes.slice(0, -1)
    } else if (before && is(t, 'keyword', 'let') && declared(tokens[i + 1])) {
      top.add((tokens[i + 1] as Named).value)
    } else if (is(t, 'keyword', 'fn')) {
      let j = i + 1
      const name = tokens[j]
      if (is(name, 'identifier')) {
        // Declared for its whole block, so one after the cursor counts too.
        if (!before || at(name) < offset) top.add(name.value)
        j++
      }
      if (before && is(tokens[j], 'punctuator', '(')) {
        pending = []
        for (j++; j < tokens.length && !is(tokens[j], 'punctuator', ')'); j++) {
          const p = tokens[j]
          if (declared(p)) pending.push(p.value)
        }
      }
    } else if (
      before &&
      is(t, 'keyword', 'for') &&
      is(tokens[i + 1], 'punctuator', '(') &&
      declared(tokens[i + 2]) &&
      is(tokens[i + 3], 'keyword', 'of')
    ) {
      pending = [(tokens[i + 2] as Named).value]
    }
  }
  return [...new Set((atCursor ?? scopes).flatMap((scope) => [...scope]))]
}

/**
 * The names to offer for the word at `wordStart`, which so far reads `prefix`: the script's own
 * names in scope there, the game API names, and the keywords.
 */
export function nameCompletions(
  source: string,
  wordStart: number,
  prefix: string,
  options: { defaultScript: boolean },
): NameCompletion[] {
  const matches = (name: string) => name.toLowerCase().startsWith(prefix.toLowerCase())
  const locals = namesInScope(source, wordStart).filter(matches)
  const out: NameCompletion[] = locals.map((label) => ({
    label,
    type: 'variable',
    detail: 'declared in this script',
  }))
  for (const n of apiNames(options.defaultScript)) {
    if (!matches(n.name) || locals.includes(n.name)) continue
    const required = bindingOf(n).params.filter((p) => !p.endsWith('?'))
    out.push({
      label: n.name,
      type: n.is === 'value' ? 'constant' : 'function',
      detail: apiDetail(n),
      info: apiInfo(n),
      ...(n.is !== 'value' && {
        snippet: `${n.name}(${required.map((p) => '${' + p + '}').join(', ')})`,
      }),
    })
  }
  for (const k of KEYWORDS) if (matches(k)) out.push({ label: k, type: 'keyword' })
  return out
}

/**
 * The game API name under `pos`, for its hover: where the word is and what to show. A field
 * (after a `.`) is no API name.
 */
export function apiHover(
  source: string,
  pos: number,
  options: { defaultScript: boolean },
): { from: number; to: number; text: string } | null {
  let from = pos
  let to = pos
  while (from > 0 && /\w/.test(source[from - 1]!)) from--
  while (to < source.length && /\w/.test(source[to]!)) to++
  if (from === to || source[from - 1] === '.') return null
  const word = source.slice(from, to)
  const n = apiNames(options.defaultScript).find((a) => a.name === word)
  return n ? { from, to, text: apiInfo(n) } : null
}
