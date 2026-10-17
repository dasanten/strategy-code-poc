import { useState } from 'react'
import { checkScript, type Diagnostic } from '@csp/lang'
import { MapView } from './MapView.js'
import { ScriptEditor } from './ScriptEditor.js'
import { useWorld } from './useWorld.js'

export function App() {
  const { world, status } = useWorld()
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])

  return (
    <div className="layout">
      <header>
        <h1>Code Strategy</h1>
        <span className={`status ${status}`}>
          {status === 'open' ? `tick ${world?.tick ?? '…'}` : status}
        </span>
      </header>
      <main>
        <section className="map-panel">
          {world ? <MapView world={world} /> : <p>Waiting for the server…</p>}
        </section>
        <section className="editor-panel">
          <h2>Unit script</h2>
          <ScriptEditor onChange={(src) => setDiagnostics(checkScript(src))} />
          <p className="diagnostics">
            {diagnostics.length === 0
              ? 'No syntax errors.'
              : diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n')}
          </p>
        </section>
      </main>
    </div>
  )
}
