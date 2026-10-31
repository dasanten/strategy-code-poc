import { describe, expect, it, vi } from 'vitest'
import { Terrain, type WorldState } from '@csp/shared'
import { runTick, type TickReporter } from './tick.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'

const terrain = cityTerrain()

function fakeReporter() {
  return {
    invariantViolations: vi.fn(),
    tickHealth: vi.fn(),
    tickError: vi.fn(),
    scriptError: vi.fn(),
  } satisfies TickReporter
}

/** A clock that advances by `stepMs` on every read. */
function clock(stepMs: number) {
  let t = 0
  return () => (t += stepMs)
}

describe('runTick', () => {
  it('reports tick health with resident and action counts', () => {
    const world = worldWithCity().world
    const reporter = fakeReporter()
    const health = runTick(world, terrain, {
      reporter,
      invariantSampleRate: 1,
      slowTickMs: 800,
      now: clock(5),
    })
    // Everyone starts working the farm: one work action each.
    expect(health).toEqual({ tick: 1, durationMs: 5, residents: 8, actions: 8, slow: false })
    expect(reporter.tickHealth).toHaveBeenCalledWith(world, health)
    expect(reporter.invariantViolations).not.toHaveBeenCalled()
  })

  it('flags a tick above the slow-tick threshold', () => {
    const health = runTick(worldWithCity().world, terrain, {
      reporter: fakeReporter(),
      invariantSampleRate: 1,
      slowTickMs: 800,
      now: clock(801),
    })
    expect(health?.slow).toBe(true)
  })

  it('reports invariant violations on checked ticks only', () => {
    const world = worldWithCity().world
    // Every resident in a lake; nothing moves them out again.
    const lake = terrain.tiles.indexOf(Terrain.Lake)
    for (const r of world.residents) {
      Object.assign(r, { x: lake % terrain.size, y: Math.floor(lake / terrain.size) })
    }
    const reporter = fakeReporter()

    runTick(world, terrain, { reporter, invariantSampleRate: 0, slowTickMs: 800 })
    expect(reporter.invariantViolations).not.toHaveBeenCalled()

    runTick(world, terrain, { reporter, invariantSampleRate: 1, slowTickMs: 800 })
    expect(reporter.invariantViolations).toHaveBeenCalledWith(
      world,
      expect.arrayContaining([
        expect.objectContaining({ invariant: 'nothing-on-impassable-terrain' }),
      ]),
    )
  })

  it('reports an error instead of throwing', () => {
    const broken = { ...worldWithCity().world, residents: null } as unknown as WorldState
    const reporter = fakeReporter()
    expect(
      runTick(broken, terrain, { reporter, invariantSampleRate: 1, slowTickMs: 800 }),
    ).toBeUndefined()
    expect(reporter.tickError).toHaveBeenCalledWith(broken, expect.any(TypeError))
  })
})
