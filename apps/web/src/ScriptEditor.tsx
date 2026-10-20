import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { StreamLanguage } from '@codemirror/language'
import { linter, lintGutter, type Diagnostic as LintDiagnostic } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { checkScript } from '@csp/lang'
import { diagnosticRange, scriptHighlighting } from './script-editor.js'

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
