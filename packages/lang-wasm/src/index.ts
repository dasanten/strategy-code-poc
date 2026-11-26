import init, * as wasm from '../generated/csp_lang_wasm.js'
import type { ScriptParamType } from './script-data.js'

/**
 * The editor's script checker (ADR 0030): `csp-lang`'s, the server's own, compiled to
 * WebAssembly (`crates/csp-lang-wasm`, built by `pnpm wasm:build`). The module is fetched only
 * when `loadLang()` is first called, so the first paint doesn't wait for it; the checks below
 * are synchronous and throw until it has loaded.
 */
export * from './script-data.js'
export * from './rules.js'
export * from './areas.js'

/** A finding at a place in a script. */
export interface Diagnostic {
  message: string
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
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
 * Checks a script against the game's names and views (`CONTEXT.md`: Script view): warnings, and
 * the fields it reads of known shapes. Both APIs, `me` a resident or an army; a default script (it
 * has a task) gets the resident's API alone. A script with a syntax error gets none; that error is
 * `checkScript`'s.
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

/**
 * The game's rules, `csp-sim`'s own, from the same module (ADR 0045): those that take only
 * values are in `rules.ts`; a throwaway mirror of what the client sees that a world-reading rule
 * asks by coordinates (`docs/wasm-rules.md`).
 */

/**
 * What the client sees, kept in the module's memory: the server's `welcome` message goes in once,
 * each `tick` message after it, as the JSON text the socket brought: everything in sight, as a
 * `WorldState` the rules read (T122.4, `docs/wasm-rules.md`).
 */
export class WorldMirror {
  private readonly mirror = new (ready().WorldMirror)()

  /** Starts over from a `welcome` message's JSON. */
  welcome(json: string): void {
    this.mirror.welcome(json)
  }

  /** Takes in a `tick` message's JSON. */
  tick(json: string): void {
    this.mirror.tick(json)
  }

  /** How many things are in sight. */
  get count(): number {
    return this.mirror.count
  }

  /** The id of the building or construction site in sight whose footprint covers (x, y). */
  buildingAt(x: number, y: number): string | undefined {
    return this.mirror.buildingAt(x, y)
  }

  /**
   * About how many ticks until resident `id` arrives where they walk, ride or drive
   * (`arrivalTicks`, `crates/csp-lang-wasm/src/estimate_rules.rs`): `order` is a way to estimate in
   * place of their own, `ground` the ground of each tile of the path estimated, in its order (a
   * road over any terrain, Plains where unexplored). Undefined for a resident not in sight or
   * going nowhere. One call per way.
   */
  arrivalTicks(id: string, order: object | undefined, ground: Uint8Array): number | undefined {
    return this.mirror.arrivalTicks(id, order && JSON.stringify(order), ground)
  }

  /**
   * Calls the check on the world `name` (`crates/csp-lang-wasm/src/world_rules.rs`) with `args`,
   * which go across as JSON (`undefined` as `null`), and answers its JSON result. Throws for a
   * rule the module doesn't have or arguments it can't read.
   */
  rule<T>(name: string, ...args: unknown[]): T {
    return JSON.parse(this.mirror.rule(name, JSON.stringify(args.map((a) => a ?? null)))) as T
  }

  /** Many checks in one call, each `[name, args]`, answered in order (`rule`). */
  rules<T>(calls: readonly (readonly [string, readonly unknown[]])[]): T[] {
    const json = JSON.stringify(calls.map(([name, args]) => [name, args.map((a) => a ?? null)]))
    return JSON.parse(this.mirror.rules(json)) as T[]
  }

  /** Frees the module's memory for it. */
  free(): void {
    this.mirror.free()
  }
}
