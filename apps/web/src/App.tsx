import { useCallback, useEffect, useState } from 'react'
import { checkScript, type Diagnostic } from '@csp/lang'
import { formatGameTime, type Account } from '@csp/shared'
import { AdminPanel } from './AdminPanel.js'
import { api } from './api.js'
import { Login } from './Login.js'
import { MapView } from './MapView.js'
import { ScriptEditor } from './ScriptEditor.js'
import { useWorld } from './useWorld.js'

export function App() {
  const [account, setAccount] = useState<Account | null | 'loading'>('loading')

  useEffect(() => {
    api.me().then(setAccount, () => setAccount(null))
  }, [])

  const loggedOut = useCallback(() => setAccount(null), [])

  if (account === 'loading') return null
  if (!account) return <Login onLoggedIn={setAccount} />
  return <Game account={account} onLoggedOut={loggedOut} />
}

function Game({ account, onLoggedOut }: { account: Account; onLoggedOut: () => void }) {
  const { world, status } = useWorld(onLoggedOut)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])

  async function logout() {
    await api.logout().catch(() => {})
    onLoggedOut()
  }

  return (
    <div className="layout">
      <header>
        <h1>Code Strategy</h1>
        {world && (
          <span className="clock" title="1 game day = 1 real hour; 1 game year = 1 real day">
            {formatGameTime(world.tick)}
          </span>
        )}
        <span className={`status ${status}`}>
          {status === 'open' ? `tick ${world?.tick ?? '…'}` : status}
        </span>
        <span className="spacer" />
        <span>{account.name}</span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <main>
        <section className="map-panel">
          {world ? <MapView world={world} /> : <p>Waiting for the server…</p>}
        </section>
        <section className="editor-panel">
          <h2>Resident script</h2>
          <ScriptEditor onChange={(src) => setDiagnostics(checkScript(src))} />
          <p className="diagnostics">
            {diagnostics.length === 0
              ? 'No syntax errors.'
              : diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n')}
          </p>
          {account.isAdmin && <AdminPanel />}
        </section>
      </main>
    </div>
  )
}
