// `node scripts/wasm-rules-bench.mjs <messages folder>` (T122.1, `docs/wasm-rules.md`): measures
// the rules module against the limits of Epic 122 with the messages a Player's socket got, as
// `bench-broadcast` writes them (`BENCH_DUMP=<folder>`): `0000.json` the `welcome`, the rest ticks.
// Build the module first (`pnpm wasm:build`).
//
// It prints the module's size (raw, and compressed as the server sends it), the start (compile and
// instantiate the module, then mirror the welcome), each tick's mirror update and one rule call.
import console from 'node:console'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

// WebAssembly is a global of Node's, as in a browser.
const { WebAssembly } = globalThis
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/wasm-rules-bench.mjs <messages folder>')
  process.exit(2)
}
const generated = join(root, 'packages/lang-wasm/generated')
const bytes = readFileSync(join(generated, 'csp_lang_wasm_bg.wasm'))
const wasm = await import(pathToFileURL(join(generated, 'csp_lang_wasm.js')).href)

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
const texts = files.map((f) => readFileSync(join(dir, f), 'utf8'))
const welcome = texts.find((t) => t.startsWith('{"type":"welcome"'))
const ticks = texts.filter((t) => t.startsWith('{"type":"tick"'))
if (!welcome) throw new Error(`no welcome message in ${dir}`)

const ms = (n) => `${n.toFixed(2)} ms`
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p95: at(0.95), max: s.at(-1) }
}

// The server compresses with tower-http's defaults: gzip at level 6 (`app.rs`).
console.log(
  `module: ${kb(bytes.length)} raw, ${kb(gzipSync(bytes, { level: 6 }).length)} gzipped as served` +
    ` (${kb(gzipSync(bytes, { level: 9 }).length)} at level 9)`,
)

let t = performance.now()
wasm.initSync({ module: new WebAssembly.Module(bytes) })
const loaded = performance.now() - t
const mirror = new wasm.WorldMirror()
t = performance.now()
mirror.welcome(welcome)
const mirrored = performance.now() - t
const seen = JSON.parse(welcome)
console.log(
  `start: ${ms(loaded + mirrored)} (module ${ms(loaded)}, first mirror ${ms(mirrored)}),` +
    ` welcome ${kb(welcome.length)} with ${seen.entities.length} things in sight,` +
    ` ${mirror.count} of them buildings`,
)

// After each update the rule's first call builds its lookup by tile again: timed apart.
const firstCalls = []
const updates = ticks.map((text) => {
  const start = performance.now()
  mirror.tick(text)
  const took = performance.now() - start
  const call = performance.now()
  mirror.buildingAt(0, 0)
  firstCalls.push(performance.now() - call)
  return took
})
const f = stats(firstCalls)
console.log(
  `first rule call after an update: ${ms(f.mean)} mean, ${ms(f.p95)} p95, ${ms(f.max)} max`,
)
const u = stats(updates)
const changed = stats(ticks.map((text) => JSON.parse(text).changed.length))
console.log(
  `mirror update: ${ms(u.mean)} mean, ${ms(u.p95)} p95, ${ms(u.max)} max over ${ticks.length}` +
    ` ticks (${changed.mean.toFixed(0)} things changed a tick on average)`,
)

// One rule call: the building on a tile, asked of tiles on and around the buildings in sight.
const tiles = seen.entities
  .filter((e) => e.is === 'building')
  .flatMap((b) => [
    [b.x, b.y],
    [b.x + 1, b.y + 1],
    [b.x - 3, b.y + 2],
  ])
const calls = tiles.map(([x, y]) => {
  const start = performance.now()
  mirror.buildingAt(x, y)
  return performance.now() - start
})
const c = stats(calls)
console.log(
  `one rule call (buildingAt): ${ms(c.mean)} mean, ${ms(c.p95)} p95, ${ms(c.max)} max over` +
    ` ${calls.length} calls`,
)

// Worst case for a mirror that keeps Last seen too: every remembered building mirrored as well.
const remembered = (seen.lastSeen ?? [])
  .filter((e) => e.is === 'building')
  .map(({ seenAt: _, ...b }) => b)
const everything = JSON.stringify({ ...seen, entities: [...seen.entities, ...remembered] })
t = performance.now()
mirror.welcome(everything)
console.log(
  `with Last seen: first mirror ${ms(performance.now() - t)} of ${kb(everything.length)},` +
    ` ${mirror.count} buildings`,
)
mirror.free()
