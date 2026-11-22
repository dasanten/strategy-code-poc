import { useState, type FormEvent, type ReactNode } from 'react'
import { ARMY_NAME_MAX_LENGTH, armyDrivenTo, spareFood } from './shared/army.js'
import type {
  Army,
  SeenCarriage,
  OrderRequest,
  Resident,
  ScriptSummary,
  SeenResident,
} from '@csp/shared-types'
import { RunScript } from './Residents.js'
import {
  ARMY_TABS,
  rememberedTabOf,
  rememberTabOf,
  supplyLines,
  TAB_LABELS,
  type ArmyTab,
} from './residents-view.js'
import { PanelHead } from './drawer-head.js'
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
 * The Player's armies (`CONTEXT.md`: Army): form one from their residents, and open one in the tab
 * (ADR 0012: header and tabs, like the resident card). Its Orders walk or guard a tile picked on
 * the map, attack or follow a resident in sight, stop, or disband; Members and Supply say who is
 * in it and which carriages feed it; Script runs one. Every change is an order the server checks
 * (ADR 0002).
 */
export function ArmiesPanel({
  armies,
  own,
  inSight,
  carriages,
  realmId,
  picking,
  onPick,
  pickError,
  scripts,
  sendOrder,
  scriptMemory,
}: {
  armies: Army[]
  /** The Player's residents. */
  own: Resident[]
  /** Everyone in sight, the Player's own included. */
  inSight: SeenResident[]
  /** The carriages in sight, for the supply wagons. */
  carriages: SeenCarriage[]
  realmId: string
  /** The army order waiting for a tile on the map, if any. */
  picking: ArmyPick | undefined
  onPick: (pick: ArmyPick | undefined) => void
  /** Why the last order with a tile picked on the map was rejected, if it was. */
  pickError: string | undefined
  /** The Player's script library. */
  scripts: ScriptSummary[]
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
  /** The memory of the script an army runs (`ScriptMemoryTree`), shown on its Script tab. */
  scriptMemory?: (armyId: string) => ReactNode
}) {
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [targets, setTargets] = useState<Record<string, string>>({})
  // The army whose card is open: the first one until the Player opens or closes one.
  const [openId, setOpenId] = useState<string | null>()
  const [tab, setTab] = useState<ArmyTab>(() => rememberedTabOf('army', ARMY_TABS))
  const [error, setError] = useState<string | undefined>()
  const order = async (o: OrderRequest) => setError(await sendOrder(o))
  const names = new Map(inSight.map((r) => [r.id, r.name]))
  const armyNameOf = new Map(armies.flatMap((a) => a.memberIds.map((id) => [id, a.name])))
  const open = openId === undefined ? armies[0] : armies.find((a) => a.id === openId)

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

  const showTab = (t: ArmyTab) => {
    setTab(t)
    rememberTabOf('army', t)
  }

  const pickButton = (army: Army, kind: ArmyPick['kind'], label: string) => {
    const on = picking?.armyId === army.id && picking.kind === kind
    return (
      <button
        type="button"
        className="btn sm grow"
        aria-pressed={on}
        onClick={() => onPick(on ? undefined : { armyId: army.id, kind })}
      >
        {on ? 'Pick a tile on the map…' : label}
      </button>
    )
  }

  /** The Player's drivers whose carriage goes after the army (`CONTEXT.md`: Supply line). */
  const wagonsOf = (army: Army) =>
    own.flatMap((r) => {
      const o = r.order
      if (armyDrivenTo(r) !== army.id || (o?.kind !== 'drive' && o?.kind !== 'haul')) return []
      return [{ name: r.name, carriageId: o.carriageId, haul: o.kind === 'haul' }]
    })

  /** An open army: its row, marked, then what it is, its tabs and the open one under it. */
  const card = (a: Army) => {
    const targetId = targets[a.id] ?? ''
    const choices = inSight.filter((r) => !a.memberIds.includes(r.id))
    const enemy = inSight.find((r) => r.id === targetId)?.owner !== realmId
    const canAttack = targetId !== '' && enemy
    const wagons = wagonsOf(a)
    return (
      <div className="army-card" role="region" aria-label={a.name}>
        <div className="rw sel army-row">
          <span className="ic i-banner" aria-hidden="true" />
          <span className="grow">
            <span className="b">{a.name}</span>
            <span className="under">{armyDoing(a, names)}</span>
          </span>
          <button
            type="button"
            className="btn sm sq"
            aria-label={`Close ${a.name}`}
            onClick={() => setOpenId(null)}
          >
            <span className="ic s16 i-x" aria-hidden="true" />
          </button>
        </div>
        <div className="army-card-body">
          <div className="sec army-facts">
            <span>
              {a.memberIds.length} {a.memberIds.length === 1 ? 'member' : 'members'} ·{' '}
              {wagons.length === 0
                ? 'no supply wagon'
                : `${wagons.length} supply ${wagons.length === 1 ? 'wagon' : 'wagons'}`}
            </span>
          </div>
          <div className="tabs" role="tablist" aria-label={`${a.name}, tabs`}>
            {ARMY_TABS.map((t) => (
              <button
                type="button"
                key={t}
                className={tab === t ? 'tab on' : 'tab'}
                role="tab"
                aria-selected={tab === t}
                onClick={() => showTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="sec army-tab">
            {tab === 'orders' && (
              <>
                <span className="lb">Move</span>
                <div className="fx army-buttons" role="group" aria-label="Move">
                  {pickButton(a, 'armyWalkTo', 'Walk to…')}
                  {pickButton(a, 'armyGuard', 'Guard…')}
                  <button
                    type="button"
                    className="btn sm grow"
                    disabled={!a.order && !a.script}
                    onClick={() => order({ kind: 'armyStop', armyId: a.id })}
                  >
                    Stop
                  </button>
                </div>
                <span className="lb">A resident in sight</span>
                <select
                  className="in"
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
                <div className="fx army-buttons" role="group" aria-label="A resident in sight">
                  <button
                    type="button"
                    className={canAttack ? 'btn sm grow dng' : 'btn sm grow off'}
                    disabled={!canAttack}
                    onClick={() => order({ kind: 'armyAttack', armyId: a.id, targetId })}
                  >
                    Attack
                  </button>
                  <button
                    type="button"
                    className="btn sm grow"
                    disabled={!targetId}
                    onClick={() => order({ kind: 'armyFollow', armyId: a.id, targetId })}
                  >
                    Follow
                  </button>
                </div>
                <span className="lb">Army</span>
                <div className="fx army-buttons" role="group" aria-label="Army">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => order({ kind: 'disbandArmy', armyId: a.id })}
                  >
                    Disband
                  </button>
                </div>
              </>
            )}
            {tab === 'members' && (
              <ul className="army-facts-list" aria-label="Members">
                {a.memberIds.map((id) => (
                  <li key={id}>{names.get(id) ?? 'Someone out of sight'}</li>
                ))}
              </ul>
            )}
            {tab === 'supply' &&
              (wagons.length === 0 ? (
                <p className="mu small">
                  No supply wagon. A carriage driven after the army, or a haul route with the army
                  as its second stop, feeds it on the way.
                </p>
              ) : (
                <ul className="army-facts-list" aria-label="Supply wagons">
                  {supplyLines(wagons, (id) => {
                    const c = carriages.find((x) => x.id === id)
                    return c?.load ? spareFood({ residents: own }, { ...c, load: c.load }) : 0
                  }).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ))}
            {tab === 'script' && (
              <>
                <RunScript
                  script={a.script}
                  scripts={scripts}
                  label={`Script for ${a.name} to run`}
                  of={a.id}
                  onRunScript={(scriptId) =>
                    order({ kind: 'armyRunScript', armyId: a.id, scriptId })
                  }
                />
                {a.script && scriptMemory?.(a.id)}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="armies" aria-label="Armies">
      <PanelHead title="Armies">{armies.length === 0 ? 'none' : armies.length}</PanelHead>
      {armies.length > 0 && (
        <ul className="army-list">
          {armies.map((a) => (
            <li key={a.id} className={`army ${relationshipClass('own')}`}>
              {open?.id === a.id ? (
                card(a)
              ) : (
                <button
                  type="button"
                  className="rw people-row army-row"
                  onClick={() => setOpenId(a.id)}
                >
                  <span className="ic i-banner" aria-hidden="true" />
                  <span className="grow">
                    <span className="b">{a.name}</span>
                    <span className="under">{armyDoing(a, names)}</span>
                  </span>
                  <span
                    className="mono mu"
                    title={`${a.memberIds.length} ${a.memberIds.length === 1 ? 'member' : 'members'}`}
                  >
                    {a.memberIds.length}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="sec army-form" onSubmit={form}>
        <fieldset className="army-members">
          <legend className="px t16">Form an army</legend>
          {own.map((r) => (
            <label key={r.id} className="fx">
              <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)} />
              <span className="grow">
                {r.name}
                {armyNameOf.has(r.id) && <span className="mu"> · {armyNameOf.get(r.id)}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="fx">
          <input
            className="in grow"
            value={name}
            maxLength={ARMY_NAME_MAX_LENGTH}
            placeholder="Its name"
            aria-label="Army name"
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" className="btn primary" disabled={chosen.size === 0}>
            Form
          </button>
        </div>
        <p className="mu small">A resident given an order of their own leaves their army.</p>
        {(error ?? pickError) && <p className="error">{error ?? pickError}</p>}
      </form>
    </section>
  )
}
