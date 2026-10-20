import {
  SCRIPT_LOG_INTERVAL,
  SCRIPT_MEMORY_MAX,
  SCRIPT_REALM_STEP_BUDGET,
  SCRIPT_STEP_BUDGET,
  TICKS_PER_GAME_YEAR,
  Terrain,
  type RealmEvent,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, schema, type Db, type OpenDb } from './db/index.js'
import { OrderQueue, orderKinds } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import {
  ScriptRunner,
  keepMemory,
  runScriptOrder,
  runningScriptsSound,
  type ScriptHost,
} from './script-runner.js'
import { createScript, deleteScript, runnableScript, saveScript } from './scripts.js'
import { entitiesInSight } from './sight.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

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

const host = (): ScriptHost => ({
  script: (id) => runnableScript(db, id),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
})

/** Mara's realm r1 with `count` residents a0, a1, … side by side from (10, 10). */
function setup(count = 1) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: mara, leaderId: 'a0' })
  for (let i = 0; i < count; i++) {
    const r = newResident(mulberry32(i + 1), {
      id: `a${i}`,
      owner: 'r1',
      x: 10 + i,
      y: 10,
      tick: 0,
    })
    r.bornAt = -20 * TICKS_PER_GAME_YEAR
    r.lifespan = 60
    world.residents.push(r)
  }
  const orders = new OrderQueue({ ...orderKinds, runScript: runScriptOrder(host()) }, terrain)
  const runner = new ScriptRunner(terrain, host())
  return { world, orders, runner }
}

const sender = () => ({ userId: mara, account: { name: 'Mara', isAdmin: false } })

/** Gives residents the run-script order and applies it, as the next tick would. */
function giveScript(world: WorldState, orders: OrderQueue, scriptId: number, ids: string[]) {
  for (const residentId of ids) {
    const answer = orders.receive(world, sender(), 'q', { kind: 'runScript', residentId, scriptId })
    expect(answer).toEqual({ type: 'ack', requestId: 'q' })
  }
  orders.applyAll(world)
}

const scriptEvents = (world: WorldState): RealmEvent[] =>
  world.events.filter((e) => e.kind.startsWith('script'))

describe('the run-script order', () => {
  it('is only for the Player’s own residents and scripts that can run', () => {
    const { world, orders } = setup()
    const s = createScript(db, mara, { name: 'idle', source: 'let x = 1' })
    const broken = createScript(db, mara, { name: 'broken', source: 'let = ' })
    const tobin = db.insert(schema.users).values({ name: 'Tobin' }).returning().get().id
    const theirs = createScript(db, tobin, { name: 'theirs', source: 'let x = 1' })
    const order = (scriptId: number, residentId = 'a0') =>
      orders.receive(world, sender(), 'q', { kind: 'runScript', residentId, scriptId })
    expect(order(s.id)).toEqual({ type: 'ack', requestId: 'q' })
    expect(order(s.id, 'nobody')).toMatchObject({ reason: 'not one of your residents' })
    for (const id of [broken.id, theirs.id, 999]) {
      expect(order(id)).toMatchObject({ type: 'rejected' })
    }
  })

  it('starts from fresh memory, ends the order before it and is ended by any other order', () => {
    const { world, orders, runner } = setup()
    const s = createScript(db, mara, { name: 'count', source: 'memory.n = 1' })
    world.residents[0]!.order = {
      kind: 'walkTo',
      target: { x: 30, y: 30 },
      path: null,
      progress: 0,
    }
    giveScript(world, orders, s.id, ['a0'])
    const a0 = world.residents[0]!
    expect(a0.order).toBeNull()
    expect(a0.script).toEqual({ scriptId: s.id, memory: {} })

    orders.receive(world, sender(), 'q', { kind: 'walkTo', residentId: 'a0', x: 20, y: 10 })
    orders.applyAll(world)
    runner.runAll(world)
    expect(a0.script).toBeUndefined()
    expect(a0.order?.kind).toBe('walkTo')
  })
})

describe('running scripts', () => {
  it('keeps memory between ticks', () => {
    const { world, orders, runner } = setup()
    const s = createScript(db, mara, {
      name: 'count',
      source: 'if (memory.n == null) { memory.n = 0 } memory.n = memory.n + 1',
    })
    giveScript(world, orders, s.id, ['a0'])
    for (let i = 0; i < 3; i++) {
      runner.runAll(world)
      world.tick++
    }
    expect(world.residents[0]!.script?.memory).toEqual({ n: 3 })
    expect(runningScriptsSound(world)).toEqual([])
  })

  it('hands over to a built-in order and takes control back when it is done', () => {
    const { world, orders, runner } = setup()
    // Walk to (13, 10); once there, walk back to (10, 10); then stay.
    const s = createScript(db, mara, {
      name: 'there and back',
      source: `
        if (me.order == null) {
          if (memory.leg == null) { memory.leg = 1; walkTo(13, 10) }
          else if (memory.leg == 1) { memory.leg = 2; walkTo(10, 10) }
        }`,
    })
    giveScript(world, orders, s.id, ['a0'])
    const a0 = world.residents[0]!
    const walking = new Walking(terrain)
    const seen: string[] = []
    for (let i = 0; i < 200 && !(a0.script?.memory.leg === 2 && a0.order === null); i++) {
      runner.runAll(world, true)
      stepWorld(world, terrain, walking)
      seen.push(`${a0.x},${a0.y}`)
    }
    expect(seen).toContain('13,10')
    expect(a0).toMatchObject({ x: 10, y: 10, order: null })
    expect(a0.script?.memory).toEqual({ leg: 2 })
  })

  it('picks up a saved change on the next tick, and ends when the script is deleted', () => {
    const { world, orders, runner } = setup()
    const s = createScript(db, mara, { name: 'role', source: 'memory.role = "miner"' })
    giveScript(world, orders, s.id, ['a0'])
    const a0 = world.residents[0]!
    runner.runAll(world)
    expect(a0.script?.memory).toEqual({ role: 'miner' })

    saveScript(db, mara, s.id, { source: 'memory.role = "farmer"' })
    runner.runAll(world)
    expect(a0.script?.memory).toEqual({ role: 'farmer' })

    // A version with syntax errors never becomes active, so the last good one keeps running.
    saveScript(db, mara, s.id, { source: 'memory.role = ' })
    memoryIs(runner, world, { role: 'farmer' })

    deleteScript(db, mara, s.id)
    runner.runAll(world)
    expect(a0.script).toBeUndefined()
    expect(scriptEvents(world)).toMatchObject([{ kind: 'scriptEnded', residentId: 'a0' }])
  })

  it('gives each resident its own step budget, and the realm one together', () => {
    const count = SCRIPT_REALM_STEP_BUDGET / SCRIPT_STEP_BUDGET + 2
    const { world, orders, runner } = setup(count)
    const s = createScript(db, mara, {
      name: 'busy',
      source: 'memory.ran = tick; while (true) {}',
    })
    const ids = world.residents.map((r) => r.id)
    giveScript(world, orders, s.id, ids)
    // Each tick two residents skip, and who skips rotates: over `count` ticks everyone runs.
    const ran = new Set<string>()
    for (let t = 0; t < count; t++) {
      runner.runAll(world)
      const now = world.residents.filter((r) => r.script?.memory.ran === world.tick)
      expect(now).toHaveLength(count - 2)
      for (const r of now) ran.add(r.id)
      world.tick++
    }
    expect(ran.size).toBe(count)
    // Out of steps is a warning in the realm log: once per resident, rate-limited.
    const warnings = scriptEvents(world).filter((e) => e.kind === 'scriptOutOfSteps')
    expect(new Set(warnings.map((e) => e.kind === 'scriptOutOfSteps' && e.residentId)).size).toBe(
      count,
    )
    expect(warnings).toHaveLength(count)
    expect(warnings.filter((e) => e.kind === 'scriptOutOfSteps' && e.realm).length).toBeGreaterThan(
      0,
    )
  })

  it('logs runtime errors in the realm log, at most once a minute, and keeps what it requested', () => {
    const { world, orders, runner } = setup()
    const s = createScript(db, mara, { name: 'oops', source: 'walkTo(12, 10)\nlet x = null\nx.a' })
    giveScript(world, orders, s.id, ['a0'])
    for (let t = 0; t <= SCRIPT_LOG_INTERVAL; t++) {
      runner.runAll(world)
      world.tick++
    }
    expect(world.residents[0]!.order?.kind).toBe('walkTo')
    const errors = scriptEvents(world)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({
      kind: 'scriptError',
      residentId: 'a0',
      scriptId: s.id,
      message: 'Can\'t read "a" of null',
      line: 3,
      tick: 0,
    })
    expect(errors[1]?.tick).toBe(SCRIPT_LOG_INTERVAL)
  })

  it('caps memory: a run that leaves too much keeps the memory from before', () => {
    const { world, orders, runner } = setup()
    const s = createScript(db, mara, {
      name: 'hoard',
      source: `
        if (memory.n == null) { memory.n = 0 } else {
          let s = "x"; while (s.length < ${SCRIPT_MEMORY_MAX}) { s = s + s }
          memory.big = s
        }`,
    })
    giveScript(world, orders, s.id, ['a0'])
    runner.runAll(world)
    runner.runAll(world)
    expect(world.residents[0]!.script?.memory).toEqual({ n: 0 })
    expect(scriptEvents(world)).toMatchObject([{ kind: 'scriptError', message: /at most/ }])
  })

  it('keeps no functions or values that hold themselves in memory', () => {
    expect(keepMemory({ a: [1, { b: 'c' }], d: null })).toEqual({ a: [1, { b: 'c' }], d: null })
    const loop: Record<string, never> = {}
    ;(loop as Record<string, unknown>).self = loop
    expect(keepMemory(loop)).toMatch(/holds itself/)
  })

  it('shows Players which script a resident runs, not its memory', () => {
    const { world, orders } = setup()
    const s = createScript(db, mara, { name: 'role', source: 'memory.role = "miner"' })
    giveScript(world, orders, s.id, ['a0'])
    world.residents[0]!.script!.memory = { secret: 1 }
    const [seen] = entitiesInSight(world, terrain, 'r1')
    expect(seen).toMatchObject({ is: 'resident', script: { scriptId: s.id } })
    expect(JSON.stringify(seen)).not.toContain('secret')
  })

  it('stops for a resident who no longer belongs to the script’s Player', () => {
    const { world, orders, runner } = setup()
    const s = createScript(db, mara, { name: 'role', source: 'memory.role = "miner"' })
    giveScript(world, orders, s.id, ['a0'])
    world.residents[0]!.owner = null
    runner.runAll(world)
    expect(world.residents[0]!.script).toBeUndefined()
  })
})

function memoryIs(runner: ScriptRunner, world: WorldState, memory: object) {
  runner.runAll(world)
  expect(world.residents[0]!.script?.memory).toEqual(memory)
}
