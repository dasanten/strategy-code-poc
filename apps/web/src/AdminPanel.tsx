import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  DIRECTIVE_BUY_OFF_PRICE,
  MAX_DIRECTIVE_GOALS,
  MAX_DIRECTIVE_REASON,
  MAX_DIRECTIVE_SOLDIERS,
  describeGoal,
  formatGameTime,
  goalMet,
  type Account,
  type AdminDirectives,
  type AdminDirectiveView,
  type DirectiveGoalRequest,
} from '@csp/shared'
import { api, ApiFailure } from './api.js'
import { AdminMap } from './AdminMap.js'
import {
  ADMIN_TABS,
  adminDirectivePath,
  adminTabFor,
  adminTabPath,
  directiveTargetFor,
  type AdminTab,
} from './pages.js'

/** What each admin tab is called. */
const TAB_NAMES: Record<AdminTab, string> = {
  map: 'Map',
  accounts: 'Accounts',
  directives: 'Directives',
}

/**
 * The admin panel, a page apart from the game (`CONTEXT.md`: Admin), in tabs: the admin map, the
 * accounts and the admin directives, each at its own path. It never opens the admin's realm: the
 * admin map's knowledge is the admin's, never their Player's.
 */
export function AdminPage({ account, onLoggedOut }: { account: Account; onLoggedOut: () => void }) {
  const [tab, setTab] = useState<AdminTab>(() => adminTabFor(window.location.pathname))
  // The map's view, kept while another tab is open so going back lands on the same spot.
  const [mapSearch, setMapSearch] = useState(() => (tab === 'map' ? window.location.search : ''))
  // The directive target chosen in the URL, such as from the admin map's inspector.
  const [directiveTarget, setDirectiveTarget] = useState(() =>
    tab === 'directives' ? directiveTargetFor(window.location.search) : '',
  )

  useEffect(() => {
    const onPop = () => {
      setTab(adminTabFor(window.location.pathname))
      if (adminTabFor(window.location.pathname) === 'map') setMapSearch(window.location.search)
      else setDirectiveTarget(directiveTargetFor(window.location.search))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function open(next: AdminTab) {
    if (next === tab) return
    history.pushState(null, '', adminTabPath(next) + (next === 'map' ? mapSearch : ''))
    setTab(next)
    setDirectiveTarget('')
  }

  // The inspector's shortcut: the Directives tab with the target chosen.
  const giveDirective = useCallback((org: string) => {
    history.pushState(null, '', adminDirectivePath(org))
    setDirectiveTarget(org)
    setTab('directives')
  }, [])

  const onMapSearch = useCallback((search: string) => {
    setMapSearch(search)
    history.replaceState(null, '', adminTabPath('map') + search)
  }, [])

  async function logout() {
    await api.logout().catch(() => {})
    onLoggedOut()
  }

  return (
    <div className="layout admin-page">
      <header>
        <h1>Code Strategy admin</h1>
        {account.isAdmin && (
          <div className="tabs admin-tabs" role="tablist">
            {ADMIN_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => open(t)}
              >
                {TAB_NAMES[t]}
              </button>
            ))}
          </div>
        )}
        <a href="/">Back to the game</a>
        <span className="spacer" />
        <span>{account.name}</span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      {!account.isAdmin ? (
        <main className="admin-main">
          <p>Only admins can open the admin panel.</p>
        </main>
      ) : tab === 'map' ? (
        <main className="admin-map-main">
          <AdminMap search={mapSearch} onSearch={onMapSearch} onDirective={giveDirective} />
        </main>
      ) : (
        <main className="admin-main">
          {tab === 'accounts' ? (
            <AdminPanel />
          ) : (
            <DirectivesPanel key={directiveTarget} initialTarget={directiveTarget} />
          )}
        </main>
      )}
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
 * with its alliance, a reason every Player sees, goals that end it and maybe a price to buy it
 * off; see how far each goal has come; change that price or lift one in force. `initialTarget`
 * comes chosen, as from the admin map's inspector.
 */
function DirectivesPanel({ initialTarget }: { initialTarget: string }) {
  const [shown, setShown] = useState<AdminDirectives>()
  const [target, setTarget] = useState(initialTarget)
  const [withAlliance, setWithAlliance] = useState(false)
  const [reason, setReason] = useState('')
  const [buyOff, setBuyOff] = useState(false)
  const [price, setPrice] = useState(DIRECTIVE_BUY_OFF_PRICE)
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
      const d = await api.giveDirective({
        target,
        withAlliance,
        reason,
        goals,
        price: buyOff ? price : null,
      })
      setMessage(`Directive given against ${d.targetName}.`)
      setReason('')
      setGoals([])
      await load()
    } catch (err) {
      report(err)
    }
  }

  async function setPriceOf(d: AdminDirectiveView, to: number | null) {
    try {
      await api.setDirectivePrice(d.id, { price: to })
      setMessage(
        to === null
          ? `${d.targetName} can no longer buy off its directive.`
          : `${d.targetName} can buy off its directive for ${to} Coins.`,
      )
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
        lift it: it refuses it trade and sends its army against it. Where you allow it, the target
        ends it by paying its price at any Trade Org warehouse. Every Player sees the target, the
        reason, the goals and the price; only admins see who gave it and how far it has come.
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
              <DirectivePrice directive={d} onSet={(to) => setPriceOf(d, to)} />{' '}
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
        <label>
          <input type="checkbox" checked={buyOff} onChange={(e) => setBuyOff(e.target.checked)} />
          Can be bought off
        </label>
        {buyOff && (
          <label>
            Price in Coins
            <input
              type="number"
              min={1}
              step={1}
              value={price}
              onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </label>
        )}
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

/**
 * Whether a directive in force can be bought off, and at what price (`CONTEXT.md`: Admin
 * directive): allow it at a price, change the price, or stop allowing it.
 */
function DirectivePrice({
  directive,
  onSet,
}: {
  directive: AdminDirectiveView
  onSet: (price: number | null) => void
}) {
  const [price, setPrice] = useState(directive.price ?? DIRECTIVE_BUY_OFF_PRICE)
  return (
    <span className="small">
      {directive.price === null ? 'Not for sale. ' : `Bought off for ${directive.price} Coins. `}
      <input
        type="number"
        min={1}
        step={1}
        value={price}
        aria-label={`Price to buy off the directive against ${directive.targetName}`}
        onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
      />{' '}
      <button type="button" onClick={() => onSet(price)}>
        {directive.price === null ? 'Allow buying off' : 'Set price'}
      </button>
      {directive.price !== null && (
        <>
          {' '}
          <button type="button" onClick={() => onSet(null)}>
            Don’t allow
          </button>
        </>
      )}
    </span>
  )
}
