import { describe, expect, it, vi } from 'vitest'
import { generateTerrain } from './terrain-gen.js'
import type { Logger } from './log.js'
import { createTickReporter } from './monitoring.js'
import { TICK_PHASES, type TickHealth } from './tick.js'
import { createWorld } from './world.js'

function fakeLog() {
  return { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() }
}

function health(phases: Partial<TickHealth['phases']>, slow: boolean): TickHealth {
  const all = Object.fromEntries(TICK_PHASES.map((p) => [p, 0])) as TickHealth['phases']
  Object.assign(all, phases)
  const durationMs = Object.values(phases).reduce((a, b) => a + b, 0)
  return { tick: 7, durationMs, phases: all, residents: 3, actions: 2, slow }
}

describe('createTickReporter.tickHealth', () => {
  const world = createWorld(generateTerrain(1), 1)

  it('warns of a slow tick with its phases, slowest first', () => {
    const log = fakeLog()
    const reporter = createTickReporter(log as unknown as Logger)
    reporter.tickHealth(world, health({ world: 500.26, sight: 300, orders: 100 }, true))
    expect(log.warn).toHaveBeenCalledTimes(1)
    const [fields, message] = log.warn.mock.calls[0]!
    expect(message).toBe('slow tick: 900 ms, slowest phase world (500 ms)')
    expect(Object.entries(fields.phases).slice(0, 3)).toEqual([
      ['world', 500.3],
      ['sight', 300],
      ['orders', 100],
    ])
    expect(log.debug).not.toHaveBeenCalled()
  })

  it('logs every other tick with its phases at debug', () => {
    const log = fakeLog()
    const reporter = createTickReporter(log as unknown as Logger)
    reporter.tickHealth(world, health({ broadcast: 2, world: 5 }, false))
    expect(log.warn).not.toHaveBeenCalled()
    expect(log.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        tick: 7,
        durationMs: 7,
        phases: expect.objectContaining({ world: 5 }),
      }),
      'tick 7: 7.0 ms',
    )
    expect(Object.keys(log.debug.mock.calls[0]![0].phases).slice(0, 2)).toEqual([
      'world',
      'broadcast',
    ])
  })
})
