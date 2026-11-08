// Writes the long expected values of the ported `packages/lang` tests from the frozen TypeScript,
// so the Rust tests compare against what the TypeScript gives instead of a retyped copy.
//
//   corepack pnpm --filter @csp/lang build
//   node crates/csp-lang/tests/expected/generate.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, tokenize } from '../../../../packages/lang/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))

/** Strips positions so tests can compare tree shapes, as `shape` in `index.test.ts`. */
function shape(node) {
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

// `statements(source)` in index.test.ts: the body's shape.
const statements = [
  'let a = 1; let b',
  'if (a) { 1 } else if (b) { 2 } else { 3 }',
  'while (i < 3) { i = i + 1 }',
  'for (x of [1, 2]) { say(x) }',
  'fn add(a, b) { return a + b }\nlet f = fn () { return }',
  'fn f() { return\n1 }',
  'let o = { role: "miner", "max load": 3, if: [], }',
  '// role\nlet /* inline */ a = 1 // done',
]

// `expr(source)` in index.test.ts: the one expression statement's expression's shape.
const expressions = [
  '[1, "a", true, false, null]',
  'a || b && c == d < e + f * -g',
  'a - b - c',
  'a = b = 1',
  '(a + b) * c',
  'memory.plan[0] = world.nearest("enemy").x',
]

const out = {
  tokens: tokenize('let x = 1.5\n  "a\\n" <= y'),
  statements: Object.fromEntries(statements.map((s) => [s, shape(parse(s).body)])),
  expressions: Object.fromEntries(
    expressions.map((s) => [s, shape(parse(s).body[0].expression)]),
  ),
  serialisable: parse('fn f(a) { for (x of a) { while (x) { x = {k: [x]} } } }'),
}

writeFileSync(join(here, 'parse.json'), JSON.stringify(out, null, 2) + '\n')
