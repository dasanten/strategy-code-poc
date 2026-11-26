// `csp/no-rule-copy` (T122.8, ADR 0045): the client keeps no copy of a game rule. A rule is
// written once, in Rust; the client asks it of the wasm module (`@csp/lang-wasm`). The rule
// refuses a top-level client function or arrow constant named after a function that a module of
// `crates/csp-sim/src/queries/` exports (its name in camelCase), unless the name is a twin held to
// its Rust original by `apps/web/src/client-twins.test.ts`: a name among the twins of
// `crates/csp-sim/tests/client_twins.json`, which the Rust side writes. A few names that are no
// rule are let through below, each with why.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { URL, fileURLToPath } from 'node:url'

const root = new URL('..', import.meta.url)
const QUERIES = new URL('crates/csp-sim/src/queries/', root)
const TWINS = new URL('crates/csp-sim/tests/client_twins.json', root)

/** Client names that are a `queries/` function's but no rule. */
const NOT_RULES = {
  // The game's names of goods and kinds, read from the generated balance tables (`wiki/names.ts`).
  goodName: 'reads GOOD_LABELS from @csp/balance',
  kindName: 'reads BUILDING_NAMES',
}

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())

/** Every function a `queries/` module exports, by its camelCase name, with its file. */
function rustQueries() {
  const out = new Map()
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (f.endsWith('.rs')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/^pub fn (\w+)/gm)) {
          out.set(camel(m[1]), `queries/${f}`)
        }
      }
    }
  }
  walk(fileURLToPath(QUERIES))
  return out
}

let known
function names() {
  if (!known) {
    const twins = JSON.parse(readFileSync(TWINS, 'utf8')).twins
    known = { rust: rustQueries(), twins: new Set(Object.keys(twins)) }
  }
  return known
}

/** The name and node of a top-level function or arrow constant, through an `export`. */
function* defined(statement) {
  const s =
    statement.type.startsWith('Export') && statement.declaration ? statement.declaration : statement
  if (s.type === 'FunctionDeclaration' && s.id) yield [s.id.name, s.id]
  if (s.type === 'VariableDeclaration') {
    for (const d of s.declarations) {
      const init = d.init?.type
      if (
        d.id.type === 'Identifier' &&
        (init === 'ArrowFunctionExpression' || init === 'FunctionExpression')
      ) {
        yield [d.id.name, d.id]
      }
    }
  }
}

const noRuleCopy = {
  meta: {
    type: 'problem',
    docs: { description: 'The client keeps no copy of a rule of csp-sim (ADR 0045)' },
    schema: [],
  },
  create(context) {
    return {
      Program(program) {
        const { rust, twins } = names()
        for (const statement of program.body) {
          for (const [name, node] of defined(statement)) {
            const file = rust.get(name)
            if (!file || twins.has(name) || name in NOT_RULES) continue
            context.report({
              node,
              message:
                `${name} is a rule of csp-sim (${file}): ask it of @csp/lang-wasm, or keep it as a ` +
                'twin held to Rust (crates/csp-sim/tests/client_twins.rs and ' +
                'apps/web/src/client-twins.test.ts, docs/wasm-rules.md).',
            })
          }
        }
      },
    }
  },
}

export default { rules: { 'no-rule-copy': noRuleCopy } }
