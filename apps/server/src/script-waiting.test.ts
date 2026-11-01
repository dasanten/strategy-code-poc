import { TICKS_PER_GAME_YEAR, Terrain, type TerrainMap, type WorldState } from '@csp/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startDefence } from './defence.js'
import { openDb, schema, type Db, type OpenDb } from './db/index.js'
import { checkInvariants } from './invariants.js'
import { village } from './npc-growth.fixture.js'
import { OrderQueue, orderKinds } from './orders.js'
import { scriptRunFor } from './realtime.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, runScriptOrder, waitingSound, type ScriptHost } from './script-runner.js'
import { createScript, runnableScript } from './scripts.js'
import { seenScript } from './sight.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Waiting (`CONTEXT.md`: Running a script, Waiting): a script that calls `wait()` is not run
 * again until its order ends, is replaced, or the resident is struck.
 */

const SIZE = 64
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }

let opened: OpenDb
let db: Db
let mara: number

beforeEach(async () => {
  opened = await openDb(':memory:')
  db = opened.db
  mara = db.insert(schema.users).values({ name: 'Mara' }).returning().get().id
})
afterEach(() => opened.close())

const sender = () => ({ userId: mara, account: { name: 'Mara', isAdmin: false } })

const host = (): ScriptHost => ({
  script: (id) => runnableScript(db, id),
  sender: () => sender(),
  explored: () => true,
})

/**
 * Mara's resident a0 at (10, 10) running a script that counts its runs in `memory.runs` and runs
 * `source` after.
 */
function setup(source: string) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: mara, leaderId: 'a0' })
  const r = newResident(mulberry32(1), { id: 'a0', owner: 'r1', x: 10, y: 10, tick: 0 })
  r.bornAt = -20 * TICKS_PER_GAME_YEAR
  r.lifespan = 60
  world.residents.push(r)
  const s = createScript(db, mara, {
    name: 'walker',
    source: `if (memory.runs == null) { memory.runs = 0 }\nmemory.runs = memory.runs + 1\n${source}`,
  })
  const orders = new OrderQueue({ ...orderKinds, runScript: runScriptOrder(host()) }, terrain)
  orders.receive(world, sender(), 'q', { kind: 'runScript', residentId: 'a0', scriptId: s.id })
  orders.applyAll(world)
  const runner = new ScriptRunner(terrain, host())
  return { world, a0: world.residents[0]!, runner, walking: new Walking(terrain) }
}

/** One tick: scripts run (checked, ADR 0004), then the world steps. */
function tick(world: WorldState, runner: ScriptRunner, walking: Walking): void {
  for (const r of world.residents) r.hunger = 100
  expect(runner.runAll(world, true)).toEqual([])
  stepWorld(world, terrain, walking)
}

// Walks to (16, 10) and waits; there, walks back to (10, 10) and waits.
const THERE_AND_BACK = `
if (me.order == null) {
  if (me.x == 10) { walkTo(16, 10) } else { walkTo(10, 10) }
  wait()
}`

describe('a waiting script', () => {
  it('is not run while its walk lasts, and runs again on arrival', () => {
    const { world, a0, runner, walking } = setup(THERE_AND_BACK)
    tick(world, runner, walking)
    expect(a0.script?.waitingSince).toBe(0)
    expect(a0.order?.kind).toBe('walkTo')
    let ticks = 1
    while (a0.order !== null && ticks < 100) {
      tick(world, runner, walking)
      expect(runner.runs).toBe(0)
      ticks++
    }
    expect(a0).toMatchObject({ x: 16, y: 10 })
    expect(a0.script?.memory.runs).toBe(1)
    // Arrived: it runs again and sets off back.
    tick(world, runner, walking)
    expect(runner.runs).toBe(1)
    expect(a0.script?.memory.runs).toBe(2)
    expect(a0.order).toMatchObject({ kind: 'walkTo', target: { x: 10, y: 10 } })
    expect(ticks).toBeGreaterThan(5)
  })

  it('runs again once its order is replaced', () => {
    const { world, a0, runner, walking } = setup(THERE_AND_BACK)
    tick(world, runner, walking)
    tick(world, runner, walking)
    expect(runner.runs).toBe(0)
    // Something of the game's gives them another walk of the same kind.
    a0.order = { kind: 'walkTo', target: { x: 12, y: 12 }, path: null, progress: 0 }
    tick(world, runner, walking)
    expect(runner.runs).toBe(1)
    expect(a0.script?.waitingSince).toBeUndefined()
  })

  it('runs the same tick they are struck', () => {
    const { world, a0, runner, walking } = setup(THERE_AND_BACK)
    tick(world, runner, walking)
    a0.struck = { by: 'someone', tick: world.tick }
    tick(world, runner, walking)
    expect(runner.runs).toBe(1)
    expect(a0.script?.memory.runs).toBe(2)
  })

  it('struck by a blow that starts their defence script, runs again once it hands back', () => {
    const { world, a0, runner, walking } = setup(THERE_AND_BACK)
    tick(world, runner, walking)
    const waiting = a0.script!
    startDefence(world, a0)
    expect(waiting.waitingSince).toBeUndefined()
    expect(a0.interrupted?.script).toBe(waiting)
  })

  it('with no order to wait on runs next tick as before, logging nothing', () => {
    const { world, a0, runner, walking } = setup('wait()')
    tick(world, runner, walking)
    tick(world, runner, walking)
    expect(runner.runs).toBe(1)
    expect(a0.script?.memory.runs).toBe(2)
    expect(a0.script?.waitingSince).toBeUndefined()
    expect(a0.scriptLog ?? []).toEqual([])
    expect(world.events).toEqual([])
  })

  it('shows its owner it waits, on the Doing line and the Script tab', () => {
    const { world, a0, runner, walking } = setup(THERE_AND_BACK)
    tick(world, runner, walking)
    expect(seenScript(world, a0.script!, true).waiting).toBe(true)
    expect(seenScript(world, a0.script!, false)).not.toHaveProperty('waiting')
    expect(scriptRunFor(world, 'r1', 'a0')).toMatchObject({ waitingSince: 0 })
  })
})

describe('an NPC town’s residents', () => {
  it('run their defaults far fewer times than once a tick each, on their way to work', () => {
    const { world, terrain: land } = village()
    const walking = new Walking(land)
    // Settled at work, then each finds themself 30 tiles off and walks back.
    for (let t = 0; t < 20; t++) stepWorld(world, land, walking)
    const workers = world.residents.filter((r) => r.script?.task === 'work' && r.order)
    expect(workers.length).toBeGreaterThan(3)
    for (const r of workers) {
      r.x += 30
      r.order = null
    }
    let runs = 0
    let running = 0
    const atWork = () => workers.every((r) => r.order?.kind === 'workAt')
    for (let t = 0; t < 2000 && !atWork(); t++) {
      running += world.residents.filter((r) => r.script).length
      runs += stepWorld(world, land, walking).npcScriptRuns
    }
    expect(atWork()).toBe(true)
    // Before waiting, every one of them ran every tick: `runs` was `running`.
    expect(runs).toBeLessThan(running * 0.6)
    expect(checkInvariants(world, land)).toEqual([])
  })
})

describe('waiting invariant', () => {
  it('flags a waiting script with no order, or one from the future (ADR 0004)', () => {
    const { world, a0, runner, walking } = setup(THERE_AND_BACK)
    tick(world, runner, walking)
    expect(waitingSound(world, world.residents)).toEqual([])
    a0.order = null
    a0.script!.waitingSince = world.tick + 5
    expect(waitingSound(world, world.residents).map((v) => v.message)).toEqual([
      'a0 waits with no order',
      `a0 began waiting at tick ${world.tick + 5}, after ${world.tick}`,
    ])
  })
})
