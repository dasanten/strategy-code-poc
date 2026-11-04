import { useState, type ReactNode } from 'react'
import {
  GOODS,
  type Good,
  type Resident,
  type SeenBuilding,
  type SeenHorse,
  type SeenOffer,
} from '@csp/shared'
import type { TradersView } from './city-view.js'
import { GOOD_LABELS } from './Residents.js'
import {
  acceptPreview,
  freeAtStorage,
  offerStands,
  offerTerms,
  postPreview,
  setAsideLine,
} from './offers-view.js'

/** The terms of an offer to post, as the post-offer order takes them (`CONTEXT.md`: Offer). */
export interface PostOfferRequest {
  storageId: string
  gives: Good
  givesUnits: number
  wants: Good
  wantsUnits: number
  times: number
}

/** An accept order, as a Player gives it to a resident on the storage (`CONTEXT.md`: Offer). */
export interface AcceptOfferRequest {
  residentId: string
  offerId: string
  times: number
  carriageId: string | null
}

const goodOptions = (goods: readonly Good[]) =>
  goods.map((g) => (
    <option key={g} value={g}>
      {GOOD_LABELS[g]}
    </option>
  ))

/**
 * The offers at a storage in a city's trade section (`CONTEXT.md`: Offer, Trade section), which
 * anyone in sight sees with their rate. At one of the Player's own they take one down or post
 * another; at another realm's, someone of theirs on its tile accepts, and with nobody there
 * `sending` offers to send someone.
 */
export function StorageOffers({
  storage,
  own,
  traders,
  sending,
  tick,
  horses,
  onPost,
  onTakeDown,
  onAccept,
}: {
  storage: SeenBuilding
  /** Whether the storage is the Player's realm's. */
  own: boolean
  traders: TradersView
  /** Whom to send there while nobody of the Player's is. */
  sending: ReactNode
  tick: number
  horses: SeenHorse[]
  onPost: (offer: PostOfferRequest) => void
  onTakeDown: (offerId: string) => void
  onAccept: (accept: AcceptOfferRequest) => void
}) {
  const offers = storage.offers ?? []
  const aside = setAsideLine(storage, GOOD_LABELS)
  return (
    <div
      className="storage-offers trade-service"
      aria-label={`Offers at the storage at (${storage.x}, ${storage.y})`}
    >
      <h4>
        Offers at the storage at ({storage.x}, {storage.y})
      </h4>
      {offers.length === 0 && <p className="small muted">None standing.</p>}
      <ul className="offer-list">
        {offers.map((o) => (
          <li key={o.id}>
            <strong>{offerTerms(o, GOOD_LABELS)}</strong>
            <span className="small muted"> · {offerStands(o, GOOD_LABELS)}</span>
            {own && (
              <p>
                <button type="button" onClick={() => onTakeDown(o.id)}>
                  Take down
                </button>
              </p>
            )}
            {!own && traders.residents.length > 0 && (
              <AcceptOffer
                offer={o}
                traders={traders}
                tick={tick}
                horses={horses}
                onAccept={onAccept}
              />
            )}
          </li>
        ))}
      </ul>
      {!own && offers.length > 0 && traders.residents.length === 0 && sending}
      {own && aside && <p className="small muted">{aside}</p>}
      {own && <PostOffer storage={storage} onPost={onPost} />}
    </div>
  )
}

/** Accepting one offer: who, from their hands or a carriage on the tile, and how many times over. */
function AcceptOffer({
  offer,
  traders,
  tick,
  horses,
  onAccept,
}: {
  offer: SeenOffer
  traders: TradersView
  tick: number
  horses: SeenHorse[]
  onAccept: (accept: AcceptOfferRequest) => void
}) {
  const [residentId, setResidentId] = useState('')
  const [carriageId, setCarriageId] = useState('')
  const [times, setTimes] = useState(1)
  const resident: Resident =
    traders.residents.find((r) => r.id === residentId) ?? traders.residents[0]!
  const carriage = traders.carriages.find((k) => k.id === carriageId)
  const { quote, text } = acceptPreview(offer, resident, carriage, times, tick, horses, GOOD_LABELS)
  return (
    <div className="offer-accept">
      <p>
        <label>
          Trader{' '}
          <select value={resident.id} onChange={(e) => setResidentId(e.target.value)}>
            {traders.residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>{' '}
        {traders.carriages.length > 0 && (
          <label>
            From{' '}
            <select value={carriage?.id ?? ''} onChange={(e) => setCarriageId(e.target.value)}>
              <option value="">their hands</option>
              {traders.carriages.map((k) => (
                <option key={k.id} value={k.id}>
                  carriage {k.id}
                </option>
              ))}
            </select>
          </label>
        )}{' '}
        <label>
          Times{' '}
          <input
            type="number"
            min={1}
            max={offer.times}
            value={times}
            onChange={(e) => setTimes(Number(e.target.value))}
          />
        </label>
      </p>
      <p className="small muted">{text}</p>
      <button
        type="button"
        disabled={quote.times === 0}
        onClick={() =>
          onAccept({
            residentId: resident.id,
            offerId: offer.id,
            times,
            carriageId: carriage?.id ?? null,
          })
        }
      >
        Accept
      </button>
    </div>
  )
}

/** Posting an offer at one of the Player's own storages, with what it would set aside. */
function PostOffer({
  storage,
  onPost,
}: {
  storage: SeenBuilding
  onPost: (offer: PostOfferRequest) => void
}) {
  const free = freeAtStorage(storage)
  const held = GOODS.filter((g) => (free[g] ?? 0) > 0)
  const [picked, setGives] = useState<Good | ''>('')
  const gives = picked !== '' && held.includes(picked) ? picked : held[0]
  const [givesUnits, setGivesUnits] = useState(10)
  const [wants, setWants] = useState<Good>('coins')
  const [wantsUnits, setWantsUnits] = useState(5)
  const [times, setTimes] = useState(1)
  if (!gives) return <p className="small muted">Nothing here to offer that isn’t set aside.</p>
  const { text, canPost } = postPreview(
    storage,
    gives,
    givesUnits,
    wants,
    wantsUnits,
    times,
    GOOD_LABELS,
  )
  return (
    <div className="offer-post">
      <p>
        <label>
          Gives{' '}
          <input
            type="number"
            min={1}
            value={givesUnits}
            aria-label="Units given"
            onChange={(e) => setGivesUnits(Number(e.target.value))}
          />{' '}
          <select
            value={gives}
            aria-label="Good given"
            onChange={(e) => setGives(e.target.value as Good)}
          >
            {goodOptions(held)}
          </select>
        </label>{' '}
        <label>
          Wants{' '}
          <input
            type="number"
            min={1}
            value={wantsUnits}
            aria-label="Units wanted"
            onChange={(e) => setWantsUnits(Number(e.target.value))}
          />{' '}
          <select
            value={wants}
            aria-label="Good wanted"
            onChange={(e) => setWants(e.target.value as Good)}
          >
            {goodOptions(GOODS)}
          </select>
        </label>{' '}
        <label>
          Times{' '}
          <input
            type="number"
            min={1}
            value={times}
            onChange={(e) => setTimes(Number(e.target.value))}
          />
        </label>
      </p>
      <p className="small muted">{text}</p>
      <button
        type="button"
        disabled={!canPost}
        onClick={() =>
          onPost({ storageId: storage.id, gives, givesUnits, wants, wantsUnits, times })
        }
      >
        Post offer
      </button>
    </div>
  )
}
