import { describe, expect, it, vi } from 'vitest'
import { Terrain, type WorldState } from '@csp/shared'
import { TOP_LEVEL_PHASES, TickTimer, runTick, type TickReporter } from './tick.js'
import type { OrderQueue } from './orders.js'
import type { ScriptRunner } from './script-runner.js'
import { Walking } from './walking.js'
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
    expect(health).toEqual({
      tick: 1,
      durationMs: expect.any(Number),
      phases: expect.any(Object),
      residents: 8,
      actions: 8,
      // Last seen works out once what the one realm sees.
      sightBuilds: 1,
      slow: false,
    })
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

  it('spreads the world invariants over the ticks of a round', () => {
    const world = worldWithCity().world
    const lake = terrain.tiles.indexOf(Terrain.Lake)
    for (const r of world.residents) {
      Object.assign(r, { x: lake % terrain.size, y: Math.floor(lake / terrain.size) })
    }
    const reporter = fakeReporter()
    // A rate of 0.1 and no before-and-after checks drawn: one tick in ten finds them in the lake.
    const ticks = 10
    for (let i = 0; i < ticks; i++) {
      runTick(world, terrain, {
        reporter,
        invariantSampleRate: 0.1,
        slowTickMs: 800,
        rand: () => 1,
      })
    }
    const found = reporter.invariantViolations.mock.calls.filter(([, violations]) =>
      (violations as { invariant: string }[]).some(
        (v) => v.invariant === 'nothing-on-impassable-terrain',
      ),
    )
    expect(found).toHaveLength(1)
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

describe('TickTimer', () => {
  it('counts the time of a phase that throws, then lets the error on', () => {
    const timer = new TickTimer(clock(5))
    expect(() =>
      timer.time('world', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(timer.phases.world).toBe(5)
    // The timer still works for the next phase.
    expect(timer.time('save', () => 'saved')).toBe('saved')
    expect(timer.phases.save).toBe(5)
  })

  it('adds up the calls of one phase', () => {
    const timer = new TickTimer(clock(2))
    timer.time('rest', () => undefined)
    timer.time('rest', () => undefined)
    expect(timer.phases.rest).toBe(4)
    expect(timer.phases.npc).toBe(0)
  })
})

describe('runTick phases', () => {
  /** A clock that stands still unless a phase moves it on. */
  function stillClock() {
    let t = 0
    return { now: () => t, advance: (ms: number) => void (t += ms) }
  }

  it('times each phase, finish included, and they add up to the tick', () => {
    const world = worldWithCity().world
    const { now, advance } = stillClock()
    const health = runTick(world, terrain, {
      reporter: fakeReporter(),
      invariantSampleRate: 1,
      slowTickMs: 800,
      now,
      orders: { applyAll: () => advance(10) } as unknown as OrderQueue,
      scripts: { runAll: () => (advance(20), []) } as unknown as ScriptRunner,
      finish: (timer) => {
        timer.time('sight', () => advance(30))
        timer.time('broadcast', () => advance(40))
      },
    })!
    expect(health.phases).toMatchObject({ orders: 10, scripts: 20, sight: 30, broadcast: 40 })
    expect(health.durationMs).toBe(100)
    const topLevel = TOP_LEVEL_PHASES.reduce((sum, p) => sum + health.phases[p], 0)
    expect(topLevel).toBeCloseTo(health.durationMs, 5)
    const { npc, walking, rest } = health.phases
    expect(npc + walking + rest).toBeCloseTo(health.phases.world, 5)
  })

  it('splits the world phase into npc, walking, rest and lastSeen', () => {
    const world = worldWithCity().world
    const health = runTick(world, terrain, {
      reporter: fakeReporter(),
      invariantSampleRate: 0,
      slowTickMs: 800,
      walking: new Walking(terrain),
    })!
    for (const phase of ['world', 'npc', 'walking', 'rest', 'lastSeen'] as const) {
      expect(health.phases[phase]).toBeGreaterThan(0)
    }
    for (const phase of ['territory', 'sight', 'broadcast', 'save'] as const) {
      expect(health.phases[phase]).toBe(0)
    }
  })

  it('reports a slow tick with its phases', () => {
    const reporter = fakeReporter()
    const health = runTick(worldWithCity().world, terrain, {
      reporter,
      invariantSampleRate: 1,
      slowTickMs: 800,
      now: clock(801),
    })
    expect(health?.slow).toBe(true)
    expect(reporter.tickHealth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        slow: true,
        phases: expect.objectContaining({ world: expect.any(Number) }),
      }),
    )
  })

  it('reports an error thrown while finishing instead of throwing', () => {
    const world = worldWithCity().world
    const reporter = fakeReporter()
    const health = runTick(world, terrain, {
      reporter,
      invariantSampleRate: 1,
      slowTickMs: 800,
      finish: (timer) =>
        timer.time('broadcast', () => {
          throw new Error('socket gone')
        }),
    })
    expect(health).toBeUndefined()
    expect(reporter.tickError).toHaveBeenCalledWith(world, expect.any(Error))
    expect(reporter.tickHealth).not.toHaveBeenCalled()
  })
})
