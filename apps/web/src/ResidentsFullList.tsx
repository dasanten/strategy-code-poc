import { useLayoutEffect, useRef, useState } from 'react'
import type { Building, City, Resident, ScriptSummary, SeenHorse, SeenResident } from '@csp/shared'
import { doingLine, interruptedLine, scriptLine } from './doing-view.js'
import { PanelHead } from './drawer-head.js'
import {
  AGE_OPTIONS,
  COLUMN_LABELS,
  DOING_OPTIONS,
  LIST_COLUMNS,
  SKILL_OPTIONS,
  WEAPON_OPTIONS,
  clearFilters,
  directionLabel,
  filterResidents,
  filtersOn,
  fittingChoice,
  loadChoice,
  pickedFromList,
  sortBy,
  sortResidents,
  storeChoice,
  type ListColumn,
  type ResidentsChoice,
} from './residents-list-choice.js'
import {
  FULL_CARD_HEIGHT,
  FULL_ROW_HEIGHT,
  listedResidents,
  residentRow,
  rowWindow,
  scrollToRow,
  type ResidentRow,
} from './residents-list-view.js'
import { residentsCount, yearsLine, type ResidentGroup } from './residents-view.js'
import { meterClass, pct } from './Residents.js'
import { browserStorage } from './saved-groups.js'

/** What the table's headings show, where a column's whole name doesn't fit. */
const COLUMN_HEADINGS: Partial<Record<ListColumn, string>> = {
  strength: 'Str',
  endurance: 'End',
  agility: 'Agi',
  intellect: 'Int',
}

/**
 * The Residents drawer opened fully (`CONTEXT.md`: Residents list): the realm's residents with
 * their stats, skills, gear, what they carry and what they are doing, a row each, or a compact card
 * each on a phone. Only the rows in view are drawn (`rowWindow`), so hundreds stay smooth. It opens
 * with the picked resident in view; tapping a row opens that resident. It can be searched, filtered
 * and sorted by any column, and this browser remembers the choice (`residents-list-choice`). Rows
 * can be ticked, and **Pick these** picks those ticked, or everyone listed, as a Group; the ticks
 * last only while the list is open.
 */
export function ResidentsFullList({
  groups,
  leaderId,
  tick,
  scripts = [],
  buildings = [],
  inSight = [],
  cities = [],
  horses = [],
  arrivesIn,
  selectedId,
  onSelect,
  onPick,
  onClose,
  phone = false,
}: {
  groups: ResidentGroup<Resident>[]
  leaderId: string
  tick: number
  /** The Player's script library, to name the script each runs and the task it is for. */
  scripts?: ScriptSummary[]
  /** The buildings in sight, to name where residents store or fetch goods. */
  buildings?: Building[]
  /** Everyone in sight, to say where a passenger's carriage is heading (`doingLine`). */
  inSight?: readonly SeenResident[]
  /** The cities the Player knows, to name where a resident relocates to (`doingLine`). */
  cities?: readonly Pick<City, 'id' | 'name'>[]
  /** The horses the Player knows, to name the two being bred (`doingLine`). */
  horses?: readonly SeenHorse[]
  /** About how many ticks until a resident arrives where they walk, ride or drive (`arrivalTicks`). */
  arrivesIn?: (r: Resident) => number | undefined
  selectedId: string | undefined
  onSelect: (id: string) => void
  /** Picks these residents as a Group on the map, in the list's order. */
  onPick: (ids: string[]) => void
  /** Back to the drawer's short list. */
  onClose: () => void
  phone?: boolean
}) {
  const all = listedResidents(groups)
  const [saved, setSaved] = useState(() => loadChoice(browserStorage()))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const choice = fittingChoice(saved, groups)
  const doingOf = (r: Resident) =>
    doingLine(r, {
      scripts,
      buildings,
      residents: inSight,
      horses,
      cities,
      arrives: arrivesIn?.(r),
    })
  const listed = sortResidents(filterResidents(all, choice, tick), choice, {
    tick,
    doing: doingOf,
  })
  const toPick = pickedFromList(listed, ticked)
  const toggleTick = (id: string) =>
    setTicked((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const rowHeight = phone ? FULL_CARD_HEIGHT : FULL_ROW_HEIGHT
  const scroller = useRef<HTMLDivElement>(null)
  // The row at the top of the view, not the pixel: scrolling within a row draws nothing new.
  const [topRow, setTopRow] = useState(0)
  const [viewport, setViewport] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setViewport(el.clientHeight)
    measure()
    const index = listed.findIndex((l) => l.resident.id === selectedId)
    if (index >= 0) el.scrollTop = scrollToRow(index, rowHeight, el.clientHeight)
    setTopRow(Math.floor(el.scrollTop / rowHeight))
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => watcher.disconnect()
    // Only on opening: later picks and ticks leave the list where the Player scrolled it.
  }, [])
  /** Takes a new choice, remembers it and goes back to the top of the list it makes. */
  const choose = (next: ResidentsChoice) => {
    setSaved(next)
    storeChoice(browserStorage(), next)
    if (scroller.current) scroller.current.scrollTop = 0
    setTopRow(0)
  }
  const shown = rowWindow({
    count: listed.length,
    rowHeight,
    scrollTop: topRow * rowHeight,
    viewport,
  })
  const Row = phone ? ResidentCardRow : ResidentTableRow
  return (
    <section className="residents-full" aria-label="All residents">
      <PanelHead title="Residents">{residentsCount(all.map((l) => l.resident))}</PanelHead>
      <div className="residents-full-choice">
        <label className="search">
          Search
          <input
            type="search"
            placeholder="Name"
            value={saved.search}
            onChange={(e) => choose({ ...saved, search: e.target.value })}
          />
        </label>
        {phone && (
          <>
            <Choice
              label="Sort by"
              value={saved.sort}
              options={LIST_COLUMNS.map((value) => ({ value, label: COLUMN_LABELS[value] }))}
              onChange={(sort) => choose(sortBy(saved, sort))}
            />
            <button type="button" onClick={() => choose(sortBy(saved, saved.sort))}>
              {directionLabel(saved.sort, saved.descending)}
            </button>
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters{filtersOn(choice) > 0 && ` (${filtersOn(choice)})`}
            </button>
          </>
        )}
        {(!phone || filtersOpen) && (
          <>
            <Choice
              label="Weapons"
              value={saved.weapons}
              options={WEAPON_OPTIONS}
              onChange={(weapons) => choose({ ...saved, weapons })}
            />
            <Choice
              label="Doing"
              value={saved.doing}
              options={DOING_OPTIONS}
              onChange={(doing) => choose({ ...saved, doing })}
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
          </>
        )}
        {(filtersOn(choice) > 0 || choice.search.trim() !== '') && (
          <>
            <span className="muted" role="status">
              {listed.length} of {all.length} shown
            </span>
            <button type="button" onClick={() => choose(clearFilters(saved))}>
              Clear filters
            </button>
          </>
        )}
        <button
          type="button"
          className="primary pick"
          title="Pick those ticked as a group, or everyone listed when none of them is"
          disabled={toPick.length === 0}
          onClick={() => onPick(toPick)}
        >
          Pick these ({toPick.length})
        </button>
        <button type="button" onClick={onClose}>
          Close full list
        </button>
      </div>
      <div
        className="residents-full-scroll"
        ref={scroller}
        onScroll={(e) => setTopRow(Math.floor(e.currentTarget.scrollTop / rowHeight))}
      >
        <div className={phone ? 'residents-full-cards' : 'residents-full-table'}>
          {!phone && (
            <div className="residents-full-row heading">
              <span className="tick" />
              <div className="residents-row full heading">
                {LIST_COLUMNS.map((column) => (
                  <ColumnHeading
                    key={column}
                    column={column}
                    choice={saved}
                    onSort={() => choose(sortBy(saved, column))}
                  />
                ))}
              </div>
            </div>
          )}
          {listed.length === 0 && all.length > 0 && (
            <p className="muted residents-full-none">No resident fits this.</p>
          )}
          <div style={{ height: shown.before }} />
          {listed.slice(shown.first, shown.end).map(({ resident: r, city }) => (
            <div className="residents-full-row" key={r.id}>
              <TickBox name={r.name} ticked={ticked.has(r.id)} onToggle={() => toggleTick(r.id)} />
              <Row
                row={residentRow(r, {
                  city,
                  leaderId,
                  tick,
                  doing: doingOf(r),
                  under:
                    interruptedLine(r, { scripts, buildings, residents: inSight, horses }) ??
                    scriptLine(r, scripts),
                })}
                selected={r.id === selectedId}
                onSelect={onSelect}
              />
            </div>
          ))}
          <div style={{ height: shown.after }} />
        </div>
      </div>
    </section>
  )
}

/** A filter or the phone's sort, as a labelled select. */
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

/** A heading of the table: tapping it sorts by that column, and again turns the order round. */
function ColumnHeading({
  column,
  choice,
  onSort,
}: {
  column: ListColumn
  choice: ResidentsChoice
  onSort: () => void
}) {
  const sorted = choice.sort === column
  const name = COLUMN_LABELS[column]
  return (
    <button
      type="button"
      className="column"
      title={name}
      aria-pressed={sorted}
      aria-label={
        sorted ? `${name}, sorted ${directionLabel(column, choice.descending)}` : `Sort by ${name}`
      }
      onClick={onSort}
    >
      {COLUMN_HEADINGS[column] ?? name}
      {sorted && <span aria-hidden="true">{choice.descending ? ' ▼' : ' ▲'}</span>}
    </button>
  )
}

/**
 * A row's tick, beside its button rather than in it, since a button can't hold another. It is a
 * button itself: a key pressed in an input counts as typing, so after a tick in one, Escape and the
 * group keys would do nothing.
 */
function TickBox({
  name,
  ticked,
  onToggle,
}: {
  name: string
  ticked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      className="tick"
      aria-checked={ticked}
      aria-label={`Tick ${name}`}
      onClick={onToggle}
    >
      <span className={ticked ? 'tick-box on' : 'tick-box'} aria-hidden="true">
        {ticked && '✓'}
      </span>
    </button>
  )
}

interface RowProps {
  row: ResidentRow
  selected: boolean
  onSelect: (id: string) => void
}

/** A hunger or health meter, named for those who can't see its colour. */
function RowMeter({ label, share }: { label: string; share: number }) {
  return (
    <span className="meter" aria-label={`${label} ${pct(share)}`} title={`${label} ${pct(share)}`}>
      <span className={meterClass(share)} style={{ width: pct(share) }} />
    </span>
  )
}

/** A resident's row in the wide table; long cells are cut, with all of it in their tooltip. */
function ResidentTableRow({ row, selected, onSelect }: RowProps) {
  const { stats } = row
  return (
    <button
      type="button"
      data-resident={row.id}
      className={`residents-row full${selected ? ' selected' : ''}`}
      style={{ height: FULL_ROW_HEIGHT }}
      aria-pressed={selected}
      onClick={() => onSelect(row.id)}
    >
      <span className="name cut" title={row.name}>
        {row.name}
        {row.leader && <small className="leader-mark">Leader</small>}
      </span>
      <span className="mono">{row.age}</span>
      <span className="cut" title={row.city}>
        {row.city}
      </span>
      <span className="mono">{stats.strength}</span>
      <span className="mono">{stats.endurance}</span>
      <span className="mono">{stats.agility}</span>
      <span className="mono">{stats.intellect}</span>
      <span className="cut muted" title={row.skills}>
        {row.skills || '–'}
      </span>
      <span className="cut" title={row.gear}>
        {row.gear || '–'}
      </span>
      <span className="cut muted" title={row.carrying}>
        {row.carrying || '–'}
        <small className="mono">{row.weight}</small>
      </span>
      <RowMeter label="Hunger" share={row.fed} />
      <RowMeter label="Health" share={row.health} />
      <span className="doing cut" title={row.under ? `${row.doing}\n${row.under}` : row.doing}>
        {row.doing}
        {row.under && <small className="muted">{row.under}</small>}
      </span>
    </button>
  )
}

/** A resident's compact card on a phone: who they are, what they do, then how they stand. */
function ResidentCardRow({ row, selected, onSelect }: RowProps) {
  const { stats } = row
  return (
    <button
      type="button"
      data-resident={row.id}
      className={`residents-row lines full-card${selected ? ' selected' : ''}`}
      style={{ height: FULL_CARD_HEIGHT }}
      aria-pressed={selected}
      onClick={() => onSelect(row.id)}
    >
      <span className="line">
        <span className="name cut">
          {row.name}
          {row.leader && <span className="leader-mark"> · Leader</span>}
        </span>
        <span className="mono">{yearsLine(row.age)}</span>
      </span>
      <span className="line">
        <span className="doing cut">{row.doing}</span>
        <RowMeter label="Hunger" share={row.fed} />
        <RowMeter label="Health" share={row.health} />
      </span>
      <span className="line">
        <span className="mono cut wide">
          Str {stats.strength} · End {stats.endurance} · Agi {stats.agility} · Int {stats.intellect}
        </span>
      </span>
      <span className="line">
        <span className="cut muted wide">{row.skills || 'No skills yet'}</span>
      </span>
      <span className="line">
        <span className="cut wide">
          {row.city}
          {row.gear && ` · ${row.gear}`}
        </span>
      </span>
      <span className="line">
        <span className="cut muted wide">
          {row.carrying ? `Carrying ${row.carrying}` : 'Carrying nothing'}
        </span>
        <span className="mono">{row.weight}</span>
      </span>
    </button>
  )
}
