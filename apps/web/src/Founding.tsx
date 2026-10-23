import { useState, type FormEvent } from 'react'
import { REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH, foundingProblem } from '@csp/shared'

/**
 * The naming screen of a Player without a realm (first login, or after a Leader death): they name
 * their realm and their Leader, whose name from the game they may keep, before the realm and its
 * starting city are founded (`CONTEXT.md`: Realm name). The server checks the names again.
 */
export function Founding({
  leaderName: suggested,
  onFound,
}: {
  leaderName: string
  /** Sends the founding request; resolves with the server's reason when it is refused. */
  onFound: (realmName: string, leaderName: string) => Promise<string | undefined>
}) {
  const [realmName, setRealmName] = useState('')
  const [leaderName, setLeaderName] = useState(suggested)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = foundingProblem(realmName, leaderName)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    const refused = await onFound(realmName.trim(), leaderName.trim())
    if (refused) {
      setError(refused)
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-form">
        <h1>Found your realm</h1>
        <p className="founding-hint">
          Name your realm and your Leader. Others know your realm by its name, and it never changes.
        </p>
        <label>
          Realm name
          <input
            value={realmName}
            onChange={(e) => setRealmName(e.target.value)}
            maxLength={REALM_NAME_MAX_LENGTH}
            autoFocus
            required
          />
        </label>
        <label>
          Leader's name
          <input
            value={leaderName}
            onChange={(e) => setLeaderName(e.target.value)}
            maxLength={RESIDENT_NAME_MAX_LENGTH}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          Found the realm
        </button>
      </form>
    </main>
  )
}
