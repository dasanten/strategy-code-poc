import { useMemo, useState } from 'react'
import type { AdminPlaces } from '@csp/shared'
import { jumpList, type JumpEntry } from './admin-jump.js'

/**
 * The admin map's jump list (`CONTEXT.md`: admin map): the whole world's places by name, grouped,
 * with a search; picking one centres the map on it. It refreshes with the map (`places`).
 */
export function AdminJumpList({
  places,
  selectedKey,
  onJump,
}: {
  places: AdminPlaces | null
  selectedKey?: string
  onJump: (entry: JumpEntry) => void
}) {
  const [search, setSearch] = useState('')
  const groups = useMemo(() => (places ? jumpList(places, search) : []), [places, search])

  return (
    <aside className="admin-jump" aria-label="Jump list">
      <input
        type="search"
        placeholder="Find an account, realm, city or army"
        aria-label="Find by name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="admin-jump-groups">
        {!places && <p className="admin-jump-note">Loading places…</p>}
        {places && groups.length === 0 && <p className="admin-jump-note">Nothing by that name.</p>}
        {groups.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <ul>
              {g.entries.map((e) => (
                <li key={e.key} className={e.nested ? 'nested' : undefined}>
                  <button
                    type="button"
                    aria-current={e.key === selectedKey || undefined}
                    disabled={!e.at}
                    title={e.at ? `Tile ${e.at.x}, ${e.at.y}` : 'Nowhere on the map'}
                    onClick={() => onJump(e)}
                  >
                    <span className="name">{e.name}</span>
                    {e.detail && <span className="detail">{e.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}
