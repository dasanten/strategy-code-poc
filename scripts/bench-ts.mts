// The TypeScript game's speed, recorded once before the Rust port (ADR 0030, T84.7): a dev-only
// script, not a server feature. The Rust `bench-world` and `bench-sim` print the same tables, so the
// two compare line for line. Results go under `## Measurements` in docs/proposals/rust-rewrite.md.
//
//   corepack pnpm exec tsx --conditions=source scripts/bench-ts.mts world [size] [seed]
//   corepack pnpm exec tsx --conditions=source scripts/bench-ts.mts sim <village|villages|hq|save> [ticks]
//   corepack pnpm exec tsx --conditions=source scripts/bench-ts.mts suite
//
// `world` at full size (MAP_SIZE) takes a long time: run it on an idle machine, with plain tsx (not
// `tsx watch`). `sim save` reads the newest save of the database at DB_PATH, from a copy.

// The server's modules import each other in a circle; realtime first, or the imports throw.
import '../apps/server/src/realtime.js'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  MAP_SIZE,
  NPC_VILLAGE,
  Terrain,
  tileIndex,
  type TerrainMap,
  type WorldState,
} from '../packages/shared/src/index.js'
import { openDb } from '../apps/server/src/db/index.js'
import { foundNpcCity } from '../apps/server/src/npc-cities.js'
import { mulberry32 } from '../apps/server/src/residents.js'
import { loadOrCreateWorld } from '../apps/server/src/saves.js'
import { foundTradeOrgHq } from '../apps/server/src/trade-org.js'
import { generateTerrain } from '../apps/server/src/terrain-gen.js'
import {
  TICK_PHASES,
  runTick,
  type TickHealth,
  type TickPhase,
  type TickReporter,
} from '../apps/server/src/tick.js'
import { Walking } from '../apps/server/src/walking.js'
import { createWorld, generateWorld } from '../apps/server/src/world.js'

type Out = (line: string) => void
const print: Out = (line) => console.log(line)

/** The machine and the day, for the line above every table. */
export function machineLine(): string {
  const cpus = os.cpus()
  return (
    `${new Date().toISOString().slice(0, 10)}, ${cpus[0]?.model.trim() ?? 'unknown CPU'}, ` +
    `${cpus.length} threads, ${Math.round(os.totalmem() / 2 ** 30)} GiB, node ${process.version}`
  )
}

function table(header: string[], rows: string[][], out: Out): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) =>
    '| ' +
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join(' | ') +
    ' |'
  out(line(header))
  out(
    '|' +
      widths
        .map((w, i) => (i === 0 ? ':' + '-'.repeat(w + 1) : '-'.repeat(w + 1) + ':'))
        .join('|') +
      '|',
  )
  for (const r of rows) out(line(r))
}

const fmt = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms >= 1 ? ms.toFixed(2) : ms.toFixed(3))

// ---------------------------------------------------------------------------------------- world

/** Times `generateTerrain` and `generateWorld` by stage and prints both tables. */
export function benchWorld(size: number, seed: number, out: Out = print): void {
  const terrainStages: [string, number][] = []
  const worldStages: [string, number][] = []
  const timed =
    (into: [string, number][]) =>
    <T,>(stage: string, run: () => T): T => {
      const from = performance.now()
      try {
        return run()
      } finally {
        into.push([stage, performance.now() - from])
      }
    }
  out(`world ${size}x${size}, seed ${seed}: ${machineLine()}`)
  const t0 = performance.now()
  const terrain = generateTerrain(seed, size, timed(terrainStages))
  const terrainMs = performance.now() - t0
  const t1 = performance.now()
  const world = generateWorld(terrain, seed, timed(worldStages))
  const worldMs = performance.now() - t1
  const rows = (stages: [string, number][], total: number, label: string) => [
    ...stages.map(([s, ms]) => [s, fmt(ms), `${((ms / total) * 100).toFixed(1)}%`]),
    [label, fmt(total), '100.0%'],
  ]
  out('')
  table(['generateTerrain stage', 'ms', 'share'], rows(terrainStages, terrainMs, 'total'), out)
  out('')
  table(['generateWorld stage', 'ms', 'share'], rows(worldStages, worldMs, 'total'), out)
  out('')
  out(
    `made: ${world.nodes.length} nodes, ${world.cities.length} cities, ${world.residents.length} residents, ` +
      `${world.caravans.length} caravans, ${world.traders.length} traders`,
  )
}

// ----------------------------------------------------------------------------------------- sim

type Scene = { world: WorldState; terrain: TerrainMap }

const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** `village()` of `npc-growth.fixture.ts`: one village on a Plains map with a forest east of it. */
function village(): Scene {
  const terrain = plains(200)
  const world = createWorld(terrain)
  foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  world.nodes.push({ id: 'forest', kind: 'forest', x: 34 + 40, y: 34 })
  terrain.tiles[tileIndex(terrain.size, 34 + 40, 34)] = Terrain.Forest
  return { world, terrain }
}

/** `villages(n)` of `npc-plan.test.ts`: `n` villages in a grid on a Plains map. */
function villages(n: number): Scene {
  const side = Math.ceil(Math.sqrt(n))
  const step = NPC_VILLAGE.size + 20
  const terrain = plains(side * step + 40)
  const world = createWorld(terrain)
  const rand = mulberry32(11)
  for (let i = 0; i < n; i++) {
    foundNpcCity(
      world,
      terrain,
      NPC_VILLAGE,
      20 + (i % side) * step,
      20 + Math.floor(i / side) * step,
      rand,
    )
  }
  return { world, terrain }
}

/** `hq()` of `trade-org.test.ts`: the Trade Org HQ alone on a Plains map 640 across, four nodes. */
function hq(): Scene {
  const mid = 320
  const terrain = plains(640)
  const nodes = [
    ['forest', mid + 80, mid],
    ['stone', mid + 80, mid + 12],
    ['ironOre', mid + 88, mid - 12],
    ['goldOre', mid + 96, mid],
  ] as const
  for (const [kind, x, y] of nodes) {
    terrain.tiles[tileIndex(terrain.size, x, y)] =
      kind === 'forest' ? Terrain.Forest : Terrain.Hills
  }
  const world = createWorld(terrain)
  world.nodes = nodes.map(([kind, x, y], i) => ({ id: `n${i}`, kind, x, y }))
  foundTradeOrgHq(world, terrain, mid, mid, mulberry32(7))
  return { world, terrain }
}

/** The newest save of the database at DB_PATH, read from a copy so the original is left alone. */
async function save(): Promise<Scene> {
  const source = process.env.DB_PATH
  if (!source) throw new Error('sim save needs DB_PATH, the database to read the newest save from')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ts-'))
  const copy = path.join(dir, 'world.db')
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, copy + suffix)
  }
  const { db, close } = await openDb(copy)
  try {
    return loadOrCreateWorld(db, (seed) => generateTerrain(seed))
  } finally {
    close()
  }
}

const SCENES = ['village', 'villages', 'hq', 'save'] as const
export type SceneName = (typeof SCENES)[number]
const DEFAULT_TICKS = 600

const quiet: TickReporter = {
  invariantViolations() {},
  tickHealth() {},
  tickError(_world, error) {
    throw error
  },
  scriptError(_world, error) {
    throw error
  },
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

/**
 * Steps the scene through `runTick` with the invariants off and prints the mean and p95 of every
 * phase, the residents, and ms per tick per resident. Players' queues, orders and scripts are not
 * wired (a `TickOptions` without them), so the NPC cities' residents' scripts are what runs; the
 * phases that belong to the server loop (`finish`) are not run and print 0.
 */
export async function benchSim(
  name: SceneName,
  ticks = DEFAULT_TICKS,
  out: Out = print,
): Promise<{ phases: Record<TickPhase, number[]>; totals: number[]; residents: number[] }> {
  const scene =
    name === 'village'
      ? village()
      : name === 'villages'
        ? villages(60)
        : name === 'hq'
          ? hq()
          : await save()
  const { world, terrain } = scene
  const walking = new Walking(terrain)
  const opts = { reporter: quiet, invariantSampleRate: 0, slowTickMs: Infinity, walking }
  const phases = Object.fromEntries(TICK_PHASES.map((p) => [p, [] as number[]])) as Record<
    TickPhase,
    number[]
  >
  const totals: number[] = []
  const residents: number[] = []
  const startResidents = world.residents.length
  for (let i = 0; i < ticks; i++) {
    const health: TickHealth | undefined = runTick(world, terrain, opts)
    if (!health) throw new Error(`tick ${i} failed`)
    for (const p of TICK_PHASES) phases[p].push(health.phases[p])
    totals.push(health.durationMs)
    residents.push(health.residents)
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
  const p95 = (xs: number[]) =>
    percentile(
      [...xs].sort((a, b) => a - b),
      0.95,
    )
  out(
    `sim ${name}, ${ticks} ticks, invariants off, ${terrain.size}x${terrain.size} map, ` +
      `${startResidents} residents at the start: ${machineLine()}`,
  )
  out('')
  table(
    ['phase', 'mean ms', 'p95 ms'],
    [
      ...TICK_PHASES.map((p) => [p, fmt(mean(phases[p])), fmt(p95(phases[p]))]),
      ['tick (total)', fmt(mean(totals)), fmt(p95(totals))],
    ],
    out,
  )
  const meanResidents = mean(residents)
  out('')
  out(
    `residents: ${meanResidents.toFixed(0)} on average (${startResidents} to ${world.residents.length}); ` +
      `ms per tick per resident: ${fmt(mean(totals) / (meanResidents || 1))} mean, ` +
      `${fmt(p95(totals) / (meanResidents || 1))} p95`,
  )
  out('(npc, walking, rest and lastSeen are parts of world; phases the server loop owns print 0.)')
  return { phases, totals, residents }
}

// ---------------------------------------------------------------------------------------- suite

interface JsonFile {
  name: string
  status?: string
  startTime: number
  endTime: number
}

/** Runs `pnpm test` once with Vitest's JSON reporter; prints the wall time and the ten slowest files. */
export function benchSuite(out: Out = print): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ts-'))
  const json = path.join(dir, 'vitest.json')
  out(`suite (pnpm test, once): ${machineLine()}`)
  const from = performance.now()
  const run = spawnSync(
    'corepack',
    ['pnpm', 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${json}`],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: true,
    },
  )
  const wallS = (performance.now() - from) / 1000
  if (!fs.existsSync(json)) throw new Error('vitest wrote no JSON report')
  const report = JSON.parse(fs.readFileSync(json, 'utf8')) as {
    numTotalTests: number
    numFailedTests: number
    testResults: JsonFile[]
  }
  const root = process.cwd()
  const files = report.testResults
    .map((f) => ({
      file: path.relative(root, f.name).replaceAll('\\', '/'),
      ms: f.endTime - f.startTime,
    }))
    .sort((a, b) => b.ms - a.ms)
  out('')
  out(
    `wall time ${wallS.toFixed(0)} s; ${report.testResults.length} files, ${report.numTotalTests} tests, ` +
      `${report.numFailedTests} failed (exit ${run.status})`,
  )
  const failed = report.testResults.filter((f) => f.status === 'failed')
  for (const f of failed) out(`failed: ${path.relative(root, f.name).replaceAll('\\', '/')}`)
  out('')
  table(
    ['ten slowest files', 'seconds'],
    files.slice(0, 10).map((f) => [f.file, (f.ms / 1000).toFixed(1)]),
    out,
  )
}

// ------------------------------------------------------------------------------------------ cli

async function main(args: string[]): Promise<void> {
  const [what, arg1, arg2] = args
  if (what === 'world') {
    benchWorld(arg1 ? Number(arg1) : MAP_SIZE, arg2 ? Number(arg2) : 1)
  } else if (what === 'sim' && SCENES.includes(arg1 as SceneName)) {
    await benchSim(arg1 as SceneName, arg2 ? Number(arg2) : DEFAULT_TICKS)
  } else if (what === 'suite') {
    benchSuite()
  } else {
    console.error(
      'usage: bench-ts.mts world [size] [seed] | sim <village|villages|hq|save> [ticks] | suite',
    )
    process.exit(2)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
