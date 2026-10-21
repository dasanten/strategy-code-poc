import { useEffect, useState, type FormEvent } from 'react'
import {
  MAX_DIRECTIVE_GOALS,
  MAX_DIRECTIVE_REASON,
  MAX_DIRECTIVE_SOLDIERS,
  describeGoal,
  formatGameTime,
  goalMet,
  type Account,
  type AdminDirectives,
  type DirectiveGoalRequest,
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
 * with its alliance, a reason every Player sees and goals that end it; see how far each goal has
 * come; lift one in force.
 */
function DirectivesPanel() {
  const [shown, setShown] = useState<AdminDirectives>()
  const [target, setTarget] = useState('')
  const [withAlliance, setWithAlliance] = useState(false)
  const [reason, setReason] = useState('')
  const [goals, setGoals] = useState<DirectiveGoalRequest[]>([])
  const [goalKind, setGoalKind] = useState<DirectiveGoalRequest['kind']>('city')
  const [goalCity, setGoalCity] = useState('')
  const [goalNumber, setGoalNumber] = useState(10)
  const [message, setMessage] = useState('')

  const report = (err: unknown) =>
    setMessage(err instanceof ApiFailure ? err.message : 'Something went wrong.')
  const load = () => api.directives().then(setShown, report)
  useEffect(() => {
    void load()
  }, [])

  // The cities a city goal can name: the target's, and with its alliance its allies' too.
  const chosen = shown?.targets.find((t) => t.org === target)
  const named = chosen ? [chosen.org, ...(withAlliance ? chosen.allies : [])] : []
  const cityChoices = (shown?.targets ?? [])
    .filter((t) => named.includes(t.org))
    .flatMap((t) => t.cities)
  const cityName = (id: string) => cityChoices.find((c) => c.id === id)?.name ?? id

  function addGoal() {
    if (goalKind === 'city') {
      if (goalCity === '' || goals.some((g) => g.kind === 'city' && g.cityId === goalCity)) return
      setGoals([...goals, { kind: 'city', cityId: goalCity }])
    } else if (goalKind === 'soldiers') {
      setGoals([...goals, { kind: 'soldiers', count: goalNumber }])
    } else {
      setGoals([...goals, { kind: 'soldierShare', percent: goalNumber }])
    }
  }

  function goalText(g: DirectiveGoalRequest): string {
    if (g.kind === 'city') return `${cityName(g.cityId)} destroyed`
    if (g.kind === 'soldiers') return `${g.count} soldiers killed`
    return `${g.percent}% of its soldiers killed`
  }

  // Resets the goals when the target or its alliance changes, since city goals depend on them.
  function retarget(next: string, alliance: boolean) {
    setTarget(next)
    setWithAlliance(alliance)
    setGoals([])
    setGoalCity('')
  }

  async function give(e: FormEvent) {
    e.preventDefault()
    try {
      const d = await api.giveDirective({ target, withAlliance, reason, goals })
      setMessage(`Directive given against ${d.targetName}.`)
      setReason('')
      setGoals([])
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
        The Trade Organization treats the target as one to punish until all its goals are met or you
        lift it: it refuses it trade and sends its army against it. Every Player sees the target,
        the reason and the goals; only admins see who gave it and how far it has come.
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
              <ul aria-label={`Goals against ${d.targetName}`}>
                {d.goals.length === 0 && (
                  <li className="muted small">No goals: it ends only when lifted.</li>
                )}
                {d.goals.map((g, i) => (
                  <li key={i}>
                    {describeGoal(g)}:{' '}
                    {g.kind === 'city'
                      ? g.met
                        ? 'met'
                        : 'not yet'
                      : `${Math.min(d.soldiersKilled, g.count)} of ${g.count} killed${goalMet(d, g) ? ', met' : ''}`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No directive is in force.</p>
      )}
      <form onSubmit={give}>
        <label>
          Target
          <select value={target} onChange={(e) => retarget(e.target.value, withAlliance)} required>
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
            onChange={(e) => retarget(target, e.target.checked)}
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
        <fieldset aria-label="Goals">
          <legend>Goals (all must be met)</legend>
          {goals.length > 0 && (
            <ul className="codes">
              {goals.map((g, i) => (
                <li key={i}>
                  {goalText(g)}{' '}
                  <button type="button" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <select
            aria-label="Goal kind"
            value={goalKind}
            onChange={(e) => setGoalKind(e.target.value as DirectiveGoalRequest['kind'])}
          >
            <option value="city">A city destroyed</option>
            <option value="soldiers">Soldiers killed</option>
            <option value="soldierShare">Share of its soldiers killed</option>
          </select>{' '}
          {goalKind === 'city' ? (
            <select
              aria-label="Goal city"
              value={goalCity}
              onChange={(e) => setGoalCity(e.target.value)}
            >
              <option value="">Choose…</option>
              {cityChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={goalKind === 'soldiers' ? 'Soldiers' : 'Percent'}
              type="number"
              min={1}
              max={goalKind === 'soldiers' ? MAX_DIRECTIVE_SOLDIERS : 100}
              value={goalNumber}
              onChange={(e) => setGoalNumber(Number(e.target.value))}
            />
          )}{' '}
          <button type="button" onClick={addGoal} disabled={goals.length >= MAX_DIRECTIVE_GOALS}>
            Add goal
          </button>
        </fieldset>
        <button type="submit" disabled={goals.length === 0}>
          Give directive
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  )
}
