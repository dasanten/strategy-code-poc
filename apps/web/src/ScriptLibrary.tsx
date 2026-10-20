import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { checkScript } from '@csp/lang'
import { SCRIPT_NAME_MAX_LENGTH, type ScriptDetail, type ScriptSummary } from '@csp/shared'
import { api } from './api.js'
import { ScriptEditor } from './ScriptEditor.js'
import {
  canMakeActive,
  describeDiagnostic,
  hasUnsavedChanges,
  savedMessage,
  versionStatus,
} from './script-editor.js'

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
}: {
  /** Hears the list each time it is loaded, so residents can be given a script to run. */
  onScripts?: (scripts: ScriptSummary[]) => void
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
    <section className="editor-panel script-library" aria-label="Scripts">
      <div className="panel-head">
        <h2>Scripts</h2>
        <select
          aria-label="Open a script"
          value={script?.id ?? ''}
          onChange={(e) => (e.target.value ? open(Number(e.target.value)) : startNew())}
        >
          <option value="">New script…</option>
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.activeVersion === null ? ' (none active)' : ''}
            </option>
          ))}
        </select>
      </div>

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
              <span className="spacer" />
              <button type="button" onClick={() => setRename(script.name)}>
                Rename
              </button>
              <button type="button" onClick={remove}>
                Delete
              </button>
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

      <ScriptEditor key={opened.key} initialSource={opened.source} onChange={setDraft} />
      <p className="diagnostics">
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
      {message && <p className="script-message">{message}</p>}
      {error && <p className="error">{error}</p>}

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
                    <time dateTime={new Date(v.savedAt * 1000).toISOString()}>
                      {new Date(v.savedAt * 1000).toLocaleString()}
                    </time>
                    <em title={v.errors.map(describeDiagnostic).join('\n') || undefined}>
                      {status}
                    </em>
                  </span>
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
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
