import * as Sentry from '@sentry/node'
import type { WorldState } from '@csp/shared'
import type { Logger } from './log.js'
import type { TickReporter } from './tick.js'

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
      if (health.slow) {
        log.warn({ ...health, seed: world.seed }, `slow tick: ${health.durationMs.toFixed(0)} ms`)
        withWorldScope(world, [], (scope) => {
          scope.setContext('tick_health', { ...health })
          scope.setFingerprint(['slow-tick'])
          Sentry.captureMessage('Slow tick', 'warning')
        })
      } else {
        log.trace({ ...health }, 'tick')
      }
    },

    tickError(world, error) {
      log.error({ err: error, tick: world.tick, seed: world.seed }, 'tick failed')
      withWorldScope(world, [], () => Sentry.captureException(error))
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
