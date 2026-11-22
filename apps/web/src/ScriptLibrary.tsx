import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { checkScript, isLangLoaded, loadLang, SCRIPT_NAME_MAX_LENGTH } from '@csp/lang-wasm'
import type { ScriptDetail, ScriptSummary } from '@csp/shared-types'
import { api } from './api.js'
import { ScriptEditor } from './ScriptEditor.js'
import {
  canMakeActive,
  defaultStatus,
  describeDiagnostic,
  diagnosticsText,
  hasUnsavedChanges,
  lineDiff,
  olderVersions,
  savedMessage,
  scriptWarnings,
  versionStatus,
  type DiffLine,
} from './script-editor.js'
import {
  EMPTY_SCRIPT,
  SCRIPT_HELP_LINKS,
  templateChoices,
  templateName,
  templateSource,
  type TemplateChoice,
} from './script-templates.js'
import {
  libraryGroups,
  libraryLine,
  workshopSteps,
  type WorkshopStep,
} from './script-workshop-view.js'

/** How a default script stands against the game's default (`CONTEXT.md`: Default script). */
const DEFAULT_STATUS: Record<ReturnType<typeof defaultStatus>, string> = {
  follows: 'follows the game’s default',
  edited: 'edited by you',
  'default changed': 'edited by you · game’s default changed',
}

const DIFF_CLASS: Record<DiffLine['op'], string> = { ' ': '', '-': 'e', '+': 'add' }

/** A version's chip in History: green when it runs, red with syntax errors. */
const VERSION_CHIP: Record<ReturnType<typeof versionStatus>, string> = {
  active: 'chip g',
  'has errors': 'chip r',
  saved: 'chip',
}

/** Why Make active is greyed for a version that can't be made active. */
const NOT_ACTIVATABLE: Record<ReturnType<typeof versionStatus>, string | undefined> = {
  active: 'It is the active version',
  'has errors': 'A version with syntax errors never runs',
  saved: undefined,
}

/**
 * Whether the script checker (WebAssembly, `@csp/lang-wasm`) has loaded; it starts loading on
 * first use, and the component renders again once it has.
 */
function useLangLoaded(): boolean {
  const [loaded, setLoaded] = useState(isLangLoaded)
  useEffect(() => {
    if (loaded) return
    let live = true
    void loadLang().then(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [loaded])
  return loaded
}

const TEMPLATE_GROUPS: readonly TemplateChoice['group'][] = [
  'Start',
  'Your default scripts',
  'Example scripts (Wiki)',
]

/** The Wiki's Script language and Game API sections, each in a new tab, on the workshop's bar. */
function HelpLinks() {
  return (
    <>
      {SCRIPT_HELP_LINKS.map((l) => (
        <a key={l.href} className="btn sm dk" href={l.href} target="_blank" rel="noreferrer">
          {l.label}
        </a>
      ))}
    </>
  )
}

/** What the editor holds: its source and a key that changes whenever other source is opened. */
interface Opened {
  key: string
  source: string
  /** The saved version it holds; none for a new script. */
  version?: number
  /** Where to put the cursor, such as a runtime error's line. */
  line?: number
  column?: number
}

/**
 * A script to open, such as the one a resident's task runs; a new `at` opens it again. With a
 * `version` that version opens rather than the newest, and with a `line` the cursor goes there,
 * as for a script's last runtime error (`CONTEXT.md`: Debugging a script).
 */
export interface ScriptToOpen {
  id: number
  at: number
  version?: number
  line?: number
  column?: number
}

/**
 * The script workshop (ADR 0044; `CONTEXT.md`: Screen, Script): the Player's script library as a
 * screen of its own over the map. A bar with Back to the map and the Wiki's help; the library on
 * the left; the editor in the middle, where scripts are written, checked and saved as new
 * versions; History on the right, to open an earlier version, make it active again or delete old
 * ones, or for a new script the form that names and creates it. On a phone the three are steps.
 *
 * It stays mounted while closed, so the list loads before it opens (residents run scripts from
 * it) and the editor keeps what was typed.
 */
export function ScriptLibrary({
  open = true,
  onClose,
  onScripts,
  toOpen,
}: {
  /** Whether the workshop shows; closed it stays mounted, hidden. */
  open?: boolean
  /** Back to the map (or Escape). */
  onClose?: () => void
  /** Hears the list each time it is loaded, so residents can be given a script to run. */
  onScripts?: (scripts: ScriptSummary[]) => void
  /** A script to open, such as the one a resident's task runs. */
  toOpen?: ScriptToOpen
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
  const [opened, setOpened] = useState<Opened>({ key: 'new', source: EMPTY_SCRIPT })
  const [draft, setDraft] = useState(EMPTY_SCRIPT)
  const [newName, setNewName] = useState('')
  /** The template a new script starts from (`templateChoices`), by its value. */
  const [template, setTemplate] = useState('empty')
  const [rename, setRename] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<string>()
  /** The step shown on a phone, where the library, editor and History come one at a time. */
  const [step, setStep] = useState<WorkshopStep>('library')
  const langLoaded = useLangLoaded()

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

  function show(
    detail: ScriptDetail,
    version = detail.versions.at(-1),
    at?: Pick<Opened, 'line' | 'column'>,
  ) {
    setScript(detail)
    setRename(undefined)
    const source = version?.source ?? ''
    setOpened({
      key: `${detail.id}-${version?.version ?? 0}-${Date.now()}`,
      source,
      version: version?.version,
      ...at,
    })
    setDraft(source)
    setStep('editor')
  }

  async function openScript({ id, version, line, column }: ScriptToOpen) {
    const detail = await act(() => api.script(id))
    if (!detail) return
    // The version asked for, unless it is gone from the history: then the newest.
    const asked = detail.versions.find((v) => v.version === version)
    show(detail, asked, asked ? { line, column } : undefined)
  }

  useEffect(() => {
    if (toOpen) void openScript(toOpen)
    // Only a new request opens a script, not a new `openScript`.
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
    setTemplate('empty')
    setNewName('')
    setOpened({ key: `new-${Date.now()}`, source: EMPTY_SCRIPT })
    setDraft(EMPTY_SCRIPT)
    setMessage(undefined)
    // On a phone, the form first: what it starts from and its name.
    setStep('side')
  }

  /** Starts the new script over from a template, its name prefilled from it. */
  async function startFrom(choice: TemplateChoice) {
    const t = choice.template
    let source = templateSource(t)
    if (source === undefined && t.kind === 'mine') {
      const detail = await act(() => api.script(t.scriptId))
      if (!detail) return
      const active = detail.versions.find((v) => v.version === detail.activeVersion)
      source = (active ?? detail.versions.at(-1))?.source ?? ''
    }
    setTemplate(choice.value)
    setNewName(
      templateName(
        t,
        scripts.map((s) => s.name),
      ),
    )
    setOpened({ key: `new-${choice.value}-${Date.now()}`, source: source ?? '' })
    setDraft(source ?? '')
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    const detail = await act(() => api.createScript({ name: newName, source: draft }))
    if (!detail) return
    setNewName('')
    setScript(detail)
    setOpened((o) => ({ ...o, version: detail.latestVersion }))
    setMessage(savedMessage(detail))
    setStep('editor')
  }

  async function save() {
    if (!script) return
    const detail = await act(() => api.saveScript(script.id, draft))
    if (!detail) return
    setScript(detail)
    setOpened((o) => ({ ...o, version: detail.latestVersion }))
    setMessage(savedMessage(detail))
  }

  async function makeActive(version: number) {
    if (!script) return
    const detail = await act(() => api.activateScriptVersion(script.id, version))
    if (!detail) return
    setScript(detail)
    setMessage(`Version ${version} is active now.`)
  }

  /** Deletes one version for good (never the active one), once the Player confirms. */
  async function deleteVersion(version: number) {
    if (!script) return
    if (!window.confirm(`Delete version ${version} of ${script.name} for good?`)) return
    const detail = await act(() => api.deleteScriptVersion(script.id, version))
    if (!detail) return
    setScript(detail)
    setMessage(`Deleted version ${version}.`)
  }

  /** Deletes every version older than the active one, once the Player confirms. */
  async function deleteOlder() {
    if (!script) return
    const count = olderVersions(script).length
    const ok = window.confirm(
      `Delete the ${count} version${count === 1 ? '' : 's'} of ${script.name} older than the active version ${script.activeVersion} for good?`,
    )
    if (!ok) return
    const detail = await act(() => api.deleteOlderScriptVersions(script.id))
    if (!detail) return
    setScript(detail)
    setMessage(`Deleted the versions older than version ${detail.activeVersion}.`)
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
    if (done) {
      startNew()
      setStep('library')
    }
  }

  // Nothing to show until the checker has loaded, a moment after the library opens.
  const errors = langLoaded ? checkScript(draft) : []
  const warnings = langLoaded ? scriptWarnings(draft, script?.task != null) : []
  const unsaved = script ? hasUnsavedChanges(script.versions, draft) : true
  const choices = templateChoices(scripts)
  const fixedName = 'Default scripts can’t be renamed or deleted, only reset'

  return (
    <section className="workshop" aria-label="Script workshop" hidden={!open} data-step={step}>
      <header className="bar workshop-bar">
        <button type="button" className="btn sm dk" onClick={onClose}>
          « Back to the map<kbd className="k">Esc</kbd>
        </button>
        <span className="ic s24 i-code" aria-hidden="true" />
        <h1 className="px t18 workshop-title">Script workshop</h1>
        <span className="grow" />
        <HelpLinks />
      </header>

      {/* On a phone: the library, the editor and History as three steps. */}
      <div className="tabs workshop-steps" role="tablist" aria-label="Workshop steps">
        {workshopSteps(script !== undefined).map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={step === s.id}
            onClick={() => setStep(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="workshop-body">
        <nav className="workshop-library" aria-label="Script library">
          <div className="sec">
            <button
              type="button"
              className="btn pri fill"
              aria-current={!script || undefined}
              onClick={startNew}
            >
              <span className="ic s16 i-plus" aria-hidden="true" />
              New script
            </button>
          </div>
          <ul>
            {libraryGroups(scripts).map((g) => (
              <Fragment key={g.label}>
                <li className="rw grp">
                  <span className="lb grow">{g.label}</span>
                </li>
                {g.scripts.map((s) => {
                  const picked = script?.id === s.id
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={`rw workshop-pick${picked ? ' sel' : ''}`}
                        aria-current={picked || undefined}
                        onClick={() => openScript({ id: s.id, at: Date.now() })}
                      >
                        <span className="grow">
                          <span className="b workshop-name">{s.name}</span>
                          <span className={s.activeVersion === null ? 'bad small' : 'mu small'}>
                            {libraryLine(s)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </Fragment>
            ))}
          </ul>
        </nav>

        <main className="workshop-editor">
          <div className="workshop-head">
            {!script ? (
              <span className="px t22">New script</span>
            ) : rename === undefined ? (
              <>
                <span className="px t22 workshop-name">{script.name}</span>
                <span className={script.activeVersion === null ? 'chip r' : 'chip g'}>
                  {script.activeVersion === null
                    ? 'no active version'
                    : `version ${script.activeVersion} active`}
                </span>
                {script.task && (
                  <span className={script.followsDefault ? 'chip' : 'chip y'}>
                    {DEFAULT_STATUS[defaultStatus(script)]}
                  </span>
                )}
                <span className="grow" />
                {script.task && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={reset}
                    disabled={script.followsDefault}
                    title={script.followsDefault ? 'It follows the game’s default' : undefined}
                  >
                    Reset to default
                  </button>
                )}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setRename(script.name)}
                  disabled={script.task !== null}
                  title={script.task !== null ? fixedName : undefined}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={remove}
                  disabled={script.task !== null}
                  title={script.task !== null ? fixedName : undefined}
                >
                  Delete
                </button>
              </>
            ) : (
              <form className="workshop-rename" onSubmit={submitRename}>
                <input
                  className="in"
                  aria-label="New name"
                  value={rename}
                  maxLength={SCRIPT_NAME_MAX_LENGTH}
                  onChange={(e) => setRename(e.target.value)}
                />
                <button type="submit" className="btn sm pri">
                  Rename
                </button>
                <button type="button" className="btn sm" onClick={() => setRename(undefined)}>
                  Cancel
                </button>
              </form>
            )}
          </div>

          {script?.gameDefault && defaultStatus(script) === 'default changed' && (
            <details className="workshop-diff" open>
              <summary className="b">
                The game’s default has changed since you edited yours.
              </summary>
              <pre className="code">
                {lineDiff(script.gameDefault.editedFrom ?? '', script.gameDefault.source).map(
                  (l, i) => (
                    <span key={i} className={DIFF_CLASS[l.op]}>
                      {l.op} {l.text}
                      {'\n'}
                    </span>
                  ),
                )}
              </pre>
              <p className="mu small">
                From the default you edited to the game’s default now. Reset to default to take it.
              </p>
            </details>
          )}
          <ScriptEditor
            key={opened.key}
            initialSource={opened.source}
            line={opened.line}
            column={opened.column}
            defaultScript={script?.task != null}
            onChange={setDraft}
          />
          <div className="workshop-foot">
            <div className="grow">
              <p
                className={`diagnostics mono${errors.length > 0 ? ' bad' : warnings.length > 0 ? ' warn' : ' ok'}`}
              >
                {langLoaded ? diagnosticsText(errors, warnings) : 'Checking…'}
              </p>
              {message && <p className="mu small">{message}</p>}
              {error && (
                <p className="bad small" role="alert">
                  {error}
                </p>
              )}
            </div>
            {script && (
              <button type="button" className="btn pri" onClick={save} disabled={!unsaved}>
                {unsaved ? `Save as version ${script.latestVersion + 1}` : 'Saved'}
              </button>
            )}
          </div>
        </main>

        <aside className="workshop-side" aria-label={script ? 'History' : 'New script'}>
          {script ? (
            <>
              <div className="sec">
                <span className="px t16">History</span>
                {olderVersions(script).length > 0 && (
                  <button type="button" className="btn sm" onClick={deleteOlder}>
                    Delete older versions
                  </button>
                )}
              </div>
              <ul>
                {[...script.versions].reverse().map((v) => {
                  const status = versionStatus(script, v)
                  return (
                    <li
                      key={v.version}
                      className={`rw workshop-version${opened.version === v.version ? ' sel' : ''}`}
                    >
                      <span className="grow">
                        <span className="b mono">v{v.version}</span>{' '}
                        <span
                          className={VERSION_CHIP[status]}
                          title={v.errors.map(describeDiagnostic).join('\n') || undefined}
                        >
                          {status}
                        </span>
                        <br />
                        <time
                          className="mu small"
                          dateTime={new Date(v.savedAt * 1000).toISOString()}
                        >
                          {new Date(v.savedAt * 1000).toLocaleString()}
                        </time>
                      </span>
                      <span className="workshop-version-actions">
                        <button type="button" className="btn sm" onClick={() => show(script, v)}>
                          Open
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => makeActive(v.version)}
                          disabled={!canMakeActive(script, v)}
                          title={NOT_ACTIVATABLE[status]}
                        >
                          Make active
                        </button>
                        {status !== 'active' && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => deleteVersion(v.version)}
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <form className="sec workshop-new" onSubmit={create}>
              <span className="px t16">New script</span>
              <label className="fld">
                <span className="lb">Start from</span>
                <select
                  className="in"
                  value={template}
                  onChange={(e) => {
                    const choice = choices.find((c) => c.value === e.target.value)
                    if (choice) void startFrom(choice)
                  }}
                >
                  {TEMPLATE_GROUPS.map((group) => (
                    <optgroup key={group} label={group}>
                      {choices
                        .filter((c) => c.group === group)
                        .map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span className="lb">Name</span>
                <span className="fx">
                  <input
                    className="in grow"
                    aria-label="Script name"
                    placeholder="Name"
                    value={newName}
                    maxLength={SCRIPT_NAME_MAX_LENGTH}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <button type="submit" className="btn pri" disabled={newName.trim() === ''}>
                    Create
                  </button>
                </span>
              </label>
              <p className="mu small">
                It starts from what the editor holds: pick a start above, or write it there.
              </p>
            </form>
          )}
        </aside>
      </div>
    </section>
  )
}
