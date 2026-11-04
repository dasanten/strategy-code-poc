import { useState, type ReactNode } from 'react'
import {
  DIRECT_OFFERS_TO_ONE_REALM,
  aboutTime,
  type DirectOfferView,
  type OrderRequest,
  type RealmLabel,
  type Resident,
  type SeenBuilding,
  type SeenCarriage,
  type SeenCity,
  type SeenHorse,
  type SeenResident,
} from '@csp/shared'
import { onTheWay, onTheWayLine, sendable, tradersAt } from './city-view.js'
import { Sending } from './CityInspector.js'
import { PanelHead } from './drawer-head.js'
import { GOOD_LABELS } from './goods-grid.js'
import { incomingItems, type IncomingItem } from './incoming-view.js'
import { AcceptOffer, PostOffer } from './Offers.js'
import {
  directOffersSent,
  offerPlace,
  offerStands,
  offerTerms,
  ownStorages,
} from './offers-view.js'

/**
 * What others sent the Player, waiting for their answer (`incoming-view.ts`). A kind says what can
 * be done with it through `actions`.
 */
export function IncomingList({
  items,
  tick,
  actions,
}: {
  items: readonly IncomingItem[]
  tick: number
  actions: (item: IncomingItem) => ReactNode
}) {
  if (items.length === 0) return null
  return (
    <>
      <h3>Sent to you</h3>
      <ul className="incoming-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.line}</strong>
            <p className="muted small">Lapses in {aboutTime(item.lapsesAt - tick)}.</p>
            {actions(item)}
          </li>
        ))}
      </ul>
    </>
  )
}

/** The Player's own, to go to, as the panel needs them. */
interface OwnSide {
  residents: SeenResident[]
  carriages: SeenCarriage[]
  horses: SeenHorse[]
  realmId: string
  tick: number
  mapSize: number
  arrivesIn?: (r: Resident) => number | undefined
}

/**
 * Answering a Direct offer sent to the Player: with someone of theirs on its storage's tile, accept
 * it there; until then, send someone, though the storage may be out of sight. They can decline it
 * from anywhere.
 */
function AnswerOffer({
  offer,
  side,
  onShowPlace,
  giveOrder,
  sendOrder,
}: {
  offer: DirectOfferView
  side: OwnSide
  onShowPlace: (x: number, y: number) => void
  giveOrder: (order: OrderRequest) => Promise<string | undefined>
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const { x, y } = offer
  const place = { id: offer.storageId, kind: 'storage' as const, x, y, prices: [] }
  const traders = tradersAt(place, side, side.realmId)
  return (
    <>
      <p className="small">
        {offerStands(offer, GOOD_LABELS)}. Fetch it in person at {offerPlace(offer)}.
      </p>
      {traders.residents.length > 0 ? (
        <AcceptOffer
          offer={offer}
          traders={traders}
          tick={side.tick}
          horses={side.horses}
          onAccept={(accept) => void giveOrder({ kind: 'acceptOffer', ...accept })}
        />
      ) : (
        <Sending
          warehouse={place}
          place="storage"
          sendable={sendable(place, side, side.realmId, side.mapSize, side.tick)}
          going={onTheWay(place, side, side.realmId, side.mapSize).map((r) =>
            onTheWayLine(r.name, side.arrivesIn?.(r)),
          )}
          onSend={({ residentId, carriageId }) =>
            void giveOrder(
              carriageId
                ? { kind: 'drive', residentId, carriageId, x, y }
                : { kind: 'walkTo', residentId, x, y },
            )
          }
        />
      )}
      <div className="order-buttons">
        <button type="button" onClick={() => onShowPlace(x, y)}>
          Show on map
        </button>
        <button
          type="button"
          onClick={() => void sendOrder({ kind: 'declineOffer', offerId: offer.id })}
        >
          Decline
        </button>
      </div>
    </>
  )
}

/**
 * Direct offers (`CONTEXT.md`: Direct offer): what others sent the Player, to fetch in person or
 * decline; what they sent, waiting for an answer; and a form to send one to a realm they know of,
 * set aside at a storage they name. Every change is an order the server checks (ADR 0002).
 */
export function DirectOffersPanel({
  offers,
  knownRealms,
  buildings,
  cities,
  residents,
  carriages,
  horses,
  realmId,
  tick,
  mapSize,
  arrivesIn,
  onShowPlace,
  giveOrder,
  sendOrder,
}: {
  offers: DirectOfferView[]
  /** The other realms the Player knows of. */
  knownRealms: RealmLabel[]
  buildings: SeenBuilding[]
  cities: SeenCity[]
  residents: SeenResident[]
  carriages: SeenCarriage[]
  horses: SeenHorse[]
  realmId: string
  tick: number
  mapSize: number
  arrivesIn?: (r: Resident) => number | undefined
  onShowPlace: (x: number, y: number) => void
  /** An order to one of the Player's, as the HUD gives those. */
  giveOrder: (order: OrderRequest) => Promise<string | undefined>
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [toId, setToId] = useState('')
  const [storageId, setStorageId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const refusable =
    (order: (o: OrderRequest) => Promise<string | undefined>) => async (o: OrderRequest) => {
      const reason = await order(o)
      setError(reason)
      return reason
    }
  const give = refusable(giveOrder)
  const send = refusable(sendOrder)

  const incoming = incomingItems({ directOffers: offers }, realmId)
  const sent = directOffersSent(offers, realmId)
  const storages = ownStorages({ cities, buildings }, realmId)
  const storage = storages.find((s) => s.id === storageId) ?? storages[0]
  const cityOf = (s: SeenBuilding) => cities.find((c) => c.id === s.cityId)?.name
  const known = knownRealms.some((r) => r.realmId === toId)
  const side = { residents, carriages, horses, realmId, tick, mapSize, arrivesIn }

  return (
    <section className="alliance-panel" aria-label="Direct offers">
      <PanelHead title="Direct offers">{offers.length === 0 ? 'none' : offers.length}</PanelHead>
      <IncomingList
        items={incoming}
        tick={tick}
        actions={(item) => (
          <AnswerOffer
            offer={item.offer}
            side={side}
            onShowPlace={onShowPlace}
            giveOrder={give}
            sendOrder={send}
          />
        )}
      />
      {sent.length > 0 && (
        <>
          <h3>Sent by you</h3>
          <ul className="incoming-list">
            {sent.map((o) => (
              <li key={o.id}>
                <strong>
                  To the realm of {o.to.realm}: {offerTerms(o, GOOD_LABELS).toLowerCase()}
                </strong>
                <p className="muted small">
                  {offerStands(o, GOOD_LABELS)}, at {offerPlace(o)}. Lapses in{' '}
                  {aboutTime(o.direct.lapsesAt - tick)}.
                </p>
                <button
                  type="button"
                  onClick={() => void send({ kind: 'takeDownOffer', offerId: o.id })}
                >
                  Take down
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="contract-form" aria-label="New direct offer">
        <h3>Send a direct offer</h3>
        <label className="contract-field">
          <span className="contract-label">To</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">
              {knownRealms.length === 0 ? 'You know of no other realm' : 'Send to…'}
            </option>
            {knownRealms.map((r) => (
              <option key={r.realmId} value={r.realmId}>
                The realm of {r.realm}
              </option>
            ))}
          </select>
        </label>
        {storage ? (
          <>
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
            <PostOffer
              key={storage.id}
              storage={storage}
              action="Send"
              ready={known}
              onPost={(offer) => void send({ kind: 'sendDirectOffer', toId, ...offer })}
            />
          </>
        ) : (
          <p className="small muted">You have no finished storage to set goods aside at.</p>
        )}
      </div>
      <p className="muted small">
        Only they can accept it, in person at the storage, and they see it at once wherever they
        are. At most {DIRECT_OFFERS_TO_ONE_REALM} can stand to one realm.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
