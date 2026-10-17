// The script language: lexer, parser and step-counting interpreter.
// Only the public surface exists so far; the implementation is the next piece of work.

export const LANGUAGE_VERSION = 1

export interface Diagnostic {
  message: string
  line: number
  column: number
}

/** Checks a script for syntax errors. Returns no diagnostics until the parser exists. */
export function checkScript(_source: string): Diagnostic[] {
  return []
}
