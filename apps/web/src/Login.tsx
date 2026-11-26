import { useState, type FormEvent, type ReactNode } from 'react'
import { MIN_PASSWORD_LENGTH } from '@csp/shared-types'
import type { Account } from '@csp/shared-types'
import { api, ApiFailure } from './api.js'
import { WIKI_PATH } from './wiki/wiki-view.js'

/**
 * The game's title over the dimmed board, above the panel of the screens outside the game (log
 * in, sign up, founding; artboard `Entry`).
 */
export function EntryScreen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <main className="login">
      <div className="login-title">
        <h1 className="px">Code Strategy</h1>
        <p className="px t18">One world. It keeps running while you sleep.</p>
      </div>
      <section className="login-panel pn" aria-label={label}>
        {children}
      </section>
    </main>
  )
}

/** Log in, or sign up with an invite code (ADR 0005). */
export function Login({ onLoggedIn }: { onLoggedIn: (account: Account) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLoggedIn(
        mode === 'login'
          ? await api.login({ name, password })
          : await api.signUp({ name, password, inviteCode }),
      )
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const signup = mode === 'signup'
  return (
    <EntryScreen label={signup ? 'Sign up' : 'Log in'}>
      <div className="tabs" role="tablist">
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={!signup}
          onClick={() => setMode('login')}
        >
          Log in
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={signup}
          onClick={() => setMode('signup')}
        >
          Sign up
        </button>
      </div>
      <form onSubmit={submit} className="login-form">
        <label className="fld">
          <span className="lb">Name</span>
          <input
            className="in lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="fld">
          <span className="lb">Password</span>
          <input
            className="in lg"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? MIN_PASSWORD_LENGTH : undefined}
            required
          />
          {signup && <span className="mu">At least {MIN_PASSWORD_LENGTH} characters.</span>}
        </label>
        {signup && (
          <label className="fld">
            <span className="lb">Invite code</span>
            <input
              className="in lg mono"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
            />
          </label>
        )}
        {error && (
          <p className="login-error well bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn pri lg" disabled={busy}>
          {signup ? 'Create account' : 'Log in'}
        </button>
        <p className="login-wiki">
          The game's rules and numbers: <a href={WIKI_PATH}>Wiki</a>
        </p>
      </form>
    </EntryScreen>
  )
}
