import { useState, type FormEvent } from 'react'
import type { Account } from '@csp/shared'
import { api, ApiFailure } from './api.js'

/**
 * The admin panel, a page apart from the game (`CONTEXT.md`: Admin). It never opens the admin's
 * realm: being an admin gives no power or knowledge in the world.
 */
export function AdminPage({ account, onLoggedOut }: { account: Account; onLoggedOut: () => void }) {
  async function logout() {
    await api.logout().catch(() => {})
    onLoggedOut()
  }

  return (
    <div className="layout">
      <header>
        <h1>Code Strategy admin</h1>
        <a href="/">Back to the game</a>
        <span className="spacer" />
        <span>{account.name}</span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <main className="admin-main">
        {account.isAdmin ? <AdminPanel /> : <p>Only admins can open the admin panel.</p>}
      </main>
    </div>
  )
}

/** Invite codes and password resets, for admins only (ADR 0005). */
function AdminPanel() {
  const [codes, setCodes] = useState<string[]>([])
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  const report = (err: unknown) =>
    setMessage(err instanceof ApiFailure ? err.message : 'Something went wrong.')

  async function invite() {
    try {
      const { code } = await api.createInvite()
      setCodes((c) => [code, ...c])
    } catch (err) {
      report(err)
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault()
    try {
      await api.resetPassword({ name, password })
      setMessage(`New password set for ${name}; they were logged out everywhere.`)
      setPassword('')
    } catch (err) {
      report(err)
    }
  }

  return (
    <section className="admin-panel">
      <h2>Accounts</h2>
      <button type="button" onClick={invite}>
        New invite code
      </button>
      {codes.length > 0 && (
        <ul className="codes">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={reset}>
        <label>
          Player
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <button type="submit">Reset password</button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
