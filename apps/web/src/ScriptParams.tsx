import { WORKPLACE_PARAM } from './shared/default-scripts.js'
import type { PickedParamType, ScriptParam, ScriptParamValue, Waypoint } from '@csp/shared-types'
import { useId, useRef, useState, type ReactNode } from 'react'
import { choiceLabel, effectiveParam, paramNote, waypointLabel } from './script-params-view.js'
import { useKeyboardInset } from './sheet-view.js'
import { foodEatenPerDay, num } from './wiki-view.js'

/**
 * The hint under number fields counting Food, like the defaults' `foodAt` and `foodTake`
 * (`CONTEXT.md`: Getting food): how much a resident eats a game day. None without such a param.
 */
export function foodParamsHint(names: readonly string[]): string | undefined {
  if (!names.some((n) => /food/i.test(n))) return undefined
  return `Food is counted in units: a resident eats about ${num(foodEatenPerDay())} a game day.`
}

/** What the map picks for a param of each type a pick is for. */
const PICK_HINTS: Record<PickedParamType, string> = {
  building: 'a building or construction site of yours',
  storage: 'a storage, a stable or a carriage of yours',
  waypoint: 'one of your waypoints',
}

/** Whether a param of `type` is picked on the map, not typed or chosen from a list. */
const pickedOnMap = (type: ScriptParam['type'] | undefined): type is PickedParamType =>
  type !== undefined && type !== 'number' && type !== 'choice'

/**
 * A `choice` param's list of words, or a `waypoint` param's list of the Player's waypoints
 * (`CONTEXT.md`: Script parameter). Its first entry leaves the param unset: a choice's default,
 * else what its comment says after "none:", else none.
 */
function ParamSelect({
  param,
  value,
  waypoints,
  onSelect,
}: {
  param: ScriptParam
  /** The word or waypoint id picked; none while unset. */
  value: string | undefined
  waypoints: readonly Waypoint[]
  onSelect: (value: string | undefined) => void
}) {
  const options =
    param.type === 'choice'
      ? (param.choices ?? []).map((c) => ({ value: c, label: choiceLabel(c) }))
      : waypoints.map((wp) => ({ value: wp.id, label: waypointLabel(wp) }))
  const unset =
    param.default === undefined
      ? (paramNote(param.description).unset ?? 'none')
      : `the default, ${typeof param.default === 'string' ? choiceLabel(param.default) : param.default}`
  return (
    <select
      aria-label={param.name}
      value={value ?? ''}
      onChange={(e) => onSelect(e.currentTarget.value || undefined)}
    >
      <option value="">{unset}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** A param's name and type, and what its comment says it is for on a line under its row. */
function ParamName({ param }: { param: ScriptParam }) {
  const { purpose } = paramNote(param.description)
  return (
    <>
      <span className="small">
        <strong>{param.name}</strong> <span className="muted">({param.type})</span>
      </span>
      {purpose && <span className="muted small param-purpose">{purpose}</span>}
    </>
  )
}

/**
 * One field for each `param` line of the script a resident runs (`CONTEXT.md`: Script
 * parameter): the value the script uses (`effectiveParam`), a button to pick it on the map,
 * filtered by the param's type, and one to clear it; a number field for a `number` param, set
 * once typed; a list of words for a `choice` param and of the Player's waypoints for a `waypoint`
 * param, which may be picked on the map too. Each says what it is for from its comment. Shown on
 * the resident card under the script they run. Working by a workplace's settings (`CONTEXT.md`:
 * Workplace settings), a value not picked for them shows as the workplace's, and one picked is
 * marked as their own, an override, its button going back to the workplace's.
 */
export function ScriptParamFields({
  params,
  values,
  label,
  target,
  onTile,
  waypoints,
  picking,
  onPick,
  onNumber,
  onChoose,
  onClear,
  workplace,
}: {
  /** The running script's `param` lines. */
  params: readonly ScriptParam[]
  /** What is picked for this resident, by param name. */
  values: Readonly<Record<string, ScriptParamValue>>
  /** The workplace's values by param name, while they work by its settings. */
  workplace?: Readonly<Record<string, ScriptParamValue>>
  /** How a picked value is named; null when it is out of sight. */
  label: (id: string) => string | null
  /** The script's target param (`targetParam`), which unset is the one they stand on. */
  target?: string
  /** What the target param would be on their tile, named; null for nothing that fits. */
  onTile?: string | null
  /** The Player's waypoints, which a `waypoint` param picks from. */
  waypoints: readonly Waypoint[]
  /** The param whose value the map is waiting for, if any. */
  picking: string | undefined
  /** Starts (or cancels) picking a param's value on the map. */
  onPick: (param: ScriptParam) => void
  /** Sets a number param to the number typed; the server checks it is whole and not negative. */
  onNumber: (name: string, value: number) => void
  /** Sets a `choice` param to the word chosen, or a `waypoint` param to the waypoint's id. */
  onChoose: (param: ScriptParam, value: string) => void
  /** Clears a param's value. */
  onClear: (name: string) => void
}) {
  if (params.length === 0) return null
  const pickingType = params.find((p) => p.name === picking)?.type
  const foodHint = foodParamsHint(params.filter((p) => p.type === 'number').map((p) => p.name))
  return (
    <div className="script-params" aria-label="Script parameters">
      {params.map((p) => {
        const value = values[p.name]
        const uses = effectiveParam(p, value, {
          label,
          target,
          onTile,
          workplace: workplace?.[p.name],
        })
        // Their own value against the workplace's; the workplace itself is never one.
        const override = workplace !== undefined && uses.set && p.name !== WORKPLACE_PARAM
        const shown = (
          <span className={uses.set ? 'small' : 'muted small'} aria-label={`${p.name} uses`}>
            {uses.text}
            {override && <span className="muted">, their own</span>}
          </span>
        )
        const clear = override ? 'Workplace’s' : 'Clear'
        const clearTitle = override ? 'Back to the workplace’s value' : undefined
        if (p.type === 'number') {
          const n = typeof value === 'number' ? value : undefined
          const from = workplace?.[p.name]
          return (
            <div key={p.name} className="goods-row">
              <ParamName param={p} />
              {shown}
              <span className="buttons">
                <NumberField
                  // A new value from the server starts the field over.
                  key={n ?? 'unset'}
                  name={p.name}
                  value={n}
                  fallback={
                    typeof from === 'number'
                      ? from
                      : typeof p.default === 'number'
                        ? p.default
                        : undefined
                  }
                  fallbackIs={typeof from === 'number' ? 'The workplace’s' : undefined}
                  onSet={(v) => (v === undefined ? onClear(p.name) : onNumber(p.name, v))}
                />
                <button
                  type="button"
                  title={clearTitle}
                  onClick={() => onClear(p.name)}
                  disabled={n === undefined}
                >
                  {clear}
                </button>
              </span>
            </div>
          )
        }
        const id = typeof value === 'string' ? value : undefined
        const pick = pickedOnMap(p.type) && (
          <button type="button" aria-pressed={picking === p.name} onClick={() => onPick(p)}>
            {picking === p.name ? 'Cancel' : 'Pick'}
          </button>
        )
        if (p.type === 'choice' || p.type === 'waypoint') {
          return (
            <div key={p.name} className="goods-row">
              <ParamName param={p} />
              {/* The list shows the value the script uses: the one picked, else its unset entry. */}
              <span className="buttons">
                <ParamSelect
                  param={p}
                  value={id}
                  waypoints={waypoints}
                  onSelect={(v) => (v === undefined ? onClear(p.name) : onChoose(p, v))}
                />
                {pick}
              </span>
            </div>
          )
        }
        return (
          <div key={p.name} className="goods-row">
            <ParamName param={p} />
            {shown}
            <span className="buttons">
              {pick}
              <button
                type="button"
                title={clearTitle}
                onClick={() => onClear(p.name)}
                disabled={id === undefined}
              >
                {clear}
              </button>
            </span>
          </div>
        )
      })}
      {foodHint && <p className="muted small">{foodHint}</p>}
      {picking !== undefined && pickedOnMap(pickingType) && (
        <p className="muted small" role="status">
          Tap {PICK_HINTS[pickingType]} on the map for {picking}.
        </p>
      )}
    </div>
  )
}

/**
 * A number param's field: what is set, or empty while unset, showing the param's default then.
 * What is typed goes out on Enter or when the field loses focus, if it changed; emptied, it
 * clears the param, back to its default.
 */
export function NumberField({
  name,
  value,
  fallback,
  fallbackIs = 'Default',
  onSet,
}: {
  name: string
  value: number | undefined
  /** The param's default (`param name: number = 3`), shown while unset. */
  fallback?: number
  /** What the fallback is, for its tooltip: the default, or the workplace's value. */
  fallbackIs?: string
  onSet: (value: number | undefined) => void
}) {
  // What went out last, so Enter and then leaving the field don't send it twice.
  const sent = useRef(value)
  const commit = (text: string) => {
    const typed = text.trim() === '' ? undefined : Number(text)
    if (typed === sent.current) return
    sent.current = typed
    onSet(typed)
  }
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      className="amount"
      aria-label={name}
      placeholder={fallback === undefined ? 'unset' : String(fallback)}
      title={fallback === undefined ? undefined : `${fallbackIs} ${fallback}`}
      defaultValue={value ?? ''}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value)
      }}
    />
  )
}

/**
 * One param's compact row in the form before a script starts: its name, the `shown` value if its
 * field doesn't show that itself, the field, and what its comment says it is for behind a "?".
 */
function StartParamRow({
  param,
  shown,
  children,
}: {
  param: ScriptParam
  shown?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const noteId = useId()
  const { purpose } = paramNote(param.description)
  return (
    <div className="start-param">
      <div className="start-param-label">
        <span className="small">
          <strong>{param.name}</strong> <span className="muted">({param.type})</span>
          {purpose && (
            <button
              type="button"
              className="start-param-why"
              aria-label={`What ${param.name} is for`}
              aria-expanded={open}
              aria-controls={noteId}
              onClick={() => setOpen(!open)}
            >
              ?
            </button>
          )}
        </span>
        {shown}
      </div>
      <span className="buttons">{children}</span>
      {purpose && (
        <p id={noteId} className="muted small start-param-note" hidden={!open}>
          {purpose}
        </p>
      )}
    </div>
  )
}

/**
 * The form shown before a script starts (`CONTEXT.md`: Script parameter, Before it starts), a
 * bottom sheet on a phone (ADR 0012): one compact row for each `param` line of the script, filled
 * with the kept values or the defaults, under its title and over Start and Cancel, which stay on
 * screen while the rows scroll. A `building` or `storage` param is picked on the map, which hides
 * the form until it is; a `number` param is typed, its default shown while empty; a `choice` param
 * is chosen from its words, and a `waypoint` param from the Player's waypoints or on the map. Start
 * gives the order with the values, Cancel gives nothing.
 */
export function StartParamsForm({
  script,
  params,
  values,
  target,
  label,
  waypoints,
  canStart,
  error,
  picking = false,
  onPick,
  onChange,
  onStart,
  onCancel,
  fromWorkplace,
}: {
  /** The name of the script about to start. */
  script: string
  /** A param is being picked on the map: hidden, keeping its scroll and open explanations. */
  picking?: boolean
  /**
   * Filled with a workplace's settings, for Work (`CONTEXT.md`: Workplace settings): what the
   * Player changes becomes the resident's own.
   */
  fromWorkplace?: boolean
  params: readonly ScriptParam[]
  /** What each param is set to now, by name; none while empty. */
  values: Readonly<Record<string, ScriptParamValue | undefined>>
  /** The script's target param (`targetParam`), which left empty is the one they stand on. */
  target?: string
  /** How a picked value is named; null when it is out of sight. */
  label: (id: string) => string | null
  /** The Player's waypoints, which a `waypoint` param picks from. */
  waypoints: readonly Waypoint[]
  /** Whether every number typed is whole and zero or more. */
  canStart: boolean
  /** Why the last tap on the map picked nothing, if it didn't. */
  error?: string
  /** Picks a param's value on the map. */
  onPick: (param: ScriptParam) => void
  /** Sets a param's value, or empties it. */
  onChange: (name: string, value: ScriptParamValue | undefined) => void
  onStart: () => void
  onCancel: () => void
}) {
  const foodHint = foodParamsHint(params.filter((p) => p.type === 'number').map((p) => p.name))
  const keyboard = useKeyboardInset()
  return (
    <div
      className={`hud-backdrop start-params-backdrop${picking ? ' picking' : ''}`}
      style={keyboard > 0 ? { paddingBottom: keyboard } : undefined}
    >
      <form
        className="hud-dialog start-params"
        role="dialog"
        aria-modal="true"
        aria-label={`Start ${script}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (canStart) onStart()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      >
        <h2>Start {script}</h2>
        <div className="start-params-rows">
          {fromWorkplace && (
            <p className="muted small">
              Filled in from the workplace’s Work settings. What you change here is this resident’s
              own and stays when the workplace’s settings change.
            </p>
          )}
          <div aria-label="Script parameters">
            {params.map((p) => {
              const value = values[p.name]
              if (p.type === 'number') {
                const n = typeof value === 'number' ? value : undefined
                return (
                  <StartParamRow key={p.name} param={p}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className="amount"
                      aria-label={p.name}
                      placeholder={p.default === undefined ? 'unset' : String(p.default)}
                      title={p.default === undefined ? undefined : `Default ${p.default}`}
                      value={n ?? ''}
                      onChange={(e) => {
                        const text = e.currentTarget.value.trim()
                        onChange(p.name, text === '' ? undefined : Number(text))
                      }}
                    />
                  </StartParamRow>
                )
              }
              const id = typeof value === 'string' ? value : undefined
              if (p.type === 'choice' || p.type === 'waypoint') {
                return (
                  <StartParamRow key={p.name} param={p}>
                    <ParamSelect
                      param={p}
                      value={id}
                      waypoints={waypoints}
                      onSelect={(v) => onChange(p.name, v)}
                    />
                    {p.type === 'waypoint' && (
                      <button type="button" onClick={() => onPick(p)}>
                        Pick
                      </button>
                    )}
                  </StartParamRow>
                )
              }
              const none =
                p.name === target
                  ? 'the one they stand on'
                  : (paramNote(p.description).unset ?? 'none picked')
              const shown = id === undefined ? none : (label(id) ?? 'out of sight')
              return (
                <StartParamRow
                  key={p.name}
                  param={p}
                  shown={
                    <span
                      className={`start-param-value small${id === undefined ? ' muted' : ''}`}
                      aria-label={`${p.name} uses`}
                    >
                      {shown}
                    </span>
                  }
                >
                  <button type="button" onClick={() => onPick(p)}>
                    Pick
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(p.name, undefined)}
                    disabled={id === undefined}
                  >
                    Clear
                  </button>
                </StartParamRow>
              )
            })}
          </div>
          {foodHint && <p className="muted small">{foodHint}</p>}
        </div>
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
        <div className="hud-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!canStart}>
            Start
          </button>
        </div>
      </form>
    </div>
  )
}
