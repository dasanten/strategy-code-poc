import { describe, expect, it, vi } from 'vitest'
import type { WorldState } from '@csp/shared'
import { runTick, type TickReporter } from './tick.js'
import { createWorld } from './world.js'

function fakeReporter() {
  return {
    invariantViolations: vi.fn(),
    tickHealth: vi.fn(),
    tickError: vi.fn(),
  } satisfies TickReporter
}

/** A clock that advances by `stepMs` on every read. */
function clock(stepMs: number) {
  let t = 0
  return () => (t += stepMs)
}

describe('runTick', () => {
  it('reports tick health with unit and action counts', () => {
    const world = createWorld()
    const reporter = fakeReporter()
    const health = runTick(world, {
      reporter,
      invariantSampleRate: 1,
      slowTickMs: 800,
      now: clock(5),
    })
    expect(health).toEqual({ tick: 1, durationMs: 5, units: 6, actions: 6, slow: false })
    expect(reporter.tickHealth).toHaveBeenCalledWith(world, health)
    expect(reporter.invariantViolations).not.toHaveBeenCalled()
  })

  it('flags a tick above the slow-tick threshold', () => {
    const health = runTick(createWorld(), {
      reporter: fakeReporter(),
      invariantSampleRate: 1,
      slowTickMs: 800,
      now: clock(801),
    })
    expect(health?.slow).toBe(true)
  })

  it('reports invariant violations on checked ticks only', () => {
    const world = createWorld()
    // Every unit on one tile: no move can make that legal again in one tick.
    for (const u of world.units) Object.assign(u, { x: world.units[0]!.x, y: world.units[0]!.y })
    const reporter = fakeReporter()

    runTick(world, { reporter, invariantSampleRate: 0, slowTickMs: 800 })
    expect(reporter.invariantViolations).not.toHaveBeenCalled()

    runTick(world, { reporter, invariantSampleRate: 1, slowTickMs: 800 })
    expect(reporter.invariantViolations).toHaveBeenCalledWith(
      world,
      expect.arrayContaining([expect.objectContaining({ invariant: 'one-unit-per-tile' })]),
    )
  })

  it('reports an error instead of throwing', () => {
    const broken = { ...createWorld(), units: null } as unknown as WorldState
    const reporter = fakeReporter()
    expect(runTick(broken, { reporter, invariantSampleRate: 1, slowTickMs: 800 })).toBeUndefined()
    expect(reporter.tickError).toHaveBeenCalledWith(broken, expect.any(TypeError))
  })
})
