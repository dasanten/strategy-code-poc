import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'

const EXAMPLE = `if (memory.role == null) { memory.role = "gatherer" }

let enemy = world.nearest("enemy")
if (enemy != null && distance(me, enemy) < 3) {
  attack(enemy)
} else {
  move(towards(world.nearest("resource")))
}
`

/** Script editor. Highlighting and inline errors for our language come with packages/lang. */
export function ScriptEditor({ onChange }: { onChange?: (source: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const view = new EditorView({
      doc: EXAMPLE,
      parent: hostRef.current!,
      extensions: [
        basicSetup,
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange?.(u.state.doc.toString())
        }),
      ],
    })
    onChange?.(EXAMPLE)
    return () => view.destroy()
  }, [])

  return <div ref={hostRef} className="editor" />
}
