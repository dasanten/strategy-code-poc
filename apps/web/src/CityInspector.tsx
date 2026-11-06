import { useEffect, useRef, useState } from 'react'
import {
  GOODS,
  buildingRealm,
  horseBuyerProblem,
  horseSellerProblem,
  isClosed,
  noSwap,
  type Building,
  type NpcHorseOffer,
  type SeenBuilding,
  type Carriage,
  type DeliveryQuote,
  type Good,
  type DirectiveView,
  type NpcCityPrice,
  type PricedGood,
  type RealmEvent,
  type RealmLabel,
  type Resident,
  type SeenCity,
  type StandingView,
  type TradeSide,
  type SeenResident,
  type Stock,
  type SeenCarriage,
  type SeenHorse,
  type SeenTrader,
  type TraderVisit,
  aboutTime,
  type SwapQuote,
  type SwapRate,
} from '@csp/shared'
import {
  buildingCount,
  describeBuying,
  deliveryCities,
  describeCity,
  describeOccupation,
  npcStablesInSight,
  npcStoragesInSight,
  previewDelivery,
  previewNpcSwap,
  previewNpcTrade,
  previewSwap,
  previewTrade,
  previewTransfer,
  holderText,
  onTheWay,
  onTheWayLine,
  ratesAt,
  rateText,
  sendable,
  swapText,
  takesTransfers,
  tradedGoods,
  tradesHere,
  tradeLists,
  tradersAt,
  traderStopsAt,
  previewTraderTrade,
  tradeText,
  warehousesInSight,
  type BuyView,
  type DeliveryCity,
  type NpcStableView,
  type SendView,
  type TradeLine,
  type TradeLists,
  type TradePreview,
  type TradersView,
  type WarehouseView,
} from './city-view.js'
import { loadKnown } from './seen.js'
import { GOOD_LABELS } from './Residents.js'
import { offerStoragesOf, outpostOfferStorages } from './offers-view.js'
import { StorageOffers, type AcceptOfferRequest, type PostOfferRequest } from './Offers.js'
import { GoodIcon } from './GoodsGrid.js'
import { carriedShort } from './residents-view.js'
import { lastSeenText, type LastSeen } from './last-seen.js'
import { horseStatsText } from './selection-view.js'
import { HOW_TO_TRADE_PATH } from './wiki-view.js'
import { PanelHead } from './drawer-head.js'
import { tradeStandingLine } from './standing-view.js'

/**
 * The city inspector: every city in sight (`CONTEXT.md`: City, NPC city), whose it is, and,
 * for the one picked, how many of its residents and which of its buildings the Player sees. A
 * city of the Player's own lists its gates, to open or close (`CONTEXT.md`: Walls in combat); an
 * NPC city names its price and can be bought (`CONTEXT.md`: Buying a city); a Trade Org city lists
 * the prices of its warehouses in sight (`CONTEXT.md`: Warehouse prices), where the Player's
 * residents on a warehouse buy and sell (`CONTEXT.md`: Trading with the Trade Organization). An
 * NPC city that doesn't refuse the Player lists its prices at its storages in sight, where their
 * residents trade with it the same way (`CONTEXT.md`: Trading with an NPC city), and a wandering
 * trader standing at a city lists its own, for the same (`CONTEXT.md`: Trader stop).
 * A city of another realm takes transfers from the Player's cities (`CONTEXT.md`: Transfer).
 * Below them, the cities the Player remembers out of sight (`CONTEXT.md`: Last seen): as they
 * last saw them and when, greyed, with nothing to do there.
 */
export function CityInspector({
  cities,
  lastSeen,
  residents,
  buildings,
  traders,
  traderVisits,
  realmId,
  realms,
  carriages,
  horses,
  tick,
  mapSize,
  onSetGate,
  onBuyCity,
  onTrade,
  onSwap,
  onBuyHorse,
  onSellHorse,
  onTransfer,
  onSend,
  arrivesIn,
  directives,
  debt,
  noCaravans,
  onBuyOff,
  onPayDebt,
  onPostOffer,
  onTakeDownOffer,
  onAcceptOffer,
  openId,
  onOpen,
  scrollTo,
  standings,
  events,
}: {
  cities: SeenCity[]
  /** What the Player remembers out of sight. */
  lastSeen: LastSeen
  residents: SeenResident[]
  buildings: SeenBuilding[]
  /** The wandering traders in sight (`CONTEXT.md`: Trader stop). */
  traders: SeenTrader[]
  /** Those standing at the realm's cities, in sight or not. */
  traderVisits: TraderVisit[]
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
  /** Gives a swap order to one of the Player's residents on a warehouse or NPC storage. */
  onSwap: (swap: SwapRequest) => void
  /** Gives a buy horse order to one of the Player's residents at an NPC city's stable. */
  onBuyHorse: (buy: HorseTradeRequest) => void
  /** Gives a sell horse order to one of the Player's residents at an NPC city's stable. */
  onSellHorse: (sale: HorseTradeRequest) => void
  /** Orders a transfer from one of the Player's cities to another realm's city. */
  onTransfer: (transfer: TransferRequest) => void
  /** Sends one of the Player's residents, or a carriage they drive, to a warehouse or storage. */
  onSend: (send: SendRequest) => void
  /** About how many ticks until a resident arrives where they walk, ride or drive (`arrivalTicks`). */
  arrivesIn: ((r: Resident) => number | undefined) | undefined
  /** The admin directives in force; one naming the Player's realm may be bought off here. */
  directives: DirectiveView[]
  /** The Coins the Player's realm owes the Trade Organization (`CONTEXT.md`: Trade Org debt). */
  debt: number
  /** The Trade Org HQ has fallen, so nothing can be delivered or transferred (`CONTEXT.md`). */
  noCaravans: boolean
  /** Gives the buy-off order for a directive to one of the Player's residents on a warehouse. */
  onBuyOff: (residentId: string, directiveId: string, carriageId: string | null) => void
  /** Gives the order to pay some of the debt to one of the Player's residents on a warehouse. */
  onPayDebt: (residentId: string, coins: number, carriageId: string | null) => void
  /** Posts an offer at a storage of the Player's realm (`CONTEXT.md`: Offer). */
  onPostOffer: (offer: PostOfferRequest) => void
  /** Takes down an offer of the Player's realm. */
  onTakeDownOffer: (offerId: string) => void
  /** Gives the accept order for an offer to one of the Player's residents on its storage. */
  onAcceptOffer: (accept: AcceptOfferRequest) => void
  /** The city shown opened, such as one picked on the map. */
  openId: string | undefined
  /** Called with the city opened in the list, or undefined when it is closed. */
  onOpen: (id: string | undefined) => void
  /**
   * The warehouse or storage of the open city to bring into view, as Trade here on its tile card
   * asks (`CONTEXT.md`: Trade section); each new object scrolls again.
   */
  scrollTo?: { buildingId: string }
  /** How others regard the realm, for the standing line of the Trade section. */
  standings: StandingView[]
  /** The realm's log, for how far its last trade moved that standing. */
  events: RealmEvent[]
}) {
  const views = cities.map((c) => ({
    ...describeCity(c, { residents, buildings }, realmId, realms),
    occupation: describeOccupation(c, tick, realmId, realms),
  }))
  const sending = (place: WarehouseView): SendingProps => ({
    sendable: sendable(place, { residents, carriages }, realmId, mapSize, tick),
    going: onTheWay(place, { residents }, realmId, mapSize).map((r) =>
      onTheWayLine(r.name, arrivesIn?.(r)),
    ),
    onSend: (s) =>
      onSend({ residentId: s.residentId, carriageId: s.carriageId, x: place.x, y: place.y }),
  })
  const offersAt = (s: SeenBuilding) => (
    <div key={s.id} data-trade-at={s.id}>
      <StorageOffers
        storage={s}
        own={buildingRealm({ cities }, s) === realmId}
        realmId={realmId}
        traders={tradersAt(s, { residents, carriages }, realmId)}
        sending={
          <Sending
            warehouse={{ id: s.id, kind: s.kind, x: s.x, y: s.y, prices: [] }}
            place="storage"
            {...sending({ id: s.id, kind: s.kind, x: s.x, y: s.y, prices: [] })}
          />
        }
        tick={tick}
        horses={horses}
        onPost={onPostOffer}
        onTakeDown={onTakeDownOffer}
        onAccept={onAcceptOffer}
      />
    </div>
  )
  const outposts = outpostOfferStorages({ cities, buildings }, realmId)
  const list = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!scrollTo) return
    list.current
      ?.querySelector(`[data-trade-at="${CSS.escape(scrollTo.buildingId)}"]`)
      ?.scrollIntoView({ block: 'start' })
  }, [scrollTo])
  return (
    <section className="city-inspector" aria-label="Cities in sight" ref={list}>
      <PanelHead title="Cities in sight">
        {views.length === 0 ? 'none in sight' : `${views.length} in sight`}
      </PanelHead>
      {debt > 0 && (
        <p className="occupation warn">
          You owe the Trade Organization {debt} Coins. A resident can pay at any of its warehouses.
        </p>
      )}
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
            {v.occupation && (
              <p className={`occupation${v.occupation.warning ? ' warn' : ''}`}>
                {v.occupation.text}
              </p>
            )}
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
                { cities, buildings, traders },
                realmId,
                traderVisits,
              ) && (
                <p className="small trade-wiki">
                  {/* A new tab, so the game keeps running behind it (`CONTEXT.md`: Wiki). */}
                  <a href={HOW_TO_TRADE_PATH} target="_blank" rel="noopener">
                    How to trade
                  </a>
                </p>
              )}
            {openId === v.id && (
              <TradeStanding
                line={tradeStandingLine(
                  cities.find((c) => c.id === v.id)!,
                  { cities, buildings, traders },
                  traderVisits,
                  standings,
                  events,
                )}
              />
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
                    deliveryCities={
                      noCaravans ? [] : deliveryCities({ cities, buildings }, realmId)
                    }
                    swapGoods={w.prices.map((p) => p.good)}
                    previewSwap={(resident, carriage, give, want, units) =>
                      previewSwap(
                        { cities, buildings },
                        w.id,
                        resident,
                        carriage,
                        give,
                        want,
                        units,
                        tick,
                        horses,
                      )
                    }
                    onSwap={onSwap}
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
                  {noCaravans && (
                    <p className="small muted">
                      The Trade Org HQ has fallen: no caravans run, so no deliveries or transfers.
                    </p>
                  )}
                  <BuyingOff
                    directives={directives.filter((d) => d.target === realmId && d.price !== null)}
                    traders={tradersAt(w, { residents, carriages }, realmId)}
                    onBuyOff={onBuyOff}
                  />
                  <PayingDebt
                    debt={debt}
                    traders={tradersAt(w, { residents, carriages }, realmId)}
                    onPayDebt={onPayDebt}
                  />
                </div>
              ))}
            {openId === v.id &&
              !noCaravans &&
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
                    rates={ratesAt(s, { buildings })}
                    swapGoods={s.prices.map((p) => p.good)}
                    previewSwap={(resident, carriage, give, want, units) =>
                      previewNpcSwap(
                        s.prices as NpcCityPrice[],
                        buildings.find((b) => b.id === s.id)!,
                        resident,
                        carriage,
                        give,
                        want,
                        units,
                        tick,
                        horses,
                      )
                    }
                    onSwap={onSwap}
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
            {openId === v.id &&
              npcStablesInSight(
                cities.find((c) => c.id === v.id)!,
                { buildings },
              ).map((s) => (
                <div key={s.id} data-trade-at={s.id}>
                  <HorseMarket
                    stable={s}
                    traders={tradersAt(s, { residents, carriages }, realmId).residents}
                    sending={sending(s)}
                    tick={tick}
                    onBuy={onBuyHorse}
                    onSell={onSellHorse}
                  />
                </div>
              ))}
            {openId === v.id &&
              traderStopsAt(v, traders, traderVisits).map((s) => (
                <div key={s.id} data-trade-at={s.id}>
                  {!s.unseen && (
                    <Prices
                      warehouse={s}
                      lists={tradeLists(s, { buildings })}
                      place="Wandering trader"
                    />
                  )}
                  <p className="small muted">
                    {s.unseen && `A wandering trader stands at (${s.x}, ${s.y}). `}It goes on in{' '}
                    {aboutTime(Math.max(0, s.until - tick))}.
                  </p>
                  {s.unseen ? (
                    <Sending warehouse={s} place="wandering trader" {...sending(s)} />
                  ) : (
                    <Trading
                      warehouse={s}
                      goods={tradedGoods(s, tradeLists(s, { buildings }))}
                      place="wandering trader"
                      traders={tradersAt(s, { residents, carriages }, realmId)}
                      sending={sending(s)}
                      deliveryCities={[]}
                      swapGoods={[]}
                      previewSwap={() => noSwap()}
                      onSwap={onSwap}
                      preview={(resident, carriage, good, units) =>
                        previewTraderTrade(
                          traders.find((t) => t.id === s.id) ?? { escortIds: [] },
                          carriages.filter(loadKnown).find((k) => k.id === s.carriageId),
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
                  )}
                </div>
              ))}
            {openId === v.id && offerStoragesOf(v, { cities, buildings }, realmId).map(offersAt)}
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
      {outposts.length > 0 && (
        <>
          <div className="panel-head">
            <h2>Outpost storages</h2>
            <span>{outposts.length}</span>
          </div>
          {outposts.map(offersAt)}
        </>
      )}
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
 * The standing with whoever a trade at this city moves it with, and how far the last trade moved it
 * (`CONTEXT.md`: Trade section), where one can be traded with here.
 */
function TradeStanding({ line }: { line: string | undefined }) {
  if (!line) return null
  return (
    <p className="small" aria-label="Standing here">
      {line}
    </p>
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
  /** What it is called: a Trade Org warehouse, an NPC city's storage or a wandering trader. */
  place?: 'Warehouse' | 'Storage' | 'Wandering trader'
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
export function PriceList({
  title,
  lines,
  none,
}: {
  title: string
  lines: TradeLine[]
  none: string
}) {
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
            <th scope="row">
              <span className="good-label">
                <GoodIcon good={l.good} />
                {GOOD_LABELS[l.good]}
              </span>
            </th>
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

/** A swap order as the inspector gives it (`CONTEXT.md`: Swap). */
export interface SwapRequest {
  residentId: string
  give: PricedGood
  want: PricedGood
  units: number
  carriageId: string | null
}

/**
 * Buying and selling at a warehouse (`CONTEXT.md`: Trading with the Trade Organization): one of
 * the Player's residents on its tile trades a good from their hands or their carriage there, with
 * what they hold and room left, and a preview of what it would move at its prices: what cut it
 * down, or why it won't go (`CONTEXT.md`: Trade section). Or, with one of the Player's cities picked, a
 * caravan delivers what is bought to its storage, or picks up what is sold from there, for a fee
 * (`CONTEXT.md`: Delivery). Below, the same trader can swap goods for goods (`Swapping`). Nobody of
 * theirs there, and it offers to send someone (`Sending`); a rate picked meanwhile is the swap filled
 * in once they arrive.
 */
function Trading({
  warehouse,
  goods,
  place = 'warehouse',
  traders,
  sending,
  deliveryCities,
  rates = [],
  swapGoods,
  preview,
  previewDelivery,
  previewSwap,
  onTrade,
  onSwap,
}: {
  warehouse: WarehouseView
  /** The goods that can be traded there (`tradedGoods`), for the Good picker. */
  goods: PricedGood[]
  /** Where the trade happens: a Trade Org warehouse, an NPC city's storage or a wandering trader. */
  place?: TradePlace
  traders: TradersView
  /** Whom to send there while nobody of the Player's is, and who is on the way. */
  sending: SendingProps
  deliveryCities: DeliveryCity[]
  /** An NPC city's rates at its storage (`ratesAt`); a warehouse lists none. */
  rates?: SwapRate[]
  /** The goods a swap can name there: every good it prices, so a refusal can say why. */
  swapGoods: PricedGood[]
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
  previewSwap: (
    resident: Resident,
    carriage: Carriage | undefined,
    give: PricedGood,
    want: PricedGood,
    units: number,
  ) => SwapQuote
  onTrade: (trade: TradeRequest) => void
  onSwap: (swap: SwapRequest) => void
}) {
  const [residentId, setResidentId] = useState<string | undefined>()
  const [carriageId, setCarriageId] = useState<string>('')
  const [cityId, setCityId] = useState<string>('')
  const [good, setGood] = useState<PricedGood | undefined>()
  const [units, setUnits] = useState(1)
  const [rate, setRate] = useState<SwapRate | undefined>()
  const resident = traders.residents.find((r) => r.id === residentId) ?? traders.residents[0]
  const carriage = traders.carriages.find((k) => k.id === carriageId)
  const city = deliveryCities.find((c) => c.id === cityId)
  const picked = good !== undefined && goods.includes(good) ? good : goods[0]
  if (!picked) return null
  if (!resident) {
    return (
      <>
        <Rates rates={rates} hint="Pick one to send someone to swap it." onPick={setRate} />
        {rate && (
          <p className="small rate-picked">
            To swap{' '}
            {rateText(
              rate,
              GOOD_LABELS[rate.give].toLowerCase(),
              GOOD_LABELS[rate.want].toLowerCase(),
            )}
            , send someone there with the {GOOD_LABELS[rate.give].toLowerCase()}.
          </p>
        )}
        <Sending warehouse={warehouse} place={place} {...sending} />
      </>
    )
  }
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
      {swapGoods.length > 0 && (
        <Swapping
          goods={swapGoods}
          rates={rates}
          firstRate={rate}
          holds={carriage ? carriage.load : resident.carried}
          preview={(give, want, n) => previewSwap(resident, carriage, give, want, n)}
          onSwap={(give, want, n) =>
            onSwap({
              residentId: resident.id,
              give,
              want,
              units: n,
              carriageId: carriage?.id ?? null,
            })
          }
        />
      )}
    </div>
  )
}

/**
 * Swapping goods for goods (`CONTEXT.md`: Swap): the good the trader wants and how much, the good
 * they give for it (each with what they hold), and a button saying what it would move at the
 * place's prices, what cut it down, or why it won't go. An NPC city's rates stand above it, and
 * picking one fills it in.
 */
function Swapping({
  goods,
  rates,
  firstRate,
  holds,
  preview,
  onSwap,
}: {
  goods: PricedGood[]
  rates: SwapRate[]
  /** The rate picked before anyone was there, to start from. */
  firstRate: SwapRate | undefined
  /** What the trader holds, in their hands or on their carriage. */
  holds: Stock
  preview: (give: PricedGood, want: PricedGood, units: number) => SwapQuote
  onSwap: (give: PricedGood, want: PricedGood, units: number) => void
}) {
  const [wantPicked, setWant] = useState<PricedGood | undefined>(firstRate?.want)
  const [givePicked, setGive] = useState<PricedGood | undefined>(firstRate?.give)
  const [units, setUnits] = useState(firstRate?.units ?? 1)
  const want = wantPicked !== undefined && goods.includes(wantPicked) ? wantPicked : goods[0]
  if (!want) return null
  const gives = goods.filter((g) => g !== want)
  const give =
    givePicked !== undefined && gives.includes(givePicked)
      ? givePicked
      : (gives.find((g) => (holds[g] ?? 0) > 0) ?? gives[0])
  if (!give) return null
  const quote = preview(give, want, units)
  return (
    <div className="trade-service" aria-label="Swap">
      <h3>Swap</h3>
      <p className="small muted">
        Goods for goods, no coins needed: you hand over enough to pay for what you want, at its
        prices, and what is over comes back in coins as far as it holds them.
      </p>
      <Rates
        rates={rates}
        hint="Pick one to fill in the swap below."
        onPick={(r) => {
          setWant(r.want)
          setGive(r.give)
          setUnits(r.units)
        }}
      />
      <label>
        Want{' '}
        <select value={want} onChange={(e) => setWant(e.target.value as PricedGood)}>
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
      <label>
        Give{' '}
        <select value={give} onChange={(e) => setGive(e.target.value as PricedGood)}>
          {gives.map((g) => (
            <option key={g} value={g}>
              {GOOD_LABELS[g]} ({Math.floor(holds[g] ?? 0)} held)
            </option>
          ))}
        </select>
      </label>
      <p>
        <button
          type="button"
          disabled={quote.units === 0}
          onClick={() => onSwap(give, want, units)}
        >
          {swapText(GOOD_LABELS[give].toLowerCase(), GOOD_LABELS[want].toLowerCase(), quote)}
        </button>
      </p>
    </div>
  )
}

/**
 * An NPC city's rates (`CONTEXT.md`: Swap): what it would take of the goods it is short of for the
 * goods it has spare, at today's prices. Nothing when it has none.
 */
function Rates({
  rates,
  hint,
  onPick,
}: {
  rates: SwapRate[]
  /** What picking one does. */
  hint: string
  onPick: (rate: SwapRate) => void
}) {
  if (rates.length === 0) return null
  return (
    <div className="swap-rates" aria-label="Rates">
      <h3>Rates</h3>
      <p className="small muted">
        You give what it is short of for what it has spare, at today’s prices. {hint}
      </p>
      <ul>
        {rates.map((r) => (
          <li key={`${r.give}:${r.want}`}>
            <button type="button" onClick={() => onPick(r)}>
              <GoodIcon good={r.give} />
              {rateText(r, GOOD_LABELS[r.give].toLowerCase(), GOOD_LABELS[r.want].toLowerCase())}
              <GoodIcon good={r.want} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A buy or sell horse order as the inspector gives it (`CONTEXT.md`: Horse market). */
export interface HorseTradeRequest {
  residentId: string
  horseId: string
}

/**
 * An NPC city's stable from the Player's side (`CONTEXT.md`: Horse market, Trade section): its horses
 * and the Player's own standing there, with name, stats and price, and for one of the Player's
 * residents there a button for each, or why it won't go. Nobody of theirs there, and it offers to
 * send someone (`Sending`).
 */
function HorseMarket({
  stable,
  traders,
  sending,
  tick,
  onBuy,
  onSell,
}: {
  stable: NpcStableView
  /** The Player's residents at the stable. */
  traders: Resident[]
  /** Whom to send there while nobody of the Player's is, and who is on the way. */
  sending: SendingProps
  tick: number
  onBuy: (buy: HorseTradeRequest) => void
  onSell: (sale: HorseTradeRequest) => void
}) {
  const [residentId, setResidentId] = useState<string | undefined>()
  const resident = traders.find((r) => r.id === residentId) ?? traders[0]
  const at = `Stable at (${stable.x}, ${stable.y})`
  return (
    <div className="warehouse-prices horse-market" aria-label={at}>
      <p className="warehouse-prices-place">{at}</p>
      {stable.horses.length > 0 && (
        <ul className="horse-offers" aria-label="Horses">
          {stable.horses.map((h) => (
            <HorseOfferRow
              key={h.horseId}
              offer={h}
              verb="Buy"
              tick={tick}
              resident={resident}
              problem={h.problem ?? (resident && horseBuyerProblem(resident, h.price, tick))}
              onTrade={onBuy}
            />
          ))}
        </ul>
      )}
      {stable.toSell.length > 0 && (
        <ul className="horse-offers" aria-label="Your horses">
          {stable.toSell.map((h) => (
            <HorseOfferRow
              key={h.horseId}
              offer={h}
              verb="Sell"
              tick={tick}
              resident={resident}
              problem={h.problem ?? (resident && horseSellerProblem(resident, h.price, tick))}
              onTrade={onSell}
            />
          ))}
        </ul>
      )}
      {resident ? (
        <>
          {traders.length > 1 && (
            <label>
              Trader{' '}
              <select value={resident.id} onChange={(e) => setResidentId(e.target.value)}>
                {traders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="small muted trader-holds">
            {resident.name} holds {Math.floor(resident.carried.coins ?? 0)} coins.
          </p>
        </>
      ) : (
        <Sending warehouse={stable} place="stable" {...sending} />
      )}
    </div>
  )
}

/** One horse in `HorseMarket`: what it is and costs, and the button to trade it or why it won't go. */
function HorseOfferRow({
  offer,
  verb,
  tick,
  resident,
  problem,
  onTrade,
}: {
  offer: NpcHorseOffer
  verb: 'Buy' | 'Sell'
  tick: number
  resident: Resident | undefined
  problem: string | undefined
  onTrade: (trade: HorseTradeRequest) => void
}) {
  return (
    <li>
      <strong>{offer.name}</strong>: <strong>{offer.price} coins</strong>
      <br />
      <span className="small">{horseStatsText(offer, tick)}</span>
      {resident && (
        <>
          <br />
          <button
            type="button"
            disabled={problem !== undefined}
            onClick={() => onTrade({ residentId: resident.id, horseId: offer.horseId })}
          >
            {verb} {offer.name} for {offer.price} coins
          </button>
        </>
      )}
      {problem && <p className="small muted">{problem}.</p>}
    </li>
  )
}

/** Where a trade happens, as the Trade section says it. */
type TradePlace = 'warehouse' | 'storage' | 'stable' | 'wandering trader'

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
export function Sending({
  warehouse,
  place,
  sendable,
  going,
  onSend,
}: SendingProps & { warehouse: WarehouseView; place: TradePlace }) {
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

/**
 * Paying the Trade Org debt (`CONTEXT.md`: Trade Org debt): one of the Player's residents on the
 * warehouse pays what they choose of it, from their hands or their carriage there. Nothing when
 * the realm owes nothing.
 */
function PayingDebt({
  debt,
  traders,
  onPayDebt,
}: {
  debt: number
  traders: TradersView
  onPayDebt: (residentId: string, coins: number, carriageId: string | null) => void
}) {
  const [residentId, setResidentId] = useState<string | undefined>()
  const [carriageId, setCarriageId] = useState<string>('')
  const [wanted, setWanted] = useState<number | undefined>()
  if (debt <= 0) return null
  const resident = traders.residents.find((r) => r.id === residentId) ?? traders.residents[0]
  const carriage = traders.carriages.find((k) => k.id === carriageId)
  if (!resident) {
    return <p className="small muted">To pay your debt, bring a resident here with coins.</p>
  }
  const most = Math.min(debt, Math.floor((carriage ? carriage.load : resident.carried).coins ?? 0))
  const coins = Math.min(wanted ?? most, most)
  return (
    <div className="warehouse-trading" aria-label="Paying the debt">
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
      <label>
        Coins{' '}
        <input
          type="number"
          min={1}
          max={most}
          value={coins}
          disabled={most < 1}
          onChange={(e) => setWanted(Math.floor(Number(e.target.value)))}
        />
      </label>
      <p>
        <button
          type="button"
          disabled={coins < 1}
          onClick={() => onPayDebt(resident.id, coins, carriage?.id ?? null)}
        >
          {most < 1
            ? 'No coins to pay your debt with'
            : `Pay ${coins} of the ${debt} Coins you owe`}
        </button>
      </p>
    </div>
  )
}

/** No delivery: an NPC city delivers nothing (`CONTEXT.md`: Delivery is a Trade Org service). */
const noDelivery: DeliveryQuote = { units: 0, coins: 0, fee: 0 }
