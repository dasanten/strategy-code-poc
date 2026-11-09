import { readFileSync } from 'node:fs'
import * as ts from '@csp/lang'
import {
  ARMY_SCRIPT_API as TS_ARMY_SCRIPT_API,
  DEFAULT_SCRIPTS as TS_DEFAULT_SCRIPTS,
  PARAM_DESCRIPTIONS as TS_PARAM_DESCRIPTIONS,
  RESIDENT_OR_ARMY as TS_RESIDENT_OR_ARMY,
  SCRIPT_API as TS_SCRIPT_API,
  SCRIPT_VIEWS as TS_SCRIPT_VIEWS,
  scriptCheckEnv,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ARMY_SCRIPT_API,
  checkGameNames,
  checkNames,
  checkScript,
  DEFAULT_SCRIPTS,
  KEYWORDS,
  loadLang,
  PARAM_DESCRIPTIONS,
  PARAMS_SHAPE,
  RESIDENT_OR_ARMY,
  SCRIPT_API,
  SCRIPT_VIEWS,
  ScriptSyntaxError,
  scriptParams,
  tokenize,
  type CheckEnv,
} from './index.js'

/**
 * The WebAssembly checker finds what `@csp/lang` finds (T88.3): every case of the language
 * fixtures (`crates/csp-sim/fixtures/lang/cases.json`, written from the frozen TypeScript), and the
 * game's own env against `scriptCheckEnv`. `lang-tests.test.ts` runs `packages/lang`'s tests
 * through it too.
 */
interface Case {
  from: string
  source: string
  env: string
  tokens?: unknown[]
  error?: unknown
  syntax: unknown[]
  warnings: unknown[]
  reads: unknown[]
}

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../crates/csp-sim/fixtures/lang/cases.json', import.meta.url),
    'utf8',
  ),
) as { envs: Record<string, CheckEnv>; cases: Case[] }

beforeAll(() => loadLang())

describe('the WebAssembly checker against the language fixtures', () => {
  it('has cases to run', () => {
    expect(fixture.cases.length).toBeGreaterThan(100)
  })

  it('finds the same tokens, syntax errors, warnings and reads on every case', () => {
    const differ: string[] = []
    for (const c of fixture.cases) {
      const same = (what: string, actual: unknown, expected: unknown) => {
        try {
          expect(actual).toEqual(expected)
        } catch {
          differ.push(`${c.from} ${JSON.stringify(c.source)}: ${what}`)
        }
      }
      let lexed: unknown
      try {
        lexed = { tokens: tokenize(c.source) }
      } catch (error) {
        if (!(error instanceof ScriptSyntaxError)) throw error
        lexed = { error: { message: error.message, line: error.line, column: error.column } }
      }
      same('tokens', lexed, c.tokens ? { tokens: c.tokens } : { error: c.error })
      same('syntax', checkScript(c.source), c.syntax)
      const names = checkNames(c.source, fixture.envs[c.env]!)
      same('warnings', names.warnings, c.warnings)
      same('reads', names.reads, c.reads)
    }
    expect(differ).toEqual([])
  })

  it('reads the same param lines as the TypeScript', () => {
    for (const c of fixture.cases) expect(scriptParams(c.source)).toEqual(ts.scriptParams(c.source))
  })
})

describe("the game's env", () => {
  const sources = [
    ...fixture.cases.map((c) => c.source),
    ...Object.values(DEFAULT_SCRIPTS).map((d) => d.source),
    'me.nam\nme.members\nfor (b of buildings()) { b.foo }\nwalkTo(1)\nparams.x',
  ]
  for (const defaultScript of [false, true]) {
    it(`checks as scriptCheckEnv({ defaultScript: ${defaultScript} }) does`, () => {
      const env = scriptCheckEnv({ defaultScript })
      for (const source of sources) {
        expect(checkGameNames(source, defaultScript), source).toEqual(ts.checkNames(source, env))
      }
    })
  }
})

describe('the script tables from Rust', () => {
  it('are the TypeScript ones', () => {
    expect(KEYWORDS).toEqual(ts.KEYWORDS)
    expect(PARAMS_SHAPE).toBe(ts.PARAMS_SHAPE)
    expect(RESIDENT_OR_ARMY).toBe(TS_RESIDENT_OR_ARMY)
    expect(PARAM_DESCRIPTIONS).toEqual(TS_PARAM_DESCRIPTIONS)
    expect(SCRIPT_VIEWS).toEqual(TS_SCRIPT_VIEWS)
    expect(SCRIPT_API).toEqual(TS_SCRIPT_API)
    expect(ARMY_SCRIPT_API).toEqual(TS_ARMY_SCRIPT_API)
    expect(DEFAULT_SCRIPTS).toEqual(TS_DEFAULT_SCRIPTS)
    expect(Object.keys(DEFAULT_SCRIPTS)).toEqual(Object.keys(TS_DEFAULT_SCRIPTS))
  })
})
