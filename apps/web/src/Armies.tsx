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
import { PanelHead } from './panel-head.js'
import { CommandBar } from './CommandBar.js'
import { CardTabs } from './SelectionCard.js'
import { relationshipClass } from './theme.js'
import { Icon } from './Icon.js'

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

/** The Player's drivers whose carriage goes after the army (`CONTEXT.md`: Supply line). */
function wagonsOf(army: Army, own: Resident[]) {
  return own.flatMap((r) => {
    const o = r.order
    if (armyDrivenTo(r) !== army.id || (o?.kind !== 'drive' && o?.kind !== 'haul')) return []
    return [{ name: r.name, carriageId: o.carriageId, haul: o.kind === 'haul' }]
  })
}

/**
 * The Player's armies (`CONTEXT.md`: Army): a row each, the open one marked, and Form an army
 * from their residents. A row opens the army's card in the command bar (`ArmyCard`), or closes
 * it when it is open already. Every change is an order the server checks (ADR 0002).
 */
export function ArmiesPanel({
  armies,
  own,
  inSight,
  openId,
  onOpen,
  sendOrder,
}: {
  armies: Army[]
  /** The Player's residents. */
  own: Resident[]
  /** Everyone in sight, the Player's own included, to name what an army does. */
  inSight: SeenResident[]
  /** The army whose card is open in the command bar, if one is. */
  openId: string | undefined
  /** Opens an army's card, or with none, closes it. */
  onOpen: (armyId: string | undefined) => void
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | undefined>()
  const names = new Map(inSight.map((r) => [r.id, r.name]))
  const armyNameOf = new Map(armies.flatMap((a) => a.memberIds.map((id) => [id, a.name])))

  async function form(e: FormEvent) {
    e.preventDefault()
    setError(await sendOrder({ kind: 'formArmy', name, residentIds: [...chosen] }))
    setName('')
    setChosen(new Set())
  }

  function toggle(id: string) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  return (
    <section className="armies" aria-label="Armies">
      <PanelHead title="Armies">{armies.length === 0 ? 'none' : armies.length}</PanelHead>
      {armies.length > 0 && (
        <ul className="army-list">
          {armies.map((a) => {
            const open = openId === a.id
            return (
              <li key={a.id} className={`army ${relationshipClass('own')}`}>
                <button
                  type="button"
                  className={`rw people-row army-row${open ? ' sel' : ''}`}
                  aria-pressed={open}
                  title={open ? `Close ${a.name}` : `Open ${a.name}`}
                  onClick={() => onOpen(open ? undefined : a.id)}
                >
                  <Icon name="banner" />
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
              </li>
            )
          })}
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
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  )
}

/**
 * An army's card in the command bar (`CONTEXT.md`: Army, Resident card; ADR 0044), laid out as a
 * resident's: its banner, name and what it does on the left with its members and supply wagons,
 * the tabs beside. Its Orders walk or guard a tile picked on the map, attack or follow a resident
 * in sight, stop, or disband; Members and Supply say who is in it and which carriages feed it;
 * Script runs one. While it waits for a tile it shrinks to its header, as in pick mode.
 */
export function ArmyCard({
  army: a,
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
  onClose,
}: {
  army: Army
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
  /** The memory of the script the army runs (`ScriptMemoryTree`), shown on its Script tab. */
  scriptMemory?: ReactNode
  onClose: () => void
}) {
  const [targetId, setTargetId] = useState('')
  const [tab, setTab] = useState<ArmyTab>(() => rememberedTabOf('army', ARMY_TABS))
  const [error, setError] = useState<string | undefined>()
  const order = async (o: OrderRequest) => setError(await sendOrder(o))
  const names = new Map(inSight.map((r) => [r.id, r.name]))
  const choices = inSight.filter((r) => !a.memberIds.includes(r.id))
  const enemy = inSight.find((r) => r.id === targetId)?.owner !== realmId
  const canAttack = targetId !== '' && enemy
  const wagons = wagonsOf(a, own)
  const waiting = picking?.armyId === a.id
  const showTab = (t: ArmyTab) => {
    setTab(t)
    rememberTabOf('army', t)
  }
  const pickButton = (kind: ArmyPick['kind'], label: string) => {
    const on = picking?.armyId === a.id && picking.kind === kind
    return (
      <div className="cmd-order">
        <button
          type="button"
          className={on ? 'btn sm fill on' : 'btn sm fill'}
          aria-pressed={on}
          onClick={() => onPick(on ? undefined : { armyId: a.id, kind })}
        >
          <span className="cmd-label">{on ? 'Pick a tile on the map…' : label}</span>
        </button>
      </div>
    )
  }
  const button = (label: string, onClick: () => void, disabled: boolean, danger = false) => (
    <div className="cmd-order">
      <button
        type="button"
        className={`btn sm fill${danger && !disabled ? ' dng' : ''}`}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="cmd-label">{label}</span>
      </button>
    </div>
  )
  const shownError = error ?? pickError
  return (
    <CommandBar
      rel="own"
      icon="banner"
      title={a.name}
      lines={[<strong key="doing">{armyDoing(a, names)}</strong>]}
      head={
        <div className="sel-line army-facts">
          {a.memberIds.length} {a.memberIds.length === 1 ? 'member' : 'members'} ·{' '}
          {wagons.length === 0
            ? 'no supply wagon'
            : `${wagons.length} supply ${wagons.length === 1 ? 'wagon' : 'wagons'}`}
        </div>
      }
      tabs={<CardTabs tabs={ARMY_TABS} labels={TAB_LABELS} tab={tab} onTab={showTab} />}
      status={
        shownError ? (
          <p className="error small" role="status">
            Order turned down: {shownError}
          </p>
        ) : (
          tab === 'orders' && (
            <p className="muted small" role="status">
              Walk to and Guard wait for a tile on the map; Attack and Follow take the resident
              picked.
            </p>
          )
        )
      }
      onClose={onClose}
      collapsed={waiting}
    >
      {tab === 'orders' && (
        <div className="cmd-orders army-orders">
          <div className="cmd-col">
            <div className="cmd-group">
              <h3>Move</h3>
              <div className="cmd-grid og" role="group" aria-label="Move">
                {pickButton('armyWalkTo', 'Walk to…')}
                {pickButton('armyGuard', 'Guard…')}
                {button(
                  'Stop',
                  () => void order({ kind: 'armyStop', armyId: a.id }),
                  !a.order && !a.script,
                )}
              </div>
            </div>
          </div>
          <div className="cmd-col wide">
            <div className="cmd-group">
              <h3>A resident in sight</h3>
              <select
                className="in"
                aria-label={`Target for ${a.name}`}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">Pick a resident…</option>
                {choices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.owner === realmId ? ' · yours' : ''}
                  </option>
                ))}
              </select>
              <div className="cmd-grid og og2" role="group" aria-label="A resident in sight">
                {button(
                  'Attack',
                  () => void order({ kind: 'armyAttack', armyId: a.id, targetId }),
                  !canAttack,
                  true,
                )}
                {button(
                  'Follow',
                  () => void order({ kind: 'armyFollow', armyId: a.id, targetId }),
                  !targetId,
                )}
              </div>
            </div>
          </div>
          <div className="cmd-col">
            <div className="cmd-group">
              <h3>Army</h3>
              <div className="cmd-grid og" role="group" aria-label="Army">
                {button('Disband', () => void order({ kind: 'disbandArmy', armyId: a.id }), false)}
              </div>
            </div>
          </div>
        </div>
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
            No supply wagon. A carriage driven after the army, or a haul route with the army as its
            second stop, feeds it on the way.
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
            onRunScript={(scriptId) => order({ kind: 'armyRunScript', armyId: a.id, scriptId })}
          />
          {a.script && scriptMemory}
        </>
      )}
    </CommandBar>
  )
}
