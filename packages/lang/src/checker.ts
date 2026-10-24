// A static check over a parsed script: names that are declared nowhere, calls with the wrong
// number of arguments, and fields an object of a known shape doesn't have. Its findings are
// warnings, never errors: wherever it isn't sure, it stays quiet. It knows nothing of the game:
// the names a script gets and the shapes of their values are passed in.

import type { BlockStatement, Expression, Program, Statement } from './ast.js'
import type { Diagnostic } from './index.js'

/** What the checker knows of a value: nothing, a list of something, or an object of a shape. */
export type CheckedType = 'unknown' | { list: CheckedType } | { shape: string }

/** A name every script gets: a value of a type, or a function with parameters and a result. */
export interface CheckedGlobal {
  /** The value's type, or what the function answers. */
  type: CheckedType
  /** For a function: its parameters, a `?` marking one that may be left out. */
  params?: readonly string[]
}

export interface CheckEnv {
  globals: Readonly<Record<string, CheckedGlobal>>
  /** The fields of each object shape by name, with the type each holds. */
  shapes: Readonly<Record<string, Readonly<Record<string, CheckedType>>>>
  /** How a shape is named in a warning, like "a resident"; `a <name>` without it. */
  describeShape?: (shape: string) => string
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

const UNKNOWN: CheckedType = 'unknown'

class Scope {
  readonly names = new Map<string, CheckedType>()
  constructor(readonly parent: Scope | null) {}

  lookup(name: string): CheckedType | undefined {
    return this.names.get(name) ?? this.parent?.lookup(name)
  }
}

/** Every name assigned to with `name = …` anywhere: what they hold isn't certain. */
function reassignedNames(program: Program): Set<string> {
  const out = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    const n = node as { kind?: string; target?: { kind: string; name?: string } }
    if (n.kind === 'Assign' && n.target?.kind === 'Identifier') out.add(n.target.name!)
    for (const value of Object.values(node)) visit(value)
  }
  visit(program.body)
  return out
}

class Checker {
  readonly warnings: Diagnostic[] = []
  readonly reads: FieldRead[] = []
  private readonly reassigned: Set<string>

  constructor(
    private readonly env: CheckEnv,
    program: Program,
  ) {
    this.reassigned = reassignedNames(program)
  }

  private warn(message: string, at: { line: number; column: number }): void {
    this.warnings.push({ message, line: at.line, column: at.column })
  }

  private describe(shape: string): string {
    return this.env.describeShape?.(shape) ?? `a ${shape}`
  }

  /**
   * A block's statements in their own scope. Every name the block declares counts from its
   * start, so a function may use a `let` declared after it, as it can when called later.
   */
  block(body: Statement[], scope: Scope): void {
    for (const s of body) {
      if (s.kind === 'Let' || s.kind === 'FunctionDeclaration') scope.names.set(s.name, UNKNOWN)
    }
    for (const s of body) this.statement(s, scope)
  }

  private body(block: BlockStatement, scope: Scope): void {
    this.block(block.body, new Scope(scope))
  }

  private statement(s: Statement, scope: Scope): void {
    switch (s.kind) {
      case 'Let': {
        const type = s.init ? this.expression(s.init, scope) : UNKNOWN
        scope.names.set(s.name, this.reassigned.has(s.name) ? UNKNOWN : type)
        return
      }
      case 'If':
        this.expression(s.test, scope)
        this.body(s.then, scope)
        if (s.else?.kind === 'If') this.statement(s.else, scope)
        else if (s.else) this.body(s.else, scope)
        return
      case 'While':
        this.expression(s.test, scope)
        this.body(s.body, scope)
        return
      case 'ForOf': {
        const list = this.expression(s.list, scope)
        const inner = new Scope(scope)
        const item = typeof list === 'object' && 'list' in list ? list.list : UNKNOWN
        inner.names.set(s.name, this.reassigned.has(s.name) ? UNKNOWN : item)
        this.body(s.body, inner)
        return
      }
      case 'FunctionDeclaration':
        this.function(s.params, s.body, scope)
        return
      case 'Return':
        if (s.value) this.expression(s.value, scope)
        return
      case 'Block':
        this.body(s, scope)
        return
      case 'ExpressionStatement':
        this.expression(s.expression, scope)
        return
    }
  }

  /** A function's body, with its parameters, whose values it can't know. */
  private function(params: string[], body: BlockStatement, scope: Scope): void {
    const inner = new Scope(scope)
    for (const p of params) inner.names.set(p, UNKNOWN)
    this.body(body, inner)
  }

  private expression(e: Expression, scope: Scope): CheckedType {
    switch (e.kind) {
      case 'Number':
      case 'String':
      case 'Boolean':
      case 'Null':
        return UNKNOWN
      case 'Identifier': {
        const local = scope.lookup(e.name)
        if (local !== undefined) return local
        const global = this.env.globals[e.name]
        if (!global) {
          this.warn(`Unknown name "${e.name}"`, e)
          return UNKNOWN
        }
        return global.params ? UNKNOWN : global.type
      }
      case 'List':
        for (const item of e.items) this.expression(item, scope)
        return UNKNOWN
      case 'Object':
        for (const p of e.properties) this.expression(p.value, scope)
        return UNKNOWN
      case 'FunctionExpression':
        this.function(e.params, e.body, scope)
        return UNKNOWN
      case 'Unary':
        this.expression(e.operand, scope)
        return UNKNOWN
      case 'Binary':
      case 'Logical':
        this.expression(e.left, scope)
        this.expression(e.right, scope)
        return UNKNOWN
      case 'Assign':
        // A field written is the script's own business; reading it is what is checked.
        if (e.target.kind === 'Identifier') this.expression(e.target, scope)
        else {
          this.expression(e.target.object, scope)
          if (e.target.kind === 'Index') this.expression(e.target.index, scope)
        }
        this.expression(e.value, scope)
        return UNKNOWN
      case 'Member': {
        const object = this.expression(e.object, scope)
        const at = { line: e.propertyLine, column: e.propertyColumn }
        if (typeof object === 'object' && 'list' in object) {
          if (e.property !== 'length') this.warn(`A list has no "${e.property}"`, at)
          return UNKNOWN
        }
        if (typeof object !== 'object') return UNKNOWN
        const fields = this.env.shapes[object.shape]
        if (!fields) return UNKNOWN
        const declared = Object.hasOwn(fields, e.property)
        this.reads.push({ shape: object.shape, field: e.property, declared, ...at })
        if (!declared) {
          this.warn(`"${e.property}" is not a field of ${this.describe(object.shape)}`, at)
          return UNKNOWN
        }
        return fields[e.property]!
      }
      case 'Index': {
        const object = this.expression(e.object, scope)
        this.expression(e.index, scope)
        return typeof object === 'object' && 'list' in object ? object.list : UNKNOWN
      }
      case 'Call': {
        for (const arg of e.args) this.expression(arg, scope)
        const callee = e.callee
        if (callee.kind === 'Identifier' && scope.lookup(callee.name) === undefined) {
          const global = this.env.globals[callee.name]
          if (global?.params) {
            this.arguments(callee.name, global.params, e.args.length, e)
            return global.type
          }
        }
        this.expression(callee, scope)
        return UNKNOWN
      }
    }
  }

  private arguments(
    name: string,
    params: readonly string[],
    given: number,
    at: { line: number; column: number },
  ): void {
    const least = params.filter((p) => !p.endsWith('?')).length
    if (given >= least && given <= params.length) return
    const count = least === params.length ? `${least}` : `${least} to ${params.length}`
    const names = params.length > 0 ? ` (${params.join(', ')})` : ''
    this.warn(
      `"${name}" takes ${count} argument${params.length === 1 && least === 1 ? '' : 's'}${names}, not ${given}`,
      at,
    )
  }
}

/** Checks a parsed script against the names and shapes a script gets. */
export function checkProgram(program: Program, env: CheckEnv): CheckResult {
  const checker = new Checker(env, program)
  checker.block(program.body, new Scope(null))
  return { warnings: checker.warnings, reads: checker.reads }
}
