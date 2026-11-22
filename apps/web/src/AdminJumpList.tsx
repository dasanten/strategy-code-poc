import { useMemo, useState } from 'react'
import type { AdminPlaces } from '@csp/shared-types'
import { jumpCount, jumpList, jumpMark, type JumpEntry } from './admin-jump.js'
import { relationshipClass } from './theme.js'
import { Icon } from './Icon.js'

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
      <div className="sec">
        <input
          type="search"
          className="in"
          placeholder="Find an account, realm, city or army"
          aria-label="Find by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-jump-groups">
        {!places && <p className="admin-jump-note mu">Loading places…</p>}
        {places && groups.length === 0 && (
          <p className="admin-jump-note mu">Nothing by that name.</p>
        )}
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="rw grp">
              <span className="lb grow">{g.title}</span>
              <span className="mono small">{jumpCount(g)}</span>
            </h3>
            <ul>
              {g.entries.map((e) => (
                <li key={e.key}>
                  <JumpRow entry={e} selected={e.key === selectedKey} onJump={onJump} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}

/** One place on the jump list: its mark, its name and what it is; greyed if it is nowhere. */
function JumpRow({
  entry: e,
  selected,
  onJump,
}: {
  entry: JumpEntry
  selected: boolean
  onJump: (entry: JumpEntry) => void
}) {
  const mark = jumpMark(e.kind)
  return (
    <button
      type="button"
      className={`rw admin-jump-row${e.nested ? ' nested' : ''}${selected ? ' sel' : ''}${
        e.kind === 'realm' ? ' realm' : ''
      }`}
      aria-current={selected || undefined}
      disabled={!e.at}
      title={e.at ? `Tile ${e.at.x}, ${e.at.y}` : 'Nowhere on the map'}
      onClick={() => onJump(e)}
    >
      {'rel' in mark ? (
        <span className={`dot ${relationshipClass(mark.rel)}`} aria-hidden="true" />
      ) : (
        <Icon name={mark.icon} size={16} />
      )}
      <span className="grow admin-jump-text">
        <span className="name">{e.name}</span>
        {e.detail && <span className="detail mu">{e.detail}</span>}
      </span>
    </button>
  )
}
