import type { TerrainMap, WorldState } from '@csp/shared'
import { tallyGoods, takeMade } from './goods-made.js'
import {
  checkInvariants,
  goodsOnlyFromNothingAtTheFloor,
  invariantsForTick,
  shouldCheckInvariants,
  type InvariantViolation,
} from './invariants.js'
import type { OrderQueue } from './orders.js'
import type { QueueRunner } from './queues.js'
import type { ScriptErrorWhere, ScriptRunner } from './script-runner.js'
import type { Walking } from './walking.js'
import { stepWorld } from './world.js'

/**
 * The phases of a tick, in the order they run (ADR 0004). `npc`, `walking` and `rest` are the
 * parts of `world`: the `TOP_LEVEL_PHASES` add up to the tick, these three to `world`.
 */
export const TICK_PHASES = [
  'orders',
  'queues',
  'scripts',
  'world',
  'npc',
  'walking',
  'rest',
  'invariants',
  'territory',
  'sight',
  'broadcast',
  'save',
] as const
export type TickPhase = (typeof TICK_PHASES)[number]

/** The phases that together make up a whole tick; the parts of `world` are left out. */
export const TOP_LEVEL_PHASES: readonly TickPhase[] = TICK_PHASES.filter(
  (p) => p !== 'npc' && p !== 'walking' && p !== 'rest',
)

/** How one tick went, reported as performance data (ADR 0004). */
export interface TickHealth {
  tick: number
  /** The whole tick, from the first order applied to the save written, in ms. */
  durationMs: number
  /** How long each phase took, in ms; a phase that did not run is 0. */
  phases: Record<TickPhase, number>
  residents: number
  actions: number
  /** The tick took longer than the slow-tick threshold. */
  slow: boolean
}

/** The phases of a tick, slowest first. */
export function phasesSlowestFirst(phases: Record<TickPhase, number>): [TickPhase, number][] {
  return (Object.entries(phases) as [TickPhase, number][]).sort((a, b) => b[1] - a[1])
}

/**
 * Times the phases of one tick. `time` runs a phase and adds what it took to that phase's total;
 * a phase that throws is still counted, then the error goes on. One timer per tick, shared by
 * `runTick` and the loop's work after it (`TickOptions.finish`), so tick health covers the whole
 * tick.
 */
export class TickTimer {
  readonly phases = Object.fromEntries(TICK_PHASES.map((p) => [p, 0])) as Record<TickPhase, number>
  private readonly now: () => number
  private readonly start: number

  constructor(now: () => number = performance.now.bind(performance)) {
    this.now = now
    this.start = now()
  }

  time<T>(phase: TickPhase, fn: () => T): T {
    const from = this.now()
    try {
      return fn()
    } finally {
      this.phases[phase] += this.now() - from
    }
  }

  /** Since the timer was made, in ms. */
  elapsed(): number {
    return this.now() - this.start
  }
}

/** Where a tick sends what it found; the server wires this to pino and Sentry. */
export interface TickReporter {
  invariantViolations(world: WorldState, violations: InvariantViolation[]): void
  tickHealth(world: WorldState, health: TickHealth): void
  tickError(world: WorldState, error: unknown): void
  /**
   * The game itself threw running a script (`ScriptHost.scriptError`): a bug in the game, not in
   * the script. With a `scriptId`, that one script ended for `entityIds`; without one, the
   * whole realm's scripts skipped the tick.
   */
  scriptError(world: WorldState, error: unknown, where: ScriptErrorWhere): void
}

export interface TickOptions {
  reporter: TickReporter
  invariantSampleRate: number
  slowTickMs: number
  /** Turns walk orders into steps; without it nobody walks. */
  walking?: Walking
  /** Orders accepted since the last tick; applied before the world steps. */
  orders?: OrderQueue
  /** Moves the residents' queues on once the orders are applied; without it no queue moves. */
  queues?: QueueRunner
  /** Runs the residents' scripts after the orders are applied; without it no script runs. */
  scripts?: ScriptRunner
  /**
   * The loop's work once the world has stepped and the invariants are checked, timed with the
   * tick's timer so tick health covers the whole tick: territory, sight, broadcast, save.
   */
  finish?: (timer: TickTimer) => void
  now?: () => number
  rand?: () => number
}

/**
 * Runs one tick of the simulation with monitoring around it: applies waiting orders, runs scripts, steps the world, checks the
 * tick's slice of the world invariants and, on sampled ticks, the before-and-after ones, runs `finish` and reports tick health with how long each phase
 * took. A thrown error is reported, not rethrown, so one bad tick does not stop the loop.
 */
export function runTick(
  world: WorldState,
  terrain: TerrainMap,
  opts: TickOptions,
): TickHealth | undefined {
  const timer = new TickTimer(opts.now)
  try {
    timer.time('orders', () => opts.orders?.applyAll(world))
    timer.time('queues', () => opts.queues?.runAll(world))
    const check = shouldCheckInvariants(opts.invariantSampleRate, opts.rand)
    const scriptViolations = timer.time('scripts', () => opts.scripts?.runAll(world, check) ?? [])
    const before = timer.time('invariants', () => (check ? tallyGoods(world) : undefined))
    const { actions } = timer.time('world', () => {
      takeMade(world)
      return stepWorld(world, terrain, opts.walking, timer)
    })
    const slice = invariantsForTick(world.tick, opts.invariantSampleRate)
    if (check || slice.length > 0) {
      timer.time('invariants', () => {
        const violations = [
          ...scriptViolations,
          ...checkInvariants(world, terrain, slice),
          ...(check ? goodsOnlyFromNothingAtTheFloor(before!, world, takeMade(world)) : []),
        ]
        if (violations.length > 0) opts.reporter.invariantViolations(world, violations)
      })
    }
    opts.finish?.(timer)
    const durationMs = timer.elapsed()
    const health: TickHealth = {
      tick: world.tick,
      durationMs,
      phases: timer.phases,
      residents: world.residents.length,
      actions,
      slow: durationMs > opts.slowTickMs,
    }
    opts.reporter.tickHealth(world, health)
    return health
  } catch (error) {
    opts.reporter.tickError(world, error)
    return undefined
  }
}
