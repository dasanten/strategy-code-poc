import type { TerrainMap, WorldState } from '@csp/shared'
import { tallyGoods, takeMade } from './goods-made.js'
import {
  checkInvariants,
  goodsOnlyFromNothingAtTheFloor,
  shouldCheckInvariants,
  type InvariantViolation,
} from './invariants.js'
import type { OrderQueue } from './orders.js'
import type { QueueRunner } from './queues.js'
import type { ScriptErrorWhere, ScriptRunner } from './script-runner.js'
import type { Walking } from './walking.js'
import { stepWorld } from './world.js'

/** How one tick went, reported as performance data (ADR 0004). */
export interface TickHealth {
  tick: number
  durationMs: number
  residents: number
  actions: number
  /** Milliseconds the game-run cities spent planning (ADR 0016). */
  npcPlanMs: number
  /** The tick took longer than the slow-tick threshold. */
  slow: boolean
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
  now?: () => number
  rand?: () => number
}

/**
 * Runs one tick of the simulation with monitoring around it: applies waiting orders, runs scripts, steps the world, checks the
 * invariants on sampled ticks and reports tick health. A thrown error is reported, not rethrown,
 * so one bad tick does not stop the loop.
 */
export function runTick(
  world: WorldState,
  terrain: TerrainMap,
  opts: TickOptions,
): TickHealth | undefined {
  const now = opts.now ?? performance.now.bind(performance)
  try {
    const start = now()
    opts.orders?.applyAll(world)
    opts.queues?.runAll(world)
    const check = shouldCheckInvariants(opts.invariantSampleRate, opts.rand)
    const scriptViolations = opts.scripts?.runAll(world, check) ?? []
    const before = check ? tallyGoods(world) : undefined
    takeMade(world)
    const { actions, npcPlanMs } = stepWorld(world, terrain, opts.walking)
    if (check) {
      const violations = [
        ...scriptViolations,
        ...checkInvariants(world, terrain),
        ...goodsOnlyFromNothingAtTheFloor(before!, world, takeMade(world)),
      ]
      if (violations.length > 0) opts.reporter.invariantViolations(world, violations)
    }
    const durationMs = now() - start
    const health: TickHealth = {
      tick: world.tick,
      durationMs,
      residents: world.residents.length,
      actions,
      npcPlanMs,
      slow: durationMs > opts.slowTickMs,
    }
    opts.reporter.tickHealth(world, health)
    return health
  } catch (error) {
    opts.reporter.tickError(world, error)
    return undefined
  }
}
