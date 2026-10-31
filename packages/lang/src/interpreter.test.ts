import { describe, expect, it } from 'vitest'
import {
  MAX_EVALUATION_DEPTH,
  NativeFunction,
  parse,
  run,
  type RunOptions,
  type RunResult,
  ScriptRuntimeError,
  type ScriptObject,
  type Value,
} from './index.js'

const BUDGET = 100_000
const CALL_DEPTH = 50
const LIMITS = { maxStringLength: 1000, maxListLength: 100, maxObjectKeys: 50 }

/** Runs a script with an `out(value)` global and returns what it printed and the result. */
function exec(source: string, options: Partial<RunOptions> = {}) {
  const printed: Value[] = []
  const out = new NativeFunction('out', (args) => {
    printed.push(args[0] ?? null)
    return null
  })
  const result = run(parse(source), {
    steps: BUDGET,
    maxCallDepth: CALL_DEPTH,
    limits: LIMITS,
    ...options,
    globals: { out, ...options.globals },
  })
  return { printed, result }
}

/** The value of one expression. */
function value(expression: string): Value {
  const { printed, result } = exec(`out(${expression})`)
  expect(result.status).toBe('done')
  return printed[0] ?? null
}

/** The error message a script stops with. */
function error(source: string, options: Partial<RunOptions> = {}): string {
  const { result } = exec(source, options)
  if (result.status !== 'error') throw new Error(`expected an error, got ${result.status}`)
  return result.message
}

describe('values and operators', () => {
  it('evaluates literals', () => {
    expect(value('42')).toBe(42)
    expect(value('"hi"')).toBe('hi')
    expect(value('true')).toBe(true)
    expect(value('null')).toBe(null)
    expect(value('[1, "a", null]')).toEqual([1, 'a', null])
    expect(value('{ a: 1, b: [2] }')).toEqual({ a: 1, b: [2] })
  })

  it('does arithmetic with precedence', () => {
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('(1 + 2) * 3')).toBe(9)
    expect(value('10 - 4 - 3')).toBe(3)
    expect(value('7 / 2')).toBe(3.5)
    expect(value('7 % 3')).toBe(1)
    expect(value('-(2 + 3)')).toBe(-5)
  })

  it('joins strings with numbers, booleans and null', () => {
    expect(value('"hp " + 3')).toBe('hp 3')
    expect(value('1 + "x"')).toBe('1x')
    expect(value('"a" + true + null')).toBe('atruenull')
    expect(error('"a" + [1]')).toMatch(/joined to a string/)
  })

  it('compares numbers and strings', () => {
    expect(value('1 < 2')).toBe(true)
    expect(value('2 <= 2')).toBe(true)
    expect(value('"b" > "a"')).toBe(true)
    expect(value('3 >= 4')).toBe(false)
    expect(error('1 < "2"')).toMatch(/compares two numbers or two strings/)
  })

  it('compares equality by value for plain values and by identity for lists and objects', () => {
    expect(value('1 == 1')).toBe(true)
    expect(value('"a" != "a"')).toBe(false)
    expect(value('null == false')).toBe(false)
    expect(value('[1] == [1]')).toBe(false)
    const { printed } = exec('let a = [1]; let b = a; out(a == b)')
    expect(printed).toEqual([true])
  })

  it('treats false, null, 0 and "" as false', () => {
    expect(value('!false')).toBe(true)
    expect(value('!null')).toBe(true)
    expect(value('!0')).toBe(true)
    expect(value('!""')).toBe(true)
    expect(value('![]')).toBe(false)
    expect(value('!"x"')).toBe(false)
  })

  it('short-circuits && and || and gives back an operand', () => {
    expect(value('null || "default"')).toBe('default')
    expect(value('1 && 2')).toBe(2)
    expect(value('0 && boom()')).toBe(0)
    expect(value('1 || boom()')).toBe(1)
  })

  it('stops on bad arithmetic', () => {
    expect(error('1 / 0')).toBe('Division by zero')
    expect(error('1 % 0')).toBe('Division by zero')
    expect(error('let x = 10; while (true) { x = x * x }')).toMatch(/too large/)
    expect(error('-"a"')).toMatch(/needs a number/)
    expect(error('true * 2')).toMatch(/needs two numbers/)
  })
})

describe('variables and scopes', () => {
  it('declares, reads and assigns variables', () => {
    const { printed } = exec('let x = 1; x = x + 1; let y; out(x); out(y)')
    expect(printed).toEqual([2, null])
  })

  it('scopes variables to their block', () => {
    const { printed } = exec('let x = 1; { let x = 2; out(x) } out(x)')
    expect(printed).toEqual([2, 1])
    expect(error('{ let inner = 1 } out(inner)')).toBe('"inner" is not defined')
  })

  it('rejects unknown and doubly declared names', () => {
    expect(error('out(nope)')).toBe('"nope" is not defined')
    expect(error('nope = 1')).toBe('"nope" is not defined')
    expect(error('let a = 1; let a = 2')).toBe('"a" is already declared here')
  })

  it('keeps globals from being reassigned, but lets their contents change', () => {
    const memory: ScriptObject = {}
    expect(error('me = 1', { globals: { me: {} } })).toBe('"me" can\'t be changed')
    const { result } = exec('memory.role = "miner"', { globals: { memory } })
    expect(result.status).toBe('done')
    expect(memory).toEqual({ role: 'miner' })
  })

  it('lets a script shadow a global with its own variable', () => {
    const { printed } = exec('let me = 5; out(me)', { globals: { me: {} } })
    expect(printed).toEqual([5])
  })
})

describe('control flow', () => {
  it('runs if / else if / else', () => {
    const script = (n: number) =>
      exec(
        `let n = ${n}; if (n < 0) { out("neg") } else if (n == 0) { out("zero") } else { out("pos") }`,
      ).printed
    expect(script(-1)).toEqual(['neg'])
    expect(script(0)).toEqual(['zero'])
    expect(script(1)).toEqual(['pos'])
  })

  it('loops with while', () => {
    const { printed } = exec('let i = 0; while (i < 3) { out(i); i = i + 1 }')
    expect(printed).toEqual([0, 1, 2])
  })

  it('loops over a list with for, over a copy of it', () => {
    const { printed } = exec('let list = [1, 2]; for (x of list) { list[list.length] = x; out(x) }')
    expect(printed).toEqual([1, 2])
    expect(error('for (x of 5) {}')).toMatch(/"for" needs a list/)
  })

  it('ends the run on a top-level return', () => {
    const { printed, result } = exec('out(1); if (true) { return } out(2)')
    expect(printed).toEqual([1])
    expect(result.status).toBe('done')
  })
})

describe('functions', () => {
  it('declares and calls functions, also before their declaration', () => {
    const { printed } = exec('out(add(2, 3)); fn add(a, b) { return a + b }')
    expect(printed).toEqual([5])
  })

  it('returns null without a return, and missing arguments are null', () => {
    const { printed } = exec('fn f(a, b) { out(b) } out(f(1))')
    expect(printed).toEqual([null, null])
  })

  it('rejects too many arguments and calling a non-function', () => {
    expect(error('fn f(a) {} f(1, 2)')).toBe('"f" takes 1 argument, not 2')
    expect(error('let x = 3; x()')).toBe('The number 3 is not a function')
  })

  it('makes closures that keep their scope', () => {
    const { printed } = exec(`
      fn counter() { let n = 0; return fn () { n = n + 1; return n } }
      let c = counter(); c(); c(); out(c())
    `)
    expect(printed).toEqual([3])
  })

  it('recurses', () => {
    const { printed } = exec(
      'out(fib(15)); fn fib(n) { if (n < 2) { return n } return fib(n - 1) + fib(n - 2) }',
    )
    expect(printed).toEqual([610])
  })

  it('returns from inside loops', () => {
    expect(exec('out(first([4, 5])); fn first(l) { for (x of l) { return x } }').printed).toEqual([
      4,
    ])
  })
})

describe('lists and objects', () => {
  it('reads and writes list items and length', () => {
    const { printed } = exec('let l = [1, 2]; l[0] = 9; l[2] = 3; out(l); out(l.length); out(l[5])')
    expect(printed).toEqual([[9, 2, 3], 3, null])
    expect(error('let l = []; l[2] = 1')).toMatch(/can be written at 0 to 0/)
    expect(error('[1][0.5]')).toMatch(/whole number/)
    expect(value('"abc".length')).toBe(3)
  })

  it('reads and writes object properties, missing ones are null', () => {
    const { printed } = exec(
      'let o = { a: 1 }; o.b = 2; o["c"] = 3; out(o); out(o.zzz); out(o["a"])',
    )
    expect(printed).toEqual([{ a: 1, b: 2, c: 3 }, null, 1])
  })

  it('does not reach JavaScript prototypes', () => {
    expect(value('{}.toString')).toBe(null)
    expect(value('{}.constructor')).toBe(null)
    const memory: ScriptObject = {}
    exec('memory.__proto__ = { evil: true }', { globals: { memory } })
    expect(Object.getPrototypeOf(memory)).toBe(Object.prototype)
    expect(Object.hasOwn(memory, '__proto__')).toBe(true)
  })

  it('stops on reading or writing through the wrong kind of value', () => {
    expect(error('let x = null; x.a')).toBe('Can\'t read "a" of null')
    expect(error('let x = 1; x.a = 2')).toBe('Can\'t set "a" of the number 1')
    expect(error('let o = {}; o[1]')).toMatch(/keys are strings/)
    expect(error('[1].foo')).toBe('A list has no "foo"')
  })

  it('keeps frozen host values read-only', () => {
    const me = Object.freeze({ hp: 10 })
    expect(error('me.hp = 99', { globals: { me } })).toBe("The object can't be changed")
    expect(me.hp).toBe(10)
  })
})

describe('native functions', () => {
  it('passes arguments and gives back the result', () => {
    const add = new NativeFunction('add', ([a, b]) => (a as number) + (b as number))
    const { printed } = exec('out(add(2, 3))', { globals: { add } })
    expect(printed).toEqual([5])
  })

  it('turns a ScriptRuntimeError into an error at the call', () => {
    const move = new NativeFunction('move', () => {
      throw new ScriptRuntimeError('No such direction')
    })
    const { result } = exec('\n  move("up")', { globals: { move } })
    expect(result).toMatchObject({
      status: 'error',
      message: 'No such direction',
      line: 2,
      column: 3,
    })
  })

  it('passes on other errors from the host', () => {
    const broken = new NativeFunction('broken', () => {
      throw new TypeError('host bug')
    })
    expect(() => exec('broken()', { globals: { broken } })).toThrow('host bug')
  })
})

describe('step budget', () => {
  it('counts one step per evaluated node', () => {
    // Program body: ExpressionStatement, Call, Identifier `out`, Number → 4 steps.
    expect(exec('out(1)').result).toEqual({ status: 'done', steps: 4 })
    // Let + Number.
    expect(exec('let x = 1').result.steps).toBe(2)
  })

  it('charges a native function its cost on top', () => {
    const attack = new NativeFunction('attack', () => null, 10)
    expect(exec('attack()', { globals: { attack } }).result.steps).toBe(13)
  })

  it('stops an endless loop at the budget', () => {
    const { printed, result } = exec('let i = 0; while (true) { out(i); i = i + 1 }', {
      steps: 500,
    })
    expect(result).toMatchObject({ status: 'out-of-steps', steps: 500 })
    expect(printed.length).toBeGreaterThan(10)
  })

  it('keeps what the script already did before running out', () => {
    const actions: Value[] = []
    const say = new NativeFunction('say', ([text]) => {
      actions.push(text ?? null)
      return null
    })
    const { result } = exec('say("a"); say("b"); while (true) {}', { globals: { say }, steps: 50 })
    expect(result.status).toBe('out-of-steps')
    expect(actions).toEqual(['a', 'b'])
  })

  it('does not call a native function it cannot afford', () => {
    let called = false
    const expensive = new NativeFunction(
      'expensive',
      () => {
        called = true
        return null
      },
      100,
    )
    const { result } = exec('expensive()', { globals: { expensive }, steps: 50 })
    expect(result).toMatchObject({ status: 'out-of-steps', line: 1, column: 1 })
    expect(called).toBe(false)
  })

  it('runs nothing with a budget of zero', () => {
    const { printed, result } = exec('out(1)', { steps: 0 })
    expect(printed).toEqual([])
    expect(result).toMatchObject({ status: 'out-of-steps', steps: 0 })
  })

  it('points at the node it stopped at', () => {
    const { result } = exec('let a = 1\nlet b = 2', { steps: 2 })
    expect(result).toMatchObject({ status: 'out-of-steps', line: 2, column: 1 })
  })

  it('never uses more than the budget (invariant)', () => {
    const scripts = [
      'let i = 0; while (i < 100) { i = i + 1 }',
      'fn f(n) { if (n < 1) { return 0 } return f(n - 1) + 1 } f(30)',
      'for (x of [1, 2, 3, 4, 5]) { cost(x) }',
      'let o = { a: [1, 2, { b: 3 }] }; o.a[2].b = o.a[0] + o.a[1]',
    ]
    const cost = new NativeFunction('cost', () => null, 7)
    for (const source of scripts) {
      const program = parse(source)
      for (let steps = 0; steps <= 600; steps += 1) {
        const result = run(program, {
          globals: { cost },
          steps,
          maxCallDepth: CALL_DEPTH,
          limits: LIMITS,
        })
        expect(result.steps).toBeLessThanOrEqual(steps)
        if (result.status === 'done') {
          // Any bigger budget gives the same result.
          expect(
            run(program, {
              globals: { cost },
              steps: BUDGET,
              maxCallDepth: CALL_DEPTH,
              limits: LIMITS,
            }),
          ).toEqual(result)
        } else {
          expect(result.status).toBe('out-of-steps')
        }
      }
    }
  })
})

describe('nesting too deep', () => {
  it('stops endless recursion at the call depth', () => {
    const { result } = exec('fn f() { return f() } f()', { maxCallDepth: 20 })
    expect(result).toMatchObject({
      status: 'error',
      message: 'Function calls nest more than 20 deep',
    })
  })

  it('allows calls exactly up to the call depth', () => {
    const script = 'fn f(n) { if (n > 1) { f(n - 1) } } f(20)'
    expect(exec(script, { maxCallDepth: 20 }).result.status).toBe('done')
    expect(exec(script, { maxCallDepth: 19 }).result.status).toBe('error')
  })

  it('caps the overall evaluation depth even with a huge call depth', () => {
    const { result } = exec('fn f() { return f() } f()', { maxCallDepth: 1_000_000 })
    expect(result).toMatchObject({ status: 'error', message: 'The script nests too deeply' })
    expect(MAX_EVALUATION_DEPTH).toBeGreaterThan(0)
  })
})

describe('purity and determinism', () => {
  const source = `
    fn step(state) {
      let next = []
      for (x of state) { next[next.length] = (x * 31 + 7) % 101 }
      return next
    }
    let s = memory.state || [1, 2, 3]
    let i = 0
    while (i < 20) { s = step(s); i = i + 1 }
    memory.state = s
    memory.text = "sum " + s[0] + s[1]
  `

  it('gives the same result and memory for the same input', () => {
    const program = parse(source)
    const once = (): [RunResult, ScriptObject] => {
      const memory: ScriptObject = {}
      return [
        run(program, {
          globals: { memory },
          steps: BUDGET,
          maxCallDepth: CALL_DEPTH,
          limits: LIMITS,
        }),
        memory,
      ]
    }
    expect(once()).toEqual(once())
  })

  it('does not change the program or the globals object it is given', () => {
    const program = parse(source)
    const before = JSON.stringify(program)
    const globals = Object.freeze({ memory: {} as ScriptObject })
    run(program, { globals, steps: BUDGET, maxCallDepth: CALL_DEPTH, limits: LIMITS })
    expect(JSON.stringify(program)).toBe(before)
    expect(Object.keys(globals)).toEqual(['memory'])
  })

  it('sees only the globals it is given', () => {
    expect(error('console')).toBe('"console" is not defined')
    expect(error('Math')).toBe('"Math" is not defined')
    expect(error('globalThis')).toBe('"globalThis" is not defined')
  })

  it('keeps memory plain serialisable data', () => {
    const memory: ScriptObject = {}
    exec('memory.a = { list: [1, "x", null, true] }', { globals: { memory } })
    expect(JSON.parse(JSON.stringify(memory))).toEqual(memory)
  })
})

describe('value limits', () => {
  const { maxStringLength, maxListLength, maxObjectKeys } = LIMITS

  it('stops a string doubling past the cap, quickly and within the budget', () => {
    const start = performance.now()
    const { result } = exec('let s = "x"\nwhile (true) { s = s + s }')
    expect(result).toMatchObject({
      status: 'error',
      message: `A string can hold at most ${maxStringLength} characters`,
      line: 2,
    })
    expect(result.steps).toBeLessThan(BUDGET)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('allows a string just at the cap and refuses one more character', () => {
    const grow = `let s = ""; let i = 0; while (i < ${maxStringLength}) { s = s + "x"; i = i + 1 }`
    const { printed, result } = exec(`${grow} out(s.length)`)
    expect(result.status).toBe('done')
    expect(printed).toEqual([maxStringLength])
    expect(error(`${grow} s = s + 1`)).toBe(
      `A string can hold at most ${maxStringLength} characters`,
    )
    expect(error(`${grow} s = 1 + s`)).toBe(
      `A string can hold at most ${maxStringLength} characters`,
    )
    expect(value(`"${'y'.repeat(maxStringLength)}".length`)).toBe(maxStringLength)
    expect(error(`"${'y'.repeat(maxStringLength + 1)}"`)).toMatch(/at most/)
  })

  it('stops a list growing past the cap, quickly and within the budget', () => {
    const start = performance.now()
    const { result } = exec('let l = []\nwhile (true) { l[l.length] = 1 }')
    expect(result).toMatchObject({
      status: 'error',
      message: `A list can hold at most ${maxListLength} items`,
      line: 2,
    })
    expect(result.steps).toBeLessThan(BUDGET)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('allows a full list, replacing its items, and a literal of that size', () => {
    const items = Array<number>(maxListLength).fill(1).join(', ')
    expect(value(`[${items}].length`)).toBe(maxListLength)
    expect(error(`[${items}, 1]`)).toBe(`A list can hold at most ${maxListLength} items`)
    const full = `let l = [${items}]; l[0] = 2; l[${maxListLength - 1}] = 3`
    expect(exec(full).result.status).toBe('done')
    expect(error(`${full}; l[${maxListLength}] = 4`)).toMatch(/at most/)
  })

  it('stops an object gaining keys past the cap, quickly and within the budget', () => {
    const start = performance.now()
    const { result } = exec('let o = {}; let i = 0\nwhile (true) { o["k" + i] = i; i = i + 1 }')
    expect(result).toMatchObject({
      status: 'error',
      message: `An object can hold at most ${maxObjectKeys} keys`,
      line: 2,
    })
    expect(result.steps).toBeLessThan(BUDGET)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('allows a full object, rewriting its keys, and a literal of that size', () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}: ${i}`).join(', ')
    const full = `let o = {${keys(maxObjectKeys)}}; o.k0 = 9; o["k1"] = 8`
    expect(exec(full).result.status).toBe('done')
    expect(error(`${full}; o.more = 1`)).toBe(`An object can hold at most ${maxObjectKeys} keys`)
    expect(error(`let o = {${keys(maxObjectKeys + 1)}}`)).toMatch(/at most/)
  })

  it('reads host values bigger than the caps but cannot grow them', () => {
    const list = Array<number>(maxListLength + 5).fill(0)
    const text = 'z'.repeat(maxStringLength + 5)
    const { printed, result } = exec('out(list.length); out(text.length)', {
      globals: { list, text },
    })
    expect(result.status).toBe('done')
    expect(printed).toEqual([maxListLength + 5, maxStringLength + 5])
    expect(error('list[list.length] = 1', { globals: { list } })).toMatch(/at most/)
    expect(error('text + "!"', { globals: { text } })).toMatch(/at most/)
  })
})
