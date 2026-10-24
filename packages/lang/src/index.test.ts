import { describe, expect, it } from 'vitest'
import {
  checkScript,
  LANGUAGE_VERSION,
  MAX_NESTING,
  parse,
  type Expression,
  type Statement,
  tokenize,
} from './index.js'

/** Strips positions so tests can compare tree shapes. */
function shape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(shape)
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !['line', 'column', 'propertyLine', 'propertyColumn'].includes(key))
        .map(([key, value]) => [key, shape(value)]),
    )
  }
  return node
}

const statements = (source: string) => shape(parse(source).body)
const expr = (source: string) => {
  const [statement] = parse(source).body as [Statement]
  if (statement.kind !== 'ExpressionStatement') throw new Error('not an expression')
  return shape(statement.expression)
}

const num = (value: number) => ({ kind: 'Number', value })
const id = (name: string) => ({ kind: 'Identifier', name })

describe('lang', () => {
  it('exposes the language version', () => {
    expect(LANGUAGE_VERSION).toBe(1)
  })
})

describe('tokenize', () => {
  it('reads numbers, strings, names, keywords and operators with their positions', () => {
    expect(tokenize('let x = 1.5\n  "a\\n" <= y')).toEqual([
      { type: 'keyword', value: 'let', line: 1, column: 1 },
      { type: 'identifier', value: 'x', line: 1, column: 5 },
      { type: 'punctuator', value: '=', line: 1, column: 7 },
      { type: 'number', value: 1.5, line: 1, column: 9 },
      { type: 'string', value: 'a\n', line: 2, column: 3 },
      { type: 'punctuator', value: '<=', line: 2, column: 9 },
      { type: 'identifier', value: 'y', line: 2, column: 12 },
      { type: 'end', line: 2, column: 13 },
    ])
  })

  it('skips line and block comments and keeps counting lines through them', () => {
    const tokens = tokenize('// first\n/* a\nb */ x // tail\ny')
    expect(tokens.map((t) => [t.type, t.line, t.column])).toEqual([
      ['identifier', 3, 6],
      ['identifier', 4, 1],
      ['end', 4, 2],
    ])
  })

  it('reads single-quoted strings and escapes', () => {
    expect(
      tokenize(`'it\\'s' "say \\"hi\\""`).map((t) => (t.type === 'end' ? null : t.value)),
    ).toEqual(["it's", 'say "hi"', null])
  })
})

describe('parse', () => {
  it('parses let with and without a value', () => {
    expect(statements('let a = 1; let b')).toEqual([
      { kind: 'Let', name: 'a', init: num(1) },
      { kind: 'Let', name: 'b', init: null },
    ])
  })

  it('parses if, else if and else', () => {
    expect(statements('if (a) { 1 } else if (b) { 2 } else { 3 }')).toEqual([
      {
        kind: 'If',
        test: id('a'),
        then: { kind: 'Block', body: [{ kind: 'ExpressionStatement', expression: num(1) }] },
        else: {
          kind: 'If',
          test: id('b'),
          then: { kind: 'Block', body: [{ kind: 'ExpressionStatement', expression: num(2) }] },
          else: { kind: 'Block', body: [{ kind: 'ExpressionStatement', expression: num(3) }] },
        },
      },
    ])
  })

  it('parses while', () => {
    expect(statements('while (i < 3) { i = i + 1 }')).toEqual([
      {
        kind: 'While',
        test: { kind: 'Binary', operator: '<', left: id('i'), right: num(3) },
        body: {
          kind: 'Block',
          body: [
            {
              kind: 'ExpressionStatement',
              expression: {
                kind: 'Assign',
                target: id('i'),
                value: { kind: 'Binary', operator: '+', left: id('i'), right: num(1) },
              },
            },
          ],
        },
      },
    ])
  })

  it('parses for (x of list)', () => {
    expect(statements('for (x of [1, 2]) { say(x) }')).toEqual([
      {
        kind: 'ForOf',
        name: 'x',
        list: { kind: 'List', items: [num(1), num(2)] },
        body: {
          kind: 'Block',
          body: [
            {
              kind: 'ExpressionStatement',
              expression: { kind: 'Call', callee: id('say'), args: [id('x')] },
            },
          ],
        },
      },
    ])
  })

  it('parses fn declarations, fn values and return', () => {
    expect(statements('fn add(a, b) { return a + b }\nlet f = fn () { return }')).toEqual([
      {
        kind: 'FunctionDeclaration',
        name: 'add',
        params: ['a', 'b'],
        body: {
          kind: 'Block',
          body: [
            {
              kind: 'Return',
              value: { kind: 'Binary', operator: '+', left: id('a'), right: id('b') },
            },
          ],
        },
      },
      {
        kind: 'Let',
        name: 'f',
        init: {
          kind: 'FunctionExpression',
          params: [],
          body: { kind: 'Block', body: [{ kind: 'Return', value: null }] },
        },
      },
    ])
  })

  it('takes a return value only from the same line', () => {
    expect(statements('fn f() { return\n1 }')).toEqual([
      {
        kind: 'FunctionDeclaration',
        name: 'f',
        params: [],
        body: {
          kind: 'Block',
          body: [
            { kind: 'Return', value: null },
            { kind: 'ExpressionStatement', expression: num(1) },
          ],
        },
      },
    ])
  })

  it('parses numbers, strings, booleans and null', () => {
    expect(expr('[1, "a", true, false, null]')).toEqual({
      kind: 'List',
      items: [
        num(1),
        { kind: 'String', value: 'a' },
        { kind: 'Boolean', value: true },
        { kind: 'Boolean', value: false },
        { kind: 'Null' },
      ],
    })
  })

  it('parses lists and objects, with trailing commas', () => {
    expect(statements('let o = { role: "miner", "max load": 3, if: [], }')).toEqual([
      {
        kind: 'Let',
        name: 'o',
        init: {
          kind: 'Object',
          properties: [
            { key: 'role', value: { kind: 'String', value: 'miner' } },
            { key: 'max load', value: num(3) },
            { key: 'if', value: { kind: 'List', items: [] } },
          ],
        },
      },
    ])
  })

  it('parses comments anywhere', () => {
    expect(statements('// role\nlet /* inline */ a = 1 // done')).toEqual([
      { kind: 'Let', name: 'a', init: num(1) },
    ])
  })

  it('follows operator precedence and associativity', () => {
    expect(expr('a || b && c == d < e + f * -g')).toEqual({
      kind: 'Logical',
      operator: '||',
      left: id('a'),
      right: {
        kind: 'Logical',
        operator: '&&',
        left: id('b'),
        right: {
          kind: 'Binary',
          operator: '==',
          left: id('c'),
          right: {
            kind: 'Binary',
            operator: '<',
            left: id('d'),
            right: {
              kind: 'Binary',
              operator: '+',
              left: id('e'),
              right: {
                kind: 'Binary',
                operator: '*',
                left: id('f'),
                right: { kind: 'Unary', operator: '-', operand: id('g') },
              },
            },
          },
        },
      },
    })
    expect(expr('a - b - c')).toEqual({
      kind: 'Binary',
      operator: '-',
      left: { kind: 'Binary', operator: '-', left: id('a'), right: id('b') },
      right: id('c'),
    })
    expect(expr('a = b = 1')).toEqual({
      kind: 'Assign',
      target: id('a'),
      value: { kind: 'Assign', target: id('b'), value: num(1) },
    })
    expect(expr('(a + b) * c')).toMatchObject({
      kind: 'Binary',
      operator: '*',
      left: { operator: '+' },
    })
  })

  it('parses member access, indexing, calls and assignment to them', () => {
    expect(expr('memory.plan[0] = world.nearest("enemy").x')).toEqual({
      kind: 'Assign',
      target: {
        kind: 'Index',
        object: { kind: 'Member', object: id('memory'), property: 'plan' },
        index: num(0),
      },
      value: {
        kind: 'Member',
        object: {
          kind: 'Call',
          callee: { kind: 'Member', object: id('world'), property: 'nearest' },
          args: [{ kind: 'String', value: 'enemy' }],
        },
        property: 'x',
      },
    })
  })

  it('parses the example from ADR 0001', () => {
    const source = [
      'if (memory.role == null) { memory.role = "gatherer" }',
      '',
      'let enemy = world.nearest("enemy")',
      'if (enemy != null && distance(me, enemy) < 3) {',
      '  attack(enemy)',
      '} else {',
      '  move(towards(world.nearest("resource")))',
      '}',
    ].join('\n')
    expect(checkScript(source)).toEqual([])
    expect(parse(source).body.map((s) => s.kind)).toEqual(['If', 'Let', 'If'])
  })

  it('records where each node starts', () => {
    const [statement] = parse('\n  let a = b + 1').body as [Statement]
    expect(statement).toMatchObject({ line: 2, column: 3 })
    const init = (statement as { init: Expression }).init
    expect(init).toMatchObject({ line: 2, column: 11, right: { line: 2, column: 15 } })
  })

  it('produces plain serialisable data', () => {
    const program = parse('fn f(a) { for (x of a) { while (x) { x = {k: [x]} } } }')
    expect(JSON.parse(JSON.stringify(program))).toEqual(program)
  })
})

describe('checkScript', () => {
  it('accepts a valid script', () => {
    expect(checkScript('let x = 1')).toEqual([])
    expect(checkScript('')).toEqual([])
  })

  it.each([
    ['let = 1', 1, 5, 'Expected a name after "let" but found "="'],
    ['let x = 1 +', 1, 12, 'The script ends where a value was expected'],
    ['if x { }', 1, 4, 'Expected "(" after "if" but found the name "x"'],
    ['while (a {', 1, 10, 'Expected ")" to close the "while" condition but found "{"'],
    ['if (a) {\n  b\n', 3, 1, 'The "{" on line 1 is never closed with "}"'],
    ['for (let x of xs) {}', 1, 6, 'Write "for (x of list)" without "let"'],
    ['for (x in xs) {}', 1, 8, 'Expected "of" in "for (x of list)" but found the name "in"'],
    ['fn f(a, a) {}', 1, 9, 'The parameter "a" appears twice'],
    ['let o = {a: 1, a: 2}', 1, 16, 'The key "a" appears twice'],
    ['1 + 2 = 3', 1, 7, 'Only a name, "a.b" or "a[i]" can be assigned to'],
    ['say("hi)', 1, 5, 'This string is never closed with "'],
    ['let a = 1\n/* never', 2, 1, 'This comment is never closed with */'],
    ['let a = "\\q"', 1, 10, 'Unknown escape "\\q" in a string'],
    ['let a = 1 # 2', 1, 11, 'Unexpected character "#"'],
    ['let a = 12ab', 1, 11, 'Unexpected "a" after a number'],
    ['x.', 1, 3, 'Expected a property name after "." but found the end of the script'],
    ['f(1 2)', 1, 5, 'Expected ")" to close the arguments but found the number 2'],
    ['else { }', 1, 1, 'Expected a value but found "else"'],
  ])('reports %j at %i:%i', (source, line, column, message) => {
    expect(checkScript(source)).toEqual([{ message, line, column }])
  })

  it('reports deep nesting as an error instead of running out of stack', () => {
    const deep = '('.repeat(MAX_NESTING * 50) + '1' + ')'.repeat(MAX_NESTING * 50)
    expect(checkScript(deep)).toMatchObject([
      { message: `The script nests more than ${MAX_NESTING} levels deep` },
    ])
    const nested = 'if (a) {'.repeat(MAX_NESTING) + '}'.repeat(MAX_NESTING)
    expect(checkScript(nested)).toHaveLength(1)
    const fine = '('.repeat(50) + '1' + ')'.repeat(50)
    expect(checkScript(fine)).toEqual([])
  })

  // Invariant: whatever a player types, checkScript returns (never throws) and any error it
  // reports points inside the script.
  it('never throws and always points inside the script, for any input', () => {
    const pieces = [
      'let',
      'if',
      'else',
      'fn',
      'for',
      'of',
      'while',
      'return',
      'x',
      '1',
      '"s"',
      "'",
      '"',
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
      '==',
      '+',
      '-',
      '!',
      '&&',
      '/*',
      '*/',
      '//',
      '\n',
      ' ',
      '#',
    ]
    let seed = 1
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let run = 0; run < 2000; run++) {
      const length = Math.floor(random() * 30)
      const source = Array.from(
        { length },
        () => pieces[Math.floor(random() * pieces.length)],
      ).join(' ')
      const diagnostics = checkScript(source)
      const lines = source.split('\n')
      for (const d of diagnostics) {
        expect(d.line).toBeGreaterThanOrEqual(1)
        expect(d.line).toBeLessThanOrEqual(lines.length)
        expect(d.column).toBeGreaterThanOrEqual(1)
        expect(d.column).toBeLessThanOrEqual(lines[d.line - 1]!.length + 1)
      }
    }
  })
})
