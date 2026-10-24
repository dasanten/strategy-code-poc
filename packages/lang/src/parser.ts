// The recursive-descent parser: turns tokens into a syntax tree (ADR 0001, version 1).
// Semicolons between statements are optional.

import type {
  AssignTarget,
  BinaryOperator,
  BlockStatement,
  Expression,
  IfStatement,
  ObjectProperty,
  Program,
  Statement,
} from './ast.js'
import { type Keyword, type Punctuator, ScriptSyntaxError, type Token, tokenize } from './lexer.js'

/**
 * How deeply blocks and expressions may nest. It keeps the parser from running out of stack on
 * a hostile script; real scripts stay far below it.
 */
export const MAX_NESTING = 200

/** Binary operators by precedence, lowest first. Each level is left-associative. */
const BINARY_LEVELS: readonly (readonly BinaryOperator[])[] = [
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
]

/** Parses a script into a syntax tree. Throws a `ScriptSyntaxError`. */
export function parse(source: string): Program {
  return new Parser(tokenize(source)).program()
}

class Parser {
  private pos = 0
  private depth = 0

  constructor(private readonly tokens: Token[]) {}

  program(): Program {
    const body: Statement[] = []
    while (this.peek().type !== 'end') body.push(this.statement())
    return { kind: 'Program', body }
  }

  // --- statements ---

  private statement(): Statement {
    return this.nested(() => {
      const token = this.peek()
      let statement: Statement
      if (this.isKeyword('let')) statement = this.letStatement()
      else if (this.isKeyword('if')) statement = this.ifStatement()
      else if (this.isKeyword('while')) statement = this.whileStatement()
      else if (this.isKeyword('for')) statement = this.forStatement()
      else if (this.isKeyword('fn') && this.peek(1).type === 'identifier') {
        statement = this.functionDeclaration()
      } else if (this.isKeyword('return')) statement = this.returnStatement()
      else if (this.isPunctuator('{')) statement = this.block()
      else {
        const expression = this.expression()
        statement = { kind: 'ExpressionStatement', expression, ...at(token) }
      }
      this.matchPunctuator(';')
      return statement
    })
  }

  private letStatement(): Statement {
    const start = this.expectKeyword('let')
    const name = this.expectIdentifier('a name after "let"')
    const init = this.matchPunctuator('=') ? this.expression() : null
    return { kind: 'Let', name, init, ...at(start) }
  }

  private ifStatement(): IfStatement {
    const start = this.expectKeyword('if')
    const test = this.condition('if')
    const then = this.block()
    let otherwise: IfStatement['else'] = null
    if (this.matchKeyword('else')) {
      otherwise = this.isKeyword('if') ? this.nested(() => this.ifStatement()) : this.block()
    }
    return { kind: 'If', test, then, else: otherwise, ...at(start) }
  }

  private whileStatement(): Statement {
    const start = this.expectKeyword('while')
    const test = this.condition('while')
    return { kind: 'While', test, body: this.block(), ...at(start) }
  }

  private forStatement(): Statement {
    const start = this.expectKeyword('for')
    this.expectPunctuator('(', 'after "for"')
    if (this.isKeyword('let')) {
      throw this.error(this.peek(), 'Write "for (x of list)" without "let"')
    }
    const name = this.expectIdentifier('a name in "for (x of list)"')
    this.expectKeyword('of', 'in "for (x of list)"')
    const list = this.expression()
    this.expectPunctuator(')', 'to close "for (x of list)"')
    return { kind: 'ForOf', name, list, body: this.block(), ...at(start) }
  }

  private functionDeclaration(): Statement {
    const start = this.expectKeyword('fn')
    const name = this.expectIdentifier('a function name after "fn"')
    const params = this.params()
    return { kind: 'FunctionDeclaration', name, params, body: this.block(), ...at(start) }
  }

  private returnStatement(): Statement {
    const start = this.expectKeyword('return')
    const next = this.peek()
    // A value only counts if it starts on the same line, as in JavaScript.
    const hasValue =
      next.type !== 'end' &&
      next.line === start.line &&
      !(next.type === 'punctuator' && (next.value === ';' || next.value === '}'))
    return { kind: 'Return', value: hasValue ? this.expression() : null, ...at(start) }
  }

  private block(): BlockStatement {
    const start = this.expectPunctuator('{', 'to start a block')
    const body: Statement[] = []
    while (!this.isPunctuator('}')) {
      if (this.peek().type === 'end') {
        throw this.error(this.peek(), `The "{" on line ${start.line} is never closed with "}"`)
      }
      body.push(this.statement())
    }
    this.advance()
    return { kind: 'Block', body, ...at(start) }
  }

  private condition(keyword: Keyword): Expression {
    this.expectPunctuator('(', `after "${keyword}"`)
    const test = this.expression()
    this.expectPunctuator(')', `to close the "${keyword}" condition`)
    return test
  }

  private params(): string[] {
    this.expectPunctuator('(', 'before the parameters')
    const params: string[] = []
    while (!this.isPunctuator(')')) {
      const token = this.peek()
      const name = this.expectIdentifier('a parameter name')
      if (params.includes(name)) throw this.error(token, `The parameter "${name}" appears twice`)
      params.push(name)
      if (!this.matchPunctuator(',')) break
    }
    this.expectPunctuator(')', 'to close the parameters')
    return params
  }

  // --- expressions, lowest precedence first ---

  private expression(): Expression {
    return this.nested(() => this.assignment())
  }

  private assignment(): Expression {
    const left = this.logicalOr()
    if (!this.isPunctuator('=')) return left
    const equals = this.advance()
    if (left.kind !== 'Identifier' && left.kind !== 'Member' && left.kind !== 'Index') {
      throw this.error(equals, 'Only a name, "a.b" or "a[i]" can be assigned to')
    }
    const target: AssignTarget = left
    // Right-associative: `a = b = 1` sets both.
    const value = this.expression()
    return { kind: 'Assign', target, value, line: left.line, column: left.column }
  }

  private logicalOr(): Expression {
    let left = this.logicalAnd()
    while (this.matchPunctuator('||')) {
      const right = this.logicalAnd()
      left = { kind: 'Logical', operator: '||', left, right, line: left.line, column: left.column }
    }
    return left
  }

  private logicalAnd(): Expression {
    let left = this.binary(0)
    while (this.matchPunctuator('&&')) {
      const right = this.binary(0)
      left = { kind: 'Logical', operator: '&&', left, right, line: left.line, column: left.column }
    }
    return left
  }

  private binary(level: number): Expression {
    const operators = BINARY_LEVELS[level]
    if (!operators) return this.unary()
    let left = this.binary(level + 1)
    for (;;) {
      const token = this.peek()
      const operator = operators.find((op) => token.type === 'punctuator' && token.value === op)
      if (!operator) return left
      this.advance()
      const right = this.binary(level + 1)
      left = { kind: 'Binary', operator, left, right, line: left.line, column: left.column }
    }
  }

  private unary(): Expression {
    const token = this.peek()
    if (token.type === 'punctuator' && (token.value === '!' || token.value === '-')) {
      this.advance()
      const operand = this.nested(() => this.unary())
      return { kind: 'Unary', operator: token.value, operand, ...at(token) }
    }
    return this.postfix()
  }

  private postfix(): Expression {
    let expression = this.primary()
    for (;;) {
      const { line, column } = expression
      if (this.matchPunctuator('.')) {
        const { line: propertyLine, column: propertyColumn } = this.peek()
        const property = this.propertyName('a property name after "."')
        expression = {
          kind: 'Member',
          object: expression,
          property,
          propertyLine,
          propertyColumn,
          line,
          column,
        }
      } else if (this.matchPunctuator('[')) {
        const index = this.expression()
        this.expectPunctuator(']', 'to close "["')
        expression = { kind: 'Index', object: expression, index, line, column }
      } else if (this.matchPunctuator('(')) {
        const args = this.list(')', 'to close the arguments')
        expression = { kind: 'Call', callee: expression, args, line, column }
      } else {
        return expression
      }
    }
  }

  private primary(): Expression {
    const token = this.peek()
    switch (token.type) {
      case 'number':
        this.advance()
        return { kind: 'Number', value: token.value, ...at(token) }
      case 'string':
        this.advance()
        return { kind: 'String', value: token.value, ...at(token) }
      case 'identifier':
        this.advance()
        return { kind: 'Identifier', name: token.value, ...at(token) }
      case 'keyword':
        if (token.value === 'true' || token.value === 'false') {
          this.advance()
          return { kind: 'Boolean', value: token.value === 'true', ...at(token) }
        }
        if (token.value === 'null') {
          this.advance()
          return { kind: 'Null', ...at(token) }
        }
        if (token.value === 'fn') {
          this.advance()
          const params = this.params()
          return { kind: 'FunctionExpression', params, body: this.block(), ...at(token) }
        }
        break
      case 'punctuator':
        if (token.value === '(') {
          this.advance()
          const inner = this.expression()
          this.expectPunctuator(')', 'to close "("')
          return inner
        }
        if (token.value === '[') {
          this.advance()
          return { kind: 'List', items: this.list(']', 'to close the list'), ...at(token) }
        }
        if (token.value === '{') {
          this.advance()
          return { kind: 'Object', properties: this.properties(), ...at(token) }
        }
        break
      case 'end':
        throw this.error(token, 'The script ends where a value was expected')
    }
    throw this.error(token, `Expected a value but found ${describe(token)}`)
  }

  /** Comma-separated expressions up to `close`; a trailing comma is allowed. */
  private list(close: Punctuator, what: string): Expression[] {
    const items: Expression[] = []
    while (!this.isPunctuator(close)) {
      items.push(this.expression())
      if (!this.matchPunctuator(',')) break
    }
    this.expectPunctuator(close, what)
    return items
  }

  private properties(): ObjectProperty[] {
    const properties: ObjectProperty[] = []
    while (!this.isPunctuator('}')) {
      const token = this.peek()
      let key: string
      if (token.type === 'string') {
        this.advance()
        key = token.value
      } else {
        key = this.propertyName('a key')
      }
      if (properties.some((p) => p.key === key)) {
        throw this.error(token, `The key "${key}" appears twice`)
      }
      this.expectPunctuator(':', `after the key "${key}"`)
      properties.push({ key, value: this.expression(), ...at(token) })
      if (!this.matchPunctuator(',')) break
    }
    this.expectPunctuator('}', 'to close the object')
    return properties
  }

  /** A name after `.` or as an object key; keywords are fine here (`a.of`, `{ if: 1 }`). */
  private propertyName(what: string): string {
    const token = this.peek()
    if (token.type === 'identifier' || token.type === 'keyword') {
      this.advance()
      return token.value
    }
    throw this.error(token, `Expected ${what} but found ${describe(token)}`)
  }

  // --- helpers ---

  private nested<T>(parse: () => T): T {
    if (++this.depth > MAX_NESTING) {
      throw this.error(this.peek(), `The script nests more than ${MAX_NESTING} levels deep`)
    }
    try {
      return parse()
    } finally {
      this.depth--
    }
  }

  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)]!
  }

  private advance(): Token {
    const token = this.peek()
    if (token.type !== 'end') this.pos++
    return token
  }

  private isKeyword(value: Keyword): boolean {
    const token = this.peek()
    return token.type === 'keyword' && token.value === value
  }

  private isPunctuator(value: Punctuator): boolean {
    const token = this.peek()
    return token.type === 'punctuator' && token.value === value
  }

  private matchKeyword(value: Keyword): boolean {
    if (!this.isKeyword(value)) return false
    this.advance()
    return true
  }

  private matchPunctuator(value: Punctuator): boolean {
    if (!this.isPunctuator(value)) return false
    this.advance()
    return true
  }

  private expectKeyword(value: Keyword, where = ''): Token {
    if (!this.isKeyword(value)) {
      const suffix = where ? ` ${where}` : ''
      throw this.error(
        this.peek(),
        `Expected "${value}"${suffix} but found ${describe(this.peek())}`,
      )
    }
    return this.advance()
  }

  private expectPunctuator(value: Punctuator, where: string): Token {
    if (!this.isPunctuator(value)) {
      throw this.error(
        this.peek(),
        `Expected "${value}" ${where} but found ${describe(this.peek())}`,
      )
    }
    return this.advance()
  }

  private expectIdentifier(what: string): string {
    const token = this.peek()
    if (token.type !== 'identifier') {
      throw this.error(token, `Expected ${what} but found ${describe(token)}`)
    }
    this.advance()
    return token.value
  }

  private error(token: Token, message: string): ScriptSyntaxError {
    return new ScriptSyntaxError(message, token.line, token.column)
  }
}

function at(token: Token): { line: number; column: number } {
  return { line: token.line, column: token.column }
}

function describe(token: Token): string {
  switch (token.type) {
    case 'end':
      return 'the end of the script'
    case 'number':
      return `the number ${token.value}`
    case 'string':
      return 'a string'
    case 'identifier':
      return `the name "${token.value}"`
    case 'keyword':
      return `"${token.value}"`
    case 'punctuator':
      return `"${token.value}"`
  }
}
