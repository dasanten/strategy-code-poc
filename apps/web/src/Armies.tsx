import { useState, type FormEvent, type ReactNode } from 'react'
import {
  ARMY_NAME_MAX_LENGTH,
  armyDrivenTo,
  spareFood,
  type Army,
  type SeenCarriage,
  type OrderRequest,
  type Resident,
  type ScriptSummary,
  type SeenResident,
} from '@csp/shared'
import { RunScript } from './Residents.js'
import {
  ARMY_TABS,
  rememberedTabOf,
  rememberTabOf,
  supplyLines,
  TAB_LABELS,
  type ArmyTab,
} from './residents-view.js'
import { CardTabs, SelectionCard } from './SelectionCard.js'
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
 * The Player's armies (`CONTEXT.md`: Army): form one from their residents, and open one as a card
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

  const card = (a: Army) => {
    const targetId = targets[a.id] ?? ''
    const choices = inSight.filter((r) => !a.memberIds.includes(r.id))
    const enemy = inSight.find((r) => r.id === targetId)?.owner !== realmId
    const wagons = wagonsOf(a)
    return (
      <SelectionCard
        rel="own"
        title={a.name}
        lines={[
          <strong key="doing">{armyDoing(a, names)}</strong>,
          `${a.memberIds.length} ${a.memberIds.length === 1 ? 'member' : 'members'} · ${
            wagons.length === 0
              ? 'no supply wagon'
              : `${wagons.length} supply ${wagons.length === 1 ? 'wagon' : 'wagons'}`
          }`,
        ]}
        onClose={() => setOpenId(null)}
      >
        <CardTabs tabs={ARMY_TABS} labels={TAB_LABELS} tab={tab} onTab={showTab} />
        {tab === 'orders' && (
          <>
            <div className="sel-order-group">
              <h3>Move</h3>
              <div className="order-buttons" aria-label="Move">
                {pickButton(a, 'armyWalkTo', 'Walk to…')}
                {pickButton(a, 'armyGuard', 'Guard…')}
                <button
                  type="button"
                  disabled={!a.order && !a.script}
                  onClick={() => order({ kind: 'armyStop', armyId: a.id })}
                >
                  Stop
                </button>
              </div>
            </div>
            <div className="sel-order-group">
              <h3>A resident in sight</h3>
              <div className="order-buttons" aria-label="A resident in sight">
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
              </div>
            </div>
            <div className="sel-order-group">
              <h3>Army</h3>
              <div className="order-buttons" aria-label="Army">
                <button
                  type="button"
                  onClick={() => order({ kind: 'disbandArmy', armyId: a.id })}
                >
                  Disband
                </button>
              </div>
            </div>
          </>
        )}
        {tab === 'members' && (
          <ul className="sel-facts" aria-label="Members">
            {a.memberIds.map((id) => (
              <li key={id}>{names.get(id) ?? 'Someone out of sight'}</li>
            ))}
          </ul>
        )}
        {tab === 'supply' &&
          (wagons.length === 0 ? (
            <p className="muted small">
              No supply wagon. A carriage driven after the army, or a haul route with the army as
              its second stop, feeds it on the way.
            </p>
          ) : (
            <ul className="sel-facts" aria-label="Supply wagons">
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
              onRunScript={(scriptId) => order({ kind: 'armyRunScript', armyId: a.id, scriptId })}
            />
            {a.script && scriptMemory?.(a.id)}
          </>
        )}
      </SelectionCard>
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
          {armies.map((a) => (
            <li key={a.id} className={`army ${relationshipClass('own')}`}>
              {open?.id === a.id ? (
                card(a)
              ) : (
                <button type="button" className="army-row" onClick={() => setOpenId(a.id)}>
                  <strong>{a.name}</strong> · {armyDoing(a, names)}
                </button>
              )}
            </li>
          ))}
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
