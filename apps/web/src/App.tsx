import { useCallback, useEffect, useState } from 'react'
import { checkScript, type Diagnostic } from '@csp/lang'
import type { Account } from '@csp/shared'
import { AdminPanel } from './AdminPanel.js'
import { api } from './api.js'
import { Login } from './Login.js'
import { MapView } from './MapView.js'
import { ResidentInspector, ResidentsList } from './Residents.js'
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
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const own = world ? world.residents.filter((r) => r.owner === world.home.realmId) : []
  const selected = own.find((r) => r.id === selectedId)
  const homeCity = world?.structures.cities.find((c) => c.id === world.home.cityId)

  async function logout() {
    await api.logout().catch(() => {})
    onLoggedOut()
  }

  return (
    <div className="layout">
      <header>
        <h1>Code Strategy</h1>
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
        <div className="play-column">
          <section className="map-panel">
            {world ? (
              <MapView world={world} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <p>Waiting for the server…</p>
            )}
          </section>
          {world && (
            <ResidentsList
              residents={own}
              leaderId={world.home.leaderId}
              tick={world.tick}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <div className="side-column">
          {world && (
            <ResidentInspector
              resident={selected}
              leaderId={world.home.leaderId}
              cityName={homeCity?.name}
              tick={world.tick}
            />
          )}
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
        </div>
      </main>
    </div>
  )
}
