import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH, type Account } from '@csp/shared'
import { api, ApiFailure } from './api.js'

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
    <main className="login">
      <form onSubmit={submit} className="login-form">
        <h1>Code Strategy</h1>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!signup} onClick={() => setMode('login')}>
            Log in
          </button>
          <button type="button" role="tab" aria-selected={signup} onClick={() => setMode('signup')}>
            Sign up
          </button>
        </div>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? MIN_PASSWORD_LENGTH : undefined}
            required
          />
        </label>
        {signup && (
          <label>
            Invite code
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {signup ? 'Create account' : 'Log in'}
        </button>
      </form>
    </main>
  )
}
