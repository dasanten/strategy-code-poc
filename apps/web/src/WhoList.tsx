import { useState } from 'react'
import { aboutTime } from './shared/estimates.js'
import { SelectionCard } from './SelectionCard.js'
import { keptTicks, searched, suggested, tickable, whoNote, type WhoRow } from './who-list-view.js'

/** From how many rows on the who-list has a search box. */
const SEARCH_FROM = 6

/** How far a row's way is: "here", "12 tiles · about 3 game hours". */
function wayLine(row: WhoRow): string {
  if (row.tiles === 0) return 'here'
  const tiles = `${row.tiles} ${row.tiles === 1 ? 'tile' : 'tiles'}`
  return row.ticks === undefined ? tiles : `${tiles} · ${aboutTime(row.ticks)}`
}

/**
 * The who-list (`CONTEXT.md`: Who-list), the last step of a realm order: the realm's residents
 * who could take it, nearest first, each with what they are doing and how long their way is.
 * The nearest idle ones (`suggest` of them) are ticked when it opens; the Player changes the
 * ticks or just confirms. Those who can't take it are listed last, greyed out, saying why.
 * Confirm with Shift held keeps the order's kind armed for the next place.
 */
export function WhoList({
  title,
  where,
  rows,
  suggest,
  doing,
  onConfirm,
  onClose,
}: {
  /** What is to be done: "Build a house". */
  title: string
  /** Where it is to be done (`whoWhere`): "at 4, 5", "from 4, 5 to 9, 5". */
  where: string
  rows: readonly WhoRow[]
  /** How many of the nearest idle residents are ticked when it opens (`WHO_SUGGESTS`). */
  suggest: number
  /** A resident's Doing line. */
  doing: (id: string) => string
  /** Those ticked, in the list's order; `again` when Shift was held. */
  onConfirm: (ids: string[], again: boolean) => void
  onClose: () => void
}) {
  const [ticks, setTicks] = useState<string[]>(() => suggested(rows, suggest))
  const [search, setSearch] = useState('')
  const ticked = keptTicks(ticks, rows)
  const tickedSet = new Set(ticked)
  const shown = searched(rows, search)
  const toggle = (id: string) =>
    setTicks(tickedSet.has(id) ? ticked.filter((t) => t !== id) : [...ticked, id])
  const send = (again: boolean) =>
    onConfirm(
      rows.filter((r) => tickedSet.has(r.id)).map((r) => r.id),
      again,
    )
  return (
    <SelectionCard
      rel="own"
      title={title}
      lines={[
        `${where} · who does it?`,
        <strong key="note">{whoNote(rows, ticked.length)}</strong>,
      ]}
      onClose={onClose}
    >
      {rows.length >= SEARCH_FROM && (
        <input
          type="search"
          className="who-search"
          placeholder="Search by name"
          aria-label="Search residents by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <ul className="who-list" aria-label="Who does it">
        {shown.map((row) => (
          <li key={row.id} className={row.why ? 'who-row who-cant' : 'who-row'}>
            <label>
              <input
                type="checkbox"
                checked={tickedSet.has(row.id)}
                disabled={!tickable(row)}
                onChange={() => toggle(row.id)}
              />
              <span className="who-name">{row.name}</span>
              <span className="who-way small muted">{wayLine(row)}</span>
              <span className="who-doing small">
                {row.why ? `Can’t: ${row.why}` : doing(row.id)}
              </span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="small muted">Nobody of that name.</li>}
      </ul>
      <div className="order-buttons who-actions">
        <button
          type="button"
          className="primary"
          disabled={ticked.length === 0}
          title="With Shift held, pick the next place for another"
          onClick={(e) => send(e.shiftKey)}
        >
          Confirm{ticked.length > 0 ? ` (${ticked.length})` : ''}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </SelectionCard>
  )
}
