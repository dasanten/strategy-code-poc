import { useState, type ReactNode } from 'react'
import { DIRECT_OFFERS_TO_ONE_REALM } from '@csp/balance'
import { TRADE_ORG } from '@csp/shared-types'
import { aboutTime } from '../residents/estimates.js'
import { citiesToCarryAt } from './direct-offer.js'
import { deliveryStorage } from '../trade/warehouse.js'
import type {
  CarriedFeeBy,
  CarriedWay,
  DirectOfferView,
  OrderRequest,
  RealmLabel,
  Resident,
  SeenBuilding,
  SeenCarriage,
  SeenCity,
  SeenHorse,
  SeenResident,
} from '@csp/shared-types'
import { onTheWay, onTheWayLine, sendable, tradersAt } from '../city/city-view.js'
import { Sending } from '../city/CityInspector.js'
import { GroupHead } from './diplomacy-parts.js'
import { PanelHead } from '../ui/panel-head.js'
import { GOOD_LABELS } from '../ui/goods-grid.js'
import { incomingItems, type IncomingItem } from './incoming-view.js'
import { AcceptOffer, PostOffer } from '../trade/Offers.js'
import {
  carriedDetails,
  carriedLine,
  carriedPreview,
  directOffersSent,
  offerPlace,
  offerStands,
  offerTerms,
  ownStorages,
} from '../trade/offers-view.js'

/**
 * What others sent the Player, waiting for their answer (`incoming-view.ts`). A kind says what can
 * be done with it through `actions`.
 */
function IncomingList({
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
      <GroupHead count={items.length}>Sent to you</GroupHead>
      <ul className="dip-list">
        {items.map((item) => (
          <li key={item.id} className="sec">
            <span className="b">{item.line}</span>
            <span className="mu small">Lapses in {aboutTime(item.lapsesAt - tick)}.</span>
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
  if (offer.direct.carried) {
    return (
      <>
        <p className="small">{carriedDetails(offer, side.realmId)}</p>
        <div className="fx wrap dip-buttons">
          <button
            type="button"
            className="btn sm pri grow"
            onClick={() => void sendOrder({ kind: 'acceptCarriedOffer', offerId: offer.id })}
          >
            Accept
          </button>
          <button type="button" className="btn sm" onClick={() => onShowPlace(x, y)}>
            Show on map
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => void sendOrder({ kind: 'declineOffer', offerId: offer.id })}
          >
            Decline
          </button>
        </div>
      </>
    )
  }
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
      <div className="fx wrap dip-buttons">
        <button type="button" className="btn sm" onClick={() => onShowPlace(x, y)}>
          Show on map
        </button>
        <button
          type="button"
          className="btn sm"
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
 * have carried, or decline; what they sent, waiting for an answer; and a form to send one to a realm
 * they know of, set aside at a storage they name or carried by the Trade Organization between two
 * cities they name. Every change is an order the server checks (ADR 0002).
 */
export function DirectOffersPanel({
  offers,
  knownRealms,
  carriedWays,
  buildings,
  cities,
  residents,
  carriages,
  horses,
  realmId,
  tick,
  mapSize,
  noCaravans,
  arrivesIn,
  onShowPlace,
  giveOrder,
  sendOrder,
}: {
  offers: DirectOfferView[]
  /** The other realms the Player knows of. */
  knownRealms: RealmLabel[]
  /** The ways the Player can name for a carried offer, to show its exact fee. */
  carriedWays: readonly CarriedWay[]
  buildings: SeenBuilding[]
  cities: SeenCity[]
  residents: SeenResident[]
  carriages: SeenCarriage[]
  horses: SeenHorse[]
  realmId: string
  tick: number
  mapSize: number
  /** The Trade Org HQ has fallen, so nothing can be carried (`CONTEXT.md`: Fall of the HQ). */
  noCaravans: boolean
  arrivesIn?: (r: Resident) => number | undefined
  onShowPlace: (x: number, y: number) => void
  /** An order to one of the Player's, as the HUD gives those. */
  giveOrder: (order: OrderRequest) => Promise<string | undefined>
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [toId, setToId] = useState('')
  const [storageId, setStorageId] = useState('')
  const [how, setHow] = useState<'inPerson' | CarriedFeeBy>('inPerson')
  const [fromCityId, setFromCityId] = useState('')
  const [toCityId, setToCityId] = useState('')
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
  const feeBy = how === 'inPerson' || noCaravans ? undefined : how
  const seen = { cities, buildings }
  const fromCities = citiesToCarryAt(seen, realmId)
  const toCities = known ? citiesToCarryAt(seen, toId) : []
  const fromCity = fromCities.find((c) => c.id === fromCityId) ?? fromCities[0]
  const toCity = toCities.find((c) => c.id === toCityId) ?? toCities[0]
  const fromStorage = fromCity && deliveryStorage(seen, fromCity.id)

  return (
    <section className="dip" aria-label="Direct offers">
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
          <GroupHead count={sent.length}>Sent by you</GroupHead>
          <ul className="dip-list">
            {sent.map((o) => (
              <li key={o.id} className="sec">
                <span className="b">
                  To {o.to.realmId === TRADE_ORG ? o.to.realm : `the realm of ${o.to.realm}`}:{' '}
                  {(o.direct.carried
                    ? carriedLine(o, GOOD_LABELS)
                    : offerTerms(o, GOOD_LABELS)
                  ).toLowerCase()}
                </span>
                <span className="mu small">
                  {o.direct.carried
                    ? carriedDetails(o, realmId)
                    : `${offerStands(o, GOOD_LABELS)}, at ${offerPlace(o)}.`}{' '}
                  Lapses in {aboutTime(o.direct.lapsesAt - tick)}.
                </span>
                <button
                  type="button"
                  className="btn sm dip-start"
                  onClick={() => void send({ kind: 'takeDownOffer', offerId: o.id })}
                >
                  Take down
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="sec dip-form" role="group" aria-label="New direct offer">
        <h3 className="px t16">Send a direct offer</h3>
        <label className="fld">
          <span className="lb">To</span>
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
        {!noCaravans && (
          <label className="fld">
            <span className="lb">How</span>
            <select
              value={how}
              aria-label="How the goods change hands"
              onChange={(e) => setHow(e.target.value as typeof how)}
            >
              <option value="inPerson">In person, at a storage of mine</option>
              <option value="sender">Carried by the Trade Org, I pay the fee</option>
              <option value="split">Carried by the Trade Org, fee split</option>
            </select>
          </label>
        )}
        {feeBy ? (
          fromCity && fromStorage ? (
            <>
              <label className="fld">
                <span className="lb">From</span>
                <select value={fromCity.id} onChange={(e) => setFromCityId(e.target.value)}>
                  {fromCities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span className="lb">To their city</span>
                <select value={toCity?.id ?? ''} onChange={(e) => setToCityId(e.target.value)}>
                  {toCities.length === 0 && <option value="">No storage of theirs in sight</option>}
                  {toCities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <PostOffer
                key="carried"
                storage={fromStorage}
                action="Send"
                ready={known && toCity !== undefined}
                carried={(goods) =>
                  toCity
                    ? carriedPreview(
                        carriedWays.find(
                          (w) => w.fromCityId === fromCity.id && w.toCityId === toCity.id,
                        ),
                        feeBy,
                        goods,
                        GOOD_LABELS,
                      )
                    : { text: 'Name a city of theirs whose storage you see.', canPost: false }
                }
                onPost={({ storageId: _storageId, ...goods }) =>
                  void send({
                    kind: 'sendCarriedOffer',
                    toId,
                    ...goods,
                    fromCityId: fromCity.id,
                    toCityId: toCity!.id,
                    feeBy,
                  })
                }
              />
            </>
          ) : (
            <p className="small mu">You have no city with a finished storage to pick up from.</p>
          )
        ) : storage ? (
          <>
            <label className="fld">
              <span className="lb">At</span>
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
          <p className="small mu">You have no finished storage to set goods aside at.</p>
        )}
      </div>
      {error && <p className="error dip-error">{error}</p>}
      <p className="sec mu small dip-foot">
        Only they can accept it, and they see it at once wherever they are: in person at the
        storage, or from anywhere when the Trade Org carries it. At most{' '}
        {DIRECT_OFFERS_TO_ONE_REALM} can stand to one realm.
      </p>
    </section>
  )
}
