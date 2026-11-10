// The shadow run (ADR 0030, "The cutover"; T88.5): the TypeScript and the Rust server on copies of
// one save, stepped in lock-step, their worlds compared at every game-day boundary and their tick
// times put side by side. A dev-only script, not a server feature; docs/shadow-run.md says how to
// run it on a copy of the live save.
//
//   corepack pnpm shadow-run <world.db> [--days 3] [--every 1440] [--out <dir>]
//                            [--rust <shadow-step binary>] [--ignore <regex>]...
//                            [--invariant-sample-rate 0.1]
//
// The TypeScript side is `apps/server/src/index.ts` without HTTP: the same tick (`runTick` with the
// orders, the queues, the scripts, walking, territory, sight and the saves) on the same kind of
// host, here in this process. The Rust side is the `shadow-step` binary of `csp-server`, the Rust
// server's `Game` on its own copy, driven over stdin and stdout. No Player is connected, so no
// order arrives and nothing is broadcast; the clock both run by is the tick.
//
// One difference from the servers, on both sides alike: path searches get no wall-clock budget
// (`PATH_BUDGET_MS`) but run to the end within the tick, as the fixture dumper's `UnhurriedWalking`
// does. With the budget, where a walker is would depend on which server is faster.
//
// Before the run, the TypeScript server opens the save once and saves it again, so a save older
// than the Rust server reads (ADR 0030: the freeze format) is migrated; both sides then start from
// that save. If the worlds differ at a check, the run is replayed from the start with the worlds
// compared after every tick from the last check that matched, and the first tick that differs is
// compared after each of its phases, which names the phase. The report (`report.md`, with every
// tick's times in `ticks.csv`) goes into the output directory.

// The server's modules import each other in a circle; realtime first, or the imports throw.
import '../apps/server/src/realtime.js'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_GAME_DAY, type WorldState } from '../packages/shared/src/index.js'
import { config } from '../apps/server/src/config.js'
import { openDb } from '../apps/server/src/db/index.js'
import { ExploredTerrain } from '../apps/server/src/explored.js'
import { noteScriptViewChanges } from '../apps/server/src/field-check.js'
import { OrderQueue, orderKinds } from '../apps/server/src/orders.js'
import { QueueRunner } from '../apps/server/src/queues.js'
import { WorldSaver, loadOrCreateWorld, saveWorld } from '../apps/server/src/saves.js'
import { setScriptParamOrder } from '../apps/server/src/script-params.js'
import {
  ScriptRunner,
  armyRunScriptOrder,
  runScriptOrder,
  setAlarmScriptOrder,
  setDefenceScriptOrder,
  taskOrder,
  type ScriptHost,
} from '../apps/server/src/script-runner.js'
import {
  checkScriptLibrary,
  defaultScriptId,
  runnableScript,
  syncDefaultScripts,
} from '../apps/server/src/scripts.js'
import { SightTracker } from '../apps/server/src/sight.js'
import { generateTerrain } from '../apps/server/src/terrain-gen.js'
import { TerritoryTracker } from '../apps/server/src/territory.js'
import {
  TICK_PHASES,
  runTick,
  type TickHealth,
  type TickPhase,
  type TickReporter,
} from '../apps/server/src/tick.js'
import { Walking } from '../apps/server/src/walking.js'
import { setWorkSettingsOrder } from '../apps/server/src/workplace-settings.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// better-sqlite3 is the server's dependency, not the workspace root's.
const Database = createRequire(path.join(root, 'apps/server/package.json'))(
  'better-sqlite3',
) as typeof import('better-sqlite3')

/**
 * Paths whose values may differ between the servers, as regular expressions over the path with
 * every array index written `[]` (`world.residents[].x`). Empty: nothing in the world is a timing
 * or otherwise allowed to differ. Add to it only with the reason, and list it in the report.
 */
export const ALLOWED_DIFFERENCES: { pattern: RegExp; reason: string }[] = []

/** Where in a tick a side's world is looked at, in order (`ProbePoint` in `server.rs`). */
export const PROBE_POINTS = ['orders', 'queues', 'scripts', 'world', 'end'] as const
export type ProbePoint = (typeof PROBE_POINTS)[number]

/** What each probe point says about where a difference arose. */
const PHASE_OF: Record<ProbePoint, string> = {
  orders: 'orders',
  queues: 'queues',
  scripts: 'scripts',
  world: 'world (npc, walking, rest, lastSeen) and its invariants',
  end: 'after the world: territory, sight, broadcast or save',
}

interface Settings {
  invariantSampleRate: number
  slowTickMs: number
  saveEveryTicks: number
}

interface StepResult {
  health: TickHealth | null
  notes: string[]
}

// ------------------------------------------------------------------------------------ comparing

export interface Difference {
  path: string
  ts: unknown
  rust: unknown
}

const MISSING = '(missing)'

/** The path with its array indices (and the ids beside them) written `[]`. */
export function genericPath(p: string): string {
  return p.replace(/\[\d+\](\{[^}]*\})?/g, '[]')
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The differences between two worlds as parsed JSON, in document order, at most `limit`: a
 * field one side lacks, an array of another length, or another value. An array element with an
 * `id` shows it in the path (`residents[3]{r-12}.x`). Paths matching `ignore` are skipped.
 */
export function differences(
  ts: unknown,
  rust: unknown,
  at = 'world',
  ignore: RegExp[] = ALLOWED_DIFFERENCES.map((a) => a.pattern),
  limit = 50,
  out: Difference[] = [],
): Difference[] {
  if (out.length >= limit || ignore.some((r) => r.test(genericPath(at)))) return out
  if (Array.isArray(ts) && Array.isArray(rust)) {
    const n = Math.min(ts.length, rust.length)
    for (let i = 0; i < n && out.length < limit; i++) {
      const v: unknown = ts[i]
      const id = isObject(v) && typeof v.id === 'string' ? `{${v.id}}` : ''
      differences(v, rust[i], `${at}[${i}]${id}`, ignore, limit, out)
    }
    if (ts.length !== rust.length && out.length < limit) {
      out.push({ path: `${at}.length`, ts: ts.length, rust: rust.length })
    }
    return out
  }
  if (isObject(ts) && isObject(rust)) {
    for (const k of Object.keys(ts)) {
      if (out.length >= limit) break
      if (!(k in rust)) {
        if (!ignore.some((r) => r.test(genericPath(`${at}.${k}`)))) {
          out.push({ path: `${at}.${k}`, ts: ts[k], rust: MISSING })
        }
      } else differences(ts[k], rust[k], `${at}.${k}`, ignore, limit, out)
    }
    for (const k of Object.keys(rust)) {
      if (out.length >= limit) break
      if (!(k in ts) && !ignore.some((r) => r.test(genericPath(`${at}.${k}`)))) {
        out.push({ path: `${at}.${k}`, ts: MISSING, rust: rust[k] })
      }
    }
    return out
  }
  // One number type in JSON: 5 and 5.0 parse the same, and 0 === -0.
  if (ts !== rust) out.push({ path: at, ts, rust })
  return out
}

// ------------------------------------------------------------------------------- the TypeScript

/** `UnhurriedWalking` of the fixture dumper: path searches never run out of time. */
class UnhurriedWalking extends Walking {
  override requestSteps(world: WorldState): ReturnType<Walking['requestSteps']> {
    return super.requestSteps(world, Infinity)
  }
}

/** Runs `then` after every call of `obj[key]`. */
function after<T extends object>(obj: T, key: keyof T, then: () => void): void {
  const f = obj[key] as (...args: unknown[]) => unknown
  obj[key] = ((...args: unknown[]) => {
    const result = f.apply(obj, args)
    then()
    return result
  }) as T[keyof T]
}

interface TsServer {
  world: WorldState
  step(probe: boolean): Promise<StepResult>
  /** The last probed tick's worlds, as JSON. */
  probed: Map<ProbePoint, string>
  state(): unknown
  close(): Promise<void>
}

/** `index.ts` without HTTP and sockets, on the database at `dbPath`. */
async function openTs(dbPath: string, settings: Settings): Promise<TsServer> {
  const { db, sqlite, close } = await openDb(dbPath)
  const { world, terrain } = loadOrCreateWorld(db, (seed) => generateTerrain(seed))
  const explored = ExploredTerrain.load(db, terrain, world.nodes)
  const territory = new TerritoryTracker()
  const notes: string[] = []
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
  const reporter: TickReporter = {
    invariantViolations: (_w, violations) => {
      for (const v of violations) notes.push(`invariant violated: ${v.message}`)
    },
    tickHealth() {},
    tickError: (_w, error) => notes.push(`tick failed: ${message(error)}`),
    scriptError: (_w, error, where) =>
      notes.push(
        `${where.scriptId === undefined ? `scripts of realm ${where.realmId} failed` : `script ${where.scriptId} failed and ended`}: ${message(error)}`,
      ),
  }
  const scriptHost: ScriptHost = {
    script: (id) => runnableScript(db, id),
    // `index.ts`'s Drizzle query, in SQL: Drizzle is the server's dependency, not the root's.
    sender: (userId) => {
      const user = sqlite.prepare('SELECT name, is_admin FROM users WHERE id = ?').get(userId) as
        { name: string; is_admin: number } | undefined
      return user && { userId, account: { name: user.name, isAdmin: user.is_admin !== 0 } }
    },
    explored: (userId, x, y) => explored.isExplored({ id: userId }, x, y),
    defaultScript: (userId, task) => defaultScriptId(db, userId, task),
    scriptError: (w, error, where) => reporter.scriptError(w, error, where),
  }
  const kinds = {
    ...orderKinds,
    runScript: runScriptOrder(scriptHost),
    armyRunScript: armyRunScriptOrder(scriptHost),
    setScriptParam: setScriptParamOrder(scriptHost),
    setDefenceScript: setDefenceScriptOrder(scriptHost),
    setAlarmScript: setAlarmScriptOrder(scriptHost),
    setWorkSettings: setWorkSettingsOrder({
      script: (id) => runnableScript(db, id),
      defaultScript: (userId, task) => defaultScriptId(db, userId, task),
    }),
    task: taskOrder({
      defaultScript: (userId, task) => defaultScriptId(db, userId, task),
      script: (id) => runnableScript(db, id),
    }),
  }
  const orders = new OrderQueue(kinds, terrain)
  const queues = new QueueRunner(scriptHost, kinds, terrain)
  const scripts = new ScriptRunner(terrain, scriptHost)
  const sight = new SightTracker()
  const walking = new UnhurriedWalking(terrain)
  const saver = new WorldSaver(db, {
    skipped: (tick, savingTick) =>
      notes.push(`save skipped: the last one (${savingTick}) is still being written (${tick})`),
    failed: (tick, error) => notes.push(`save failed (${tick}): ${message(error)}`),
  })
  syncDefaultScripts(db)
  if (noteScriptViewChanges(db, world)) saveWorld(db, world)
  reporter.invariantViolations(world, checkScriptLibrary(db))

  let probing: Map<ProbePoint, string> | undefined
  const look = (point: ProbePoint) => probing?.set(point, JSON.stringify(world))
  after(orders, 'applyAll', () => look('orders'))
  after(queues, 'runAll', () => look('queues'))
  after(scripts, 'runAll', () => look('scripts'))

  const server: TsServer = {
    world,
    probed: new Map(),
    async step(probe) {
      // The server has a second between ticks for a save's gzip; here it may need waiting for.
      if ((world.tick + 1) % settings.saveEveryTicks === 0) await saver.settled()
      probing = probe ? new Map() : undefined
      const health = runTick(world, terrain, {
        reporter,
        orders,
        queues,
        scripts,
        walking,
        invariantSampleRate: settings.invariantSampleRate,
        slowTickMs: settings.slowTickMs,
        finish: (timer) => {
          look('world')
          timer.time('territory', () => territory.update(world, terrain))
          timer.time('sight', () => sight.update(world, explored))
          if (world.tick % settings.saveEveryTicks === 0) {
            timer.time('save', () => {
              saver.start(world)
              explored.save(db)
            })
          }
          look('end')
        },
      })
      if (probing) server.probed = probing
      probing = undefined
      // As the server's event loop runs between ticks: a save's gzip finishes and is written.
      await new Promise((resolve) => setImmediate(resolve))
      return { health: health ?? null, notes: notes.splice(0) }
    },
    state: () => JSON.parse(JSON.stringify(world)) as unknown,
    async close() {
      await saver.settled()
      explored.save(db)
      close()
    },
  }
  return server
}

// ------------------------------------------------------------------------------------- the Rust

class RustServer {
  private answers: ((line: string) => void)[] = []
  private ended = false
  tick = 0

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const lines = readline.createInterface({ input: child.stdout })
    lines.on('line', (line) => this.answers.shift()?.(line))
    child.stderr.on('data', (d: Buffer) => process.stderr.write(`[rust] ${d.toString()}`))
    child.on('exit', (code) => {
      this.ended = true
      for (const a of this.answers.splice(0)) a(JSON.stringify({ error: `exited with ${code}` }))
    })
  }

  static async start(exe: string, dbPath: string, settings: Settings): Promise<RustServer> {
    const child = spawn(exe, [
      dbPath,
      '--invariant-sample-rate',
      String(settings.invariantSampleRate),
      '--slow-tick-ms',
      String(settings.slowTickMs),
      '--save-every-ticks',
      String(settings.saveEveryTicks),
    ])
    const server = new RustServer(child)
    const ready = await server.next()
    if (ready.ready !== true) throw new Error(`shadow-step did not start: ${JSON.stringify(ready)}`)
    server.tick = ready.tick as number
    return server
  }

  private next(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      if (this.ended) resolve({ error: 'shadow-step has ended' })
      else this.answers.push((line) => resolve(JSON.parse(line) as Record<string, unknown>))
    })
  }

  private async ask(command: object): Promise<Record<string, unknown>> {
    const answer = this.next()
    this.child.stdin.write(JSON.stringify(command) + '\n')
    const a = await answer
    if (typeof a.error === 'string') throw new Error(`shadow-step: ${a.error}`)
    return a
  }

  async step(probe: boolean): Promise<StepResult> {
    const a = await this.ask({ cmd: 'step', probe })
    return { health: (a.health ?? null) as TickHealth | null, notes: a.notes as string[] }
  }

  async state(file: string): Promise<unknown> {
    await this.ask({ cmd: 'dump', path: file })
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  }

  async probed(dir: string): Promise<Map<ProbePoint, string>> {
    const a = await this.ask({ cmd: 'phases', dir })
    const files = a.files as Record<string, string>
    return new Map(PROBE_POINTS.map((p) => [p, fs.readFileSync(files[p]!, 'utf8')]))
  }

  async stop(): Promise<void> {
    if (!this.ended) await this.ask({ cmd: 'stop' })
    this.child.stdin.end()
  }
}

/** Builds `shadow-step` in release and answers its path. */
function buildRust(): string {
  console.log('building shadow-step (cargo build --release)…')
  const built = spawnSync(
    'cargo',
    ['build', '--release', '-p', 'csp-server', '--bin', 'shadow-step'],
    { cwd: root, stdio: 'inherit' },
  )
  if (built.status !== 0) throw new Error('cargo build failed; run it from PowerShell, see docs')
  const target = process.env.CARGO_TARGET_DIR ?? path.join(root, 'target')
  return path.join(
    target,
    'release',
    process.platform === 'win32' ? 'shadow-step.exe' : 'shadow-step',
  )
}

// --------------------------------------------------------------------------------------- the run

/**
 * Copies the save at `source` with SQLite's backup (safe while a server writes it), lets the
 * TypeScript server open it once and save it again, and answers the copy both sides start from.
 */
async function prepare(source: string, out: string): Promise<{ start: string; from: string }> {
  const start = path.join(out, 'start.db')
  const original = new Database(source, { readonly: true, fileMustExist: true })
  const row = original
    .prepare('SELECT tick, version FROM world_saves ORDER BY id DESC LIMIT 1')
    .get() as { tick: number; version: number } | undefined
  if (!row) throw new Error(`${source} has no save`)
  await original.backup(start)
  original.close()
  const { db, close } = await openDb(start)
  const { world } = loadOrCreateWorld(db, (seed) => generateTerrain(seed))
  saveWorld(db, world)
  close()
  return { start, from: `tick ${row.tick}, world format ${row.version}` }
}

/** A fresh copy of the start for one side of one run. */
function copyOf(start: string, file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(start, file)
  return file
}

interface TickRow {
  tick: number
  ts: TickHealth | null
  rust: TickHealth | null
}

interface Check {
  tick: number
  differences: Difference[]
}

interface RunResult {
  startTick: number
  endTick: number
  ticks: TickRow[]
  checks: Check[]
  notes: { ts: string[]; rust: string[] }
}

interface RunOptions {
  start: string
  dir: string
  exe: string
  settings: Settings
  ticks: number
  every: number
  ignore: RegExp[]
}

async function openBoth(o: RunOptions, name: string): Promise<[TsServer, RustServer]> {
  const dir = path.join(o.dir, name)
  const ts = await openTs(copyOf(o.start, path.join(dir, 'ts.db')), o.settings)
  const rust = await RustServer.start(o.exe, copyOf(o.start, path.join(dir, 'rust.db')), o.settings)
  if (rust.tick !== ts.world.tick) {
    throw new Error(`the sides start at tick ${ts.world.tick} (TypeScript), ${rust.tick} (Rust)`)
  }
  return [ts, rust]
}

/** Steps both sides once, at the same time. */
async function stepBoth(
  ts: TsServer,
  rust: RustServer,
  probe: boolean,
): Promise<[StepResult, StepResult]> {
  const r = rust.step(probe)
  const t = await ts.step(probe)
  return [t, await r]
}

/** Steps both for `o.ticks`, comparing whenever the tick is a multiple of `o.every` and at the end. */
async function run(o: RunOptions): Promise<RunResult> {
  const [ts, rust] = await openBoth(o, 'run')
  const startTick = ts.world.tick
  const endTick = startTick + o.ticks
  const result: RunResult = {
    startTick,
    endTick,
    ticks: [],
    checks: [],
    notes: { ts: [], rust: [] },
  }
  const dump = path.join(o.dir, 'run', 'rust-world.json')
  const began = performance.now()
  try {
    while (ts.world.tick < endTick) {
      const [t, r] = await stepBoth(ts, rust, false)
      const tick = ts.world.tick
      result.ticks.push({ tick, ts: t.health, rust: r.health })
      for (const n of t.notes) result.notes.ts.push(`${tick}: ${n}`)
      for (const n of r.notes) result.notes.rust.push(`${tick}: ${n}`)
      if (tick % o.every === 0 || tick === endTick) {
        const d = differences(ts.state(), await rust.state(dump), 'world', o.ignore)
        result.checks.push({ tick, differences: d })
        console.log(
          `tick ${tick}: ${d.length === 0 ? 'same' : `${d.length >= 50 ? '50+' : d.length} differences, first ${d[0]!.path}`}`,
        )
      } else if ((tick - startTick) % 100 === 0) {
        const s = (performance.now() - began) / 1000
        console.log(`tick ${tick} (${tick - startTick}/${o.ticks}, ${s.toFixed(0)} s)`)
      }
    }
  } finally {
    await rust.stop()
    await ts.close()
  }
  return result
}

interface Located {
  tick: number
  phase: string
  differences: Difference[]
}

/**
 * Replays the run from the start: steps both to `from` (the last check that matched), then
 * compares after every tick up to `to`; the first tick that differs is compared after each of its
 * phases. Undefined if no tick differs: then the run did not repeat itself.
 */
async function locate(o: RunOptions, from: number, to: number): Promise<Located | undefined> {
  const [ts, rust] = await openBoth(o, 'replay')
  const dir = path.join(o.dir, 'replay')
  try {
    console.log(`replaying to tick ${from}…`)
    while (ts.world.tick < from) await stepBoth(ts, rust, false)
    while (ts.world.tick < to) {
      await stepBoth(ts, rust, true)
      const tick = ts.world.tick
      const end = differences(
        ts.state(),
        await rust.state(path.join(dir, 'rust-world.json')),
        'world',
        o.ignore,
      )
      if (end.length === 0) continue
      const rs = await rust.probed(path.join(dir, `tick-${tick}`))
      for (const point of PROBE_POINTS) {
        const d = differences(
          JSON.parse(ts.probed.get(point)!) as unknown,
          JSON.parse(rs.get(point)!) as unknown,
          'world',
          o.ignore,
        )
        if (d.length > 0) {
          fs.writeFileSync(
            path.join(dir, `tick-${tick}`, `ts-${point}.json`),
            ts.probed.get(point)!,
          )
          return { tick, phase: PHASE_OF[point], differences: d }
        }
      }
      return { tick, phase: 'not found: the phases match, the tick does not', differences: end }
    }
    return undefined
  } finally {
    await rust.stop()
    await ts.close()
  }
}

// ------------------------------------------------------------------------------------ the report

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0
}

function fmt(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(3)
}

function stats(values: number[]): { mean: number; p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length)
  return {
    mean,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  }
}

function table(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map((_, i) => (i === 0 ? ':--' : '--:')).join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ]
}

function shown(v: unknown): string {
  const s = v === MISSING ? MISSING : JSON.stringify(v)
  return '`' + (s.length > 160 ? s.slice(0, 157) + '…' : s).replace(/`/g, "'") + '`'
}

function differenceLines(d: Difference[], max = 10): string[] {
  return d
    .slice(0, max)
    .map((x) => `- \`${x.path}\`: TypeScript ${shown(x.ts)}, Rust ${shown(x.rust)}`)
}

export function report(o: {
  source: string
  from: string
  settings: Settings
  every: number
  ignore: RegExp[]
  result: RunResult
  located?: Located
  firstBad?: Check
  replayed: boolean
}): string {
  const { result } = o
  const days = (result.endTick - result.startTick) / TICKS_PER_GAME_DAY
  const lines: string[] = [
    '# Shadow run',
    '',
    `- Save: \`${o.source}\` (${o.from}), ticks ${result.startTick} to ${result.endTick} (${days} game days)`,
    `- Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC on ${os.cpus()[0]?.model.trim() ?? 'unknown CPU'}, node ${process.version}, Rust release`,
    `- Invariant sample rate ${o.settings.invariantSampleRate}, saves every ${o.settings.saveEveryTicks} ticks, worlds compared every ${o.every} ticks and at the end`,
    '- Path searches run to the end within the tick on both sides (no `PATH_BUDGET_MS`)',
    `- Allowed to differ: ${o.ignore.length === 0 ? 'nothing' : o.ignore.map((r) => `\`${r.source}\``).join(', ')}`,
    '',
    '## Result',
    '',
  ]
  if (!o.firstBad) {
    lines.push(`No difference at any of the ${result.checks.length} checks.`)
  } else {
    lines.push(`The worlds differ from the check at tick ${o.firstBad.tick} on.`, '')
    if (o.located) {
      lines.push(
        `**First difference: tick ${o.located.tick}, phase ${o.located.phase}, at \`${o.located.differences[0]!.path}\`.**`,
        '',
        ...differenceLines(o.located.differences),
      )
    } else if (o.replayed) {
      lines.push(
        'The replay found no difference up to that check: the run did not repeat itself, so something depends on more than the save and the tick.',
        '',
        ...differenceLines(o.firstBad.differences),
      )
    } else {
      lines.push(...differenceLines(o.firstBad.differences))
    }
  }
  lines.push('', '## Checks', '')
  lines.push(
    ...table(
      ['tick', 'game day', 'differences', 'first'],
      result.checks.map((c) => [
        String(c.tick),
        String(Math.floor(c.tick / TICKS_PER_GAME_DAY)),
        c.differences.length >= 50 ? '50+' : String(c.differences.length),
        c.differences[0] ? `\`${c.differences[0].path}\`` : '',
      ]),
    ),
  )

  const health = (side: 'ts' | 'rust') =>
    result.ticks.map((t) => t[side]).filter((h): h is TickHealth => h !== null)
  const tsH = health('ts')
  const rustH = health('rust')
  const failed = (side: 'ts' | 'rust') => result.ticks.filter((t) => t[side] === null).length
  const sTs = stats(tsH.map((h) => h.durationMs))
  const sRust = stats(rustH.map((h) => h.durationMs))
  lines.push('', '## Tick times (ms)', '')
  lines.push(
    ...table(
      ['', 'TypeScript', 'Rust'],
      [
        ['mean', fmt(sTs.mean), fmt(sRust.mean)],
        ['p50', fmt(sTs.p50), fmt(sRust.p50)],
        ['p95', fmt(sTs.p95), fmt(sRust.p95)],
        ['max', fmt(sTs.max), fmt(sRust.max)],
        [
          'slow ticks',
          String(tsH.filter((h) => h.slow).length),
          String(rustH.filter((h) => h.slow).length),
        ],
        ['failed ticks', String(failed('ts')), String(failed('rust'))],
      ],
    ),
  )
  lines.push('', '### By game day', '')
  const byDay = new Map<number, TickRow[]>()
  for (const t of result.ticks) {
    const day = Math.floor((t.tick - 1) / TICKS_PER_GAME_DAY)
    byDay.set(day, [...(byDay.get(day) ?? []), t])
  }
  lines.push(
    ...table(
      ['game day', 'ticks', 'TS mean', 'TS p95', 'TS max', 'Rust mean', 'Rust p95', 'Rust max'],
      [...byDay].map(([day, rows]) => {
        const a = stats(rows.flatMap((r) => (r.ts ? [r.ts.durationMs] : [])))
        const b = stats(rows.flatMap((r) => (r.rust ? [r.rust.durationMs] : [])))
        return [
          String(day),
          String(rows.length),
          fmt(a.mean),
          fmt(a.p95),
          fmt(a.max),
          fmt(b.mean),
          fmt(b.p95),
          fmt(b.max),
        ]
      }),
    ),
  )
  lines.push('', '### By phase (mean ms per tick)', '')
  const phaseMean = (h: TickHealth[], p: TickPhase) =>
    h.reduce((a, x) => a + (x.phases[p] ?? 0), 0) / Math.max(1, h.length)
  lines.push(
    ...table(
      ['phase', 'TypeScript', 'Rust'],
      TICK_PHASES.map((p) => [p, fmt(phaseMean(tsH, p)), fmt(phaseMean(rustH, p))]),
    ),
  )
  const counts = (h: TickHealth[], f: (x: TickHealth) => number) =>
    (h.reduce((a, x) => a + f(x), 0) / Math.max(1, h.length)).toFixed(1)
  lines.push('', '### Work per tick (mean)', '')
  lines.push(
    ...table(
      ['', 'TypeScript', 'Rust'],
      [
        ['residents', counts(tsH, (h) => h.residents), counts(rustH, (h) => h.residents)],
        ['actions', counts(tsH, (h) => h.actions), counts(rustH, (h) => h.actions)],
        ['script runs', counts(tsH, (h) => h.scriptRuns), counts(rustH, (h) => h.scriptRuns)],
        ['sight builds', counts(tsH, (h) => h.sightBuilds), counts(rustH, (h) => h.sightBuilds)],
      ],
    ),
  )
  lines.push('', '## What the servers logged', '')
  for (const [side, notes] of [
    ['TypeScript', result.notes.ts],
    ['Rust', result.notes.rust],
  ] as const) {
    const byMessage = new Map<string, number>()
    for (const n of notes) {
      const key = n.replace(/^\d+: /, '').replace(/\d+/g, 'n')
      byMessage.set(key, (byMessage.get(key) ?? 0) + 1)
    }
    lines.push(
      `${side}: ${notes.length === 0 ? 'nothing at warn or above.' : `${notes.length} lines.`}`,
    )
    for (const [m, n] of [...byMessage].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      lines.push(`- ${n} × ${m.length > 200 ? m.slice(0, 197) + '…' : m}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function ticksCsv(result: RunResult): string {
  const header = [
    'tick',
    'ts_ms',
    'rust_ms',
    ...TICK_PHASES.flatMap((p) => [`ts_${p}`, `rust_${p}`]),
  ]
  const rows = result.ticks.map((t) =>
    [
      t.tick,
      t.ts?.durationMs.toFixed(3) ?? '',
      t.rust?.durationMs.toFixed(3) ?? '',
      ...TICK_PHASES.flatMap((p) => [
        t.ts?.phases[p].toFixed(3) ?? '',
        t.rust?.phases[p]?.toFixed(3) ?? '',
      ]),
    ].join(','),
  )
  return [header.join(','), ...rows].join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------- main

interface Args {
  source: string
  days: number
  every: number
  out?: string
  rust?: string
  invariantSampleRate: number
  ignore: RegExp[]
}

function parseArgs(argv: string[]): Args {
  const usage =
    'usage: shadow-run.mts <world.db> [--days 3] [--every 1440] [--out <dir>] [--rust <shadow-step>] [--ignore <regex>]... [--invariant-sample-rate 0.1]'
  const args: Args = {
    source: '',
    days: 3,
    every: TICKS_PER_GAME_DAY,
    // The live servers sample a tenth of the ticks (`INVARIANT_SAMPLE_RATE` in production).
    invariantSampleRate: 0.1,
    ignore: ALLOWED_DIFFERENCES.map((a) => a.pattern),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(usage)
      return v
    }
    if (a === '--days') args.days = Number(value())
    else if (a === '--every') args.every = Number(value())
    else if (a === '--out') args.out = value()
    else if (a === '--rust') args.rust = value()
    else if (a === '--ignore') args.ignore.push(new RegExp(value()))
    else if (a === '--invariant-sample-rate') args.invariantSampleRate = Number(value())
    else if (!a.startsWith('--') && !args.source) args.source = a
    else throw new Error(usage)
  }
  if (!args.source || !(args.days > 0) || !(args.every >= 1)) throw new Error(usage)
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const source = path.resolve(args.source)
  const out = path.resolve(args.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-run-')))
  fs.mkdirSync(out, { recursive: true })
  const exe = args.rust ? path.resolve(args.rust) : buildRust()
  const settings: Settings = {
    invariantSampleRate: args.invariantSampleRate,
    slowTickMs: config.slowTickMs,
    saveEveryTicks: config.saveEveryTicks,
  }
  console.log(`preparing ${source} in ${out}…`)
  const { start, from } = await prepare(source, out)
  const o: RunOptions = {
    start,
    dir: out,
    exe,
    settings,
    ticks: Math.round(args.days * TICKS_PER_GAME_DAY),
    every: args.every,
    ignore: args.ignore,
  }
  const result = await run(o)
  const badAt = result.checks.findIndex((c) => c.differences.length > 0)
  const firstBad = badAt >= 0 ? result.checks[badAt] : undefined
  let located: Located | undefined
  if (firstBad) {
    const from = badAt > 0 ? result.checks[badAt - 1]!.tick : result.startTick
    located = await locate(o, from, firstBad.tick)
  }
  fs.writeFileSync(path.join(out, 'ticks.csv'), ticksCsv(result))
  const text = report({
    source,
    from,
    settings,
    every: args.every,
    ignore: args.ignore,
    result,
    located,
    firstBad,
    replayed: !!firstBad,
  })
  fs.writeFileSync(path.join(out, 'report.md'), text)
  console.log(`\n${text}\n\nreport: ${path.join(out, 'report.md')}`)
  process.exitCode = firstBad ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 2
  })
}
