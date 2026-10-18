import {
  MAX_HEALTH,
  MAX_HUNGER,
  STAT_NAMES,
  STAT_BASE_MAX,
  TRAINED_CAP_SHARE,
  ageInYears,
  trainedCap,
  type Resident,
  type SkillName,
  type StatName,
} from '@csp/shared'

const STAT_LABELS: Record<StatName, string> = {
  strength: 'Strength',
  endurance: 'Endurance',
  agility: 'Agility',
  intellect: 'Intellect',
}

const SKILL_LABELS: Record<SkillName, string> = {
  mining: 'Mining',
  construction: 'Construction',
  combat: 'Combat',
  driving: 'Driving',
}

/** The longest a stat bar can be: the highest base plus the most training could add to it. */
const STAT_SCALE = STAT_BASE_MAX * (1 + TRAINED_CAP_SHARE)

/** Meter colour by how full it is: low is a warning, half-empty a caution. */
function meterClass(share: number): string {
  return share < 0.25 ? 'low' : share < 0.5 ? 'mid' : 'ok'
}

const pct = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`

/** What a resident is doing. Nothing yet: orders come with walking and work (T4.2, T5.3). */
function doing(_r: Resident): string {
  return 'Idle'
}

/** The Player's residents, one row each; click a row to inspect that resident. */
export function ResidentsList({
  residents,
  leaderId,
  tick,
  selectedId,
  onSelect,
}: {
  residents: Resident[]
  leaderId: string
  tick: number
  selectedId: string | undefined
  onSelect: (id: string) => void
}) {
  return (
    <section className="residents" aria-label="Residents">
      <div className="panel-head">
        <h2>Residents</h2>
        <span>{residents.length} in sight</span>
      </div>
      <div className="residents-scroll">
        <div className="residents-table">
          <div className="residents-row heading" aria-hidden="true">
            <span>Name</span>
            <span>Age</span>
            <span>Doing</span>
            <span>Hunger</span>
            <span>Carrying</span>
          </div>
          {residents.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`residents-row${r.id === selectedId ? ' selected' : ''}`}
              aria-pressed={r.id === selectedId}
              onClick={() => onSelect(r.id)}
            >
              <span className="name">
                {r.name}
                {r.id === leaderId && <span className="leader-mark"> · Leader</span>}
              </span>
              <span className="mono">{Math.floor(ageInYears(r, tick))}</span>
              <span className="doing">{doing(r)}</span>
              <span className="meter" aria-label={`Hunger ${pct(r.hunger / MAX_HUNGER)} fed`}>
                <span
                  className={meterClass(r.hunger / MAX_HUNGER)}
                  style={{ width: pct(r.hunger / MAX_HUNGER) }}
                />
              </span>
              <span className="mono">0 kg</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Everything about one resident (`CONTEXT.md`: Resident, Stats, Skill). */
export function ResidentInspector({
  resident,
  leaderId,
  cityName,
  tick,
}: {
  resident: Resident | undefined
  leaderId: string
  cityName: string | undefined
  tick: number
}) {
  if (!resident) {
    return (
      <aside className="inspector" aria-label="Resident inspector">
        <p className="muted">Pick a resident on the map or in the list.</p>
      </aside>
    )
  }
  const r = resident
  const age = Math.floor(ageInYears(r, tick))
  const skills = (Object.keys(SKILL_LABELS) as SkillName[]).filter((s) => (r.skills[s] ?? 0) > 0)
  return (
    <aside className="inspector" aria-label="Resident inspector">
      <div className="inspector-title">
        <div className="name-line">
          <h2>{r.name}</h2>
          {r.id === leaderId && <span className="badge">Leader</span>}
        </div>
        <div className="muted">
          Adult · {age} years{cityName ? ` · ${cityName}` : ''}
        </div>
      </div>

      <div className="vitals">
        <Meter
          label="Health"
          value={`${Math.round(r.health)} / ${MAX_HEALTH}`}
          share={r.health / MAX_HEALTH}
        />
        <Meter
          label="Hunger"
          value={r.hunger / MAX_HUNGER < 0.25 ? 'hungry' : `${pct(r.hunger / MAX_HUNGER)} fed`}
          share={r.hunger / MAX_HUNGER}
        />
      </div>

      <section className="inspector-block" aria-label="Order">
        <div className="panel-head">
          <h3>Order</h3>
        </div>
        <div className="doing-now">{doing(r)}</div>
        <p className="muted small">Orders come with walking and work.</p>
      </section>

      <section className="inspector-block" aria-label="Stats">
        <div className="panel-head">
          <h3>Stats</h3>
          <span className="small muted">base + trained (cap)</span>
        </div>
        {STAT_NAMES.map((s) => {
          const { base, trained } = r.stats[s]
          const cap = trainedCap(base)
          return (
            <div className="stat" key={s}>
              <span>{STAT_LABELS[s]}</span>
              <span className="stat-bar" aria-hidden="true">
                <span className="base" style={{ width: pct(base / STAT_SCALE) }} />
                <span className="trained" style={{ width: pct(trained / STAT_SCALE) }} />
                <span className="cap" style={{ width: pct((cap - trained) / STAT_SCALE) }} />
              </span>
              <span className="mono right">
                {base} + {trained} ({cap})
              </span>
            </div>
          )
        })}
      </section>

      <section className="inspector-block" aria-label="Skills">
        <h3>Skills</h3>
        <div className="chips">
          {skills.length === 0 && <span className="chip">None yet</span>}
          {skills.map((s) => (
            <span className="chip" key={s}>
              {SKILL_LABELS[s]} <span className="mono accent">{r.skills[s]}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="inspector-block" aria-label="Carrying">
        <div className="panel-head">
          <h3>Carrying</h3>
          <span className="mono small">0 kg</span>
        </div>
        <p className="muted">
          Nothing.{cityName ? ` Eats from ${cityName} storage while at home.` : ''}
        </p>
      </section>
    </aside>
  )
}

function Meter({ label, value, share }: { label: string; value: string; share: number }) {
  return (
    <div className="vital">
      <div className="vital-head">
        <span className="muted">{label}</span>
        <span className="mono">{value}</span>
      </div>
      <span className="meter big">
        <span className={meterClass(share)} style={{ width: pct(share) }} />
      </span>
    </div>
  )
}
