// The script language: lexer, parser and step-counting interpreter (ADR 0001).

import { checkProgram, type CheckEnv, type CheckResult } from './checker.js'
import { ScriptSyntaxError } from './lexer.js'
import { parse } from './parser.js'

export {
  checkProgram,
  type CheckEnv,
  type CheckResult,
  type CheckedGlobal,
  type CheckedType,
  type FieldRead,
} from './checker.js'
export type * from './ast.js'
export { KEYWORDS, type Keyword, ScriptSyntaxError, tokenize, type Token } from './lexer.js'
export { MAX_NESTING, parse } from './parser.js'
export {
  MAX_EVALUATION_DEPTH,
  NativeFunction,
  run,
  type RunOptions,
  type RunResult,
  ScriptFunction,
  type ScriptObject,
  ScriptRuntimeError,
  truthy,
  type Value,
} from './interpreter.js'

export const LANGUAGE_VERSION = 1

export interface Diagnostic {
  message: string
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
}

/**
 * Checks a script against the names and shapes it gets (`checkProgram`): warnings, and the
 * fields it reads of known shapes. A script with a syntax error gets none; that error is
 * `checkScript`'s.
 */
export function checkNames(source: string, env: CheckEnv): CheckResult {
  let program
  try {
    program = parse(source)
  } catch (error) {
    if (error instanceof ScriptSyntaxError) return { warnings: [], reads: [] }
    throw error
  }
  return checkProgram(program, env)
}

/** Checks a script for syntax errors. The parser stops at the first one, so there is at most one. */
export function checkScript(source: string): Diagnostic[] {
  try {
    parse(source)
    return []
  } catch (error) {
    if (error instanceof ScriptSyntaxError) {
      return [{ message: error.message, line: error.line, column: error.column }]
    }
    throw error
  }
}
