// `pnpm test:browser` (Epic 126, ADR 0048): the main flows in a real browser on a small creative
// world. Not part of `pnpm check`; it runs at the epic gate and on the release PR.
//
// It builds the server and the client, makes a small world with a fixed seed into a database of
// its own (`csp-admin new-world`), creates an admin in it, starts the server with `CREATIVE=1`
// serving the built client on a free port, runs the Playwright tests in `apps/web/browser/` and
// stops the server, also when a test fails or the run is interrupted. Everything it writes goes
// into one run folder under `.browser-test/`: removed when every flow passes, kept with the
// screenshots and the server log when one fails. It never touches `data/`.
//
// Arguments after `--` go to Playwright (`pnpm test:browser -- --headed`, a test name to narrow
// the run). `BROWSER_CHANNEL` picks the installed browser (default `chrome`; `msedge` works too).
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, openSync, rmSync, closeSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import console from 'node:console'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
// A small world (the smallest size) whose seed has room for the Trade Org HQ, a trading post and
// an NPC city; fixed, so a failure replays on the same map.
const WORLD = { size: 640, seed: 7 }
const ADMIN = { name: 'smoke', password: 'smoke-test-password' }
// The `slow` cargo profile: release optimisation without LTO, so the build is about half as long
// (`Cargo.toml`); the world ticks as fast as in release.
const PROFILE = 'slow'

const started = Date.now()
const stamp = new Date(started).toISOString().replace(/[:.]/g, '-')
const runDir = join(root, '.browser-test', stamp)
mkdirSync(runDir, { recursive: true })

let server
function stopServer() {
  if (server && server.exitCode === null) server.kill()
}
process.on('exit', stopServer)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopServer()
    process.exit(130)
  })
}

function step(label) {
  console.log(`\n[test:browser] ${label} (${((Date.now() - started) / 1000).toFixed(0)} s)`)
}

function run(command, args, options = {}) {
  const { status } = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (status !== 0) fail(`${command} ${args.join(' ')} exited with ${status}`)
}

function fail(message) {
  stopServer()
  console.error(`\n[test:browser] ${message}`)
  console.error(`[test:browser] Screenshots, traces and the server log: ${runDir}`)
  process.exit(1)
}

function freePort() {
  return new Promise((done, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => done(port))
    })
  })
}

function targetDir() {
  const { stdout, status } = spawnSync(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (status !== 0) fail('cargo metadata failed')
  return JSON.parse(stdout).target_directory
}

async function waitForHealth(url, timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (server.exitCode !== null) fail(`The server exited with ${server.exitCode} before it was up`)
    try {
      const res = await globalThis.fetch(url)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await setTimeout(250)
  }
  fail(`The server did not answer ${url} within ${timeoutMs / 1000} s`)
}

step('Building the server and csp-admin')
run('cargo', ['build', '--profile', PROFILE, '-p', 'csp-server', '--bin', 'csp-server'])
run('cargo', ['build', '--profile', PROFILE, '-p', 'csp-server', '--bin', 'csp-admin'])
const exe = process.platform === 'win32' ? '.exe' : ''
const bin = (name) => join(targetDir(), PROFILE, `${name}${exe}`)

step('Building the client')
run('pnpm', ['--filter', '@csp/web', 'build'], { shell: true })

step(`Making a world of ${WORLD.size} tiles, seed ${WORLD.seed}`)
const db = join(runDir, 'world.db')
// Every variable the server reads, set here, so a `.env` in the checkout changes nothing.
const env = {
  ...process.env,
  NODE_ENV: 'development',
  DB_PATH: db,
  BACKUP_DIR: '',
  SENTRY_DSN: '',
  CREATIVE: '1',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'info',
  WEB_DIST: join(root, 'apps', 'web', 'dist'),
  ADMIN_PASSWORD: ADMIN.password,
}
run(bin('csp-admin'), [
  'new-world',
  '--db',
  db,
  '--size',
  String(WORLD.size),
  '--seed',
  String(WORLD.seed),
])
run(bin('csp-admin'), ['create', ADMIN.name], { env })

const port = await freePort()
const baseUrl = `http://127.0.0.1:${port}`
step(`Starting the server on ${baseUrl}`)
const log = openSync(join(runDir, 'server.log'), 'w')
server = spawn(bin('csp-server'), [], {
  cwd: root,
  env: { ...env, PORT: String(port), ALLOWED_ORIGINS: baseUrl },
  stdio: ['ignore', log, log],
})
await waitForHealth(`${baseUrl}/api/health`, 60_000)

step('Running the flows')
const playwright = spawnSync(
  'pnpm',
  ['--filter', '@csp/web', 'exec', 'playwright', 'test', ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      BROWSER_BASE_URL: baseUrl,
      BROWSER_USER: ADMIN.name,
      BROWSER_PASSWORD: ADMIN.password,
      BROWSER_OUT: join(runDir, 'results'),
    },
  },
)
stopServer()
closeSync(log)
const seconds = ((Date.now() - started) / 1000).toFixed(0)
if (playwright.status !== 0) fail(`A flow failed (after ${seconds} s)`)
// Windows may hold the database a moment after the server has exited.
rmSync(runDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
console.log(`\n[test:browser] Every flow passed in ${seconds} s`)
