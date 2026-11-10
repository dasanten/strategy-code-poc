import { MAX_HEALTH, MAX_HUNGER } from '@csp/balance'
import { horseAgeInYears } from './shared/stats.js'
import type { SeenHorse } from '@csp/shared-types'
import { useEffect, useRef } from 'react'
import { horseLines, type HorseGroup, type HorseLines } from './horses-view.js'
import { horseAgeText } from './selection-view.js'
import { PanelHead } from './drawer-head.js'

/** Meter colour by how full it is, as in the Residents drawer: low a warning, half a caution. */
export const meterClass = (share: number) => (share < 0.25 ? 'low' : share < 0.5 ? 'mid' : 'ok')

export const pct = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`

/** A small meter, "?" where the Player doesn't know the value. */
export function Meter({ label, share }: { label: string; share: number | undefined }) {
  if (share === undefined) return <span className="muted">?</span>
  return (
    <span className="meter" aria-label={`${label} ${pct(share)}`}>
      <span className={meterClass(share)} style={{ width: pct(share) }} />
    </span>
  )
}

/**
 * The realm's horses (`CONTEXT.md`: Horses drawer), one row each under the stable they stand in,
 * or Hitched, Ridden or Loose (see `groupHorses`), laid out like the Residents drawer: name and
 * where it is, Speed · Strength · Endurance, age, health and hunger; on a phone two lines each
 * (`horseLines`). Clicking a row centres the map on the horse and picks it.
 */
export function HorsesList({
  groups,
  tick,
  selectedId,
  onSelect,
  phone = false,
}: {
  groups: HorseGroup<SeenHorse>[]
  tick: number
  selectedId: string | undefined
  onSelect: (horse: SeenHorse) => void
  /** Rows of two lines each, for a phone's narrow screen. */
  phone?: boolean
}) {
  const tableRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    const row = tableRef.current?.querySelector(`[data-horse="${CSS.escape(selectedId)}"]`)
    row?.closest('.residents-group')?.firstElementChild?.scrollIntoView({ block: 'nearest' })
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  const count = groups.reduce((n, g) => n + g.rows.length, 0)
  return (
    <section className="residents horses" aria-label="Horses">
      <PanelHead title="Horses">{count === 1 ? '1 horse' : `${count} horses`}</PanelHead>
      {count === 0 && <p className="muted">Your realm has no horses.</p>}
      <div className="residents-scroll">
        <div className={`residents-table${phone ? ' lines' : ''}`} ref={tableRef}>
          {count > 0 && !phone && (
            <div className="residents-row horses-row heading" aria-hidden="true">
              <span>Name</span>
              <span title="Speed / Strength / Endurance">Stats</span>
              <span>Age</span>
              <span>Health</span>
              <span>Hunger</span>
            </div>
          )}
          {groups.map((g) => (
            <div className="residents-group" key={g.key} role="group" aria-label={g.label}>
              <h3>
                {g.label} <span>· {g.rows.length}</span>
              </h3>
              {g.rows.map((row) => {
                const { horse: h, place } = row
                if (phone) {
                  return (
                    <HorseLinesRow
                      key={h.id}
                      lines={horseLines(row, tick)}
                      id={h.id}
                      selected={h.id === selectedId}
                      onSelect={() => onSelect(h)}
                    />
                  )
                }
                return (
                  <button
                    type="button"
                    key={h.id}
                    data-horse={h.id}
                    className={`residents-row horses-row${h.id === selectedId ? ' selected' : ''}`}
                    aria-pressed={h.id === selectedId}
                    onClick={() => onSelect(h)}
                  >
                    <span className="doing">
                      <span className="name">{h.name}</span>
                      <small className="muted" title={place}>
                        {place}
                      </small>
                    </span>
                    <span
                      className="mono"
                      title={`Speed ${h.stats.speed}, Strength ${h.stats.strength}, Endurance ${h.stats.endurance}`}
                    >
                      {h.stats.speed}/{h.stats.strength}/{h.stats.endurance}
                    </span>
                    <span className="mono" title={horseAgeText(h, tick)}>
                      {Math.floor(horseAgeInYears(h, tick))}
                    </span>
                    <Meter
                      label="Health"
                      share={h.health === undefined ? undefined : h.health / MAX_HEALTH}
                    />
                    <Meter
                      label="Hunger"
                      share={h.hunger === undefined ? undefined : h.hunger / MAX_HUNGER}
                    />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** A horse's row on a phone: name, age and stats, then where it is with health and hunger. */
function HorseLinesRow({
  id,
  lines,
  selected,
  onSelect,
}: {
  id: string
  lines: HorseLines
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-horse={id}
      className={`residents-row lines${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="line">
        <span className="name">{lines.name}</span>
        <span className="mono">
          {lines.age} ·{' '}
          <span title="Speed / Strength / Endurance" aria-label={`Stats ${lines.stats}`}>
            {lines.stats}
          </span>
        </span>
      </span>
      <span className="line">
        <span className="doing">{lines.place}</span>
        <Meter label="Health" share={lines.health} />
        <Meter label="Hunger" share={lines.fed} />
      </span>
    </button>
  )
}
