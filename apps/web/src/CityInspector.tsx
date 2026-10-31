import { useEffect, useRef, useState } from 'react'
import {
  GOODS,
  isClosed,
  type Building,
  type Carriage,
  type DeliveryQuote,
  type Good,
  type DirectiveView,
  type NpcCityPrice,
  type PricedGood,
  type RealmLabel,
  type Resident,
  type SeenCity,
  type TradeSide,
  type SeenResident,
  type SeenCarriage,
  type SeenHorse,
} from '@csp/shared'
import {
  buildingCount,
  describeBuying,
  deliveryCities,
  describeCity,
  npcStoragesInSight,
  previewDelivery,
  previewNpcTrade,
  previewTrade,
  previewTransfer,
  holderText,
  onTheWay,
  onTheWayLine,
  sendable,
  takesTransfers,
  tradedGoods,
  tradesHere,
  tradeLists,
  tradersAt,
  tradeText,
  warehousesInSight,
  type BuyView,
  type DeliveryCity,
  type SendView,
  type TradeLine,
  type TradeLists,
  type TradePreview,
  type TradersView,
  type WarehouseView,
} from './city-view.js'
import { GOOD_LABELS } from './Residents.js'
import { carriedShort } from './residents-view.js'
import { lastSeenText, type LastSeen } from './last-seen.js'
import { HOW_TO_TRADE_PATH } from './wiki-view.js'

/**
 * The city inspector: every city in sight (`CONTEXT.md`: City, NPC city), whose it is, and,
 * for the one picked, how many of its residents and which of its buildings the Player sees. A
 * city of the Player's own lists its gates, to open or close (`CONTEXT.md`: Walls in combat); an
 * NPC city names its price and can be bought (`CONTEXT.md`: Buying a city); a Trade Org city lists
 * the prices of its warehouses in sight (`CONTEXT.md`: Warehouse prices), where the Player's
 * residents on a warehouse buy and sell (`CONTEXT.md`: Trading with the Trade Organization). An
 * NPC city that doesn't refuse the Player lists its prices at its storages in sight, where their
 * residents trade with it the same way (`CONTEXT.md`: Trading with an NPC city).
 * A city of another realm takes transfers from the Player's cities (`CONTEXT.md`: Transfer).
 * Below them, the cities the Player remembers out of sight (`CONTEXT.md`: Last seen): as they
 * last saw them and when, greyed, with nothing to do there.
 */
export function CityInspector({
  cities,
  lastSeen,
  residents,
  buildings,
  realmId,
  realms,
  carriages,
  horses,
  tick,
  mapSize,
  onSetGate,
  onBuyCity,
  onTrade,
  onTransfer,
  onSend,
  arrivesIn,
  directives,
  onBuyOff,
  openId,
  onOpen,
  scrollTo,
}: {
  cities: SeenCity[]
  /** What the Player remembers out of sight. */
  lastSeen: LastSeen
  residents: SeenResident[]
  buildings: Building[]
  realmId: string
  realms: RealmLabel[]
  carriages: SeenCarriage[]
  horses: SeenHorse[]
  tick: number
  /** Tiles along each side of the map, for delivery fees. */
  mapSize: number
  onSetGate: (gateId: string, open: boolean) => void
  /** Gives the buy order for an NPC city to one of the Player's residents on its town hall. */
  onBuyCity: (residentId: string, cityId: string) => void
  /** Gives a buy or sell order to one of the Player's residents on a warehouse. */
  onTrade: (trade: TradeRequest) => void
  /** Orders a transfer from one of the Player's cities to another realm's city. */
  onTransfer: (transfer: TransferRequest) => void
  /** Sends one of the Player's residents, or a carriage they drive, to a warehouse or storage. */
  onSend: (send: SendRequest) => void
  /** About how many ticks until a resident arrives where they walk, ride or drive (`arrivalTicks`). */
  arrivesIn: ((r: Resident) => number | undefined) | undefined
  /** The admin directives in force; one naming the Player's realm may be bought off here. */
  directives: DirectiveView[]
  /** Gives the buy-off order for a directive to one of the Player's residents on a warehouse. */
  onBuyOff: (residentId: string, directiveId: string, carriageId: string | null) => void
  /** The city shown opened, such as one picked on the map. */
  openId: string | undefined
  /** Called with the city opened in the list, or undefined when it is closed. */
  onOpen: (id: string | undefined) => void
  /**
   * The warehouse or storage of the open city to bring into view, as Trade here on its tile card
   * asks (`CONTEXT.md`: Trade section); each new object scrolls again.
   */
  scrollTo?: { buildingId: string }
}) {
  const views = cities.map((c) => describeCity(c, { residents, buildings }, realmId, realms))
  const sending = (place: WarehouseView): SendingProps => ({
    sendable: sendable(place, { residents, carriages }, realmId, mapSize, tick),
    going: onTheWay(place, { residents }, realmId, mapSize).map((r) =>
      onTheWayLine(r.name, arrivesIn?.(r)),
    ),
    onSend: (s) =>
      onSend({ residentId: s.residentId, carriageId: s.carriageId, x: place.x, y: place.y }),
  })
  const list = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!scrollTo) return
    list.current
      ?.querySelector(`[data-trade-at="${CSS.escape(scrollTo.buildingId)}"]`)
      ?.scrollIntoView({ block: 'start' })
  }, [scrollTo])
  return (
    <section className="city-inspector" aria-label="Cities in sight" ref={list}>
      <div className="panel-head">
        <h2>Cities in sight</h2>
        <span>{views.length === 0 ? 'none' : views.length}</span>
      </div>
      <ul className="city-list">
        {views.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              aria-expanded={openId === v.id}
              onClick={() => onOpen(openId === v.id ? undefined : v.id)}
            >
              <strong>{v.name}</strong>
              <span>{v.whose}</span>
            </button>
            {openId === v.id && (
              <p className="city-details">
                {v.residents} {v.residents === 1 ? 'resident' : 'residents'} in sight
                {v.buildings.length > 0 &&
                  ` · ${v.buildings.map(([k, n]) => buildingCount(k, n)).join(', ')}`}
              </p>
            )}
            {openId === v.id &&
              tradesHere(
                cities.find((c) => c.id === v.id)!,
                { cities, buildings },
                realmId,
              ) && (
                <p className="small trade-wiki">
                  {/* A new tab, so the game keeps running behind it (`CONTEXT.md`: Wiki). */}
                  <a href={HOW_TO_TRADE_PATH} target="_blank" rel="noopener">
                    How to trade
                  </a>
                </p>
              )}
            {openId === v.id &&
              warehousesInSight(
                cities.find((c) => c.id === v.id)!,
                { cities, buildings },
              ).map((w) => (
                <div key={w.id} data-trade-at={w.id}>
                  <Prices warehouse={w} lists={tradeLists(w, { buildings })} />
                  <Trading
                    warehouse={w}
                    goods={tradedGoods(w, tradeLists(w, { buildings }))}
                    traders={tradersAt(w, { residents, carriages }, realmId)}
                    sending={sending(w)}
                    deliveryCities={deliveryCities({ cities, buildings }, realmId)}
                    preview={(resident, carriage, good, units) =>
                      previewTrade(
                        { cities, buildings },
                        w.id,
                        resident,
                        carriage,
                        good,
                        units,
                        tick,
                        horses,
                      )
                    }
                    previewDelivery={(resident, carriage, good, units, city) =>
                      previewDelivery(
                        { cities, buildings },
                        w.id,
                        resident,
                        carriage,
                        good,
                        units,
                        city,
                        mapSize,
                      )
                    }
                    onTrade={onTrade}
                  />
                  <BuyingOff
                    directives={directives.filter((d) => d.target === realmId && d.price !== null)}
                    traders={tradersAt(w, { residents, carriages }, realmId)}
                    onBuyOff={onBuyOff}
                  />
                </div>
              ))}
            {openId === v.id &&
              takesTransfers(
                cities.find((c) => c.id === v.id)!,
                { buildings },
                realmId,
              ) && (
                <Transferring
                  to={v}
                  fromCities={deliveryCities({ cities, buildings }, realmId)}
                  preview={(from, good, units) =>
                    previewTransfer({ cities, buildings }, from, v.id, good, units, mapSize)
                  }
                  onTransfer={onTransfer}
                />
              )}
            {openId === v.id &&
              npcStoragesInSight(
                cities.find((c) => c.id === v.id)!,
                { buildings },
              ).map((s) => (
                <div key={s.id} data-trade-at={s.id}>
                  <Prices warehouse={s} lists={tradeLists(s, { buildings })} place="Storage" />
                  <Trading
                    warehouse={s}
                    goods={tradedGoods(s, tradeLists(s, { buildings }))}
                    place="storage"
                    traders={tradersAt(s, { residents, carriages }, realmId)}
                    sending={sending(s)}
                    deliveryCities={[]}
                    preview={(resident, carriage, good, units) =>
                      previewNpcTrade(
                        s.prices as NpcCityPrice[],
                        buildings.find((b) => b.id === s.id)!,
                        resident,
                        carriage,
                        good,
                        units,
                        tick,
                        horses,
                      )
                    }
                    previewDelivery={() => ({ buy: noDelivery, sell: noDelivery })}
                    onTrade={onTrade}
                  />
                </div>
              ))}
            {openId === v.id && <Reaction city={cities.find((c) => c.id === v.id)!} />}
            {openId === v.id && (
              <Buying
                buy={describeBuying(
                  cities.find((c) => c.id === v.id)!,
                  { residents, buildings },
                  realmId,
                )}
                onBuy={(buyerId) => onBuyCity(buyerId, v.id)}
              />
            )}
            {openId === v.id && cities.find((c) => c.id === v.id)?.realmId === realmId && (
              <Gates
                gates={buildings.filter((b) => b.kind === 'gate' && !b.site && b.cityId === v.id)}
                onSetGate={onSetGate}
              />
            )}
          </li>
        ))}
      </ul>
      {lastSeen.cities.length > 0 && (
        <>
          <div className="panel-head">
            <h2>Last seen</h2>
            <span>{lastSeen.cities.length}</span>
          </div>
          <ul className="city-list" aria-label="Cities last seen">
            {lastSeen.cities.map((c) => (
              <RememberedCity
                key={c.id}
                city={c}
                lastSeen={lastSeen}
                realmId={realmId}
                realms={realms}
                tick={tick}
                open={openId === c.id}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * A city the Player remembers out of sight (`CONTEXT.md`: Last seen): when they last saw it, then
 * its buildings and prices as they were, greyed. Nothing can be done there from here.
 */
function RememberedCity({
  city,
  lastSeen,
  realmId,
  realms,
  tick,
  open,
  onOpen,
}: {
  city: LastSeen['cities'][number]
  lastSeen: LastSeen
  realmId: string
  realms: RealmLabel[]
  tick: number
  open: boolean
  onOpen: (id: string | undefined) => void
}) {
  const v = describeCity(city, { residents: [], buildings: lastSeen.buildings }, realmId, realms)
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => onOpen(open ? undefined : city.id)}>
        <strong>{v.name}</strong>
        <span>{v.whose}</span>
      </button>
      {open && (
        <div className="last-seen">
          <p className="city-details">{lastSeenText(city.seenAt, tick)}</p>
          {v.buildings.length > 0 && (
            <p className="city-details">
              {v.buildings.map(([k, n]) => buildingCount(k, n)).join(', ')}
            </p>
          )}
          {warehousesInSight(city, lastSeen).map((w) => (
            <Prices key={w.id} warehouse={w} lists={tradeLists(w, lastSeen)} />
          ))}
          {npcStoragesInSight(city, lastSeen).map((s) => (
            <Prices key={s.id} warehouse={s} lists={tradeLists(s, lastSeen)} place="Storage" />
          ))}
        </div>
      )}
    </li>
  )
}

/**
 * What an NPC city that holds the Player in low standing won't do (`CONTEXT.md`: NPC city
 * reaction): let their residents through its gates, trade, hire out, or sell itself.
 */
function Reaction({ city }: { city: SeenCity }) {
  if (!city.refuses && !city.wontSell) return null
  return (
    <div className="city-reaction" aria-label="Reaction">
      {city.refuses && (
        <p>
          It holds you in low standing: it won’t trade with you or hire out to you, and its gates
          are shut to your residents.
        </p>
      )}
      {city.wontSell && <p>It won’t sell itself to you.</p>}
    </div>
  )
}

/**
 * An NPC city's price (`CONTEXT.md`: Buying a city), the coins the Player's residents on its town
 * hall carry, and the buy order for one of them once there.
 */
function Buying({ buy, onBuy }: { buy: BuyView | undefined; onBuy: (buyerId: string) => void }) {
  if (!buy) return null
  const enough = buy.coins >= buy.price
  return (
    <div className="city-buying" aria-label="Buying">
      <p>
        Price: <strong>{buy.price} coins</strong>
      </p>
      {buy.townHall && !buy.buyerId && (
        <p className="small muted">
          To buy it, bring residents carrying the coins to its town hall at ({buy.townHall.x},{' '}
          {buy.townHall.y}).
        </p>
      )}
      {buy.buyerId && (
        <p>
          Your residents at its town hall carry {buy.coins} coins.{' '}
          <button type="button" disabled={!enough} onClick={() => onBuy(buy.buyerId!)}>
            Buy for {buy.price} coins
          </button>
        </p>
      )}
    </div>
  )
}

/** A city's finished gates, each open or closed, with a button to change it. */
function Gates({
  gates,
  onSetGate,
}: {
  gates: Building[]
  onSetGate: (gateId: string, open: boolean) => void
}) {
  if (gates.length === 0) return null
  return (
    <ul className="city-gates" aria-label="Gates">
      {gates.map((g) => {
        const open = !isClosed(g)
        return (
          <li key={g.id}>
            <span>
              Gate at ({g.x}, {g.y}): {open ? 'open' : 'closed'}
            </span>{' '}
            <button type="button" onClick={() => onSetGate(g.id, !open)}>
              {open ? 'Close' : 'Open'}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A warehouse's or an NPC city's storage's prices from the Player's side (`CONTEXT.md`: Trade
 * section): what they can buy there and what they can sell, with units where they see them and
 * the price of each in coins. An NPC city says it takes nothing else.
 */
function Prices({
  warehouse,
  lists,
  place = 'Warehouse',
}: {
  warehouse: WarehouseView
  lists: TradeLists
  /** What it is called: a Trade Org warehouse or an NPC city's storage. */
  place?: 'Warehouse' | 'Storage'
}) {
  const at = `${place} at (${warehouse.x}, ${warehouse.y})`
  return (
    <div className="warehouse-prices" aria-label={at}>
      <p className="warehouse-prices-place">{at}</p>
      <PriceList
        title="You can buy"
        lines={lists.canBuy}
        none={lists.takesOnlyListed ? 'It has nothing to spare.' : 'Nothing.'}
      />
      <PriceList
        title="You can sell"
        lines={lists.canSell}
        none={lists.takesOnlyListed ? 'It takes nothing.' : 'Nothing.'}
      />
      {lists.takesOnlyListed && lists.canSell.length > 0 && (
        <p className="small muted">It takes nothing else.</p>
      )}
    </div>
  )
}

/** One side of the prices: per good, the units (where known) and the price of each in coins. */
function PriceList({ title, lines, none }: { title: string; lines: TradeLine[]; none: string }) {
  if (lines.length === 0) {
    return (
      <p className="small">
        <strong>{title}:</strong> {none}
      </p>
    )
  }
  const units = lines.some((l) => l.units !== undefined)
  return (
    <table aria-label={title}>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">Good</th>
          {units && <th scope="col">Units</th>}
          <th scope="col">Coins each</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.good}>
            <th scope="row">{GOOD_LABELS[l.good]}</th>
            {units && <td>{l.units ?? ''}</td>}
            <td>{l.price}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Sending someone to a warehouse or storage to trade (`CONTEXT.md`: Trade section): a walk order
 * to its tile, or with `carriageId` a drive order for the carriage.
 */
export interface SendRequest {
  residentId: string
  carriageId: string | undefined
  x: number
  y: number
}

/** A buy or sell order as the inspector gives it (`CONTEXT.md`: Trading with the Trade Organization). */
export interface TradeRequest {
  side: TradeSide
  residentId: string
  good: PricedGood
  units: number
  carriageId: string | null
  /** A city of the Player's to deliver to or pick up from (`CONTEXT.md`: Delivery). */
  cityId?: string
}

/**
 * Buying and selling at a warehouse (`CONTEXT.md`: Trading with the Trade Organization): one of
 * the Player's residents on its tile trades a good from their hands or their carriage there, with
 * what they hold and room left, and a preview of what it would move at its prices: what cut it
 * down, or why it won't go (`CONTEXT.md`: Trade section). Or, with one of the Player's cities picked, a
 * caravan delivers what is bought to its storage, or picks up what is sold from there, for a fee
 * (`CONTEXT.md`: Delivery). Nobody of theirs there, and it offers to send someone (`Sending`).
 */
function Trading({
  warehouse,
  goods,
  place = 'warehouse',
  traders,
  sending,
  deliveryCities,
  preview,
  previewDelivery,
  onTrade,
}: {
  warehouse: WarehouseView
  /** The goods that can be traded there (`tradedGoods`), for the Good picker. */
  goods: PricedGood[]
  /** Where the trade happens: a Trade Org warehouse or an NPC city's storage. */
  place?: 'warehouse' | 'storage'
  traders: TradersView
  /** Whom to send there while nobody of the Player's is, and who is on the way. */
  sending: SendingProps
  deliveryCities: DeliveryCity[]
  preview: (
    resident: Resident,
    carriage: Carriage | undefined,
    good: PricedGood,
    units: number,
  ) => TradePreview
  previewDelivery: (
    resident: Resident,
    carriage: Carriage | undefined,
    good: PricedGood,
    units: number,
    city: DeliveryCity,
  ) => { buy: DeliveryQuote; sell: DeliveryQuote }
  onTrade: (trade: TradeRequest) => void
}) {
  const [residentId, setResidentId] = useState<string | undefined>()
  const [carriageId, setCarriageId] = useState<string>('')
  const [cityId, setCityId] = useState<string>('')
  const [good, setGood] = useState<PricedGood | undefined>()
  const [units, setUnits] = useState(1)
  const resident = traders.residents.find((r) => r.id === residentId) ?? traders.residents[0]
  const carriage = traders.carriages.find((k) => k.id === carriageId)
  const city = deliveryCities.find((c) => c.id === cityId)
  const picked = good !== undefined && goods.includes(good) ? good : goods[0]
  if (!picked) return null
  if (!resident) return <Sending warehouse={warehouse} place={place} {...sending} />
  const label = GOOD_LABELS[picked].toLowerCase()
  const quote = preview(resident, carriage, picked, units)
  const trade = (side: TradeSide) =>
    onTrade({
      side,
      residentId: resident.id,
      good: picked,
      units,
      // A pick-up comes from the city's storage, never a carriage.
      carriageId: city && side === 'sell' ? null : (carriage?.id ?? null),
      ...(city ? { cityId: city.id } : {}),
    })
  let buyText: string
  let sellText: string
  let canBuy: boolean
  let canSell: boolean
  if (city) {
    const delivery = previewDelivery(resident, carriage, picked, units, city)
    canBuy = delivery.buy.units > 0
    canSell = delivery.sell.units > 0
    buyText = canBuy
      ? `Buy ${delivery.buy.units} ${label} for ${delivery.buy.coins} coins + ${delivery.buy.fee} fee, delivered to ${city.name}`
      : `Can’t buy ${label} for delivery`
    sellText = canSell
      ? `Sell ${delivery.sell.units} ${label} from ${city.name}, picked up for about ${delivery.sell.coins} coins after a ${delivery.sell.fee} fee`
      : `Nothing to pick up in ${city.name}`
  } else {
    canBuy = quote.buy.units > 0
    canSell = quote.sell.units > 0
    buyText = tradeText('buy', label, quote.buy, !!carriage)
    sellText = tradeText('sell', label, quote.sell, !!carriage)
  }
  return (
    <div className="warehouse-trading" aria-label="Trading">
      <label>
        Trader{' '}
        <select value={resident.id} onChange={(e) => setResidentId(e.target.value)}>
          {traders.residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {traders.carriages.length > 0 && (
        <label>
          With{' '}
          <select value={carriageId} onChange={(e) => setCarriageId(e.target.value)}>
            <option value="">their hands</option>
            {traders.carriages.map((k) => (
              <option key={k.id} value={k.id}>
                carriage {k.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="small muted trader-holds">
        {holderText(quote.holder, picked, label, carriage?.id)}
      </p>
      <label>
        Good{' '}
        <select value={picked} onChange={(e) => setGood(e.target.value as PricedGood)}>
          {goods.map((g) => (
            <option key={g} value={g}>
              {GOOD_LABELS[g]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Units{' '}
        <input
          type="number"
          min={1}
          step={1}
          value={units}
          onChange={(e) => setUnits(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        />
      </label>
      {deliveryCities.length > 0 && (
        <div className="trade-service" aria-label="Delivery">
          <h3>Delivery</h3>
          <p className="small muted">
            A caravan brings what you buy to your city’s storage, or fetches what you sell from it,
            for a fee.
          </p>
          <label>
            City{' '}
            <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
              <option value="">none, carry it here</option>
              {deliveryCities.map((c) => (
                <option key={c.id} value={c.id}>
                  to or from {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p>
        <button type="button" disabled={!canBuy} onClick={() => trade('buy')}>
          {buyText}
        </button>{' '}
        <button type="button" disabled={!canSell} onClick={() => trade('sell')}>
          {sellText}
        </button>
      </p>
    </div>
  )
}

interface SendingProps {
  /** Whom the Player can send there, nearest first (`sendable`). */
  sendable: SendView[]
  /** A line for each of theirs on the way there (`onTheWayLine`). */
  going: string[]
  onSend: (send: SendView) => void
}

/**
 * With nobody of the Player's at a warehouse or storage (`CONTEXT.md`: Trade section): who is on
 * the way there, and a picker to send one of their residents, or a carriage, nearest first with
 * what each carries.
 */
function Sending({
  warehouse,
  place,
  sendable,
  going,
  onSend,
}: SendingProps & { warehouse: WarehouseView; place: 'warehouse' | 'storage' }) {
  const [key, setKey] = useState('')
  const keyOf = (s: SendView) => `${s.residentId}:${s.carriageId ?? ''}`
  const picked = sendable.find((s) => keyOf(s) === key) ?? sendable[0]
  return (
    <div className="warehouse-sending" aria-label="Sending a trader">
      {going.length > 0 ? (
        going.map((line) => <p key={line}>{line}.</p>)
      ) : (
        <p className="small muted">
          Nobody of yours is at the {place} at ({warehouse.x}, {warehouse.y}) to trade.
        </p>
      )}
      {picked ? (
        <p>
          <label>
            Send{' '}
            <select value={keyOf(picked)} onChange={(e) => setKey(e.target.value)}>
              {sendable.map((s) => (
                <option key={keyOf(s)} value={keyOf(s)}>
                  {s.name}, {s.tiles} {s.tiles === 1 ? 'tile' : 'tiles'} away,{' '}
                  {carriedShort(s.carries, GOOD_LABELS).toLowerCase()}
                </option>
              ))}
            </select>
          </label>{' '}
          <button type="button" onClick={() => onSend(picked)}>
            Send
          </button>
        </p>
      ) : (
        <p className="small muted">Nobody of yours in sight to send.</p>
      )}
    </div>
  )
}

/** A transfer order (`CONTEXT.md`: Transfer): from one of the Player's cities to another realm's. */
export interface TransferRequest {
  fromCityId: string
  toCityId: string
  good: Good
  units: number
}

/**
 * Sending a transfer to another realm's city (`CONTEXT.md`: Transfer): a caravan picks up a good
 * (coins too) at one of the Player's cities and brings it to this city's storage, taking its fee
 * there with the goods; with a preview of what it would take, as far as the Player sees.
 */
function Transferring({
  to,
  fromCities,
  preview,
  onTransfer,
}: {
  to: { id: string; name: string }
  fromCities: DeliveryCity[]
  preview: (
    from: DeliveryCity,
    good: Good,
    units: number,
  ) => { units: number; fee: number } | undefined
  onTransfer: (transfer: TransferRequest) => void
}) {
  const [fromId, setFromId] = useState<string>('')
  const [good, setGood] = useState<Good>('food')
  const [units, setUnits] = useState(1)
  const from = fromCities.find((c) => c.id === fromId) ?? fromCities[0]
  if (!from) return null
  const label = GOOD_LABELS[good].toLowerCase()
  const quote = preview(from, good, units)
  const text =
    quote === undefined
      ? `Send ${units} ${label} from ${from.name} (no warehouse in sight to tell the fee)`
      : quote.units > 0
        ? `Send ${quote.units} ${label} from ${from.name} for a ${quote.fee}-coin fee`
        : `${from.name} hasn’t the ${label} or the fee`
  return (
    <div className="city-transfer trade-service" aria-label="Transfer">
      <h3>Transfer</h3>
      <p className="small muted">
        A caravan fetches goods or coins from one of your cities and brings them to this city, for a
        fee.
      </p>
      <label>
        From{' '}
        <select value={from.id} onChange={(e) => setFromId(e.target.value)}>
          {fromCities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Good{' '}
        <select value={good} onChange={(e) => setGood(e.target.value as Good)}>
          {GOODS.map((g) => (
            <option key={g} value={g}>
              {GOOD_LABELS[g]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Units{' '}
        <input
          type="number"
          min={1}
          step={1}
          value={units}
          onChange={(e) => setUnits(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        />
      </label>
      <p>
        <button
          type="button"
          disabled={quote?.units === 0}
          onClick={() => onTransfer({ fromCityId: from.id, toCityId: to.id, good, units })}
        >
          {text}
        </button>{' '}
        <span className="small muted">to {to.name}, by Trade Org caravan</span>
      </p>
    </div>
  )
}

/**
 * Buying off an admin directive against the Player's realm (`CONTEXT.md`: Admin directive): one
 * of their residents on the warehouse pays its price from their hands or their carriage there.
 * Nothing when no directive names the realm with a price.
 */
function BuyingOff({
  directives,
  traders,
  onBuyOff,
}: {
  directives: DirectiveView[]
  traders: TradersView
  onBuyOff: (residentId: string, directiveId: string, carriageId: string | null) => void
}) {
  const [residentId, setResidentId] = useState<string | undefined>()
  const [carriageId, setCarriageId] = useState<string>('')
  if (directives.length === 0) return null
  const resident = traders.residents.find((r) => r.id === residentId) ?? traders.residents[0]
  const carriage = traders.carriages.find((k) => k.id === carriageId)
  if (!resident) {
    return (
      <p className="small muted">
        To buy off the admin directive against you, bring a resident here with its price in coins.
      </p>
    )
  }
  const coins = (carriage ? carriage.load : resident.carried).coins ?? 0
  return (
    <div className="warehouse-trading" aria-label="Buying off">
      <label>
        Payer{' '}
        <select value={resident.id} onChange={(e) => setResidentId(e.target.value)}>
          {traders.residents.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {traders.carriages.length > 0 && (
        <label>
          With{' '}
          <select value={carriageId} onChange={(e) => setCarriageId(e.target.value)}>
            <option value="">their hands</option>
            {traders.carriages.map((k) => (
              <option key={k.id} value={k.id}>
                carriage {k.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {directives.map((d) => (
        <p key={d.id}>
          <button
            type="button"
            disabled={coins < d.price!}
            onClick={() => onBuyOff(resident.id, d.id, carriage?.id ?? null)}
          >
            {coins < d.price!
              ? `Buying off the directive (${d.reason}) takes ${d.price} coins`
              : `Pay ${d.price} coins to buy off the directive (${d.reason})`}
          </button>
        </p>
      ))}
    </div>
  )
}

/** No delivery: an NPC city delivers nothing (`CONTEXT.md`: Delivery is a Trade Org service). */
const noDelivery: DeliveryQuote = { units: 0, coins: 0, fee: 0 }
