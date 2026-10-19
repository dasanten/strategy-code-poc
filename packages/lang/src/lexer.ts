// The lexer: turns script source into tokens, each with the line and column (1-based) it starts at.

export const KEYWORDS = [
  'let',
  'if',
  'else',
  'while',
  'for',
  'of',
  'fn',
  'return',
  'true',
  'false',
  'null',
] as const

export type Keyword = (typeof KEYWORDS)[number]

/** Operators and punctuation, longest first so `<=` wins over `<`. */
const PUNCTUATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  ',',
  ':',
  ';',
  '.',
  '=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
] as const

export type Punctuator = (typeof PUNCTUATORS)[number]

export type Token =
  | { type: 'number'; value: number; line: number; column: number }
  | { type: 'string'; value: string; line: number; column: number }
  | { type: 'identifier'; value: string; line: number; column: number }
  | { type: 'keyword'; value: Keyword; line: number; column: number }
  | { type: 'punctuator'; value: Punctuator; line: number; column: number }
  | { type: 'end'; line: number; column: number }

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

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  '"': '"',
  "'": "'",
}

const isDigit = (c: string) => c >= '0' && c <= '9'
const isIdentStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c)
const isKeyword = (word: string): word is Keyword => (KEYWORDS as readonly string[]).includes(word)

/** Splits source into tokens, ending with an `end` token. Throws a `ScriptSyntaxError`. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  let line = 1
  let lineStart = 0

  const column = () => pos - lineStart + 1
  const newline = () => {
    line++
    lineStart = pos
  }

  while (pos < source.length) {
    const c = source[pos]!

    if (c === '\n') {
      pos++
      newline()
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      pos++
      continue
    }

    // Comments: `// to the end of the line` and `/* across lines */`.
    if (c === '/' && source[pos + 1] === '/') {
      while (pos < source.length && source[pos] !== '\n') pos++
      continue
    }
    if (c === '/' && source[pos + 1] === '*') {
      const startLine = line
      const startColumn = column()
      pos += 2
      while (pos < source.length && !(source[pos] === '*' && source[pos + 1] === '/')) {
        pos++
        if (source[pos - 1] === '\n') newline()
      }
      if (pos >= source.length) {
        throw new ScriptSyntaxError('This comment is never closed with */', startLine, startColumn)
      }
      pos += 2
      continue
    }

    const startColumn = column()

    if (isDigit(c)) {
      const start = pos
      while (pos < source.length && isDigit(source[pos]!)) pos++
      if (source[pos] === '.' && isDigit(source[pos + 1] ?? '')) {
        pos++
        while (pos < source.length && isDigit(source[pos]!)) pos++
      }
      if (isIdentStart(source[pos] ?? '')) {
        throw new ScriptSyntaxError(`Unexpected "${source[pos]}" after a number`, line, column())
      }
      tokens.push({
        type: 'number',
        value: Number(source.slice(start, pos)),
        line,
        column: startColumn,
      })
      continue
    }

    if (isIdentStart(c)) {
      const start = pos
      while (pos < source.length && isIdentPart(source[pos]!)) pos++
      const word = source.slice(start, pos)
      tokens.push(
        isKeyword(word)
          ? { type: 'keyword', value: word, line, column: startColumn }
          : { type: 'identifier', value: word, line, column: startColumn },
      )
      continue
    }

    if (c === '"' || c === "'") {
      pos++
      let value = ''
      for (;;) {
        const ch = source[pos]
        if (ch === undefined || ch === '\n') {
          throw new ScriptSyntaxError(`This string is never closed with ${c}`, line, startColumn)
        }
        if (ch === c) {
          pos++
          break
        }
        if (ch === '\\') {
          const escaped = source[pos + 1]
          const replacement = escaped === undefined ? undefined : ESCAPES[escaped]
          if (replacement === undefined) {
            throw new ScriptSyntaxError(
              `Unknown escape "\\${escaped ?? ''}" in a string`,
              line,
              column(),
            )
          }
          value += replacement
          pos += 2
          continue
        }
        value += ch
        pos++
      }
      tokens.push({ type: 'string', value, line, column: startColumn })
      continue
    }

    const punctuator = PUNCTUATORS.find((p) => source.startsWith(p, pos))
    if (punctuator) {
      pos += punctuator.length
      tokens.push({ type: 'punctuator', value: punctuator, line, column: startColumn })
      continue
    }

    throw new ScriptSyntaxError(`Unexpected character "${c}"`, line, startColumn)
  }

  tokens.push({ type: 'end', line, column: column() })
  return tokens
}
