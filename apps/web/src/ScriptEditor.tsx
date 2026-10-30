import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { StreamLanguage, syntaxTree } from '@codemirror/language'
import { linter, lintGutter, type Diagnostic as LintDiagnostic } from '@codemirror/lint'
import { EditorView, hoverTooltip } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { checkScript, type Diagnostic } from '@csp/lang'
import {
  apiHover,
  diagnosticRange,
  fieldCompletions,
  fieldHover,
  nameCompletions,
  scriptHighlighting,
  scriptWarnings,
} from './script-editor.js'
import { THEME } from './theme.js'

const language = StreamLanguage.define(scriptHighlighting)

/**
 * Marks syntax errors inline in red, with the same check the server runs on every saved
 * version, and the checker's warnings in yellow, which never stop a version from running.
 */
function diagnostics(defaultScript: boolean) {
  return linter(
    (view): LintDiagnostic[] => {
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
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\w*/)
    if (!word || inText(context)) return null
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
  return hoverTooltip((view, pos) => {
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

/** One Dark's colours on the HUD's well, filling the height it is given (ADR 0008). */
const hudLook = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: THEME.ui.well },
    '.cm-gutters': { backgroundColor: THEME.ui.well, borderRight: `1px solid ${THEME.ui.line}` },
    '.cm-scroller': { fontFamily: THEME.font.mono, fontSize: '13px', lineHeight: '1.55' },
    '.cm-api-info, .cm-completionInfo': {
      maxWidth: '360px',
      padding: '4px 8px',
      whiteSpace: 'pre-wrap',
      fontSize: '12px',
    },
  },
  { dark: true },
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
    const view = new EditorView({
      doc: initialSource,
      parent: hostRef.current!,
      extensions: [
        basicSetup,
        // Before One Dark, so its colours give way to the HUD's.
        hudLook,
        oneDark,
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
