import { useState, type FormEvent } from 'react'
import { REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH } from '@csp/balance'
import { foundingProblem } from './shared/names.js'
import { EntryScreen } from './Login.js'

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
    <EntryScreen label="Found your realm">
      <h2 className="hd">
        <span className="ic s24 i-crown" aria-hidden="true" />
        <span className="grow">Found your realm</span>
      </h2>
      <form onSubmit={submit} className="login-form">
        <p>
          Name your realm and your Leader. Others know your realm by its name, and it never changes.
        </p>
        <label className="fld">
          <span className="lb">Realm name</span>
          <input
            className="in lg"
            value={realmName}
            onChange={(e) => setRealmName(e.target.value)}
            maxLength={REALM_NAME_MAX_LENGTH}
            autoFocus
            required
          />
        </label>
        <label className="fld">
          <span className="lb">Leader's name</span>
          <input
            className="in lg"
            value={leaderName}
            onChange={(e) => setLeaderName(e.target.value)}
            maxLength={RESIDENT_NAME_MAX_LENGTH}
            required
          />
          <span className="mu">A name from the game. Keep it or type your own.</span>
        </label>
        {error && (
          <p className="login-error well bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn gold lg" disabled={busy}>
          Found the realm
        </button>
      </form>
    </EntryScreen>
  )
}

/**
 * Over the game once the Player's Leader has died with no heir (`CONTEXT.md`: Leader):
 * Start afresh reloads, and the server then asks for a new founding.
 */
export function RealmEnded() {
  return (
    <div className="hud-backdrop">
      <div
        className="hud-dialog realm-ended pn"
        role="alertdialog"
        aria-modal="true"
        aria-label="Your realm has ended"
      >
        <h2 className="hd">
          <span className="ic s24 i-warn" aria-hidden="true" />
          <span className="grow">Your realm has ended</span>
        </h2>
        <p>
          Your Leader has died and your realm has ended. The realm log says what became of your
          cities. You start afresh with a new Leader and a new starting city.
        </p>
        <div className="hud-dialog-actions">
          <button type="button" className="btn pri lg" onClick={() => window.location.reload()}>
            Start afresh
          </button>
        </div>
      </div>
    </div>
  )
}
