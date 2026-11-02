import {
  WORKPLACE_PARAM,
  type ScriptParam,
  type ScriptParamType,
  type ScriptParamValue,
} from '@csp/shared'
import { useRef } from 'react'
import { effectiveParam, paramNote } from './script-params-view.js'
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
const PICK_HINTS: Record<Exclude<ScriptParamType, 'number'>, string> = {
  building: 'a building or construction site of yours',
  storage: 'a storage, a stable or a carriage of yours',
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
 * once typed. Each says what it is for from its comment. Shown on the resident card under the
 * script they run. Working by a workplace's settings (`CONTEXT.md`: Workplace settings), a value
 * not picked for them shows as the workplace's, and one picked is marked as their own, an
 * override, its button going back to the workplace's.
 */
export function ScriptParamFields({
  params,
  values,
  label,
  target,
  onTile,
  picking,
  onPick,
  onNumber,
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
  /** The param whose value the map is waiting for, if any. */
  picking: string | undefined
  /** Starts (or cancels) picking a param's value on the map. */
  onPick: (param: ScriptParam) => void
  /** Sets a number param to the number typed; the server checks it is whole and not negative. */
  onNumber: (name: string, value: number) => void
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
                  fallback={typeof from === 'number' ? from : p.default}
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
        return (
          <div key={p.name} className="goods-row">
            <ParamName param={p} />
            {shown}
            <span className="buttons">
              <button type="button" aria-pressed={picking === p.name} onClick={() => onPick(p)}>
                {picking === p.name ? 'Cancel' : 'Pick'}
              </button>
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
      {picking !== undefined && pickingType !== undefined && pickingType !== 'number' && (
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
 * The form shown before a script starts (`CONTEXT.md`: Script parameter, Before it starts): one
 * field for each `param` line of the script, filled with the kept values or the defaults. A
 * `building` or `storage` param is picked on the map, which hides the form until it is; a
 * `number` param is typed, its default shown while empty. Start gives the order with the values,
 * Cancel gives nothing.
 */
export function StartParamsForm({
  script,
  params,
  values,
  target,
  label,
  canStart,
  error,
  onPick,
  onChange,
  onStart,
  onCancel,
  fromWorkplace,
}: {
  /** The name of the script about to start. */
  script: string
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
  return (
    <div className="hud-backdrop">
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
        {fromWorkplace && (
          <p className="muted small">
            Filled in from the workplace’s Work settings. What you change here is this resident’s
            own and stays when the workplace’s settings change.
          </p>
        )}
        <div className="script-params" aria-label="Script parameters">
          {params.map((p) => {
            const value = values[p.name]
            if (p.type === 'number') {
              const n = typeof value === 'number' ? value : undefined
              return (
                <label key={p.name} className="goods-row">
                  <ParamName param={p} />
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
                </label>
              )
            }
            const id = typeof value === 'string' ? value : undefined
            const none =
              p.name === target
                ? 'the one they stand on'
                : (paramNote(p.description).unset ?? 'none picked')
            const shown = id === undefined ? none : (label(id) ?? 'out of sight')
            return (
              <div key={p.name} className="goods-row">
                <ParamName param={p} />
                <span className={id === undefined ? 'muted small' : 'small'}>{shown}</span>
                <span className="buttons">
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
                </span>
              </div>
            )
          })}
        </div>
        {foodHint && <p className="muted small">{foodHint}</p>}
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
