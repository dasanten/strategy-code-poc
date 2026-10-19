// The script language: lexer, parser and step-counting interpreter (ADR 0001).

import { ScriptSyntaxError } from './lexer.js'
import { parse } from './parser.js'

export type * from './ast.js'
export { ScriptSyntaxError, tokenize, type Token } from './lexer.js'
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
