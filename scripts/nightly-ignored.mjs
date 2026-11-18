// `pnpm nightly:ignored [--report <file>]` (ADR 0040, T111.4): runs `pnpm test:ignored`, every test
// ignored for time, in this checkout and appends to the nightly report whether it passed, the names
// of the tests that failed and how long it took. The scheduled task `nightly-year-run` calls it after
// the year run, in its worktree on `origin/dev`.
//
// The report defaults to `.claude/worktrees/nightly-year-report.md` of the main checkout (found from
// git, so it is the same file from any worktree). The whole nextest output goes to
// `nightly-ignored.log` beside it.
import { spawn, spawnSync } from 'node:child_process'
import console from 'node:console'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim()

function reportPath() {
  const flag = process.argv.indexOf('--report')
  if (flag !== -1 && process.argv[flag + 1]) return path.resolve(process.argv[flag + 1])
  const commonDir = path.resolve(git('rev-parse', '--git-common-dir'))
  return path.join(path.dirname(commonDir), '.claude', 'worktrees', 'nightly-year-report.md')
}

/** Which commit this is, named `dev` when it is origin/dev. */
function commitLabel() {
  const head = git('rev-parse', 'HEAD')
  const short = head.slice(0, 8)
  return head === git('rev-parse', 'origin/dev') ? `dev ${short}` : `HEAD ${short} (not origin/dev)`
}

/** Test names nextest reported as failing, in order, each once. */
function failedTests(output) {
  const failed = new Set()
  for (const line of output.split(/\r?\n/)) {
    const match =
      /^\s*(?:FAIL|TIMEOUT|SIG\w+|ABORT|LEAK-FAIL)\s+\[[^\]]*\]\s+(?:\(\d+\/\d+\)\s+)?\S+\s+(\S+)/.exec(
        line,
      )
    if (match) failed.add(match[1])
  }
  return [...failed]
}

/** `Summary [ 420.1s] 69 tests run: 68 passed, 1 failed, ...` → its counts. */
function summary(output) {
  const match = /Summary \[[^\]]*\]\s+(\d+) tests? run: (\d+) passed/.exec(output)
  return match ? { run: Number(match[1]), passed: Number(match[2]) } : null
}

const minutes = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

const report = reportPath()
const log = path.join(path.dirname(report), 'nightly-ignored.log')
const label = commitLabel()
const started = Date.now()

const child = spawn(
  'cargo',
  [
    'nextest',
    'run',
    '--cargo-profile',
    'slow',
    '--profile',
    'ignored',
    '--workspace',
    '--run-ignored',
    'only',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
let output = ''
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    output += chunk
    process.stdout.write(chunk)
  })
}
const code = await new Promise((resolve) => child.on('close', resolve))
const took = Date.now() - started

fs.mkdirSync(path.dirname(report), { recursive: true })
fs.writeFileSync(log, output)

const counts = summary(output)
const failed = failedTests(output)
const passed = code === 0 && counts !== null
const stamp = new Date().toLocaleString('sv-SE', { hour12: false }).slice(0, 16)
const lines = [
  `## ${stamp} — ${label}: ignored tests`,
  passed
    ? `- ignored: pass, ${counts.run} tests`
    : `- ignored: FAIL${counts ? `, ${counts.passed} of ${counts.run} passed` : ', no summary (build failed?)'}`,
  ...failed.map((name) => `  - failed: \`${name}\``),
  `- duration: ${minutes(took)} (exit ${code}; log: ${path.basename(log)})`,
]
if (!fs.existsSync(report)) fs.writeFileSync(report, '# Nightly year run on dev\n')
const before = fs.readFileSync(report, 'utf8')
fs.appendFileSync(
  report,
  `${before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'}${lines.join('\n')}\n`,
)
console.log(`\n${lines.join('\n')}\n→ ${report}`)
process.exit(code ?? 1)
