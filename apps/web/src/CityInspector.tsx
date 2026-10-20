import { useState } from 'react'
import { isClosed, type Building, type RealmLabel, type Resident, type SeenCity } from '@csp/shared'
import {
  buildingCount,
  describeBuying,
  describeCity,
  warehousesInSight,
  type BuyView,
  type WarehouseView,
} from './city-view.js'
import { GOOD_LABELS } from './Residents.js'

/**
 * The city inspector: every city in sight (`CONTEXT.md`: City, NPC city), whose it is, and,
 * for the one picked, how many of its residents and which of its buildings the Player sees. A
 * city of the Player's own lists its gates, to open or close (`CONTEXT.md`: Walls in combat); an
 * NPC city names its price and can be bought (`CONTEXT.md`: Buying a city); a Trade Org city lists
 * the prices of its warehouses in sight (`CONTEXT.md`: Warehouse prices).
 */
export function CityInspector({
  cities,
  residents,
  buildings,
  realmId,
  realms,
  onSetGate,
  onBuyCity,
}: {
  cities: SeenCity[]
  residents: Resident[]
  buildings: Building[]
  realmId: string
  realms: RealmLabel[]
  onSetGate: (gateId: string, open: boolean) => void
  /** Gives the buy order for an NPC city to one of the Player's residents on its town hall. */
  onBuyCity: (residentId: string, cityId: string) => void
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
              ).map((w) => <Prices key={w.id} warehouse={w} />)}
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
