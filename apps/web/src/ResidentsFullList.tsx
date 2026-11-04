import { useLayoutEffect, useRef, useState } from 'react'
import type { City, Resident, ScriptSummary, SeenResident, Building } from '@csp/shared'
import { doingLine, interruptedLine, scriptLine } from './doing-view.js'
import { PanelHead } from './drawer-head.js'
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

/**
 * The Residents drawer opened fully (`CONTEXT.md`: Residents list): the realm's residents with
 * their stats, skills, gear, what they carry and what they are doing, a row each, or a compact card
 * each on a phone. Only the rows in view are drawn (`rowWindow`), so hundreds stay smooth. It opens
 * with the picked resident in view; tapping a row opens that resident.
 */
export function ResidentsFullList({
  groups,
  leaderId,
  tick,
  scripts = [],
  buildings = [],
  inSight = [],
  cities = [],
  arrivesIn,
  selectedId,
  onSelect,
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
  /** About how many ticks until a resident arrives where they walk, ride or drive (`arrivalTicks`). */
  arrivesIn?: (r: Resident) => number | undefined
  selectedId: string | undefined
  onSelect: (id: string) => void
  /** Back to the drawer's short list. */
  onClose: () => void
  phone?: boolean
}) {
  const listed = listedResidents(groups)
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
  const shown = rowWindow({
    count: listed.length,
    rowHeight,
    scrollTop: topRow * rowHeight,
    viewport,
  })
  const Row = phone ? ResidentCardRow : ResidentTableRow
  return (
    <section className="residents-full" aria-label="All residents">
      <PanelHead title="Residents">{residentsCount(listed.map((l) => l.resident))}</PanelHead>
      <div className="residents-full-tools">
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
            <div className="residents-row full heading" aria-hidden="true">
              <span>Name</span>
              <span>Age</span>
              <span>City</span>
              <span title="Strength">Str</span>
              <span title="Endurance">End</span>
              <span title="Agility">Agi</span>
              <span title="Intellect">Int</span>
              <span>Skills</span>
              <span>Gear</span>
              <span>Carrying</span>
              <span>Hunger</span>
              <span>Health</span>
              <span>Doing</span>
            </div>
          )}
          <div style={{ height: shown.before }} />
          {listed.slice(shown.first, shown.end).map(({ resident: r, city }) => (
            <Row
              key={r.id}
              row={residentRow(r, {
                city,
                leaderId,
                tick,
                doing: doingLine(r, {
                  scripts,
                  buildings,
                  residents: inSight,
                  cities,
                  arrives: arrivesIn?.(r),
                }),
                under:
                  interruptedLine(r, { scripts, buildings, residents: inSight }) ??
                  scriptLine(r, scripts),
              })}
              selected={r.id === selectedId}
              onSelect={onSelect}
            />
          ))}
          <div style={{ height: shown.after }} />
        </div>
      </div>
    </section>
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
