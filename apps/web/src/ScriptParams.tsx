import type { ScriptParam, ScriptParamType } from '@csp/shared'

/** What the map picks for a param of each type. */
const PICK_HINTS: Record<ScriptParamType, string> = {
  building: 'a building or construction site of yours',
  storage: 'a storage, a stable or a carriage of yours',
}

/**
 * One field for each `param` line of the script a resident runs (`CONTEXT.md`: Script
 * parameter): what is picked for them, a button to pick it on the map, filtered by the param's
 * type, and one to clear it. Shown on the resident card under the script they run.
 */
export function ScriptParamFields({
  params,
  values,
  label,
  picking,
  onPick,
  onClear,
}: {
  /** The running script's `param` lines. */
  params: readonly ScriptParam[]
  /** What is picked for this resident, by param name. */
  values: Readonly<Record<string, string>>
  /** How a picked value is named; null when it is out of sight. */
  label: (id: string) => string | null
  /** The param whose value the map is waiting for, if any. */
  picking: string | undefined
  /** Starts (or cancels) picking a param's value on the map. */
  onPick: (param: ScriptParam) => void
  /** Clears a param's value. */
  onClear: (name: string) => void
}) {
  if (params.length === 0) return null
  return (
    <div className="script-params" aria-label="Script parameters">
      {params.map((p) => {
        const id = values[p.name]
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
      {picking !== undefined && (
        <p className="muted small" role="status">
          Tap {PICK_HINTS[params.find((p) => p.name === picking)?.type ?? 'building']} on the map
          for {picking}.
        </p>
      )}
    </div>
  )
}
