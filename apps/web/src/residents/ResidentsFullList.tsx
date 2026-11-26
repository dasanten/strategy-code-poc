import { useLayoutEffect, useRef, useState } from 'react'
import type {
  Building,
  City,
  Resident,
  ScriptSummary,
  SeenHorse,
  SeenResident,
} from '@csp/shared-types'
import { doingLine, interruptedLine, scriptLine } from './doing-view.js'
import { PanelHead } from '../ui/panel-head.js'
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
 * The Residents tab opened fully (`CONTEXT.md`: Residents list): the realm's residents with
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
  heirId,
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
  /** The realm's heir, marked in their row (`CONTEXT.md`: Heir). */
  heirId?: string | null
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
  /** Back to the tab's short list. */
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
  const narrowed = filtersOn(choice) > 0 || choice.search.trim() !== ''
  return (
    <section className="residents-full" aria-label="All residents">
      <PanelHead title="Residents">
        <span className="residents-full-head">
          {narrowed ? (
            <span role="status">
              {listed.length} of {all.length} shown
            </span>
          ) : (
            <span>{residentsCount(all.map((l) => l.resident))}</span>
          )}
          <button type="button" className="btn sm dk" onClick={onClose}>
            Close full list
          </button>
        </span>
      </PanelHead>
      <div className="residents-full-choice fx wrap">
        <label className="fld search">
          <span className="lb">Search</span>
          <input
            type="search"
            className="in"
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
            <button type="button" className="btn" onClick={() => choose(sortBy(saved, saved.sort))}>
              {directionLabel(saved.sort, saved.descending)}
            </button>
            <button
              type="button"
              className="btn"
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
        {narrowed && (
          <button type="button" className="btn" onClick={() => choose(clearFilters(saved))}>
            Clear filters
          </button>
        )}
        <span className="grow" />
        <button
          type="button"
          className="btn primary"
          title="Pick those ticked as a group, or everyone listed when none of them is"
          disabled={toPick.length === 0}
          onClick={() => onPick(toPick)}
        >
          Pick these ({toPick.length})
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
              <div className="full-cells heading">
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
                  heirId,
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
    <label className="fld">
      <span className="lb">{label}</span>
      <select className="in" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The columns that hold a number, right-aligned as the kit's table does them (`.n`). */
const NUMBER_COLUMNS: ReadonlySet<ListColumn> = new Set([
  'age',
  'strength',
  'endurance',
  'agility',
  'intellect',
])

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
      className={NUMBER_COLUMNS.has(column) ? 'column n' : 'column'}
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
 * group keys would do nothing. It shows the kit's checkbox (`.cb`).
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
      <span className={ticked ? 'cb on' : 'cb'} aria-hidden="true" />
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

/** The Leader or Heir mark beside a name, as the kit's chip. */
function Marks({ row }: { row: ResidentRow }) {
  return (
    <>
      {row.leader && <span className="chip y">Leader</span>}
      {row.heir && <span className="chip bl">Heir</span>}
    </>
  )
}

/** A resident's row in the wide table; long cells are cut, with all of it in their tooltip. */
function ResidentTableRow({ row, selected, onSelect }: RowProps) {
  const { stats } = row
  return (
    <button
      type="button"
      data-resident={row.id}
      className={`rw people-row full-cells${selected ? ' sel' : ''}`}
      style={{ height: FULL_ROW_HEIGHT }}
      aria-pressed={selected}
      onClick={() => onSelect(row.id)}
    >
      <span className="b cut" title={row.name}>
        {row.name}
        <Marks row={row} />
      </span>
      <span className="mono n">{row.age}</span>
      <span className="cut" title={row.city}>
        {row.city}
      </span>
      <span className="mono n">{stats.strength}</span>
      <span className="mono n">{stats.endurance}</span>
      <span className="mono n">{stats.agility}</span>
      <span className="mono n">{stats.intellect}</span>
      <span className="cut" title={row.skills}>
        {row.skills || '–'}
      </span>
      <span className="cut" title={row.gear}>
        {row.gear || '–'}
      </span>
      <span className="cut" title={row.carrying}>
        {row.carrying || '–'}
        <span className="mono mu under">{row.weight}</span>
      </span>
      <RowMeter label="Hunger" share={row.fed} />
      <RowMeter label="Health" share={row.health} />
      <span className="cut" title={row.under ? `${row.doing}\n${row.under}` : row.doing}>
        {row.doing}
        {row.under && <span className="mu under">{row.under}</span>}
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
      className={`rw people-row full-card${selected ? ' sel' : ''}`}
      style={{ height: FULL_CARD_HEIGHT }}
      aria-pressed={selected}
      onClick={() => onSelect(row.id)}
    >
      <span className="fx">
        <span className="b grow cut">
          {row.name}
          <Marks row={row} />
        </span>
        <span className="mono mu">{yearsLine(row.age)}</span>
      </span>
      <span className="fx">
        <span className="grow cut">{row.doing}</span>
        <RowMeter label="Hunger" share={row.fed} />
        <RowMeter label="Health" share={row.health} />
      </span>
      <span className="fx">
        <span className="mono grow cut">
          Str {stats.strength} · End {stats.endurance} · Agi {stats.agility} · Int {stats.intellect}
        </span>
      </span>
      <span className="fx">
        <span className="mu grow cut">{row.skills || 'No skills yet'}</span>
      </span>
      <span className="fx">
        <span className="grow cut">
          {row.city}
          {row.gear && ` · ${row.gear}`}
        </span>
      </span>
      <span className="fx">
        <span className="mu grow cut">
          {row.carrying ? `Carrying ${row.carrying}` : 'Carrying nothing'}
        </span>
        <span className="mono mu">{row.weight}</span>
      </span>
    </button>
  )
}
