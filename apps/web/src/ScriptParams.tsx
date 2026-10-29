import type { ScriptParam, ScriptParamType, ScriptParamValue } from '@csp/shared'
import { useRef } from 'react'
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

/**
 * One field for each `param` line of the script a resident runs (`CONTEXT.md`: Script
 * parameter): what is picked for them, a button to pick it on the map, filtered by the param's
 * type, and one to clear it; a number field for a `number` param, set once typed. Shown on the
 * resident card under the script they run.
 */
export function ScriptParamFields({
  params,
  values,
  label,
  picking,
  onPick,
  onNumber,
  onClear,
}: {
  /** The running script's `param` lines. */
  params: readonly ScriptParam[]
  /** What is picked for this resident, by param name. */
  values: Readonly<Record<string, ScriptParamValue>>
  /** How a picked value is named; null when it is out of sight. */
  label: (id: string) => string | null
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
        if (p.type === 'number') {
          const n = typeof value === 'number' ? value : undefined
          return (
            <div key={p.name} className="goods-row">
              <span className="small">
                <strong>{p.name}</strong> <span className="muted">(number)</span>
              </span>
              <NumberField
                // A new value from the server starts the field over.
                key={n ?? 'unset'}
                name={p.name}
                value={n}
                fallback={p.default}
                onSet={(v) => (v === undefined ? onClear(p.name) : onNumber(p.name, v))}
              />
              <span className="buttons">
                <button type="button" onClick={() => onClear(p.name)} disabled={n === undefined}>
                  Clear
                </button>
              </span>
            </div>
          )
        }
        const id = typeof value === 'string' ? value : undefined
        const shown = id === undefined ? 'none picked' : (label(id) ?? 'out of sight')
        return (
          <div key={p.name} className="goods-row">
            <span className="small">
              <strong>{p.name}</strong> <span className="muted">({p.type})</span>
            </span>
            <span className={id === undefined ? 'muted small' : 'small'}>{shown}</span>
            <span className="buttons">
              <button type="button" aria-pressed={picking === p.name} onClick={() => onPick(p)}>
                {picking === p.name ? 'Cancel' : 'Pick'}
              </button>
              <button type="button" onClick={() => onClear(p.name)} disabled={id === undefined}>
                Clear
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
  onSet,
}: {
  name: string
  value: number | undefined
  /** The param's default (`param name: number = 3`), shown while unset. */
  fallback?: number
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
      title={fallback === undefined ? undefined : `Default ${fallback}`}
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
  label,
  canStart,
  error,
  onPick,
  onChange,
  onStart,
  onCancel,
}: {
  /** The name of the script about to start. */
  script: string
  params: readonly ScriptParam[]
  /** What each param is set to now, by name; none while empty. */
  values: Readonly<Record<string, ScriptParamValue | undefined>>
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
        <div className="script-params" aria-label="Script parameters">
          {params.map((p) => {
            const value = values[p.name]
            if (p.type === 'number') {
              const n = typeof value === 'number' ? value : undefined
              return (
                <label key={p.name} className="goods-row">
                  <span className="small">
                    <strong>{p.name}</strong> <span className="muted">(number)</span>
                  </span>
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
            const shown = id === undefined ? 'none picked' : (label(id) ?? 'out of sight')
            return (
              <div key={p.name} className="goods-row">
                <span className="small">
                  <strong>{p.name}</strong> <span className="muted">({p.type})</span>
                </span>
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
