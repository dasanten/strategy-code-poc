import { useState } from 'react'
import type { ScriptParam, ScriptSummary, WorkplaceSettings } from '@csp/shared'
import { ScriptParamFields } from './ScriptParams.js'
import { workScriptOf, workScripts, workSettingsParams } from './work-settings-view.js'

/** Where the browser remembers whether the Player left Work settings open. */
const OPEN_KEY = 'csp.workSettingsOpen'

function remembered(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function remember(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch {
    // Without storage it just isn't remembered.
  }
}

/**
 * The Work settings panel on a workplace's or site's card (`CONTEXT.md`: Workplace settings):
 * the work script, picked from the Work default and the Player's scripts declaring
 * `param workplace: building`, and one field for each of its params as on the resident card,
 * each with its comment and the value it uses. Only the Player's realm sees them. Collapsed by
 * default; whether it was left open is remembered in the browser, so it stays open across a pick
 * on the map.
 */
export function WorkSettings({
  scripts,
  settings,
  label,
  picking,
  onScript,
  onPick,
  onNumber,
  onClear,
}: {
  /** The Player's script library. */
  scripts: readonly ScriptSummary[]
  /** The realm's settings for this building; none while nothing is set. */
  settings: WorkplaceSettings | undefined
  /** How a picked value is named; null when it is out of sight. */
  label: (id: string) => string | null
  /** The param whose value the map is waiting for, if any. */
  picking: string | undefined
  /** Switches the work script: its id, or null for the Work default. */
  onScript: (scriptId: number | null) => void
  /** Starts (or cancels) picking a param's value on the map. */
  onPick: (param: ScriptParam) => void
  onNumber: (name: string, value: number) => void
  onClear: (name: string) => void
}) {
  const [open, setOpen] = useState(remembered)
  const choices = workScripts(scripts)
  const script = workScriptOf(scripts, settings)
  const params = workSettingsParams(script)
  return (
    <div className="sel-info work-settings">
      <button
        type="button"
        className="sel-info-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          remember(!open)
        }}
      >
        <span aria-hidden="true">⚙</span> Work settings
        <span className="sel-more" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div aria-label="Work settings">
          <label className="goods-row">
            <span className="small">
              <strong>Work script</strong>
            </span>
            <select
              aria-label="Work script"
              value={script?.id ?? ''}
              disabled={choices.length === 0}
              onChange={(e) => {
                const picked = choices.find((s) => s.id === Number(e.currentTarget.value))
                onScript(!picked || picked.task === 'work' ? null : picked.id)
              }}
            >
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {params.length > 0 ? (
            <ScriptParamFields
              params={params}
              values={settings?.params ?? {}}
              label={label}
              picking={picking}
              onPick={onPick}
              onNumber={onNumber}
              onClear={onClear}
            />
          ) : (
            script && <p className="muted small">{script.name} takes no settings here.</p>
          )}
          <p className="muted small">Only your realm sees these.</p>
        </div>
      )}
    </div>
  )
}
