// The tree-walking interpreter (ADR 0001, `CONTEXT.md`: Step budget). It is pure: it reads and
// writes only the values it is given, so the same program, globals and budget always give the
// same result. Every evaluated node costs 1 step, a native function call costs its own `cost`
// on top, and the run stops when the budget is used up. What the script already did still counts.

import type {
  AssignExpression,
  BinaryExpression,
  BlockStatement,
  Expression,
  Position,
  Program,
  Statement,
} from './ast.js'

/** A value a script works with. Lists and objects are plain arrays and plain objects. */
export type Value =
  number | string | boolean | null | Value[] | ScriptObject | ScriptFunction | NativeFunction

export interface ScriptObject {
  [key: string]: Value
}

/** A function written in the script. */
export class ScriptFunction {
  constructor(
    readonly name: string,
    readonly params: readonly string[],
    readonly body: BlockStatement,
    /** @internal */ readonly scope: Scope,
  ) {}
}

/** A function the host gives the script, such as a game API action or query. */
export class NativeFunction {
  constructor(
    readonly name: string,
    readonly call: (args: Value[]) => Value,
    /** Extra steps one call costs, on top of the 1 every evaluated node costs. */
    readonly cost = 0,
  ) {}
}

/**
 * Thrown by a native function when the script used it wrong (say, a bad argument). The run
 * stops with an `error` result at the call. Anything else a native function throws is a bug in
 * the host and is passed on.
 */
export class ScriptRuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScriptRuntimeError'
  }
}

export interface RunOptions {
  /** The built-in globals, such as `me`, `memory` and the actions. Scripts can't reassign them. */
  globals: Readonly<Record<string, Value>>
  /** How many steps the script may use in this run. */
  steps: number
  /** How deeply script function calls may nest. */
  maxCallDepth: number
}

export type RunResult =
  | { status: 'done'; steps: number }
  /** Out of steps at this node, which did not run. */
  | ({ status: 'out-of-steps'; steps: number } & Position)
  | ({ status: 'error'; steps: number; message: string } & Position)

/**
 * How deeply evaluation may nest overall, counting every statement, expression and call. It keeps
 * the interpreter itself from running out of stack; real scripts stay far below it.
 */
export const MAX_EVALUATION_DEPTH = 1000

/** Runs a parsed script once. Never throws for anything the script does. */
export function run(program: Program, options: RunOptions): RunResult {
  const interpreter = new Interpreter(options)
  try {
    interpreter.program(program)
    return { status: 'done', steps: interpreter.steps }
  } catch (error) {
    if (error instanceof OutOfSteps) {
      return { status: 'out-of-steps', steps: interpreter.steps, ...where(error.at) }
    }
    if (error instanceof Failure) {
      return {
        status: 'error',
        steps: interpreter.steps,
        message: error.message,
        ...where(error.at),
      }
    }
    throw error
  }
}

function where(at: Position): Position {
  return { line: at.line, column: at.column }
}

/** A function body's `return`, unwinding to its call. At the top level it ends the run. */
class Return {
  constructor(readonly value: Value) {}
}

class OutOfSteps {
  constructor(readonly at: Position) {}
}

class Failure {
  constructor(
    readonly message: string,
    readonly at: Position,
  ) {}
}

interface Binding {
  value: Value
  readonly constant: boolean
}

class Scope {
  private readonly bindings = new Map<string, Binding>()

  constructor(readonly parent: Scope | null) {}

  declare(name: string, value: Value, constant = false): boolean {
    if (this.bindings.has(name)) return false
    this.bindings.set(name, { value, constant })
    return true
  }

  lookup(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.lookup(name)
  }
}

class Interpreter {
  steps = 0
  private depth = 0
  private callDepth = 0
  private readonly budget: number
  private readonly maxCallDepth: number
  private readonly globals: Scope

  constructor(options: RunOptions) {
    this.budget = options.steps
    this.maxCallDepth = options.maxCallDepth
    this.globals = new Scope(null)
    for (const [name, value] of Object.entries(options.globals)) {
      this.globals.declare(name, value, true)
    }
  }

  program(program: Program): void {
    try {
      this.statements(program.body, new Scope(this.globals))
    } catch (signal) {
      if (!(signal instanceof Return)) throw signal
    }
  }

  // --- bookkeeping ---

  private step(node: Position, cost = 1): void {
    if (this.steps + cost > this.budget) throw new OutOfSteps(node)
    this.steps += cost
  }

  /** Counts one step for `node` and evaluates it one level deeper. */
  private enter<T>(node: Position, evaluate: () => T): T {
    this.step(node)
    if (++this.depth > MAX_EVALUATION_DEPTH) {
      throw new Failure('The script nests too deeply', node)
    }
    try {
      return evaluate()
    } catch (error) {
      // The JavaScript stack ran out before our own cap: report it the same way.
      if (error instanceof RangeError && /call stack/i.test(error.message)) {
        throw new Failure('The script nests too deeply', node)
      }
      throw error
    } finally {
      this.depth--
    }
  }

  // --- statements ---

  private statements(body: Statement[], scope: Scope): void {
    // Functions can be called before their declaration, as long as it is in the same block.
    for (const statement of body) {
      if (statement.kind !== 'FunctionDeclaration') continue
      this.step(statement)
      const fn = new ScriptFunction(statement.name, statement.params, statement.body, scope)
      if (!scope.declare(statement.name, fn)) {
        throw new Failure(`"${statement.name}" is already declared here`, statement)
      }
    }
    for (const statement of body) {
      if (statement.kind !== 'FunctionDeclaration') this.statement(statement, scope)
    }
  }

  private statement(node: Statement, scope: Scope): void {
    this.enter(node, () => {
      switch (node.kind) {
        case 'Let': {
          const value = node.init ? this.expression(node.init, scope) : null
          if (!scope.declare(node.name, value)) {
            throw new Failure(`"${node.name}" is already declared here`, node)
          }
          return
        }
        case 'If': {
          if (truthy(this.expression(node.test, scope))) this.statement(node.then, scope)
          else if (node.else) this.statement(node.else, scope)
          return
        }
        case 'While': {
          while (truthy(this.expression(node.test, scope))) this.statement(node.body, scope)
          return
        }
        case 'ForOf': {
          const list = this.expression(node.list, scope)
          if (!Array.isArray(list)) {
            throw new Failure(`"for" needs a list, not ${describe(list)}`, node.list)
          }
          // A copy, so changing the list inside the loop doesn't change what it walks over.
          for (const item of [...list]) {
            const inner = new Scope(scope)
            inner.declare(node.name, item)
            this.statement(node.body, inner)
          }
          return
        }
        case 'FunctionDeclaration':
          return // Declared when its block starts.
        case 'Return':
          throw new Return(node.value ? this.expression(node.value, scope) : null)
        case 'Block':
          this.statements(node.body, new Scope(scope))
          return
        case 'ExpressionStatement':
          this.expression(node.expression, scope)
          return
      }
    })
  }

  // --- expressions ---

  private expression(node: Expression, scope: Scope): Value {
    return this.enter(node, () => {
      switch (node.kind) {
        case 'Number':
        case 'String':
        case 'Boolean':
          return node.value
        case 'Null':
          return null
        case 'Identifier': {
          const binding = scope.lookup(node.name)
          if (!binding) throw new Failure(`"${node.name}" is not defined`, node)
          return binding.value
        }
        case 'List':
          return node.items.map((item) => this.expression(item, scope))
        case 'Object': {
          const object: ScriptObject = Object.create(null) as ScriptObject
          for (const property of node.properties) {
            setOwn(object, property.key, this.expression(property.value, scope))
          }
          return object
        }
        case 'FunctionExpression':
          return new ScriptFunction('', node.params, node.body, scope)
        case 'Unary': {
          const operand = this.expression(node.operand, scope)
          if (node.operator === '!') return !truthy(operand)
          if (typeof operand !== 'number') {
            throw new Failure(`"-" needs a number, not ${describe(operand)}`, node)
          }
          return -operand
        }
        case 'Binary':
          return this.binary(node, scope)
        case 'Logical': {
          const left = this.expression(node.left, scope)
          if (node.operator === '&&' ? !truthy(left) : truthy(left)) return left
          return this.expression(node.right, scope)
        }
        case 'Assign':
          return this.assign(node, scope)
        case 'Member':
          return this.read(this.expression(node.object, scope), node.property, node)
        case 'Index': {
          const object = this.expression(node.object, scope)
          return this.read(object, this.expression(node.index, scope), node)
        }
        case 'Call': {
          const callee = this.expression(node.callee, scope)
          const args = node.args.map((arg) => this.expression(arg, scope))
          return this.call(callee, args, node)
        }
      }
    })
  }

  private binary(node: BinaryExpression, scope: Scope): Value {
    const left = this.expression(node.left, scope)
    const right = this.expression(node.right, scope)
    const op = node.operator
    if (op === '==') return left === right
    if (op === '!=') return left !== right
    if (op === '+' && (typeof left === 'string' || typeof right === 'string')) {
      return text(left, node) + text(right, node)
    }
    if (op === '<' || op === '<=' || op === '>' || op === '>=') {
      const comparable =
        (typeof left === 'number' && typeof right === 'number') ||
        (typeof left === 'string' && typeof right === 'string')
      if (!comparable) {
        throw new Failure(
          `"${op}" compares two numbers or two strings, not ${describe(left)} and ${describe(right)}`,
          node,
        )
      }
      const l = left as number | string
      const r = right as number | string
      if (op === '<') return l < r
      if (op === '<=') return l <= r
      if (op === '>') return l > r
      return l >= r
    }
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new Failure(
        `"${op}" needs two numbers, not ${describe(left)} and ${describe(right)}`,
        node,
      )
    }
    if ((op === '/' || op === '%') && right === 0) throw new Failure('Division by zero', node)
    const result =
      op === '+'
        ? left + right
        : op === '-'
          ? left - right
          : op === '*'
            ? left * right
            : op === '/'
              ? left / right
              : left % right
    if (!Number.isFinite(result)) throw new Failure('The number is too large', node)
    return result
  }

  private assign(node: AssignExpression, scope: Scope): Value {
    const target = node.target
    if (target.kind === 'Identifier') {
      const binding = scope.lookup(target.name)
      if (!binding) throw new Failure(`"${target.name}" is not defined`, target)
      if (binding.constant) throw new Failure(`"${target.name}" can't be changed`, target)
      const value = this.expression(node.value, scope)
      binding.value = value
      return value
    }
    const object = this.expression(target.object, scope)
    const key = target.kind === 'Member' ? target.property : this.expression(target.index, scope)
    const value = this.expression(node.value, scope)
    this.write(object, key, value, target)
    return value
  }

  private call(callee: Value, args: Value[], node: Position): Value {
    if (callee instanceof NativeFunction) {
      this.step(node, callee.cost)
      try {
        return callee.call(args) ?? null
      } catch (error) {
        if (error instanceof ScriptRuntimeError) throw new Failure(error.message, node)
        throw error
      }
    }
    if (!(callee instanceof ScriptFunction)) {
      throw new Failure(`${capitalised(describe(callee))} is not a function`, node)
    }
    if (args.length > callee.params.length) {
      const name = callee.name ? `"${callee.name}"` : 'The function'
      throw new Failure(
        `${name} takes ${callee.params.length} argument${callee.params.length === 1 ? '' : 's'}, not ${args.length}`,
        node,
      )
    }
    if (this.callDepth >= this.maxCallDepth) {
      throw new Failure(`Function calls nest more than ${this.maxCallDepth} deep`, node)
    }
    const scope = new Scope(callee.scope)
    callee.params.forEach((param, i) => scope.declare(param, args[i] ?? null))
    this.callDepth++
    try {
      this.statement(callee.body, scope)
      return null
    } catch (signal) {
      if (signal instanceof Return) return signal.value
      throw signal
    } finally {
      this.callDepth--
    }
  }

  // --- lists and objects ---

  private read(object: Value, key: Value, node: Position): Value {
    if (Array.isArray(object) || typeof object === 'string') {
      if (key === 'length') return object.length
      if (typeof key === 'number' && Array.isArray(object)) {
        if (!Number.isInteger(key)) throw new Failure(`A list index is a whole number`, node)
        return object[key] ?? null
      }
      throw new Failure(`${capitalised(describe(object))} has no ${describeKey(key)}`, node)
    }
    if (isObject(object)) {
      if (typeof key !== 'string') {
        throw new Failure(`An object's keys are strings, not ${describe(key)}`, node)
      }
      return Object.hasOwn(object, key) ? (object[key] ?? null) : null
    }
    throw new Failure(`Can't read ${describeKey(key)} of ${describe(object)}`, node)
  }

  private write(object: Value, key: Value, value: Value, node: Position): void {
    if (Array.isArray(object)) {
      if (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key > object.length) {
        throw new Failure(
          `A list of ${object.length} can be written at 0 to ${object.length}, not ${describe(key)}`,
          node,
        )
      }
      if (Object.isFrozen(object)) throw new Failure(`The list can't be changed`, node)
      object[key] = value
      return
    }
    if (isObject(object)) {
      if (typeof key !== 'string') {
        throw new Failure(`An object's keys are strings, not ${describe(key)}`, node)
      }
      if (Object.isFrozen(object)) throw new Failure(`The object can't be changed`, node)
      setOwn(object, key, value)
      return
    }
    throw new Failure(`Can't set ${describeKey(key)} of ${describe(object)}`, node)
  }
}

/** Sets an own property, even one called `__proto__`. */
function setOwn(object: ScriptObject, key: string, value: Value): void {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

function isObject(value: Value): value is ScriptObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ScriptFunction) &&
    !(value instanceof NativeFunction)
  )
}

/** `false`, `null`, `0` and `""` count as false; everything else as true. */
export function truthy(value: Value): boolean {
  return value !== false && value !== null && value !== 0 && value !== ''
}

function text(value: Value, node: Position): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value)
  }
  throw new Failure(`Only numbers, strings, booleans and null can be joined to a string`, node)
}

function describe(value: Value): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  if (value instanceof ScriptFunction || value instanceof NativeFunction) return 'a function'
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`
  return `the ${typeof value} ${String(value)}`
}

function describeKey(key: Value): string {
  return typeof key === 'string' ? `"${key}"` : describe(key)
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
