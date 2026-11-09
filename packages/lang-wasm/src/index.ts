import init, * as wasm from '../generated/csp_lang_wasm.js'
import type { ScriptParamType } from './script-data.js'

/**
 * The editor's script checker (ADR 0030): `csp-lang`'s, the server's own, compiled to
 * WebAssembly (`crates/csp-lang-wasm`, built by `pnpm wasm:build`). The module is fetched only
 * when `loadLang()` is first called, so the first paint doesn't wait for it; the checks below
 * are synchronous and throw until it has loaded.
 */
export * from './script-data.js'

/** A finding at a place in a script. */
export interface Diagnostic {
  message: string
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
}

/** What the checker knows of a value: nothing, a list of something, or an object of a shape. */
export type CheckedType = 'unknown' | { list: CheckedType } | { shape: string }

/** The names and shapes a script is checked against. */
export interface CheckEnv {
  globals: Readonly<Record<string, { type: CheckedType; params?: readonly string[] }>>
  shapes: Readonly<Record<string, Readonly<Record<string, CheckedType>>>>
  /** What `params.name` holds for a `param` of each type; unknown without it. */
  paramTypes?: Readonly<Partial<Record<ScriptParamType, CheckedType>>>
  /** How a shape is named in a warning, like "a resident"; `a <name>` without it. */
  describeShape?: (shape: string) => string
  /** The same as words by shape name, as JSON carries them. */
  describedShapes?: Readonly<Record<string, string>>
}

/** A field read from an object whose shape the checker was sure of. */
export interface FieldRead {
  shape: string
  field: string
  /** Whether the shape has the field. */
  declared: boolean
  line: number
  column: number
}

export interface CheckResult {
  warnings: Diagnostic[]
  reads: FieldRead[]
}

/** A token with the line and column (both 1-based) where it starts. */
export type Token =
  | { type: 'number'; value: number; line: number; column: number }
  | {
      type: 'string' | 'identifier' | 'keyword' | 'punctuator'
      value: string
      line: number
      column: number
    }
  | { type: 'end'; line: number; column: number }

/** A `param` line with the comment at its end, if it has one. */
export interface ParamInfo {
  name: string
  type: ScriptParamType
  /** What it holds while none is set: a number, or one of `choices`. */
  default?: number | string
  /** A `choice` param's words. */
  choices?: string[]
  line: number
  column: number
  /** The `//` comment at the end of the line, without the slashes. */
  description?: string
}

/** A syntax error in a script, at the line and column (1-based) where it was found. */
export class ScriptSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message)
    this.name = 'ScriptSyntaxError'
  }
}

const WASM_URL = new URL('../generated/csp_lang_wasm_bg.wasm', import.meta.url)

/** The module's bytes in Node (Vitest), whose `fetch` reads no files; its URL in a browser. */
async function wasmSource(): Promise<URL | Uint8Array> {
  if (WASM_URL.protocol !== 'file:') return WASM_URL
  const fs = 'node:fs/promises'
  const { readFile } = (await import(/* @vite-ignore */ fs)) as {
    readFile(path: URL): Promise<Uint8Array>
  }
  return readFile(WASM_URL)
}

let loading: Promise<void> | undefined
let loaded = false

/** Loads the checker once; every call answers the same promise. */
export function loadLang(): Promise<void> {
  loading ??= wasmSource()
    .then((source) => init({ module_or_path: source }))
    .then(() => {
      loaded = true
    })
  return loading
}

// In Node (Vitest, tools) the module loads as this file is imported, so code that runs there,
// like the Wiki's tests, needs no `loadLang()`; a browser fetches it only on first use.
if (WASM_URL.protocol === 'file:') await loadLang()

/** Whether the checker has loaded, so the checks below can run. */
export function isLangLoaded(): boolean {
  return loaded
}

function ready(): typeof wasm {
  if (!loaded) throw new Error('@csp/lang-wasm is not loaded yet: await loadLang() first')
  return wasm
}

/** Checks a script for syntax errors; the parser stops at the first one, so there is at most one. */
export function checkScript(source: string): Diagnostic[] {
  return JSON.parse(ready().checkScript(source)) as Diagnostic[]
}

/**
 * Checks a script against the names and shapes it gets: warnings, and the fields it reads of
 * known shapes. A script with a syntax error gets none; that error is `checkScript`'s.
 */
export function checkNames(source: string, env: CheckEnv): CheckResult {
  const { describeShape, ...plain } = env
  const described = describeShape
    ? Object.fromEntries(Object.keys(env.shapes).map((s) => [s, describeShape(s)]))
    : undefined
  const json = JSON.stringify({
    ...plain,
    describedShapes: { ...described, ...env.describedShapes },
  })
  return JSON.parse(ready().checkNames(source, json)) as CheckResult
}

/**
 * `checkNames` against the game's names and views (`CONTEXT.md`: Script view): both APIs, `me` a
 * resident or an army; a default script (it has a task) gets the resident's API alone.
 */
export function checkGameNames(source: string, defaultScript: boolean): CheckResult {
  return JSON.parse(ready().checkGameNames(source, defaultScript)) as CheckResult
}

/** A script's tokens; throws a `ScriptSyntaxError` where it doesn't lex. */
export function tokenize(source: string): Token[] {
  const lexed = JSON.parse(ready().tokenize(source)) as
    { tokens: Token[] } | { error: { message: string; line: number; column: number } }
  if ('error' in lexed) {
    throw new ScriptSyntaxError(lexed.error.message, lexed.error.line, lexed.error.column)
  }
  return lexed.tokens
}

/** A script's `param` lines, each with the `//` comment at its end; none for a syntax error. */
export function scriptParams(source: string): ParamInfo[] {
  return JSON.parse(ready().scriptParams(source)) as ParamInfo[]
}
