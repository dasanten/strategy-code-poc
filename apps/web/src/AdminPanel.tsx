import { useEffect, useState, type FormEvent } from 'react'
import {
  DIRECTIVE_BUY_OFF_PRICE,
  MAX_DIRECTIVE_REASON,
  formatGameTime,
  type Account,
  type AdminDirectives,
  type AdminDirectiveView,
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
 * with its alliance, a reason every Player sees and maybe a price to buy it off; change that price
 * or lift one in force.
 */
function DirectivesPanel() {
  const [shown, setShown] = useState<AdminDirectives>()
  const [target, setTarget] = useState('')
  const [withAlliance, setWithAlliance] = useState(false)
  const [reason, setReason] = useState('')
  const [buyOff, setBuyOff] = useState(false)
  const [price, setPrice] = useState(DIRECTIVE_BUY_OFF_PRICE)
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
      const d = await api.giveDirective({
        target,
        withAlliance,
        reason,
        price: buyOff ? price : null,
      })
      setMessage(`Directive given against ${d.targetName}.`)
      setReason('')
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
        The Trade Organization treats the target as one to punish until you lift it: it refuses it
        trade and sends its army against it. Where you allow it, the target ends it by paying its
        price at any Trade Org warehouse. Every Player sees the target, the reason and the price;
        only admins see who gave it.
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
        <button type="submit">Give directive</button>
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
