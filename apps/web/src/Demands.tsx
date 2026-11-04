import { useState, type FormEvent } from 'react'
import {
  DEMANDS_PER_GAME_DAY,
  DEMAND_DEFAULT_DAYS,
  DEMAND_MAX_DAYS,
  DEMAND_NOTE_MAX_LENGTH,
  GOODS,
  aboutTime,
  demandNoteProblem,
  type DemandView,
  type Good,
  type OrderRequest,
  type RealmLabel,
  type SeenCity,
} from '@csp/shared'
import {
  demandSides,
  goodsOfLines,
  knownCitiesOf,
  termsLine,
  type GoodsLine,
} from './demand-view.js'
import { PanelHead } from './drawer-head.js'
import { GOOD_LABELS } from './goods-grid.js'
import type { LastSeenCity } from './last-seen.js'

/** A demand's note: the sender's words as plain text, which React escapes, never as markup. */
export function DemandNote({ note }: { note: string }) {
  return <p className="demand-note">{note}</p>
}

/**
 * Demands (`CONTEXT.md`: Demand): what others demand of the Player, to accept or decline; what they
 * demanded, waiting for an answer; and a form to send one to a realm they know of. Every change is
 * an order the server checks (ADR 0002). It is only words: nothing happens when one is ignored.
 */
export function DemandsPanel({
  demands,
  realmId,
  knownRealms,
  cities,
  lastSeen,
  tick,
  sendOrder,
}: {
  demands: DemandView[]
  realmId: string
  /** The other realms the Player knows of. */
  knownRealms: RealmLabel[]
  /** The cities in sight. */
  cities: SeenCity[]
  /** The cities the Player remembers out of sight. */
  lastSeen: LastSeenCity[]
  tick: number
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [toId, setToId] = useState('')
  const [wantsCity, setWantsCity] = useState(true)
  const [cityId, setCityId] = useState('')
  const [lines, setLines] = useState<GoodsLine[]>([{ good: 'coins', units: 100 }])
  const [note, setNote] = useState('')
  const [days, setDays] = useState(DEMAND_DEFAULT_DAYS)
  const [error, setError] = useState<string | undefined>()
  const order = async (o: OrderRequest) => {
    const reason = await sendOrder(o)
    setError(reason)
    return reason
  }

  const { incoming, sent } = demandSides(demands, realmId)
  const theirCities = toId ? knownCitiesOf(toId, cities, lastSeen) : []
  const goods = goodsOfLines(lines)
  const noteProblem = note === '' ? undefined : demandNoteProblem(note)
  const ready =
    toId !== '' &&
    (wantsCity ? theirCities.some((c) => c.id === cityId) : Object.keys(goods).length > 0) &&
    note.trim() !== '' &&
    !noteProblem

  async function send(e: FormEvent) {
    e.preventDefault()
    const reason = await order({
      kind: 'sendDemand',
      realmId: toId,
      terms: wantsCity ? { kind: 'city', cityId } : { kind: 'goods', goods },
      note,
      days,
    })
    if (!reason) setNote('')
  }

  const setLine = (i: number, line: GoodsLine) =>
    setLines(lines.map((l, at) => (at === i ? line : l)))

  return (
    <section className="alliance-panel" aria-label="Demands">
      <PanelHead title="Demands">{demands.length === 0 ? 'none' : demands.length}</PanelHead>
      {incoming.length > 0 && (
        <>
          <h3>Sent to you</h3>
          <ul className="alliance-list">
            {incoming.map((d) => (
              <li key={d.id} className="army">
                <span>
                  <strong>
                    The realm of {d.from.realm} demands {termsLine(d.terms)}
                  </strong>
                  <DemandNote note={d.note} />
                  <span className="muted small">
                    Lapses in {aboutTime(d.deadline - tick)}. Ignoring it does nothing by itself.
                  </span>
                </span>
                <div className="order-buttons">
                  <button
                    type="button"
                    onClick={() => void order({ kind: 'acceptDemand', demandId: d.id })}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void order({ kind: 'declineDemand', demandId: d.id })}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {sent.length > 0 && (
        <>
          <h3>Sent by you</h3>
          <ul className="alliance-list">
            {sent.map((d) => (
              <li key={d.id} className="army">
                <span>
                  <strong>
                    {termsLine(d.terms)} from the realm of {d.to.realm}
                  </strong>
                  <DemandNote note={d.note} />
                  <span className="muted small">Lapses in {aboutTime(d.deadline - tick)}.</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="contract-form demand-form" onSubmit={send} aria-label="New demand">
        <h3>Send a demand</h3>
        <label className="contract-field">
          <span className="contract-label">To</span>
          <select
            value={toId}
            onChange={(e) => {
              setToId(e.target.value)
              setCityId('')
            }}
          >
            <option value="">Send to…</option>
            {knownRealms.map((r) => (
              <option key={r.realmId} value={r.realmId}>
                The realm of {r.realm}
              </option>
            ))}
          </select>
        </label>
        <div className="contract-field" role="radiogroup" aria-label="What">
          <span className="contract-label">What</span>
          <span className="contract-choice">
            <label>
              <input type="radio" checked={wantsCity} onChange={() => setWantsCity(true)} />A city
            </label>
            <label>
              <input type="radio" checked={!wantsCity} onChange={() => setWantsCity(false)} />
              Goods or Coins
            </label>
          </span>
        </div>
        {wantsCity ? (
          <label className="contract-field">
            <span className="contract-label">City</span>
            <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="">
                {!toId
                  ? 'Pick whom to send it to'
                  : theirCities.length === 0
                    ? 'You know no city of theirs'
                    : 'Which city…'}
              </option>
              {theirCities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="contract-field">
            <span className="contract-label">Goods</span>
            <ul className="demand-goods" aria-label="Goods">
              {lines.map((l, i) => (
                <li key={i}>
                  <select
                    aria-label="Good"
                    value={l.good}
                    onChange={(e) => setLine(i, { ...l, good: e.target.value as Good })}
                  >
                    {GOODS.map((g) => (
                      <option key={g} value={g}>
                        {GOOD_LABELS[g]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    aria-label="Units"
                    min={1}
                    value={l.units}
                    onChange={(e) => setLine(i, { ...l, units: Number(e.target.value) })}
                  />
                  {lines.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => setLines(lines.filter((_, at) => at !== i))}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setLines([...lines, { good: 'food', units: 10 }])}
                >
                  Add a good
                </button>
              </li>
            </ul>
          </div>
        )}
        <label className="contract-field">
          <span className="contract-label">Note</span>
          <textarea
            rows={3}
            maxLength={DEMAND_NOTE_MAX_LENGTH}
            value={note}
            placeholder="Give the city back, or we attack."
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label className="contract-field">
          <span className="contract-label">Deadline</span>
          <span>
            <input
              type="number"
              min={1}
              max={DEMAND_MAX_DAYS}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />{' '}
            game days
          </span>
        </label>
        {noteProblem && <p className="error">{noteProblem}</p>}
        <button type="submit" className="primary" disabled={!ready}>
          Send
        </button>
      </form>
      <p className="muted small">
        A demand arrives at once, wherever they are. A realm sends at most {DEMANDS_PER_GAME_DAY} a
        game day. It is only words: what you threaten is yours to carry out, or not.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
