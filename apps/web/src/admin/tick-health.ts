import type { Percentiles, TickHealthResponse, WindowStats } from '@csp/shared-types'

/** How often the admin panel's Tick health tab asks again while it is open, in ms. */
export const TICK_HEALTH_POLL_MS = 10_000

/** What the Tick health tab shows: the last answer and when it came, and the last failure. */
export interface TickHealthState {
  health?: TickHealthResponse
  /** When `health` was fetched, in ms since the epoch. */
  fetchedAt?: number
  /** Why the last fetch failed; cleared by the next one that works. */
  error?: string
}

/** A window's phases, slowest first by p95, then by p50; ties keep the server's order. */
export function phasesSlowestFirst(stats: WindowStats): [string, Percentiles][] {
  return Object.entries(stats.phases).sort(([, a], [, b]) => b.p95 - a.p95 || b.p50 - a.p50)
}

/**
 * Fetches the tick health now and every `everyMs` after, until the returned stop is called;
 * `show` gets the state after each answer or failure. An answer that comes after the stop is
 * dropped.
 */
export function pollTickHealth(
  load: () => Promise<TickHealthResponse>,
  show: (update: (s: TickHealthState) => TickHealthState) => void,
  now: () => number = Date.now,
  everyMs = TICK_HEALTH_POLL_MS,
): () => void {
  let stopped = false
  const fetchOnce = () =>
    load().then(
      (health) => {
        if (!stopped) show(() => ({ health, fetchedAt: now() }))
      },
      (err: unknown) => {
        if (stopped) return
        const error = err instanceof Error ? err.message : 'Something went wrong.'
        show((s) => ({ ...s, error }))
      },
    )
  void fetchOnce()
  const timer = setInterval(() => void fetchOnce(), everyMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/** A time in ms as the tab shows it: one decimal under 10 ms, whole ms above. */
export function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
}
