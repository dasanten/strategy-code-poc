import { useState } from 'react'
import {
  isClosed,
  type Building,
  type Carriage,
  type PricedGood,
  type RealmLabel,
  type Resident,
  type SeenCity,
  type TradeQuote,
  type TradeSide,
} from '@csp/shared'
import {
  buildingCount,
  describeBuying,
  describeCity,
  previewTrade,
  tradersAt,
  warehousesInSight,
  type BuyView,
  type TradersView,
  type WarehouseView,
} from './city-view.js'
import { GOOD_LABELS } from './Residents.js'

/**
 * The city inspector: every city in sight (`CONTEXT.md`: City, NPC city), whose it is, and,
 * for the one picked, how many of its residents and which of its buildings the Player sees. A
 * city of the Player's own lists its gates, to open or close (`CONTEXT.md`: Walls in combat); an
 * NPC city names its price and can be bought (`CONTEXT.md`: Buying a city); a Trade Org city lists
 * the prices of its warehouses in sight (`CONTEXT.md`: Warehouse prices), where the Player's
 * residents on a warehouse buy and sell (`CONTEXT.md`: Trading with the Trade Organization).
 */
export function CityInspector({
  cities,
  residents,
  buildings,
  realmId,
  realms,
  carriages,
  tick,
  onSetGate,
  onBuyCity,
  onTrade,
}: {
  cities: SeenCity[]
  residents: Resident[]
  buildings: Building[]
  realmId: string
  realms: RealmLabel[]
  carriages: Carriage[]
  tick: number
  onSetGate: (gateId: string, open: boolean) => void
  /** Gives the buy order for an NPC city to one of the Player's residents on its town hall. */
  onBuyCity: (residentId: string, cityId: string) => void
  /** Gives a buy or sell order to one of the Player's residents on a warehouse. */
  onTrade: (trade: TradeRequest) => void
}) {
  const [openId, setOpenId] = useState<string | undefined>()
  const views = cities.map((c) => describeCity(c, { residents, buildings }, realmId, realms))
  return (
    <section className="city-inspector" aria-label="Cities in sight">
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
              onClick={() => setOpenId((id) => (id === v.id ? undefined : v.id))}
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
              warehousesInSight(
                cities.find((c) => c.id === v.id)!,
                { cities, buildings },
              ).map((w) => (
                <div key={w.id}>
                  <Prices warehouse={w} />
                  <Trading
                    warehouse={w}
                    traders={tradersAt(w, { residents, carriages }, realmId)}
                    preview={(resident, carriage, good, units) =>
                      previewTrade(
                        { cities, buildings },
                        w.id,
                        resident,
                        carriage,
                        good,
                        units,
                        tick,
                      )
                    }
                    onTrade={onTrade}
                  />
                </div>
              ))}
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
    </section>
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

/** A warehouse's prices: per good, what it holds, what it pays and what it asks, in coins. */
function Prices({ warehouse }: { warehouse: WarehouseView }) {
  return (
    <table
      className="warehouse-prices"
      aria-label={`Warehouse at (${warehouse.x}, ${warehouse.y})`}
    >
      <caption>
        Warehouse at ({warehouse.x}, {warehouse.y}): prices in coins
      </caption>
      <thead>
        <tr>
          <th scope="col">Good</th>
          <th scope="col">Stock</th>
          <th scope="col">Buys at</th>
          <th scope="col">Sells at</th>
        </tr>
      </thead>
      <tbody>
        {warehouse.prices.map((p) => (
          <tr key={p.good}>
            <th scope="row">{GOOD_LABELS[p.good]}</th>
            <td>{p.stock}</td>
            <td>{p.buy}</td>
            <td>{p.sell}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A buy or sell order as the inspector gives it (`CONTEXT.md`: Trading with the Trade Organization). */
export interface TradeRequest {
  side: TradeSide
  residentId: string
  good: PricedGood
  units: number
  carriageId: string | null
}

/**
 * Buying and selling at a warehouse (`CONTEXT.md`: Trading with the Trade Organization): one of
 * the Player's residents on its tile trades a good from their hands or their carriage there, with
 * a preview of what it would move at its prices. Nobody of theirs there, and it says how to trade.
 */
function Trading({
  warehouse,
  traders,
  preview,
  onTrade,
}: {
  warehouse: WarehouseView
  traders: TradersView
  preview: (
    resident: Resident,
    carriage: Carriage | undefined,
    good: PricedGood,
    units: number,
  ) => { buy: TradeQuote; sell: TradeQuote }
  onTrade: (trade: TradeRequest) => void
}) {
  const [residentId, setResidentId] = useState<string | undefined>()
  const [carriageId, setCarriageId] = useState<string>('')
  const [good, setGood] = useState<PricedGood | undefined>()
  const [units, setUnits] = useState(1)
  const resident = traders.residents.find((r) => r.id === residentId) ?? traders.residents[0]
  const carriage = traders.carriages.find((k) => k.id === carriageId)
  const picked = good ?? warehouse.prices[0]?.good
  if (!resident || !picked) {
    return (
      <p className="small muted">
        To trade here, bring a resident to the warehouse at ({warehouse.x}, {warehouse.y}).
      </p>
    )
  }
  const quote = preview(resident, carriage, picked, units)
  const label = GOOD_LABELS[picked].toLowerCase()
  const trade = (side: TradeSide) =>
    onTrade({
      side,
      residentId: resident.id,
      good: picked,
      units,
      carriageId: carriage?.id ?? null,
    })
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
      <label>
        Good{' '}
        <select value={picked} onChange={(e) => setGood(e.target.value as PricedGood)}>
          {warehouse.prices.map((p) => (
            <option key={p.good} value={p.good}>
              {GOOD_LABELS[p.good]}
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
        <button type="button" disabled={quote.buy.units === 0} onClick={() => trade('buy')}>
          {quote.buy.units === 0
            ? `Can’t buy ${label}`
            : `Buy ${quote.buy.units} ${label} for ${quote.buy.coins} coins`}
        </button>{' '}
        <button type="button" disabled={quote.sell.units === 0} onClick={() => trade('sell')}>
          {quote.sell.units === 0
            ? `Can’t sell ${label}`
            : `Sell ${quote.sell.units} ${label} for ${quote.sell.coins} coins`}
        </button>
      </p>
    </div>
  )
}
