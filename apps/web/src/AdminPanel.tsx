import { useEffect, useState, type FormEvent } from 'react'
import {
  MAX_DIRECTIVE_REASON,
  formatGameTime,
  type Account,
  type AdminDirectives,
} from '@csp/shared'
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
        {account.isAdmin ? (
          <>
            <AdminPanel />
            <DirectivesPanel />
          </>
        ) : (
          <p>Only admins can open the admin panel.</p>
        )}
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

/**
 * Admin directives (`CONTEXT.md`: Admin directive): give one naming an Organization, optionally
 * with its alliance, and a reason every Player sees; lift one in force.
 */
function DirectivesPanel() {
  const [shown, setShown] = useState<AdminDirectives>()
  const [target, setTarget] = useState('')
  const [withAlliance, setWithAlliance] = useState(false)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')

  const report = (err: unknown) =>
    setMessage(err instanceof ApiFailure ? err.message : 'Something went wrong.')
  const load = () => api.directives().then(setShown, report)
  useEffect(() => {
    void load()
  }, [])

  async function give(e: FormEvent) {
    e.preventDefault()
    try {
      const d = await api.giveDirective({ target, withAlliance, reason })
      setMessage(`Directive given against ${d.targetName}.`)
      setReason('')
      await load()
    } catch (err) {
      report(err)
    }
  }

  async function lift(id: string, name: string) {
    try {
      await api.liftDirective(id)
      setMessage(`Directive against ${name} lifted.`)
      await load()
    } catch (err) {
      report(err)
    }
  }

  return (
    <section className="admin-panel" aria-label="Admin directives">
      <h2>Admin directives</h2>
      <p className="muted small">
        The Trade Organization treats the target as one to punish until you lift it: it refuses it
        trade and sends its army against it. Every Player sees the target and the reason; only
        admins see who gave it.
      </p>
      {shown && shown.directives.length > 0 ? (
        <ul className="codes">
          {shown.directives.map((d) => (
            <li key={d.id}>
              {d.targetName}
              {d.withAlliance && ' and its alliance'}: {d.reason}{' '}
              <span className="muted small">
                (by {d.givenBy}, {formatGameTime(d.givenAt)})
              </span>{' '}
              <button type="button" onClick={() => lift(d.id, d.targetName)}>
                Lift
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No directive is in force.</p>
      )}
      <form onSubmit={give}>
        <label>
          Target
          <select value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="">Choose…</option>
            {shown?.targets.map((t) => (
              <option key={t.org} value={t.org}>
                {t.is === 'city' ? `${t.name} (NPC city)` : `${t.name} (${t.account ?? 'realm'})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={withAlliance}
            onChange={(e) => setWithAlliance(e.target.checked)}
          />
          With its alliance
        </label>
        <label>
          Reason
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_DIRECTIVE_REASON}
            required
          />
        </label>
        <button type="submit">Give directive</button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
