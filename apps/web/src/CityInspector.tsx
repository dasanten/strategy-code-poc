import { useState } from 'react'
import { isClosed, type Building, type City, type RealmLabel, type Resident } from '@csp/shared'
import { buildingCount, describeCity } from './city-view.js'

/**
 * The city inspector: every city in sight (`CONTEXT.md`: City, NPC city), whose it is, and,
 * for the one picked, how many of its residents and which of its buildings the Player sees. A
 * city of the Player's own lists its gates, to open or close (`CONTEXT.md`: Walls in combat).
 */
export function CityInspector({
  cities,
  residents,
  buildings,
  realmId,
  realms,
  onSetGate,
}: {
  cities: City[]
  residents: Resident[]
  buildings: Building[]
  realmId: string
  realms: RealmLabel[]
  onSetGate: (gateId: string, open: boolean) => void
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
