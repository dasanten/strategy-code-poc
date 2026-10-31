import * as Sentry from '@sentry/node'
import type { WorldState } from '@csp/shared'
import type { Logger } from './log.js'
import { phasesSlowestFirst, type TickReporter } from './tick.js'

/**
 * Starts Sentry when a DSN is configured. Without one, reporting is off and only logs are
 * written; the Sentry calls below are then no-ops.
 */
export function initSentry(opts: { dsn: string | undefined; environment: string }): boolean {
  if (!opts.dsn) return false
  Sentry.init({ dsn: opts.dsn, environment: opts.environment })
  return true
}

/** Tags every later event with the world it came from. */
export function tagWorld(world: WorldState): void {
  Sentry.setTag('world_seed', world.seed)
  Sentry.setTag('tick', world.tick)
}

function withWorldScope(
  world: WorldState,
  entityIds: string[],
  capture: (scope: Sentry.Scope) => void,
) {
  Sentry.withScope((scope) => {
    scope.setTag('tick', world.tick)
    scope.setTag('world_seed', world.seed)
    if (entityIds.length > 0) {
      scope.setTag('entity_ids', entityIds.join(','))
      scope.setContext('entities', { ids: entityIds })
    }
    capture(scope)
  })
}

export function createTickReporter(log: Logger): TickReporter {
  return {
    invariantViolations(world, violations) {
      for (const v of violations) {
        log.error(
          { tick: world.tick, seed: world.seed, invariant: v.invariant, entityIds: v.entityIds },
          `invariant violated: ${v.message}`,
        )
        withWorldScope(world, v.entityIds, (scope) => {
          scope.setTag('invariant', v.invariant)
          // Same invariant groups into one Sentry issue, whatever the entities.
          scope.setFingerprint(['invariant', v.invariant])
          Sentry.captureException(new Error(`Invariant violated: ${v.message}`))
        })
      }
    },

    tickHealth(world, health) {
      const attributes = { world_seed: world.seed }
      Sentry.metrics.distribution('tick.duration', health.durationMs, {
        unit: 'millisecond',
        attributes,
      })
      Sentry.metrics.gauge('tick.residents', health.residents, { attributes })
      Sentry.metrics.gauge('tick.actions', health.actions, { attributes })
      for (const [phase, ms] of phasesSlowestFirst(health.phases)) {
        Sentry.metrics.distribution(`tick.phase.${phase}`, ms, { unit: 'millisecond', attributes })
      }
      // Logged slowest phase first, so the terminal says where the tick went at a glance.
      const phases = Object.fromEntries(
        phasesSlowestFirst(health.phases).map(([phase, ms]) => [phase, Math.round(ms * 10) / 10]),
      )
      const [slowest, slowestMs] = phasesSlowestFirst(health.phases)[0] ?? ['world', 0]
      if (health.slow) {
        log.warn(
          { ...health, phases, seed: world.seed },
          `slow tick: ${health.durationMs.toFixed(0)} ms, slowest phase ${slowest} (${slowestMs.toFixed(0)} ms)`,
        )
        withWorldScope(world, [], (scope) => {
          scope.setContext('tick_health', { ...health, phases })
          scope.setTag('slowest_phase', slowest)
          scope.setFingerprint(['slow-tick'])
          Sentry.captureMessage('Slow tick', 'warning')
        })
      } else {
        log.debug({ ...health, phases }, `tick ${health.tick}: ${health.durationMs.toFixed(1)} ms`)
      }
    },

    tickError(world, error) {
      log.error({ err: error, tick: world.tick, seed: world.seed }, 'tick failed')
      withWorldScope(world, [], () => Sentry.captureException(error))
    },

    scriptError(world, error, where) {
      log.error(
        { err: error, tick: world.tick, seed: world.seed, ...where },
        where.scriptId === undefined
          ? `scripts of realm ${where.realmId} failed`
          : `script ${where.scriptId} failed and ended`,
      )
      withWorldScope(world, where.entityIds, (scope) => {
        scope.setTag('realm_id', where.realmId)
        if (where.scriptId !== undefined) scope.setTag('script_id', where.scriptId)
        // The same bug groups into one Sentry issue, whichever script or resident hit it.
        scope.setFingerprint(['script-error', '{{ default }}'])
        Sentry.captureException(error)
      })
    },
  }
}

/**
 * Reports an error that escaped a client's WebSocket message handler (ADR 0004): logged, and sent
 * to Sentry with the Player it came from.
 */
export function reportClientError(log: Logger, error: unknown, userId: number): void {
  log.error({ err: error, userId }, 'client message failed')
  Sentry.withScope((scope) => {
    scope.setTag('user_id', userId)
    Sentry.captureException(error)
  })
}

export const setupFastifyErrorHandler = Sentry.setupFastifyErrorHandler
export const flushSentry = (timeoutMs = 2000) => Sentry.close(timeoutMs)
