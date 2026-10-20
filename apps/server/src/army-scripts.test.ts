import {
  ARMY_SCRIPT_API,
  SCRIPT_REALM_STEP_BUDGET,
  SCRIPT_STEP_BUDGET,
  TICKS_PER_GAME_YEAR,
  Terrain,
  type OrderRequest,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { armyOrders } from './armies.js'
import { openDb, schema, type Db, type OpenDb } from './db/index.js'
import { OrderQueue, orderKinds } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { ARMY_SCRIPT_ORDER_KINDS, armyScriptRequestsSound, bindScript } from './script-bindings.js'
import {
  ScriptRunner,
  armyRunScriptOrder,
  runScriptOrder,
  runningScriptsSound,
  type ScriptHost,
} from './script-runner.js'
import { createScript, deleteScript, runnableScript } from './scripts.js'
import { entitiesInSight } from './sight.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** Scripts for armies (`CONTEXT.md`: Running a script, Army). */

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
const sender = () => ({ userId: mara, account: { name: 'Mara', isAdmin: false } })

/**
 * Mara's realm r1 with residents a0, a1, a2 side by side from (10, 10), and the army "North" of
 * a0 and a1. Realm r2 has b0 at (14, 10), in sight.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: mara, leaderId: 'a0' })
  world.realms.push({ id: 'r2', userId: mara + 1, leaderId: 'b0' })
  const add = (id: string, owner: string, x: number) => {
    const r = newResident(mulberry32(world.residents.length + 1), {
      id,
      owner,
      x,
      y: 10,
      tick: 0,
    })
    r.bornAt = -20 * TICKS_PER_GAME_YEAR
    r.lifespan = 60
    world.residents.push(r)
  }
  for (let i = 0; i < 3; i++) add(`a${i}`, 'r1', 10 + i)
  add('b0', 'r2', 14)
  world.armies.push({
    id: 'army1',
    name: 'North',
    realmId: 'r1',
    memberIds: ['a0', 'a1'],
    order: null,
  })
  const orders = new OrderQueue(
    {
      ...orderKinds,
      runScript: runScriptOrder(host()),
      armyRunScript: armyRunScriptOrder(host()),
    },
    terrain,
  )
  const runner = new ScriptRunner(terrain, host())
  return { world, orders, runner, army: world.armies[0]! }
}

function order(world: WorldState, orders: OrderQueue, o: OrderRequest) {
  return orders.receive(world, sender(), 'q', o)
}

/** Gives the army the run-script order and applies it, as the next tick would. */
function giveScript(world: WorldState, orders: OrderQueue, scriptId: number, armyId = 'army1') {
  expect(order(world, orders, { kind: 'armyRunScript', armyId, scriptId })).toEqual({
    type: 'ack',
    requestId: 'q',
  })
  orders.applyAll(world)
}

describe('the run-script order for an army', () => {
  it('is only for the Player’s own armies and scripts that can run', () => {
    const { world, orders } = setup()
    const s = createScript(db, mara, { name: 'idle', source: 'let x = 1' })
    const broken = createScript(db, mara, { name: 'broken', source: 'let = ' })
    world.armies.push({
      id: 'army2',
      name: 'Theirs',
      realmId: 'r2',
      memberIds: ['b0'],
      order: null,
    })
    const run = (scriptId: number, armyId = 'army1') =>
      order(world, orders, { kind: 'armyRunScript', armyId, scriptId })
    expect(run(s.id)).toEqual({ type: 'ack', requestId: 'q' })
    expect(run(s.id, 'army2')).toMatchObject({ reason: 'not one of your armies' })
    expect(run(s.id, 'nope')).toMatchObject({ reason: 'not one of your armies' })
    for (const id of [broken.id, 999]) expect(run(id)).toMatchObject({ type: 'rejected' })
  })

  it('starts from fresh memory, ends the army’s order, keeps its members, and any other army order ends it', () => {
    const { world, orders, army } = setup()
    const s = createScript(db, mara, { name: 'idle', source: 'memory.n = 1' })
    order(world, orders, { kind: 'armyWalkTo', armyId: 'army1', x: 30, y: 10 })
    orders.applyAll(world)
    stepWorld(world, terrain, new Walking(terrain))
    expect(world.residents[0]!.order?.kind).toBe('walkTo')

    giveScript(world, orders, s.id)
    expect(army.order).toBeNull()
    expect(army.script).toEqual({ scriptId: s.id, memory: {} })
    expect(army.memberIds).toEqual(['a0', 'a1'])
    expect(world.residents[0]!.order).toBeNull()

    order(world, orders, { kind: 'armyGuard', armyId: 'army1', x: 12, y: 10 })
    orders.applyAll(world)
    expect(army.script).toBeUndefined()
    expect(army.order?.kind).toBe('guard')
  })

  it('is not ended by a resident’s order', () => {
    const { world, orders, army } = setup()
    const s = createScript(db, mara, { name: 'idle', source: 'memory.n = 1' })
    giveScript(world, orders, s.id)
    order(world, orders, { kind: 'walkTo', residentId: 'a2', x: 20, y: 10 })
    orders.applyAll(world)
    expect(army.script?.scriptId).toBe(s.id)
  })
})

describe('an army’s script', () => {
  it('runs once a tick with the army’s memory and gives army orders the members carry out', () => {
    const { world, orders, runner, army } = setup()
    // Walk the army to (20, 10); once there, guard (11, 12); count the ticks it ran.
    const s = createScript(db, mara, {
      name: 'march',
      source: `
        if (memory.n == null) { memory.n = 0 }
        memory.n = memory.n + 1
        if (me.order == null) {
          if (memory.leg == null) { memory.leg = 1; memory.answer = walkTo(20, 10) }
          else if (memory.leg == 1) { memory.leg = 2; guard(11, 12) }
        }`,
    })
    giveScript(world, orders, s.id)
    const walking = new Walking(terrain)
    let ticks = 0
    for (; ticks < 3000 && army.order?.kind !== 'guard'; ticks++) {
      expect(runner.runAll(world, true)).toEqual([])
      stepWorld(world, terrain, walking)
    }
    expect(army.order?.kind).toBe('guard')
    expect(army.script?.memory).toMatchObject({ n: ticks, leg: 2, answer: null })
    expect(world.events.filter((e) => e.kind.startsWith('script'))).toEqual([])
    const [a0, a1] = [world.residents[0]!, world.residents[1]!]
    // They got there together and are still the army's.
    expect(Math.abs(a0.x - a1.x)).toBeLessThanOrEqual(2)
    expect(army.memberIds).toEqual(['a0', 'a1'])
  })

  it('sees the army as `me`, with its members, and is told why an order is turned down', () => {
    const { world, orders, runner, army } = setup()
    const s = createScript(db, mara, {
      name: 'look',
      source: `
        memory.me = [me.id, me.name, me.members[1].id, me.members[0].age > 19, me.memberIds[0]]
        memory.own = attack("a2")
        memory.out = follow("a0")
        memory.ok = attack("b0")`,
    })
    giveScript(world, orders, s.id)
    runner.runAll(world)
    expect(army.script?.memory).toEqual({
      me: ['army1', 'North', 'a1', true, 'a0'],
      own: 'that is one of your own residents',
      out: 'that is one of the army',
      ok: null,
    })
    expect(army.order).toMatchObject({ kind: 'attack', targetId: 'b0' })
  })

  it('logs trouble naming the army, and ends when the script is deleted', () => {
    const { world, orders, runner, army } = setup()
    const s = createScript(db, mara, { name: 'oops', source: 'let x = nothing + 1' })
    giveScript(world, orders, s.id)
    runner.runAll(world)
    expect(world.events).toMatchObject([
      { kind: 'scriptError', armyId: 'army1', name: 'North', scriptId: s.id },
    ])
    deleteScript(db, mara, s.id)
    runner.runAll(world)
    expect(army.script).toBeUndefined()
    expect(world.events.at(-1)).toMatchObject({ kind: 'scriptEnded', armyId: 'army1' })
  })

  it('shares the realm’s step budget with its residents’ scripts', () => {
    const { world, orders, runner } = setup()
    const loop = createScript(db, mara, { name: 'loop', source: 'while (true) { }' })
    // Enough residents' scripts to use up the realm's budget, and the army's too.
    const count = SCRIPT_REALM_STEP_BUDGET / SCRIPT_STEP_BUDGET
    for (let i = 0; i < count; i++) {
      const r = newResident(mulberry32(100 + i), {
        id: `c${i}`,
        owner: 'r1',
        x: 20,
        y: 20,
        tick: 0,
      })
      world.residents.push(r)
      order(world, orders, { kind: 'runScript', residentId: r.id, scriptId: loop.id })
    }
    giveScript(world, orders, loop.id)
    runner.runAll(world)
    const cut = world.events.filter((e) => e.kind === 'scriptOutOfSteps' && e.realm)
    expect(cut).toHaveLength(1)
  })

  it('is seen by its Player as which script it runs, not its memory', () => {
    const { world, orders, army } = setup()
    const s = createScript(db, mara, { name: 'idle', source: 'let x = 1' })
    giveScript(world, orders, s.id)
    army.script!.memory = { secret: 1 }
    const seen = entitiesInSight(world, terrain, 'r1').find((e) => e.is === 'army')
    expect(seen).toMatchObject({ is: 'army', id: 'army1', script: { scriptId: s.id } })
    expect(JSON.stringify(seen)).not.toContain('secret')
  })

  it('ends with its army', () => {
    const { world, orders, runner } = setup()
    const s = createScript(db, mara, { name: 'count', source: 'memory.n = 1' })
    giveScript(world, orders, s.id)
    order(world, orders, { kind: 'disbandArmy', armyId: 'army1' })
    orders.applyAll(world)
    expect(world.armies).toEqual([])
    expect(runner.runAll(world, true)).toEqual([])
  })
})

describe('army script bindings', () => {
  it('bind every name in the army script API, and every army order but forming and disbanding', () => {
    const { world } = setup()
    const { globals } = bindScript({
      world,
      terrain,
      sender: sender(),
      armyId: 'army1',
      memory: {},
      seen: () => [],
      explored: () => true,
    })
    expect(Object.keys(globals).sort()).toEqual(ARMY_SCRIPT_API.map((b) => b.name).sort())
    const commands = Object.keys(armyOrders).filter((k) => k !== 'formArmy' && k !== 'disbandArmy')
    expect([...ARMY_SCRIPT_ORDER_KINDS].sort()).toEqual(commands.sort())
  })

  it('invariant: an army’s script requests only its own army orders', () => {
    const { world } = setup()
    const bad: OrderRequest[] = [
      { kind: 'walkTo', residentId: 'a0', x: 1, y: 1 },
      { kind: 'armyWalkTo', armyId: 'army9', x: 1, y: 1 },
      { kind: 'disbandArmy', armyId: 'army1' },
      { kind: 'armyAttack', armyId: 'army1', targetId: 'a2' },
    ]
    const found = bad.flatMap((o) =>
      armyScriptRequestsSound(world, terrain, sender(), 'army1', [o]),
    )
    expect(found).toHaveLength(bad.length)
    expect(
      armyScriptRequestsSound(world, terrain, sender(), 'army1', [
        { kind: 'armyWalkTo', armyId: 'army1', x: 1, y: 1 },
      ]),
    ).toEqual([])
  })

  it('invariant: an army’s running script is sound', () => {
    const { world, army } = setup()
    army.script = { scriptId: 0, memory: {}, errorLoggedAt: world.tick + 5 }
    expect(runningScriptsSound(world).map((v) => v.message)).toEqual([
      'army army1 runs script 0',
      `army army1 logged script trouble at tick ${world.tick + 5}, after ${world.tick}`,
    ])
  })
})
