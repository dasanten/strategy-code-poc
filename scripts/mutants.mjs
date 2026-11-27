// `pnpm mutants <base> [--minutes <n>] [--report <file>]` (ADR 0048, T130.2): `cargo mutants` on
// the Rust lines changed since `<base>`. Each mutant changes one line (a `<` to `<=`, a return value
// to a default) and runs the tests; one no test notices is "missed": a test to write, or a line that
// does nothing (`docs/recipes.md`). It writes the missed mutants to a report and prints the count.
// It never fails: it exits 0 whatever it finds, and says so when it stopped at its time cap.
//
// cargo-mutants builds in a scratch copy of the tree (without `target/`, so the worktree's build is
// not disturbed): `JOBS` copies, each building and testing one mutant at a time with cargo and
// nextest at `THREADS` threads, so it shares the machine (ADR 0040). The tests stop at the first
// failure (the `mutants` nextest profile), which is enough to catch a mutant. There is no baseline
// run of the unchanged tree: run it on a tree whose tests pass, as `dev` and a checked branch are. What it leaves out is in `.cargo/mutants.toml`. A mutant runs the tests of
// its own crate; one in `csp-shared` also those of `csp-sim`, which hold the shared crate's rules.
// So it runs twice: the shared crate's mutants, then the rest's, both inside one time cap.
//
// Its own output goes to `target/mutants/<run>/mutants.out/`; the report defaults to
// `target/mutants/report.md`.
import { spawn, spawnSync } from 'node:child_process'
import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'

const CAP_MINUTES = 30
const JOBS = 2
const THREADS = 6
/** Per mutant, with no baseline to measure from: the csp-sim suite takes 1 to 2.5 min. */
const TEST_TIMEOUT_S = 600
const BUILD_TIMEOUT_S = 900
/** Crates whose rules are held by another crate's tests too. */
const ALSO_TESTED_BY = { 'csp-shared': ['csp-sim'] }

const git = (...args) => {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`)
  return result.stdout
}

function flag(name) {
  const at = process.argv.indexOf(name)
  return at !== -1 ? process.argv[at + 1] : undefined
}

const base = process.argv[2]
if (!base || base.startsWith('--')) {
  console.log('usage: pnpm mutants <base> [--minutes <n>] [--report <file>]')
  process.exit(0)
}
const capMinutes = Number(flag('--minutes') ?? CAP_MINUTES)
const root = git('rev-parse', '--show-toplevel').trim()
const outDir = path.join(root, 'target', 'mutants')
const report = path.resolve(flag('--report') ?? path.join(outDir, 'report.md'))
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const head = git('rev-parse', '--short=8', 'HEAD').trim()
const title = `## Mutants: ${head} against ${base}`

function writeReport(lines) {
  fs.mkdirSync(path.dirname(report), { recursive: true })
  fs.writeFileSync(report, `${[title, ...lines].join('\n')}\n`)
  console.log(`\n${[title, ...lines].join('\n')}\n→ ${report}`)
}

const minutes = (ms) => `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`

const diff = git('diff', '--merge-base', base, 'HEAD', '--', 'crates/*.rs')
const crates = [...new Set([...diff.matchAll(/^\+\+\+ b\/crates\/([^/]+)\//gm)].map((m) => m[1]))]
if (crates.length === 0) {
  writeReport(['- no Rust change'])
  process.exit(0)
}
const diffFile = path.join(outDir, 'in.diff')
fs.writeFileSync(diffFile, diff)

// One run per set of tests: the crates tested by others alone, the rest together.
const runs = []
for (const name of crates.filter((c) => ALSO_TESTED_BY[c])) {
  runs.push({ name, mutate: [name], tests: [name, ...ALSO_TESTED_BY[name]] })
}
const plain = crates.filter((c) => !ALSO_TESTED_BY[c])
if (plain.length > 0) runs.push({ name: 'rest', mutate: plain, tests: null })

const env = {
  ...process.env,
  CARGO_BUILD_JOBS: String(THREADS),
  NEXTEST_TEST_THREADS: String(THREADS),
  NEXTEST_PROFILE: 'mutants',
}
const started = Date.now()
const deadline = started + capMinutes * 60 * 1000
let capped = false
const failures = []

function runMutants(run, dir) {
  const args = [
    'mutants',
    '--in-diff',
    diffFile,
    '--output',
    dir,
    '--jobs',
    String(JOBS),
    '--no-shuffle',
    '--baseline',
    'skip',
    '--timeout',
    String(TEST_TIMEOUT_S),
    '--build-timeout',
    String(BUILD_TIMEOUT_S),
    ...run.mutate.flatMap((name) => ['--package', name]),
    ...(run.tests ?? []).flatMap((name) => ['--test-package', name]),
  ]
  console.log(`pnpm mutants: cargo ${args.join(' ')}`)
  const child = spawn('cargo', args, { cwd: root, env, stdio: 'inherit' })
  const timer = setTimeout(
    () => {
      capped = true
      console.log(`pnpm mutants: stopping at the ${capMinutes} min cap`)
      // The whole tree: cargo-mutants, cargo, the test binaries.
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
      }
    },
    Math.max(0, deadline - Date.now()),
  )
  return new Promise((resolve) =>
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    }),
  )
}

const read = (dir, name) => {
  const file = path.join(dir, 'mutants.out', name)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : []
}
const sum = { total: 0, missed: [], caught: 0, timeouts: 0, unviable: 0 }
for (const run of runs) {
  if (capped) break
  const dir = path.join(outDir, run.name)
  const code = await runMutants(run, dir)
  // cargo-mutants exits 2 when it found missed mutants and 3 on timeouts: findings, not failures.
  if (!capped && ![0, 2, 3].includes(code)) failures.push(`${run.name} exited ${code}`)
  const listed = path.join(dir, 'mutants.out', 'mutants.json')
  if (fs.existsSync(listed)) sum.total += JSON.parse(fs.readFileSync(listed, 'utf8')).length
  sum.missed.push(...read(dir, 'missed.txt'))
  sum.caught += read(dir, 'caught.txt').length
  sum.timeouts += read(dir, 'timeout.txt').length
  sum.unviable += read(dir, 'unviable.txt').length
}
const done = sum.missed.length + sum.caught + sum.timeouts + sum.unviable
const took = Date.now() - started

writeReport([
  `- ${sum.missed.length} missed of ${done} tested (${sum.total} listed): ${sum.caught} caught, ` +
    `${sum.timeouts} timed out, ${sum.unviable} unviable`,
  `- crates changed: ${crates.join(', ')}`,
  `- duration: ${minutes(took)}` +
    (capped ? `, stopped at the ${capMinutes} min cap after ${done} mutants` : ''),
  ...failures.map((f) => `- cargo mutants ${f} (its mutants.out/debug.log says why)`),
  ...sum.missed.map((line) => `  - missed: \`${line}\``),
])
