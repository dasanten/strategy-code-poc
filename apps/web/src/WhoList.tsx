import { useState } from 'react'
import type { Resident } from '@csp/shared-types'
import { aboutTime } from './shared/estimates.js'
import { SelectionCard } from './SelectionCard.js'
import {
  AGE_OPTIONS,
  DOING_OPTIONS,
  SKILL_OPTIONS,
  WEAPON_OPTIONS,
  clearFilters,
  filterResidents,
  filtersOn,
  fittingChoice,
  loadChoice,
  storeChoice,
  type ResidentsChoice,
} from './residents-list-choice.js'
import { listedResidents } from './residents-list-view.js'
import type { ResidentGroup } from './residents-view.js'
import { browserStorage } from './saved-groups.js'
import {
  NO_QUEUE,
  WHO_PAGE,
  keptTicks,
  searched,
  suggested,
  tickable,
  tickedAfter,
  tickedHidden,
  whenOf,
  whoNote,
  type WhoRow,
  type WhoWhen,
} from './who-list-view.js'

/** From how many rows on the who-list has a search box and filters. */
const SEARCH_FROM = 6

/** Where this browser keeps the who-list's filters, apart from the Residents list's. */
const WHO_CHOICE_KEY = 'csp.who-list'

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
 * ticks or just confirms. A ticked busy resident's row has a Now / After switch. Those who can't
 * take it are listed last, greyed out, saying why. It can be searched and filtered as the
 * Residents list can (this browser remembers the filters); ticks hidden by them stay and are
 * counted. Only the nearest `WHO_PAGE` rows are drawn until Show more. Confirm with Shift held
 * keeps the order's kind armed for the next place.
 */
export function WhoList({
  title,
  where,
  rows,
  suggest,
  doing,
  groups,
  tick,
  most,
  mostNote,
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
  /** The realm's residents under their cities, as the Residents drawer has them, to filter. */
  groups: readonly ResidentGroup<Resident>[]
  tick: number
  /**
   * How many it may send, if it may send only so many: one driver or rower, the seats left to
   * board (`vehicleMost`). Confirm is off past it.
   */
  most?: number | undefined
  /** What the list says of the ticks against `most`: "2 of 3 seats" (`mostNote`). */
  mostNote?: ((ticked: number) => string | undefined) | undefined
  /**
   * Those ticked, in the list's order, and of them those who take it after what they do;
   * `again` when Shift was held.
   */
  onConfirm: (ids: string[], after: string[], again: boolean) => void
  onClose: () => void
}) {
  const [ticks, setTicks] = useState<string[]>(() => suggested(rows, suggest))
  const [when, setWhen] = useState<Record<string, WhoWhen>>({})
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState(() => loadChoice(browserStorage(), WHO_CHOICE_KEY))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [limit, setLimit] = useState(WHO_PAGE)
  const ticked = keptTicks(ticks, rows)
  const tickedSet = new Set(ticked)
  const after = tickedAfter(rows, ticked, when)
  // A short list has no search and no filters, so a filter kept from before can't hide anyone.
  const choosing = rows.length >= SEARCH_FROM
  const choice = fittingChoice(saved, groups)
  const filtering = choosing && filtersOn(choice) > 0
  const fits = filtering
    ? new Set(
        filterResidents(listedResidents(groups), { ...choice, search: '' }, tick).map(
          (l) => l.resident.id,
        ),
      )
    : undefined
  const shown = searched(rows, choosing ? search : '').filter((r) => !fits || fits.has(r.id))
  const hidden = tickedHidden(ticked, shown)
  const toggle = (id: string) =>
    setTicks(tickedSet.has(id) ? ticked.filter((t) => t !== id) : [...ticked, id])
  /** Takes new filters, remembers them and draws the first page of what they leave. */
  const choose = (next: ResidentsChoice) => {
    setSaved(next)
    storeChoice(browserStorage(), { ...next, search: '' }, WHO_CHOICE_KEY)
    setLimit(WHO_PAGE)
  }
  const capNote = mostNote?.(ticked.length)
  const tooMany = most !== undefined && ticked.length > most
  const send = (again: boolean) =>
    onConfirm(
      rows.filter((r) => tickedSet.has(r.id)).map((r) => r.id),
      after,
      again,
    )
  return (
    <SelectionCard
      rel="own"
      title={title}
      lines={[
        `${where} · who does it?`,
        <strong key="note">{whoNote(rows, ticked.length, after.length)}</strong>,
        ...(capNote ? [<span key="most">{capNote}</span>] : []),
      ]}
      onClose={onClose}
    >
      {choosing && (
        <div className="who-choice">
          <input
            type="search"
            className="who-search"
            placeholder="Search by name"
            aria-label="Search residents by name"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setLimit(WHO_PAGE)
            }}
          />
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters{filtersOn(choice) > 0 && ` (${filtersOn(choice)})`}
          </button>
        </div>
      )}
      {choosing && filtersOpen && (
        <div className="who-filters">
          <Choice
            label="Doing"
            value={saved.doing}
            options={DOING_OPTIONS}
            onChange={(doing) => choose({ ...saved, doing })}
          />
          <Choice
            label="Weapons"
            value={saved.weapons}
            options={WEAPON_OPTIONS}
            onChange={(weapons) => choose({ ...saved, weapons })}
          />
          <Choice
            label="Age"
            value={saved.age}
            options={AGE_OPTIONS}
            onChange={(age) => choose({ ...saved, age })}
          />
          <Choice
            label="City"
            value={choice.city}
            options={[
              { value: '', label: 'All' },
              ...groups.map((g) => ({ value: g.key, label: g.label })),
            ]}
            onChange={(city) => choose({ ...saved, city })}
          />
          <Choice
            label="Skill"
            value={saved.skill}
            options={SKILL_OPTIONS}
            onChange={(skill) => choose({ ...saved, skill })}
          />
          {filtersOn(choice) > 0 && (
            <button type="button" onClick={() => choose(clearFilters(saved))}>
              Clear filters
            </button>
          )}
        </div>
      )}
      {(filtering || (choosing && search.trim() !== '')) && (
        <p className="who-shown small muted" role="status">
          {shown.length} of {rows.length} shown
          {hidden > 0 && ` · ${hidden} ticked but not shown`}
        </p>
      )}
      <ul className="who-list" aria-label="Who does it">
        {shown.slice(0, limit).map((row) => {
          const on = tickedSet.has(row.id)
          const rowWhen = on && tickable(row) ? whenOf(row, when) : undefined
          return (
            <li key={row.id} className={row.why ? 'who-row who-cant' : 'who-row'}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!tickable(row)}
                  onChange={() => toggle(row.id)}
                />
                <span className="who-name">{row.name}</span>
                <span className="who-way small muted">{wayLine(row)}</span>
                <span className="who-doing small">
                  {row.why ? `Can’t: ${row.why}` : doing(row.id)}
                </span>
              </label>
              {rowWhen && (
                <div className="who-when" role="group" aria-label={`When ${row.name} does it`}>
                  <button
                    type="button"
                    aria-pressed={rowWhen === 'now'}
                    title="Drop what they are doing and go"
                    onClick={() => setWhen({ ...when, [row.id]: 'now' })}
                  >
                    Now
                  </button>
                  {row.noAfter ? (
                    <span className="small muted">After: {NO_QUEUE}</span>
                  ) : (
                    <button
                      type="button"
                      aria-pressed={rowWhen === 'after'}
                      title="Add it to the end of their queue"
                      onClick={() => setWhen({ ...when, [row.id]: 'after' })}
                    >
                      After
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="small muted">
            {filtering ? 'Nobody fits this.' : 'Nobody of that name.'}
          </li>
        )}
        {shown.length > limit && (
          <li>
            <button type="button" className="who-more" onClick={() => setLimit(limit + WHO_PAGE)}>
              Show more ({shown.length - limit} more)
            </button>
          </li>
        )}
      </ul>
      <div className="order-buttons who-actions">
        <button
          type="button"
          className="primary"
          disabled={ticked.length === 0 || tooMany}
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

/** A filter as a labelled select. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
