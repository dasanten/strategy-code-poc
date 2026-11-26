import type { Percentiles, TickHealthResponse, WindowStats } from '@csp/shared-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TickHealthView } from './TickHealth.js'
import {
  TICK_HEALTH_POLL_MS,
  phasesSlowestFirst,
  pollTickHealth,
  type TickHealthState,
} from './tick-health.js'

const p = (p50: number, p95: number, max = p95): Percentiles => ({ p50, p95, max })

const stretch = (ticks: number, phases: Record<string, Percentiles>, tick: Percentiles) =>
  ({
    ticks,
    slow: 1,
    durationMs: tick,
    residents: p(120, 124, 125),
    scriptRuns: p(30, 41, 52),
    phases,
  }) satisfies WindowStats

const HEALTH: TickHealthResponse = {
  slowTickMs: 800,
  // In the server's order; the slowest is `npc`, and `scripts` is over the threshold too.
  lastMinute: stretch(
    60,
    { orders: p(0.2, 0.4), scripts: p(300, 850), world: p(4, 9), npc: p(500, 900) },
    p(820, 1400, 2000),
  ),
  lastHour: stretch(
    3600,
    { orders: p(0.1, 0.3), scripts: p(40, 90), npc: p(60, 120) },
    p(110, 240),
  ),
}

const view = (state: TickHealthState) => renderToStaticMarkup(createElement(TickHealthView, state))

/** The markup of the window titled `title`, up to the next window. */
const part = (html: string, title: string) =>
  html.split('class="tick-health-window"').find((w) => w.includes(`<h3>${title}</h3>`)) ?? ''

/** The phase names of a window's phase table, top to bottom. */
const phaseOrder = (html: string) =>
  [...html.split('<th>Phase</th>')[1]!.matchAll(/<tr[^>]*><th>([a-z]+)/g)].map((m) => m[1])

describe('the Tick health tab', () => {
  it('shows the last minute and the last hour: tick, residents and script runs', () => {
    const html = view({ health: HEALTH, fetchedAt: Date.UTC(2026, 10, 10, 20, 15, 30) })
    const minute = part(html, 'Last minute')
    expect(minute).toContain('60 ticks, 1 slow')
    expect(minute).toContain('<th>Tick</th><td>820 ms</td><td>1400 ms</td><td>2000 ms</td>')
    expect(minute).toContain('<th>Residents</th><td>120</td><td>124</td><td>125</td>')
    expect(minute).toContain('<th>Script runs</th><td>30</td><td>41</td><td>52</td>')
    const hour = part(html, 'Last hour')
    expect(hour).toContain('3600 ticks, 1 slow')
    expect(hour).toContain('<th>Tick</th><td>110 ms</td><td>240 ms</td><td>240 ms</td>')
  })

  it('lists the phases slowest first, with p50 and p95', () => {
    const html = view({ health: HEALTH, fetchedAt: 0 })
    expect(phaseOrder(part(html, 'Last minute'))).toEqual(['npc', 'scripts', 'world', 'orders'])
    expect(phaseOrder(part(html, 'Last hour'))).toEqual(['npc', 'scripts', 'orders'])
    expect(part(html, 'Last minute')).toContain('<th>world</th><td>4.0 ms</td><td>9.0 ms</td>')
  })

  it('marks a phase whose p95 is over the server’s slow-tick threshold', () => {
    const minute = part(view({ health: HEALTH, fetchedAt: 0 }), 'Last minute')
    expect(minute).toContain('<tr class="slow"><th>npc (slow)</th>')
    expect(minute).toContain('<tr class="slow"><th>scripts (slow)</th>')
    expect(minute).toContain('<tr><th>world</th>')
    // The threshold is the server's: raised above every phase, none is marked.
    const relaxed = view({ health: { ...HEALTH, slowTickMs: 1000 }, fetchedAt: 0 })
    expect(relaxed).not.toContain('(slow)')
    expect(relaxed).toContain('is over 1000 ms is marked slow')
  })

  it('says when the numbers were fetched', () => {
    const at = Date.UTC(2026, 10, 10, 20, 15, 30)
    const html = view({ health: HEALTH, fetchedAt: at })
    expect(html).toContain(`Fetched at ${new Date(at).toLocaleTimeString('en-GB')}.`)
    expect(view({})).toContain('Not fetched yet.')
  })

  it('shows an error line when the fetch fails, and keeps the last numbers', () => {
    const html = view({ health: HEALTH, fetchedAt: 0, error: 'Cannot reach the server.' })
    expect(html).toContain(
      '<p role="alert" class="error">Could not fetch the tick health: Cannot reach the server.</p>',
    )
    expect(html).toContain('<h3>Last minute</h3>')
    expect(view({ health: HEALTH, fetchedAt: 0 })).not.toContain('role="alert"')
  })

  it('shows no tables for a window without ticks', () => {
    const empty = { ...HEALTH, lastMinute: stretch(0, {}, p(0, 0)) }
    const minute = part(view({ health: empty, fetchedAt: 0 }), 'Last minute')
    expect(minute).toContain('0 ticks')
    expect(minute).not.toContain('<table')
  })
})

describe('phases slowest first', () => {
  it('orders by p95, then p50, keeping the server’s order on ties', () => {
    const stats = stretch(1, { a: p(1, 5), b: p(2, 5), c: p(9, 9), d: p(2, 5) }, p(1, 1))
    expect(phasesSlowestFirst(stats).map(([name]) => name)).toEqual(['c', 'b', 'd', 'a'])
  })
})

describe('fetching the tick health', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Runs the poll over `answers` (an Error fails that fetch) and keeps the state it shows. */
  function poll(answers: (TickHealthResponse | Error)[]) {
    vi.useFakeTimers()
    let state: TickHealthState = {}
    let clock = 1000
    const load = vi.fn(() => {
      const a = answers.shift() ?? HEALTH
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a)
    })
    const stop = pollTickHealth(
      load,
      (update) => (state = update(state)),
      () => clock++,
    )
    return { load, stop, state: () => state }
  }

  it('fetches at once and every 10 s until stopped', async () => {
    const { load, stop, state } = poll([HEALTH])
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    expect(state()).toEqual({ health: HEALTH, fetchedAt: 1000 })
    await vi.advanceTimersByTimeAsync(TICK_HEALTH_POLL_MS - 1)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(state().fetchedAt).toBe(1001)
    stop()
    await vi.advanceTimersByTimeAsync(TICK_HEALTH_POLL_MS * 3)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the last numbers with the error when a fetch fails, and clears it on the next', async () => {
    const { stop, state } = poll([HEALTH, new Error('Request failed (502).')])
    await vi.advanceTimersByTimeAsync(TICK_HEALTH_POLL_MS)
    expect(state()).toEqual({ health: HEALTH, fetchedAt: 1000, error: 'Request failed (502).' })
    await vi.advanceTimersByTimeAsync(TICK_HEALTH_POLL_MS)
    expect(state()).toEqual({ health: HEALTH, fetchedAt: 1001 })
    stop()
  })

  it('drops an answer that comes after the tab closed', async () => {
    const { stop, state } = poll([HEALTH])
    stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(state()).toEqual({})
  })
})
