import type { TerrainMap, WorldState } from '@csp/shared'
import { checkInvariants, shouldCheckInvariants, type InvariantViolation } from './invariants.js'
import type { OrderQueue } from './orders.js'
import { stepWorld } from './world.js'

/** How one tick went, reported as performance data (ADR 0004). */
export interface TickHealth {
  tick: number
  durationMs: number
  residents: number
  actions: number
  /** The tick took longer than the slow-tick threshold. */
  slow: boolean
}

/** Where a tick sends what it found; the server wires this to pino and Sentry. */
export interface TickReporter {
  invariantViolations(world: WorldState, violations: InvariantViolation[]): void
  tickHealth(world: WorldState, health: TickHealth): void
  tickError(world: WorldState, error: unknown): void
}

export interface TickOptions {
  reporter: TickReporter
  invariantSampleRate: number
  slowTickMs: number
  /** Orders accepted since the last tick; applied before the world steps. */
  orders?: OrderQueue
  now?: () => number
  rand?: () => number
}

/**
 * Runs one tick of the simulation with monitoring around it: applies waiting orders, steps the world, checks the
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
    const { actions } = stepWorld(world, terrain)
    if (shouldCheckInvariants(opts.invariantSampleRate, opts.rand)) {
      const violations = checkInvariants(world, terrain)
      if (violations.length > 0) opts.reporter.invariantViolations(world, violations)
    }
    const durationMs = now() - start
    const health: TickHealth = {
      tick: world.tick,
      durationMs,
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
