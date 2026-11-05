import { useState, type FormEvent } from 'react'
import {
  DEMANDS_PER_GAME_DAY,
  DEMAND_DEFAULT_DAYS,
  DEMAND_MAX_DAYS,
  DEMAND_NOTE_MAX_LENGTH,
  GOODS,
  aboutTime,
  citiesToCarryAt,
  deliveryStorage,
  demandNoteProblem,
  type CarriedWay,
  type DemandHandOver,
  type DemandView,
  type Good,
  type OrderRequest,
  type RealmLabel,
  type SeenBuilding,
  type SeenCity,
} from '@csp/shared'
import {
  answersByGame,
  citiesToDemandOf,
  demandSides,
  goodsOfLines,
  handOverQuestion,
  sentLine,
  setAsidePreview,
  termsLine,
  transferPreview,
  type GoodsLine,
  type HandOverPreview,
} from './demand-view.js'
import { PanelHead } from './drawer-head.js'
import { GOOD_LABELS } from './goods-grid.js'
import type { LastSeenCity } from './last-seen.js'
import { freeAtStorage, ownStorages } from './offers-view.js'

/** A demand's note: the sender's words as plain text, which React escapes, never as markup. */
export function DemandNote({ note }: { note: string }) {
  return <p className="demand-note">{note}</p>
}

/**
 * Accepting a demand for goods or Coins (`CONTEXT.md`: Demand): the Player picks how they go, set
 * aside at a storage of theirs or sent by a Transfer they pay for, and reads what goes, also when
 * the storage is short, before they accept.
 */
function HandOverGoods({
  goods,
  senderId,
  buildings,
  cities,
  carriedWays,
  noCaravans,
  realmId,
  onAccept,
}: {
  goods: Partial<Record<Good, number>>
  senderId: string
  buildings: SeenBuilding[]
  cities: SeenCity[]
  /** The ways the Player can send a Transfer, to show its exact fee. */
  carriedWays: readonly CarriedWay[]
  /** The Trade Org HQ has fallen, so nothing can be carried (`CONTEXT.md`: Fall of the HQ). */
  noCaravans: boolean
  realmId: string
  onAccept: (handOver: DemandHandOver) => void
}) {
  const [way, setWay] = useState<DemandHandOver['way']>('setAside')
  const [storageId, setStorageId] = useState('')
  const [fromCityId, setFromCityId] = useState('')
  const [toCityId, setToCityId] = useState('')

  const seen = { cities, buildings }
  const storages = ownStorages(seen, realmId)
  const storage = storages.find((s) => s.id === storageId) ?? storages[0]
  const cityOf = (s: SeenBuilding) => cities.find((c) => c.id === s.cityId)?.name
  const fromCities = citiesToCarryAt(seen, realmId)
  const toCities = citiesToCarryAt(seen, senderId)
  const fromCity = fromCities.find((c) => c.id === fromCityId) ?? fromCities[0]
  const toCity = toCities.find((c) => c.id === toCityId) ?? toCities[0]
  const fromStorage = fromCity && deliveryStorage(seen, fromCity.id)

  const sending = way === 'transfer' && !noCaravans
  let preview: HandOverPreview
  if (sending) {
    const tiles = carriedWays.find(
      (w) => w.fromCityId === fromCity?.id && w.toCityId === toCity?.id,
    )?.senderTiles
    preview = !fromStorage
      ? { text: 'You have no city with a finished storage to pick up from.', canAccept: false }
      : !toCity
        ? { text: 'You see no storage of theirs to send it to.', canAccept: false }
        : transferPreview(goods, freeAtStorage(fromStorage), tiles)
  } else {
    preview = storage
      ? setAsidePreview(goods, freeAtStorage(storage))
      : { text: 'You have no finished storage to set goods aside at.', canAccept: false }
  }

  return (
    <div className="demand-hand-over">
      {!noCaravans && (
        <label className="contract-field">
          <span className="contract-label">How</span>
          <select
            value={way}
            aria-label="How the goods go"
            onChange={(e) => setWay(e.target.value as DemandHandOver['way'])}
          >
            <option value="setAside">Set aside for them to fetch</option>
            <option value="transfer">Send by Transfer, I pay the fee</option>
          </select>
        </label>
      )}
      {sending ? (
        <>
          <label className="contract-field">
            <span className="contract-label">From</span>
            <select value={fromCity?.id ?? ''} onChange={(e) => setFromCityId(e.target.value)}>
              {fromCities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="contract-field">
            <span className="contract-label">To their city</span>
            <select value={toCity?.id ?? ''} onChange={(e) => setToCityId(e.target.value)}>
              {toCities.length === 0 && <option value="">No storage of theirs in sight</option>}
              {toCities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        storage && (
          <label className="contract-field">
            <span className="contract-label">At</span>
            <select value={storage.id} onChange={(e) => setStorageId(e.target.value)}>
              {storages.map((s) => (
                <option key={s.id} value={s.id}>
                  The storage at ({s.x}, {s.y}){cityOf(s) ? ` in ${cityOf(s)}` : ''}
                </option>
              ))}
            </select>
          </label>
        )
      )}
      <p className="small muted">{preview.text}</p>
      <button
        type="button"
        disabled={!preview.canAccept}
        onClick={() =>
          onAccept(
            sending
              ? { way: 'transfer', fromCityId: fromCity!.id, toCityId: toCity!.id }
              : { way: 'setAside', storageId: storage!.id },
          )
        }
      >
        Accept
      </button>
    </div>
  )
}

/**
 * Demands (`CONTEXT.md`: Demand): what others demand of the Player, to accept or decline; what they
 * demanded, waiting for an answer; and a form to send one to a realm they know of, an NPC city they
 * know of or the Trade Organization, which the game answers. Every change is an order the server
 * checks (ADR 0002). It is only words: nothing happens when one is ignored.
 */
export function DemandsPanel({
  demands,
  realmId,
  knownRealms,
  knownNpcOrgs,
  cities,
  buildings,
  carriedWays,
  noCaravans,
  lastSeen,
  tick,
  sendOrder,
}: {
  demands: DemandView[]
  realmId: string
  /** The other realms the Player knows of. */
  knownRealms: RealmLabel[]
  /** The Trade Organization and the NPC cities the Player knows of. */
  knownNpcOrgs: RealmLabel[]
  /** The cities in sight. */
  cities: SeenCity[]
  /** The buildings in sight, for the storages goods can go from and to. */
  buildings: SeenBuilding[]
  /** The ways the Player can send a Transfer, to show its exact fee. */
  carriedWays: readonly CarriedWay[]
  /** The Trade Org HQ has fallen, so nothing can be carried (`CONTEXT.md`: Fall of the HQ). */
  noCaravans: boolean
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
  const to = [...knownRealms, ...knownNpcOrgs].find((r) => r.realmId === toId)
  const theirCities = to ? citiesToDemandOf(to, cities, lastSeen) : []
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
                {d.terms.kind === 'goods' && (
                  <HandOverGoods
                    goods={d.terms.goods}
                    senderId={d.from.realmId}
                    buildings={buildings}
                    cities={cities}
                    carriedWays={carriedWays}
                    noCaravans={noCaravans}
                    realmId={realmId}
                    onAccept={(handOver) =>
                      void order({ kind: 'acceptDemand', demandId: d.id, handOver })
                    }
                  />
                )}
                <div className="order-buttons">
                  {d.terms.kind === 'city' && (
                    <button
                      type="button"
                      onClick={() => {
                        const question = handOverQuestion(d, realmId, cities)
                        if (question && !window.confirm(question)) return
                        void order({ kind: 'acceptDemand', demandId: d.id })
                      }}
                    >
                      Accept
                    </button>
                  )}
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
                  <strong>{sentLine(d)}</strong>
                  <DemandNote note={d.note} />
                  <span className="muted small">
                    {answersByGame(d.to)
                      ? 'The answer comes within a game hour.'
                      : `Lapses in ${aboutTime(d.deadline - tick)}.`}
                  </span>
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
              // An NPC city can only hand over itself, so that is the city named.
              const city = knownNpcOrgs.some((o) => o.city && o.realmId === e.target.value)
              setCityId(city ? e.target.value : '')
            }}
          >
            <option value="">Send to…</option>
            {knownRealms.map((r) => (
              <option key={r.realmId} value={r.realmId}>
                The realm of {r.realm}
              </option>
            ))}
            {knownNpcOrgs.map((r) => (
              <option key={r.realmId} value={r.realmId}>
                {r.city ? `${r.realm} (NPC city)` : 'The Trade Organization'}
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
        game day. It is only words: what you threaten is yours to carry out, or not. An NPC city
        answers within a game hour: it gives in only to far more of your armed residents and walls
        in its sight than it has soldiers, and otherwise thinks less of you. The Trade Organization
        always declines, and being asked costs standing.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
