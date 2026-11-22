import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import { linter, lintGutter, type Diagnostic as LintDiagnostic } from '@codemirror/lint'
import { EditorView, hoverTooltip } from '@codemirror/view'
import { color as oneDarkColor, oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { checkScript, loadLang, type Diagnostic } from '@csp/lang-wasm'
import {
  apiHover,
  diagnosticRange,
  fieldCompletions,
  fieldHover,
  nameCompletions,
  scriptHighlighting,
  scriptWarnings,
} from './script-editor.js'
import { EDITOR_LOOK } from './script-editor-look.js'
import { THEME } from './theme.js'

const language = StreamLanguage.define(scriptHighlighting)

/**
 * Marks syntax errors inline in red, with the same check the server runs on every saved
 * version (the server's own checker, as WebAssembly, fetched when the first editor opens), and
 * the checker's warnings in yellow, which never stop a version from running.
 */
function diagnostics(defaultScript: boolean) {
  return linter(
    async (view): Promise<LintDiagnostic[]> => {
      await loadLang()
      const source = view.state.doc.toString()
      const mark = (severity: 'error' | 'warning') => (d: Diagnostic) => ({
        ...diagnosticRange(source, d),
        severity,
        message: d.message,
      })
      return [
        ...checkScript(source).map(mark('error')),
        ...scriptWarnings(source, defaultScript).map(mark('warning')),
      ]
    },
    { delay: 300 },
  )
}

/** Whether `pos` is inside a comment or a string, where nothing is completed. */
function inText(context: CompletionContext): boolean {
  const name = syntaxTree(context.state).resolveInner(context.pos, -1).name
  return name === 'comment' || name === 'string'
}

/**
 * Completes keywords, game API names and the script's own names; after a `.`, the fields of the
 * value's script view where it is certain.
 */
function names(defaultScript: boolean) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/\w*/)
    if (!word || inText(context)) return null
    await loadLang()
    const source = context.state.doc.toString()
    if (context.state.sliceDoc(word.from - 1, word.from) === '.') {
      const fields = fieldCompletions(source, word.from, word.to, { defaultScript })
      return fields && { from: word.from, options: fields, validFor: /^\w*$/ }
    }
    if (word.from === word.to && !context.explicit) return null
    const options = nameCompletions(source, word.from, word.text, { defaultScript }).map(
      ({ snippet, ...c }): Completion => (snippet ? snippetCompletion(snippet, c) : c),
    )
    return { from: word.from, options, validFor: /^\w*$/ }
  }
}

/** Shows a game API name's parameters, cost and description, or a field's, on hover. */
function apiTooltips(defaultScript: boolean) {
  return hoverTooltip(async (view, pos) => {
    await loadLang()
    const source = view.state.doc.toString()
    const hover =
      apiHover(source, pos, { defaultScript }) ?? fieldHover(source, pos, { defaultScript })
    if (!hover) return null
    return {
      pos: hover.from,
      end: hover.to,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-api-info'
        dom.textContent = hover.text
        return { dom }
      },
    }
  })
}

const look = EDITOR_LOOK

/**
 * The editor's dark look from the palette (ADR 0044; `script-editor-look`), filling the height it
 * is given: hard 2 px edges, no rounded corners, lint marks and tooltips in the kit's colours.
 */
const pixelLook = EditorView.theme(
  {
    '&': { height: '100%', color: look.text, backgroundColor: look.ground },
    '.cm-content': { caretColor: look.cursor },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: look.cursor, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: look.selection },
    '.cm-activeLine': { backgroundColor: look.activeLine },
    '.cm-selectionMatch': { backgroundColor: look.activeLine },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: look.selection,
      outline: `1px solid ${look.keyword}`,
    },
    '.cm-gutters': {
      backgroundColor: look.ground,
      color: look.gutter,
      border: 'none',
      borderRight: `2px solid ${THEME.ui.ink}`,
    },
    '.cm-activeLineGutter': { backgroundColor: look.activeLine, color: look.text },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: look.gutter },
    '.cm-scroller': { fontFamily: THEME.font.mono, fontSize: '13px', lineHeight: '1.55' },
    '.cm-panels': { backgroundColor: look.tooltip.ground, color: look.tooltip.text },
    '.cm-searchMatch': { backgroundColor: look.picked.ground, outline: `1px solid ${look.number}` },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: look.selection },
    // Lint marks: a wavy underline in red for an error, gold for a warning.
    '.cm-lintRange-error, .cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecorationLine: 'underline',
      textDecorationStyle: 'wavy',
      textDecorationThickness: '1px',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-error': { textDecorationColor: look.error },
    '.cm-lintRange-warning': { textDecorationColor: look.warning },
    // Hovers, completions and lint messages: ink boxes with a steel edge.
    '.cm-tooltip': {
      backgroundColor: look.tooltip.ground,
      color: look.tooltip.text,
      border: `2px solid ${look.tooltip.edge}`,
      borderRadius: '0',
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: look.tooltip.edge,
      borderBottomColor: look.tooltip.edge,
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: look.tooltip.ground,
      borderBottomColor: look.tooltip.ground,
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: THEME.font.mono },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: look.picked.ground,
      color: look.picked.text,
    },
    '.cm-completionMatchedText': { color: look.matched, textDecoration: 'none' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText': {
      color: look.picked.text,
      textDecoration: 'underline',
    },
    '.cm-completionDetail': { color: look.tooltip.muted },
    '.cm-diagnostic': { borderRadius: '0' },
    '.cm-diagnostic-error': { borderLeft: `4px solid ${look.error}` },
    '.cm-diagnostic-warning': { borderLeft: `4px solid ${look.warning}` },
    '.cm-api-info, .cm-completionInfo': {
      maxWidth: '360px',
      padding: '4px 8px',
      whiteSpace: 'pre-wrap',
      fontSize: '12px',
    },
  },
  { dark: true },
)

/** One Dark's colour for each kind of word, by its role there, as the palette colour it takes. */
const PALETTE_FOR: Record<string, string> = {
  [oneDarkColor.violet]: look.keyword,
  [oneDarkColor.stone]: look.comment,
  [oneDarkColor.sage]: look.string,
  [oneDarkColor.chalky]: look.number,
  [oneDarkColor.whiskey]: look.atom,
  [oneDarkColor.cyan]: look.operator,
}

/**
 * The highlighting: One Dark's (which kind of word gets a colour of its own, so the highlighting
 * stays what it was), each colour swapped for the palette's (`EDITOR_LOOK`); names in the text
 * colour.
 */
const pixelHighlighting = syntaxHighlighting(
  HighlightStyle.define(
    oneDarkHighlightStyle.specs.map((spec) =>
      typeof spec.color === 'string'
        ? { ...spec, color: PALETTE_FOR[spec.color] ?? look.text }
        : spec,
    ),
  ),
)

/**
 * Script editor with highlighting, inline syntax errors, and completions and hovers for the game
 * API. A default script gets the resident's API only. It starts from `initialSource`; give it a
 * new React `key` to open other source. With a `line`, it opens there, the word at `column`
 * picked, as for a runtime error (`CONTEXT.md`: Debugging a script).
 */
export function ScriptEditor({
  initialSource,
  line,
  column,
  defaultScript,
  onChange,
}: {
  initialSource: string
  line?: number
  column?: number
  defaultScript: boolean
  onChange: (source: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    // Fetched once, while the editor paints; the lints, completions and hovers wait for it.
    void loadLang()
    const view = new EditorView({
      doc: initialSource,
      parent: hostRef.current!,
      extensions: [
        basicSetup,
        pixelLook,
        pixelHighlighting,
        language,
        autocompletion({ override: [names(defaultScript)] }),
        apiTooltips(defaultScript),
        diagnostics(defaultScript),
        lintGutter(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
      ],
    })
    if (line !== undefined) {
      const at = { line, column: column ?? 1, message: '' }
      const { from, to } = diagnosticRange(initialSource, at)
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      })
      view.focus()
    }
    return () => view.destroy()
  }, [initialSource, defaultScript, line, column])

  return <div ref={hostRef} className="editor" />
}
