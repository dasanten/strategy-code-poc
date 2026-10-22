import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { StreamLanguage } from '@codemirror/language'
import { linter, lintGutter, type Diagnostic as LintDiagnostic } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { checkScript } from '@csp/lang'
import { diagnosticRange, scriptHighlighting } from './script-editor.js'
import { THEME } from './theme.js'

const language = StreamLanguage.define(scriptHighlighting)

/** Marks syntax errors inline, with the same check the server runs on every saved version. */
const syntaxErrors = linter(
  (view): LintDiagnostic[] => {
    const source = view.state.doc.toString()
    return checkScript(source).map((d) => ({
      ...diagnosticRange(source, d),
      severity: 'error',
      message: d.message,
    }))
  },
  { delay: 300 },
)

/** One Dark's colours on the HUD's well, filling the height it is given (ADR 0008). */
const hudLook = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: THEME.ui.well },
    '.cm-gutters': { backgroundColor: THEME.ui.well, borderRight: `1px solid ${THEME.ui.line}` },
    '.cm-scroller': { fontFamily: THEME.font.mono, fontSize: '13px', lineHeight: '1.55' },
  },
  { dark: true },
)

/**
 * Script editor with highlighting and inline syntax errors. It starts from `initialSource`; give
 * it a new React `key` to open other source.
 */
export function ScriptEditor({
  initialSource,
  onChange,
}: {
  initialSource: string
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
        syntaxErrors,
        lintGutter(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
      ],
    })
    return () => view.destroy()
  }, [initialSource])

  return <div ref={hostRef} className="editor" />
}
