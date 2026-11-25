import type {
  ScriptBinding,
  ScriptField,
  ScriptParamType,
  ScriptType,
  ScriptViewName,
  Task,
} from '@csp/shared-types'
import data from '../script-data.json'

export type { ScriptBinding, ScriptField, ScriptParamType, ScriptType, ScriptViewName, Task }

/**
 * The game's script tables, as the Rust build writes them (`script-data.json`, from `csp-sim`'s
 * `script_tables` and `default_scripts.rs` by `pnpm script-data:rust`; a Rust test fails while
 * the file is stale): the script views, both game APIs, what each param type accepts and each
 * task's default script (`CONTEXT.md`: Script view, Default script). Plain data, so nothing here
 * waits for the WebAssembly checker.
 */

export interface ScriptView {
  /** What the view is of, in words, for the Wiki and the editor. */
  description: string
  fields: readonly ScriptField[]
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

/** Script names are at most this many characters. */
export const SCRIPT_NAME_MAX_LENGTH: number = data.scriptNameMaxLength

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

/** The Orders tab heading a queue step is shown under (`CONTEXT.md`: Planner blocks). */
export type StepGroup = 'move' | 'work' | 'goods' | 'scripts' | 'flow'

/** What an order kind says about itself (`OrderMeta` in `csp-sim`), as far as the client reads it. */
export interface OrderKindFacts {
  kind: string
  /** It can be a step of a queue: a one-off action or task the UI gives, or running a script. */
  queueStep: boolean
  /** The group a queue step is shown under; null for a kind that is no queue step. */
  stepGroup: StepGroup | null
  /** As a queue step it never ends on its own. */
  neverEnds: boolean
  /** Running, it goes on until stopped. */
  goesOnUntilStopped: boolean
}

/** Every order kind's facts, as the server declares them. */
export const ORDER_KINDS = data.orderKinds as readonly OrderKindFacts[]

/** An order kind's facts, by its name; none for a kind the server doesn't know. */
export function orderKind(kind: string): OrderKindFacts | undefined {
  return ORDER_KINDS.find((k) => k.kind === kind)
}
