import { useState } from 'react'
import type { Building, City, RealmLabel, Resident } from '@csp/shared'
import { buildingCount, describeCity } from './city-view.js'

/**
 * The city inspector: every city in sight (`CONTEXT.md`: City, NPC city), whose it is, and,
 * for the one picked, how many of its residents and which of its buildings the Player sees.
 */
export function CityInspector({
  cities,
  residents,
  buildings,
  realmId,
  realms,
}: {
  cities: City[]
  residents: Resident[]
  buildings: Building[]
  realmId: string
  realms: RealmLabel[]
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
          </li>
        ))}
      </ul>
    </section>
  )
}
