// `pnpm wasm:build` (T88.3, ADR 0030): builds the editor's script checker, `crates/csp-lang-wasm`,
// to WebAssembly in `packages/lang-wasm/generated/` (not committed). Cargo decides whether the
// crate changed; `wasm-bindgen` and `wasm-opt` (binaryen, a dev dependency) run only when the wasm it
// wrote is newer than the bindings, so a build with nothing to do takes about a second.
//
// Needs the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` at the version of the
// `wasm-bindgen` crate in Cargo.lock:
//   rustup target add wasm32-unknown-unknown
//   cargo install wasm-bindgen-cli --version <that version> --locked
//
// CSP_WASM_PREBUILT=1 skips the build when the bindings are already there (the Docker image
// builds them in its Rust stage).
import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'packages/lang-wasm/generated')
const bindings = join(outDir, 'csp_lang_wasm_bg.wasm')
const target = process.env.CARGO_TARGET_DIR ?? join(root, 'target')
const built = join(target, 'wasm32-unknown-unknown/wasm/csp_lang_wasm.wasm')
const wasmOpt = join(root, 'node_modules/binaryen/bin/wasm-opt')

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })

if (process.env.CSP_WASM_PREBUILT && existsSync(bindings)) {
  console.log('wasm:build: prebuilt bindings in packages/lang-wasm/generated, nothing to do')
  process.exit(0)
}

run('cargo', [
  'build',
  '--quiet',
  '--profile',
  'wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--package',
  'csp-lang-wasm',
  '--lib',
])

if (!existsSync(bindings) || statSync(built).mtimeMs > statSync(bindings).mtimeMs) {
  const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8')
  const wanted = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock)?.[1]
  let have = ''
  try {
    have = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim().split(' ')[1]
  } catch {
    // Not installed: said below.
  }
  if (have !== wanted) {
    console.error(
      `wasm:build: needs wasm-bindgen-cli ${wanted}${have ? ` (found ${have})` : ''}:\n` +
        `  cargo install wasm-bindgen-cli --version ${wanted} --locked`,
    )
    process.exit(1)
  }
  run('wasm-bindgen', [
    '--target',
    'web',
    '--out-dir',
    outDir,
    '--out-name',
    'csp_lang_wasm',
    // The function names are half the module's bytes and only name frames in a stack trace
    // (docs/wasm-rules.md).
    '--remove-name-section',
    '--remove-producers-section',
    built,
  ])
  // binaryen's `wasm-opt` (#1637), from the pinned `binaryen` dev dependency: the same version on
  // every machine and in the `Dockerfile`. The package is wasm-opt compiled to JavaScript, so it
  // runs on Node wherever pnpm installed it, Windows included. The features are what rustc emits
  // for wasm32-unknown-unknown; wasm-opt refuses a module that uses one it was not allowed.
  run(process.execPath, [
    wasmOpt,
    '-Oz',
    '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int',
    '--enable-sign-ext',
    '--enable-mutable-globals',
    '--enable-reference-types',
    '--enable-multivalue',
    bindings,
    '-o',
    bindings,
  ])
}

const bytes = readFileSync(bindings)

// What the browser lacks (ADR 0045): on wasm32-unknown-unknown the standard library builds
// `Instant::now()`, `SystemTime::now()` and threads as calls that only fail when they run. Code
// that can reach one carries its message into the module (dead code is dropped), so a message in
// the module is a call the rules can reach: the build fails before a browser finds it.
const LACKING = [
  ['time not implemented on this platform', 'Instant::now() or SystemTime::now()'],
  ['operation not supported on this platform', 'a thread, a file or another OS call'],
  ['failed to spawn thread', 'a thread'],
]
const text = bytes.toString('latin1')
const found = LACKING.filter(([message]) => text.includes(message))
if (found.length > 0) {
  console.error(
    'wasm:build: the module can reach what the browser lacks:\n' +
      found.map(([message, what]) => `  ${what} ("${message}")`).join('\n') +
      '\n  Keep it out of what crates/csp-lang-wasm calls (docs/wasm-rules.md).',
  )
  process.exit(1)
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(
  `wasm:build: packages/lang-wasm/generated/csp_lang_wasm_bg.wasm is ${kb(bytes.length)}` +
    ` (${kb(gzipSync(bytes, { level: 9 }).length)} gzipped)`,
)
