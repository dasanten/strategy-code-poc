import { useState, type FormEvent } from 'react'
import {
  ARMY_NAME_MAX_LENGTH,
  type Army,
  type OrderRequest,
  type Resident,
  type ScriptSummary,
  type SeenResident,
} from '@csp/shared'
import { RunScript } from './Residents.js'
import { relationshipClass } from './theme.js'

/** An army order that needs a tile, picked on the map. */
export type ArmyPick = { armyId: string; kind: 'armyWalkTo' | 'armyGuard' }

/** What an army is doing, from its order. */
function armyDoing(army: Army, names: Map<string, string>): string {
  const o = army.order
  if (!o) return 'Idle'
  const who = (id: string) => names.get(id) ?? 'someone out of sight'
  if (o.kind === 'walkTo') return `Walking to ${o.target.x}, ${o.target.y}`
  if (o.kind === 'guard') return `Guarding ${o.at.x}, ${o.at.y}`
  if (o.kind === 'attack') return `Attacking ${who(o.targetId)}`
  return `Following ${who(o.targetId)}`
}

/**
 * The Player's armies (`CONTEXT.md`: Army): form one from their residents, and order it to walk
 * or guard a tile picked on the map, to attack or follow a resident in sight, to run a script,
 * to stop, or to disband. Every change is an order the server checks (ADR 0002).
 */
export function ArmiesPanel({
  armies,
  own,
  inSight,
  realmId,
  picking,
  onPick,
  pickError,
  scripts,
  sendOrder,
}: {
  armies: Army[]
  /** The Player's residents. */
  own: Resident[]
  /** Everyone in sight, the Player's own included. */
  inSight: SeenResident[]
  realmId: string
  /** The army order waiting for a tile on the map, if any. */
  picking: ArmyPick | undefined
  onPick: (pick: ArmyPick | undefined) => void
  /** Why the last order with a tile picked on the map was rejected, if it was. */
  pickError: string | undefined
  /** The Player's script library. */
  scripts: ScriptSummary[]
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | undefined>()
  const order = async (o: OrderRequest) => setError(await sendOrder(o))
  const names = new Map(inSight.map((r) => [r.id, r.name]))
  const armyNameOf = new Map(armies.flatMap((a) => a.memberIds.map((id) => [id, a.name])))

  async function form(e: FormEvent) {
    e.preventDefault()
    await order({ kind: 'formArmy', name, residentIds: [...chosen] })
    setName('')
    setChosen(new Set())
  }

  function toggle(id: string) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  const pickButton = (army: Army, kind: ArmyPick['kind'], label: string) => {
    const on = picking?.armyId === army.id && picking.kind === kind
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onPick(on ? undefined : { armyId: army.id, kind })}
      >
        {on ? 'Pick a tile on the map…' : label}
      </button>
    )
  }

  return (
    <section className="alliance-panel" aria-label="Armies">
      <div className="panel-head">
        <h2>Armies</h2>
        <span>{armies.length === 0 ? 'none' : armies.length}</span>
      </div>
      {armies.length > 0 && (
        <ul className="alliance-list">
          {armies.map((a) => {
            const targetId = targets[a.id] ?? ''
            const choices = inSight.filter((r) => !a.memberIds.includes(r.id))
            const enemy = inSight.find((r) => r.id === targetId)?.owner !== realmId
            return (
              <li key={a.id} className={`army ${relationshipClass('own')}`}>
                <span>
                  <strong>{a.name}</strong> · {armyDoing(a, names)}
                  <br />
                  <span className="muted small">
                    {a.memberIds.map((id) => names.get(id) ?? '?').join(', ')}
                  </span>
                </span>
                <div className="order-buttons">
                  {pickButton(a, 'armyWalkTo', 'Walk to…')}
                  {pickButton(a, 'armyGuard', 'Guard…')}
                  <select
                    aria-label={`Target for ${a.name}`}
                    value={targetId}
                    onChange={(e) => setTargets({ ...targets, [a.id]: e.target.value })}
                  >
                    <option value="">Pick a resident…</option>
                    {choices.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.owner === realmId ? ' · yours' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!targetId || !enemy}
                    onClick={() => order({ kind: 'armyAttack', armyId: a.id, targetId })}
                  >
                    Attack
                  </button>
                  <button
                    type="button"
                    disabled={!targetId}
                    onClick={() => order({ kind: 'armyFollow', armyId: a.id, targetId })}
                  >
                    Follow
                  </button>
                  <button
                    type="button"
                    disabled={!a.order && !a.script}
                    onClick={() => order({ kind: 'armyStop', armyId: a.id })}
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => order({ kind: 'disbandArmy', armyId: a.id })}
                  >
                    Disband
                  </button>
                </div>
                <RunScript
                  script={a.script}
                  scripts={scripts}
                  label={`Script for ${a.name} to run`}
                  onRunScript={(scriptId) =>
                    order({ kind: 'armyRunScript', armyId: a.id, scriptId })
                  }
                />
              </li>
            )
          })}
        </ul>
      )}
      <form onSubmit={form}>
        <fieldset className="army-members">
          <legend>Form an army</legend>
          {own.map((r) => (
            <label key={r.id}>
              <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)} />
              {r.name}
              {armyNameOf.has(r.id) && (
                <span className="muted small"> · {armyNameOf.get(r.id)}</span>
              )}
            </label>
          ))}
        </fieldset>
        <input
          value={name}
          maxLength={ARMY_NAME_MAX_LENGTH}
          placeholder="Its name"
          aria-label="Army name"
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" disabled={chosen.size === 0}>
          Form
        </button>
      </form>
      <p className="muted small">A resident given an order of their own leaves their army.</p>
      {(error ?? pickError) && <p className="error">{error ?? pickError}</p>}
    </section>
  )
}
