import data from '../script-data.json'

/**
 * The game's script tables, as the Rust build writes them (`script-data.json`, from `csp-sim`'s
 * `script_tables.rs` and `default_scripts.rs` by `pnpm script-data:rust`; a Rust test fails while
 * the file is stale): the script views, both game APIs, what each param type accepts and each
 * task's default script (`CONTEXT.md`: Script view, Default script). Plain data, so nothing here
 * waits for the WebAssembly checker.
 */

/** A task the UI can give, which runs its default script (`CONTEXT.md`: Default script). */
export type Task = keyof typeof data.defaultScripts

/** The name of a script view (`CONTEXT.md`: Script view). */
export type ScriptViewName = keyof typeof data.scriptViews

/** A `param` line's type (`CONTEXT.md`: Script parameter). */
export type ScriptParamType = keyof typeof data.paramDescriptions

/** What a field holds or a game API name answers. */
export type ScriptType =
  'number' | 'string' | 'boolean' | 'any' | { view: ScriptViewName } | { list: ScriptType }

export interface ScriptField {
  name: string
  type: ScriptType
  description: string
  /** When the field is `null`; absent when it never is. */
  nullWhen?: string
}

export interface ScriptView {
  /** What the view is of, in words, for the Wiki and the editor. */
  description: string
  fields: readonly ScriptField[]
}

/** One name of the game API: a value, or a query or action called with its `params`. */
export interface ScriptBinding {
  name: string
  is: 'value' | 'query' | 'action'
  /** The arguments, by name; a `?` marks one that may be left out. */
  params: readonly string[]
  cost: number
  description: string
  returns: ScriptType
}

export interface DefaultScript {
  /** The task's name, as the UI shows it. */
  name: string
  source: string
}

/** The language's keywords. */
export const KEYWORDS: readonly string[] = data.keywords

/** The shape of `params`: the script's own `param` lines. */
export const PARAMS_SHAPE: string = data.paramsShape

/** The shape of `me` where it may be a resident or an army. */
export const RESIDENT_OR_ARMY: string = data.residentOrArmy

/** What each param type accepts, for the editor and the Wiki. */
export const PARAM_DESCRIPTIONS: Readonly<Record<ScriptParamType, string>> = data.paramDescriptions

/** Every script view by name. */
export const SCRIPT_VIEWS = data.scriptViews as Readonly<Record<ScriptViewName, ScriptView>>

/** The game API a resident's script gets. */
export const SCRIPT_API = data.scriptApi as readonly ScriptBinding[]

/** The game API an army's script gets: the same values and queries, but army actions. */
export const ARMY_SCRIPT_API = data.armyScriptApi as readonly ScriptBinding[]

/** Each task's default script, in the order of the tasks. */
export const DEFAULT_SCRIPTS: Readonly<Record<Task, DefaultScript>> = data.defaultScripts
