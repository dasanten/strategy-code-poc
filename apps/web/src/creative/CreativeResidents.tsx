import { useEffect, useState, type ReactNode } from 'react'
import { CREATIVE_HORSE_AGE_MAX, CREATIVE_STAT_MAX, LIFESPAN_MIN, SKILL_MAX } from '@csp/balance'
import type { HorseStats, SkillName, StatRecord } from '@csp/shared-types'
import { api } from '../world/api.js'
import { CreativeSaid, useCreativeAct } from './CreativeSection.js'
import {
  citiesFromPlaces,
  defaultCreativeCity,
  pickedNumber,
  residentActions,
  type CreativeCity,
  type CreativeResident,
} from './creative-section.js'
import { SKILL_LABELS, STAT_LABELS } from '../residents/Residents.js'
import { HORSE_STAT_NAMES, STAT_NAMES } from '@csp/shared-types'
import { SKILL_NAMES } from '../world/world.js'

const HORSE_STAT_LABELS: Record<(typeof HORSE_STAT_NAMES)[number], string> = {
  speed: 'Speed',
  strength: 'Strength',
  endurance: 'Endurance',
}

/** A number field: empty leaves the value to be drawn as for a new one. */
function Field({
  label,
  value,
  onChange,
  max,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  max: number
}) {
  return (
    <label className="card-creative-field">
      <span className="small muted">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        aria-label={label}
        placeholder="drawn"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/** All of a record's fields typed in range, or undefined when any is empty or out of range. */
function allPicked<K extends string>(
  texts: Record<K, string>,
  names: readonly K[],
): Record<K, number> | undefined {
  const out = {} as Record<K, number>
  for (const n of names) {
    const v = pickedNumber(texts[n], 1, CREATIVE_STAT_MAX)
    if (v === undefined || !Number.isInteger(v)) return undefined
    out[n] = v
  }
  return out
}

const blank = <K extends string>(names: readonly K[]) =>
  Object.fromEntries(names.map((n) => [n, ''])) as Record<K, string>

/**
 * The Creative section of a tile card (`CONTEXT.md`: Creative mode): add a Resident, with age,
 * stats and skills picked, or a horse, with age and stats picked, on the tile, to a city and its
 * realm. What is left empty is drawn as for a new one; stats are all picked or all drawn.
 */
export function CreativeAddSection({
  x,
  y,
  knownCities,
  tileCityId,
  homeCityId,
  homeRealmId,
  children,
}: {
  x: number
  y: number
  /** The cities the admin knows, listed until every city of the world has loaded. */
  knownCities: readonly CreativeCity[]
  /** The city whose area holds the tile, picked at first. */
  tileCityId: string | undefined
  homeCityId: string | undefined
  homeRealmId: string | undefined
  /** The Residents on the tile, each with heal, grow up and kill (`CreativeResidentActions`). */
  children?: ReactNode
}) {
  const { busy, said, act } = useCreativeAct()
  const [allCities, setAllCities] = useState<CreativeCity[]>()
  const [picked, setPicked] = useState<string>()
  const [age, setAge] = useState('')
  const [stats, setStats] = useState(blank(STAT_NAMES))
  const [skills, setSkills] = useState(blank(SKILL_NAMES))
  const [horseAge, setHorseAge] = useState('')
  const [horseStats, setHorseStats] = useState(blank(HORSE_STAT_NAMES))
  // Every city of the world, seen or not, from the admin's jump list.
  useEffect(() => {
    let live = true
    api
      .adminPlaces()
      .then((places) => live && setAllCities(citiesFromPlaces(places, homeRealmId)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [homeRealmId])
  const cities = allCities ?? knownCities
  const cityId = picked ?? defaultCreativeCity(cities, tileCityId, homeCityId)

  const residentAge = age.trim() === '' ? undefined : pickedNumber(age, 0, LIFESPAN_MIN - 0.01)
  const statsPicked = Object.values(stats).some((v) => v !== '')
  const residentStats = statsPicked ? allPicked(stats, STAT_NAMES) : undefined
  const pickedSkills: Partial<Record<SkillName, number>> = {}
  let skillsOk = true
  for (const s of SKILL_NAMES) {
    if (skills[s].trim() === '') continue
    const v = pickedNumber(skills[s], 0, SKILL_MAX[s])
    if (v === undefined) skillsOk = false
    else pickedSkills[s] = v
  }
  const residentOk =
    (age.trim() === '' || residentAge !== undefined) && (!statsPicked || residentStats) && skillsOk

  const hAge =
    horseAge.trim() === '' ? undefined : pickedNumber(horseAge, 0, CREATIVE_HORSE_AGE_MAX)
  const hPicked = Object.values(horseStats).some((v) => v !== '')
  const hStats = hPicked ? allPicked(horseStats, HORSE_STAT_NAMES) : undefined
  const horseOk = (horseAge.trim() === '' || hAge !== undefined) && (!hPicked || hStats)

  return (
    <section className="card-creative" aria-label="Creative">
      <h3 title="Creative mode: for testing, never play">Creative</h3>
      {children}
      <label className="card-creative-field">
        <span className="small muted">Joins</span>
        <select aria-label="Joins" value={cityId} onChange={(e) => setPicked(e.target.value)}>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <details className="card-creative-add">
        <summary>Resident</summary>
        <div className="card-creative-fields">
          <Field label="Age" value={age} onChange={setAge} max={LIFESPAN_MIN} />
          {STAT_NAMES.map((s) => (
            <Field
              key={s}
              label={STAT_LABELS[s]}
              value={stats[s]}
              onChange={(v) => setStats({ ...stats, [s]: v })}
              max={CREATIVE_STAT_MAX}
            />
          ))}
          {SKILL_NAMES.map((s) => (
            <Field
              key={s}
              label={SKILL_LABELS[s]}
              value={skills[s]}
              onChange={(v) => setSkills({ ...skills, [s]: v })}
              max={SKILL_MAX[s]}
            />
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !cityId || !residentOk}
          title="Stats: all four picked, or all drawn"
          onClick={() =>
            act({
              action: 'addResident',
              cityId: cityId!,
              x,
              y,
              ...(residentAge !== undefined && { age: residentAge }),
              ...(residentStats && { stats: residentStats as StatRecord<number> }),
              skills: pickedSkills,
            })
          }
        >
          Add Resident
        </button>
      </details>
      <details className="card-creative-add">
        <summary>Horse</summary>
        <div className="card-creative-fields">
          <Field label="Age" value={horseAge} onChange={setHorseAge} max={CREATIVE_HORSE_AGE_MAX} />
          {HORSE_STAT_NAMES.map((s) => (
            <Field
              key={s}
              label={HORSE_STAT_LABELS[s]}
              value={horseStats[s]}
              onChange={(v) => setHorseStats({ ...horseStats, [s]: v })}
              max={CREATIVE_STAT_MAX}
            />
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !cityId || !horseOk}
          title="Stats: all three picked, or all drawn"
          onClick={() =>
            act({
              action: 'addHorse',
              cityId: cityId!,
              x,
              y,
              ...(hAge !== undefined && { age: hAge }),
              ...(hStats && { stats: hStats as HorseStats }),
            })
          }
        >
          Add horse
        </button>
      </details>
      <CreativeSaid said={said} />
    </section>
  )
}

/**
 * Heal, grow up and kill for one Resident (`CONTEXT.md`: Creative mode), of any realm: on their
 * own card, or a row of the tile card for each Resident on the tile. Kill is a normal death; a
 * Leader's follows the Leader death rules.
 */
export function CreativeResidentActions({
  resident: r,
  tick,
  named = false,
  move,
}: {
  resident: CreativeResident
  tick: number
  /** Says whose row it is: on the tile card, where several Residents may stand. */
  named?: boolean
  /** Move: picks the tile on the map they stand on at once (their own card only). */
  move?: CreativeMove
}) {
  const { busy, said, act } = useCreativeAct()
  const can = residentActions(r, tick)
  const buttons = (
    <div className="card-creative-goods">
      {named && <span>{r.name}</span>}
      <button
        type="button"
        disabled={busy || !can.heal}
        title="Wounds close and a Down Resident wakes, at full health"
        onClick={() => act({ action: 'heal', residentId: r.id })}
      >
        Heal
      </button>
      <button
        type="button"
        disabled={busy || !can.growUp}
        title="A child is grown, as if the years had passed"
        onClick={() => act({ action: 'growUp', residentId: r.id })}
      >
        Grow up
      </button>
      <button
        type="button"
        disabled={busy}
        title="A normal death; a Leader's follows the Leader death rules"
        onClick={() => {
          if (window.confirm(`Kill ${r.name}?`)) act({ action: 'kill', residentId: r.id })
        }}
      >
        Kill
      </button>
      {move && <MoveButton move={move} />}
    </div>
  )
  if (named) {
    return (
      <>
        {buttons}
        <CreativeSaid said={said} />
      </>
    )
  }
  return (
    <section className="card-creative" aria-label="Creative">
      <h3 title="Creative mode: for testing, never play">Creative</h3>
      {buttons}
      <CreativeSaid said={said} />
    </section>
  )
}

/** Move in creative mode: whether the map is picking the tile, and what switches that. */
export interface CreativeMove {
  picking: boolean
  onPick: () => void
}

/**
 * Move (`CONTEXT.md`: Creative mode): pick a tile on the map, and the Resident (or each of the
 * group) stands there at once, their way and work dropped, what they carry kept. Pressed while
 * the map waits for the tile; pressed again, it stops waiting.
 */
function MoveButton({ move }: { move: CreativeMove }) {
  return (
    <button
      type="button"
      className={move.picking ? 'on' : undefined}
      aria-pressed={move.picking}
      title="Pick a tile: they stand there at once, their way and work dropped, what they carry kept"
      onClick={move.onPick}
    >
      Move
    </button>
  )
}

/** The Creative section of a group's card (`CONTEXT.md`: Creative mode): move them all at once. */
export function CreativeGroupMove({ move }: { move: CreativeMove }) {
  return (
    <section className="card-creative" aria-label="Creative">
      <h3 title="Creative mode: for testing, never play">Creative</h3>
      <div className="card-creative-goods">
        <MoveButton move={move} />
      </div>
    </section>
  )
}
