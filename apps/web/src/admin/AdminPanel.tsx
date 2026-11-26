import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DIRECTIVE_BUY_OFF_PRICE } from '@csp/balance'
import {
  MAX_DIRECTIVE_GOALS,
  MAX_DIRECTIVE_REASON,
  MAX_DIRECTIVE_SOLDIERS,
} from '@csp/shared-types'
import { describeGoal } from './directive.js'
import { goalProgress } from './admin-directives.js'
import { formatGameTime } from '@csp/lang-wasm'
import type {
  Account,
  AdminDirectives,
  AdminDirectiveView,
  DirectiveGoalRequest,
} from '@csp/shared-types'
import { api, ApiFailure } from '../world/api.js'
import { AdminMap } from './AdminMap.js'
import { TickHealthPanel } from './TickHealth.js'
import {
  ADMIN_TABS,
  adminDirectivePath,
  adminTabFor,
  adminTabPath,
  directiveTargetFor,
  type AdminTab,
} from '../screen/pages.js'
import { Icon } from '../ui/Icon.js'

/** What each admin tab is called. */
const TAB_NAMES: Record<AdminTab, string> = {
  map: 'Map',
  accounts: 'Accounts',
  directives: 'Directives',
  'tick-health': 'Tick health',
}

/**
 * The admin panel, a page apart from the game (`CONTEXT.md`: Admin), in tabs: the admin map, the
 * accounts, the admin directives and the tick health, each at its own path. It never opens the admin's realm: the
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
    <div className="admin-page">
      <header className="bar admin-head">
        <Icon name="key" size={24} />
        <h1 className="px t18">Code Strategy admin</h1>
        {account.isAdmin && (
          <div className="fx admin-tabs" role="tablist">
            {ADMIN_TABS.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn sm dk${tab === t ? ' on' : ''}`}
                role="tab"
                aria-selected={tab === t}
                onClick={() => open(t)}
              >
                {TAB_NAMES[t]}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {account.isAdmin && tab === 'map' && (
          <span className="chip d admin-head-note">
            Nothing here gives orders, except admin directives
          </span>
        )}
        <a className="btn sm dk" href="/">
          Back to the game
        </a>
        <span className="mu admin-head-account">{account.name}</span>
        <button type="button" className="btn sm dk" onClick={logout}>
          Log out
        </button>
      </header>
      {!account.isAdmin ? (
        <main className="admin-main">
          <section className="pn" aria-label="Not an admin">
            <h2 className="hd">Not an admin</h2>
            <p className="sec">Only admins can open the admin panel.</p>
          </section>
        </main>
      ) : tab === 'map' ? (
        <main className="admin-map-main">
          <AdminMap search={mapSearch} onSearch={onMapSearch} onDirective={giveDirective} />
        </main>
      ) : (
        <main className="admin-main">
          {tab === 'accounts' ? (
            <AdminPanel />
          ) : tab === 'tick-health' ? (
            <TickHealthPanel />
          ) : (
            <DirectivesPanel key={directiveTarget} initialTarget={directiveTarget} />
          )}
        </main>
      )}
    </div>
  )
}

/** Invite codes, password resets and offering horses again, for admins only (ADR 0005). */
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
    <>
      <section className="pn admin-panel" aria-label="Accounts">
        <h2 className="hd">Accounts</h2>
        <div className="sec">
          <h3 className="px t16">Invite codes</h3>
          <button type="button" className="btn pri" onClick={invite}>
            New invite code
          </button>
          {codes.length > 0 && (
            <>
              <ul className="well mono admin-codes">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <span className="mu small">Newest first.</span>
            </>
          )}
        </div>
        <form className="sec" onSubmit={reset}>
          <h3 className="px t16">Reset a password</h3>
          <label className="fld">
            <span className="lb">Player</span>
            <input className="in" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="fld">
            <span className="lb">New password</span>
            <input
              className="in"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <button type="submit" className="btn">
            Reset password
          </button>
          {message && (
            <p role="status" className="well admin-note">
              {message}
            </p>
          )}
        </form>
      </section>
      <OfferHorsesAgain />
    </>
  )
}

/**
 * Offering horses again (`CONTEXT.md`: Horse offer): re-opens the Horse offer for the Player named,
 * or with no name for every Player, once the admin has confirmed that.
 */
function OfferHorsesAgain() {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')

  async function offer(e: FormEvent) {
    e.preventDefault()
    const player = name.trim()
    if (
      player === '' &&
      !window.confirm('Offer horses again to every Player who claimed theirs?')
    ) {
      return
    }
    try {
      const { reopened } = await api.reopenHorseOffers(player === '' ? {} : { name: player })
      const offers = reopened === 1 ? '1 Horse offer' : `${reopened} Horse offers`
      setMessage(`${offers} re-opened for ${player === '' ? 'every Player' : player}.`)
      setName('')
    } catch (err) {
      setMessage(err instanceof ApiFailure ? err.message : 'Something went wrong.')
    }
  }

  return (
    <section className="pn admin-panel" aria-label="Offer horses again">
      <h2 className="hd">Offer horses again</h2>
      <form className="sec" onSubmit={offer}>
        <p className="mu">
          Each Player who claimed their Horse offer may claim once more, and sees the notice at
          once. A Player who hasn't claimed still has just the one claim.
        </p>
        <label className="fld">
          <span className="lb">Player (empty for every Player)</span>
          <input className="in" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn">
          Offer horses again
        </button>
        {message && (
          <p role="status" className="well admin-note">
            {message}
          </p>
        )}
      </form>
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
  // What the last action said, beside the panel it was done in: the list or the Give form.
  const [message, setMessage] = useState<{ text: string; at: 'list' | 'form' }>()
  const say = (text: string, at: 'list' | 'form' = 'list') => setMessage({ text, at })

  const report = (err: unknown, at: 'list' | 'form' = 'list') =>
    say(err instanceof ApiFailure ? err.message : 'Something went wrong.', at)
  const load = () => api.directives().then(setShown, (err: unknown) => report(err))
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
      say(`Directive given against ${d.targetName}.`, 'form')
      setReason('')
      setGoals([])
      await load()
    } catch (err) {
      report(err, 'form')
    }
  }

  async function setPriceOf(d: AdminDirectiveView, to: number | null) {
    try {
      await api.setDirectivePrice(d.id, { price: to })
      say(
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
      say(`Directive against ${name} lifted.`)
      await load()
    } catch (err) {
      report(err)
    }
  }

  const status = (at: 'list' | 'form') =>
    message?.at === at && (
      <div className="sec">
        <p role="status" className="well admin-note">
          {message.text}
        </p>
      </div>
    )

  return (
    <>
      <section className="pn admin-panel" aria-label="Admin directives">
        <h2 className="hd">
          <span className="grow">Admin directives in force</span>
          {shown && <span className="mono small">{shown.directives.length}</span>}
        </h2>
        <div className="sec">
          <p className="mu">
            The Trade Organization treats the target as one to punish until all its goals are met or
            you lift it: it refuses it trade and sends its army against it. Where you allow it, the
            target ends it by paying its price at any Trade Org warehouse. Every Player sees the
            target, the reason, the goals and the price; only admins see who gave it and how far it
            has come.
          </p>
        </div>
        {shown && shown.directives.length > 0 ? (
          shown.directives.map((d) => (
            <div key={d.id} className="sec admin-directive">
              <div className="fx">
                <p className="grow">
                  <span className="b t16">
                    {d.targetName}
                    {d.withAlliance && ' and its alliance'}
                  </span>
                  <br />
                  {d.reason}{' '}
                  <span className="mu">
                    (by {d.givenBy}, {formatGameTime(d.givenAt)})
                  </span>
                </p>
                <button
                  type="button"
                  className="btn sm dng"
                  onClick={() => lift(d.id, d.targetName)}
                >
                  Lift
                </button>
              </div>
              <span className="lb">Goals</span>
              <ul className="admin-goals" aria-label={`Goals against ${d.targetName}`}>
                {d.goals.length === 0 && (
                  <li className="mu">No goals: it ends only when lifted.</li>
                )}
                {d.goals.map((g, i) => {
                  const p = goalProgress(d, g)
                  return (
                    <li key={i} className="fx wrap">
                      <span className={`cb${p.met ? ' on' : ''}`} aria-hidden="true" />
                      <span className="grow">{describeGoal(g)}</span>
                      {p.done !== undefined && (
                        <span className="mt hp admin-goal-meter" aria-hidden="true">
                          <i style={{ width: `${Math.round(p.done * 100)}%` }} />
                        </span>
                      )}
                      <span className={p.done === undefined ? 'mu' : 'mono'}>{p.text}</span>
                    </li>
                  )
                })}
              </ul>
              <span className="lb">Buying off</span>
              <DirectivePrice directive={d} onSet={(to) => setPriceOf(d, to)} />
            </div>
          ))
        ) : (
          <div className="sec">
            <p className="mu">No directive is in force.</p>
          </div>
        )}
        {status('list')}
      </section>
      <section className="pn admin-panel" aria-label="Give a directive">
        <h2 className="hd">Give a directive</h2>
        <form className="sec" onSubmit={give}>
          <div className="fx wrap admin-fields">
            <label className="fld grow">
              <span className="lb">Target</span>
              <select
                className="in"
                value={target}
                onChange={(e) => retarget(e.target.value, withAlliance)}
                required
              >
                <option value="">Choose…</option>
                {shown?.targets.map((t) => (
                  <option key={t.org} value={t.org}>
                    {t.is === 'city'
                      ? `${t.name} (NPC city)`
                      : `${t.name} (${t.account ?? 'realm'})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={withAlliance}
                onChange={(e) => retarget(target, e.target.checked)}
              />
              With its alliance
            </label>
          </div>
          <label className="fld">
            <span className="lb">Reason</span>
            <input
              className="in"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={MAX_DIRECTIVE_REASON}
              required
            />
          </label>
          <div className="fx wrap admin-fields">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={buyOff}
                onChange={(e) => setBuyOff(e.target.checked)}
              />
              Can be bought off
            </label>
            {buyOff && (
              <label className="fld grow">
                <span className="lb">Price in Coins</span>
                <input
                  className="in mono"
                  type="number"
                  min={1}
                  step={1}
                  value={price}
                  onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                />
              </label>
            )}
          </div>
          <fieldset className="col admin-goals-field" aria-label="Goals">
            <legend className="lb">Goals (all must be met)</legend>
            {goals.length > 0 && (
              <ul className="admin-goals">
                {goals.map((g, i) => (
                  <li key={i} className="fx">
                    <span className="grow">{goalText(g)}</span>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setGoals(goals.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="fx wrap">
              <select
                className="in grow"
                aria-label="Goal kind"
                value={goalKind}
                onChange={(e) => setGoalKind(e.target.value as DirectiveGoalRequest['kind'])}
              >
                <option value="city">A city destroyed</option>
                <option value="soldiers">Soldiers killed</option>
                <option value="soldierShare">Share of its soldiers killed</option>
              </select>
              {goalKind === 'city' ? (
                <select
                  className="in grow"
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
                  className="in mono admin-number"
                  aria-label={goalKind === 'soldiers' ? 'Soldiers' : 'Percent'}
                  type="number"
                  min={1}
                  max={goalKind === 'soldiers' ? MAX_DIRECTIVE_SOLDIERS : 100}
                  value={goalNumber}
                  onChange={(e) => setGoalNumber(Number(e.target.value))}
                />
              )}
              <button
                type="button"
                className="btn"
                onClick={addGoal}
                disabled={goals.length >= MAX_DIRECTIVE_GOALS}
              >
                Add goal
              </button>
            </div>
            <span className="mu small">
              A city destroyed names one of the target’s cities, or with its alliance one of its
              allies’. Changing the target clears the goals.
            </span>
          </fieldset>
          <button type="submit" className="btn dng lg" disabled={goals.length === 0}>
            Give directive
          </button>
        </form>
        {status('form')}
      </section>
    </>
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
    <div className="fx wrap">
      <span className="grow">
        {directive.price === null ? 'Not for sale.' : `Bought off for ${directive.price} Coins.`}
      </span>
      <input
        className="in mono admin-number"
        type="number"
        min={1}
        step={1}
        value={price}
        aria-label={`Price to buy off the directive against ${directive.targetName}`}
        onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
      />
      <button type="button" className="btn sm" onClick={() => onSet(price)}>
        {directive.price === null ? 'Allow buying off' : 'Set price'}
      </button>
      {directive.price !== null && (
        <button type="button" className="btn sm" onClick={() => onSet(null)}>
          Don’t allow
        </button>
      )}
    </div>
  )
}
