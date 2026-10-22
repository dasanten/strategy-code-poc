import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { checkScript } from '@csp/lang'
import { SCRIPT_NAME_MAX_LENGTH, type ScriptDetail, type ScriptSummary } from '@csp/shared'
import { api } from './api.js'
import { ScriptEditor } from './ScriptEditor.js'
import {
  canMakeActive,
  defaultStatus,
  describeDiagnostic,
  hasUnsavedChanges,
  lineDiff,
  savedMessage,
  versionStatus,
  type DiffLine,
} from './script-editor.js'

/** How a default script stands against the game's default (`CONTEXT.md`: Default script). */
const DEFAULT_STATUS: Record<ReturnType<typeof defaultStatus>, string> = {
  follows: 'follows the game’s default',
  edited: 'edited by you',
  'default changed': 'edited by you · game’s default changed',
}

const DIFF_CLASS: Record<DiffLine['op'], string> = { ' ': '', '-': 'removed', '+': 'added' }

const STARTER = `// Runs once a tick for each resident or army running it.
if (memory.role == null) { memory.role = "gatherer" }
`

/** What the editor holds: its source and a key that changes whenever other source is opened. */
interface Opened {
  key: string
  source: string
}

/**
 * The Player's script library (`CONTEXT.md`: Script): write and check scripts, save them as new
 * versions, browse a script's history and make an earlier version active again.
 */
export function ScriptLibrary({
  onScripts,
  toOpen,
}: {
  /** Hears the list each time it is loaded, so residents can be given a script to run. */
  onScripts?: (scripts: ScriptSummary[]) => void
  /** A script to open, such as the one a resident's task runs; a new `at` opens it again. */
  toOpen?: { id: number; at: number }
} = {}) {
  const [scripts, setListed] = useState<ScriptSummary[]>([])
  const setScripts = useCallback(
    (list: ScriptSummary[]) => {
      setListed(list)
      onScripts?.(list)
    },
    [onScripts],
  )
  const [script, setScript] = useState<ScriptDetail>()
  const [opened, setOpened] = useState<Opened>({ key: 'new', source: STARTER })
  const [draft, setDraft] = useState(STARTER)
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()

  /** Runs a library call, showing its error, and refreshes the list afterwards. */
  const act = useCallback(
    async <T,>(call: () => Promise<T>): Promise<T | undefined> => {
      setError(undefined)
      setMessage(undefined)
      try {
        return await call()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return undefined
      } finally {
        api.scripts().then(setScripts, () => {})
      }
    },
    [setScripts],
  )

  useEffect(() => {
    api.scripts().then(setScripts, (e: Error) => setError(e.message))
  }, [setScripts])

  function show(detail: ScriptDetail, version = detail.versions.at(-1)) {
    setScript(detail)
    setRename(undefined)
    const source = version?.source ?? ''
    setOpened({ key: `${detail.id}-${version?.version ?? 0}-${Date.now()}`, source })
    setDraft(source)
  }

  async function open(id: number) {
    const detail = await act(() => api.script(id))
    if (detail) show(detail)
  }

  useEffect(() => {
    if (toOpen) void open(toOpen.id)
    // Only a new request opens a script, not a new `open`.
  }, [toOpen])

  /** Resets a default script to the game's current default, once the Player confirms. */
  async function reset() {
    if (!script) return
    const ok = window.confirm(
      `Reset ${script.name} to the game’s default? Your versions stay in the history; the game’s default becomes the newest and runs from the next tick.`,
    )
    if (!ok) return
    const detail = await act(() => api.resetScript(script.id))
    if (!detail) return
    show(detail)
    setMessage(`Reset to the game’s default as version ${detail.latestVersion}.`)
  }

  function startNew() {
    setScript(undefined)
    setOpened({ key: `new-${Date.now()}`, source: STARTER })
    setDraft(STARTER)
    setMessage(undefined)
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    const detail = await act(() => api.createScript({ name: newName, source: draft }))
    if (!detail) return
    setNewName('')
    setScript(detail)
    setMessage(savedMessage(detail))
  }

  async function save() {
    if (!script) return
    const detail = await act(() => api.saveScript(script.id, draft))
    if (!detail) return
    setScript(detail)
    setMessage(savedMessage(detail))
  }

  async function makeActive(version: number) {
    if (!script) return
    const detail = await act(() => api.activateScriptVersion(script.id, version))
    if (!detail) return
    setScript(detail)
    setMessage(`Version ${version} is active now.`)
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault()
    if (!script || rename === undefined) return
    const detail = await act(() => api.renameScript(script.id, rename))
    if (!detail) return
    setScript(detail)
    setRename(undefined)
  }

  async function remove() {
    if (!script) return
    if (!window.confirm(`Delete the script ${script.name} with its whole history?`)) return
    const done = await act(async () => {
      await api.deleteScript(script.id)
      return true
    })
    if (done) startNew()
  }

  const errors = checkScript(draft)
  const unsaved = script ? hasUnsavedChanges(script.versions, draft) : true

  return (
    <section className="script-library" aria-label="Scripts">
      <nav className="script-list" aria-label="Script library">
        <h3>Library</h3>
        <ul>
          <li>
            <button
              type="button"
              className={script ? '' : 'on'}
              aria-current={!script || undefined}
              onClick={startNew}
            >
              + New script
            </button>
          </li>
          {scripts.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={script?.id === s.id ? 'on' : ''}
                aria-current={script?.id === s.id || undefined}
                onClick={() => open(s.id)}
              >
                <span>{s.name}</span>
                <small>
                  {s.task && (s.followsDefault ? 'game’s · ' : 'edited · ')}
                  {s.activeVersion === null ? 'none active' : `v${s.activeVersion}`}
                </small>
              </button>
            </li>
          ))}
        </ul>

        {script && script.versions.length > 0 && (
          <>
            <h3>History</h3>
            <ul className="script-history">
              {[...script.versions].reverse().map((v) => {
                const status = versionStatus(script, v)
                return (
                  <li key={v.version} className={status.replace(' ', '-')}>
                    <span>
                      <strong>v{v.version}</strong>
                      <em title={v.errors.map(describeDiagnostic).join('\n') || undefined}>
                        {status}
                      </em>
                      <time dateTime={new Date(v.savedAt * 1000).toISOString()}>
                        {new Date(v.savedAt * 1000).toLocaleString()}
                      </time>
                    </span>
                    <span className="script-history-actions">
                      <button type="button" onClick={() => show(script, v)}>
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => makeActive(v.version)}
                        disabled={!canMakeActive(script, v)}
                      >
                        Make active
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </nav>

      <div className="script-main">
        {script ? (
          <div className="script-head">
            {rename === undefined ? (
              <>
                <strong>{script.name}</strong>
                <span>
                  {script.activeVersion === null
                    ? 'no active version'
                    : `version ${script.activeVersion} active`}
                </span>
                {script.task && <span>{DEFAULT_STATUS[defaultStatus(script)]}</span>}
                <span className="spacer" />
                {script.task ? (
                  // A default script can't be renamed or deleted, only reset.
                  <button type="button" onClick={reset} disabled={script.followsDefault}>
                    Reset to default
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => setRename(script.name)}>
                      Rename
                    </button>
                    <button type="button" onClick={remove}>
                      Delete
                    </button>
                  </>
                )}
              </>
            ) : (
              <form onSubmit={submitRename}>
                <input
                  aria-label="New name"
                  value={rename}
                  maxLength={SCRIPT_NAME_MAX_LENGTH}
                  onChange={(e) => setRename(e.target.value)}
                />
                <button type="submit">Rename</button>
                <button type="button" onClick={() => setRename(undefined)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        ) : (
          <form className="script-head" onSubmit={create}>
            <input
              aria-label="Script name"
              placeholder="Name"
              value={newName}
              maxLength={SCRIPT_NAME_MAX_LENGTH}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className="primary" disabled={newName.trim() === ''}>
              Create
            </button>
          </form>
        )}

        {script?.gameDefault && defaultStatus(script) === 'default changed' && (
          <details className="default-changed">
            <summary>The game’s default has changed since you edited yours.</summary>
            <pre className="script-diff">
              {lineDiff(script.gameDefault.editedFrom ?? '', script.gameDefault.source).map(
                (l, i) => (
                  <span key={i} className={DIFF_CLASS[l.op]}>
                    {l.op} {l.text}
                    {'\n'}
                  </span>
                ),
              )}
            </pre>
            <p className="muted small">
              From the default you edited to the game’s default now. Reset to default to take it.
            </p>
          </details>
        )}
        <ScriptEditor key={opened.key} initialSource={opened.source} onChange={setDraft} />
        <div className="script-foot">
          <p className={`diagnostics${errors.length > 0 ? ' has-errors' : ''}`}>
            {errors.length === 0
              ? 'No syntax errors.'
              : errors.map(describeDiagnostic).join('\n') +
                '\nA version with syntax errors is kept but never runs.'}
          </p>
          {script && (
            <button type="button" className="primary" onClick={save} disabled={!unsaved}>
              {unsaved ? `Save as version ${script.latestVersion + 1}` : 'Saved'}
            </button>
          )}
        </div>
        {message && <p className="script-message">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  )
}
