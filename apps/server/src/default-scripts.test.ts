import { parse, run } from '@csp/lang'
import {
  DEFAULT_SCRIPTS,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_STEP_BUDGET,
  TASKS,
  Terrain,
  pileAt,
  type SeenEntity,
  type Task,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { checkScript } from '@csp/lang'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthError } from './auth.js'
import { openDb, schema, type Db, type OpenDb } from './db/index.js'
import { OrderQueue, orderKinds } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { bindScript } from './script-bindings.js'
import { ScriptRunner, runScriptOrder, taskOrder, type ScriptHost } from './script-runner.js'
import {
  activateVersion,
  checkScriptLibrary,
  createScript,
  defaultScriptId,
  deleteScript,
  ensureDefaultScripts,
  getScript,
  listScripts,
  renameScript,
  resetScript,
  runnableScript,
  saveScript,
  syncDefaultScripts,
} from './scripts.js'
import { addCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Default scripts (`CONTEXT.md`: Default script, Memory, Step budget; ADR 0009): each Player's
 * version follows the game's default until edited, can be reset, and Work from the UI runs it.
 */

const SIZE = 16
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }

let opened: OpenDb
let db: Db
let mara: number
let tobin: number

beforeEach(async () => {
  opened = await openDb(':memory:')
  db = opened.db
  mara = db.insert(schema.users).values({ name: 'Mara' }).returning().get().id
  tobin = db.insert(schema.users).values({ name: 'Tobin' }).returning().get().id
})
afterEach(() => opened.close())

/** Runs `body` while the game's default of `task` is `source`, as a later game version might. */
function withGameDefault(task: Task, source: string, body: () => void) {
  const shipped = DEFAULT_SCRIPTS[task]
  const before = shipped.source
  ;(shipped as { source: string }).source = source
  try {
    body()
  } finally {
    ;(shipped as { source: string }).source = before
  }
}

const workId = (userId = mara) => defaultScriptId(db, userId, 'work')
const WORK = DEFAULT_SCRIPTS.work.source
const sourceOf = (id: number) => runnableScript(db, id)?.source

describe('a Player’s default scripts', () => {
  it('are in their library from the start, one per task, following the game’s default', () => {
    const list = listScripts(db, mara)
    expect(list.map((s) => [s.name, s.task, s.followsDefault])).toEqual([
      ['Work (default)', 'work', true],
    ])
    const work = getScript(db, mara, list[0]!.id)
    expect(work.versions.map((v) => v.source)).toEqual([WORK])
    expect(work.activeVersion).toBe(1)
    expect(work.gameDefault).toEqual({ source: WORK, editedFrom: null })
    // Listing again makes no second one.
    expect(listScripts(db, mara)).toHaveLength(1)
    expect(workId()).toBe(list[0]!.id)
  })

  it('ship without syntax errors', () => {
    for (const task of TASKS) expect(checkScript(DEFAULT_SCRIPTS[task].source)).toEqual([])
  })

  it('can’t be renamed or deleted, and their names can’t be taken', () => {
    const id = workId()
    expect(() => renameScript(db, mara, id, { name: 'Mine' })).toThrow(AuthError)
    expect(() => deleteScript(db, mara, id)).toThrow(/default script/)
    expect(() => createScript(db, mara, { name: 'work (DEFAULT)', source: '' })).toThrow(
      /by that name/,
    )
    const own = createScript(db, mara, { name: 'Mine', source: '' })
    expect(() => renameScript(db, mara, own.id, { name: 'Work (default)' })).toThrow(/by that name/)
    expect(() => resetScript(db, mara, own.id)).toThrow(/Only a default script/)
  })

  it('moves aside a script of the Player’s already called by a default’s name', () => {
    db.insert(schema.users).values({ name: 'Old' }).run()
    const old = db.select().from(schema.users).all().at(-1)!.id
    db.insert(schema.scripts).values({ userId: old, name: 'Work (default)' }).run()
    const names = listScripts(db, old).map((s) => [s.name, s.task])
    expect(names).toEqual([
      ['Work (default)', 'work'],
      ['Work (default) 2', null],
    ])
  })

  it('follow the game’s default as it changes, until the Player edits theirs', () => {
    const id = workId()
    const tobins = workId(tobin)
    withGameDefault('work', 'workAt(null)\n', () => {
      syncDefaultScripts(db)
      expect(sourceOf(id)).toBe('workAt(null)\n')
      expect(getScript(db, mara, id).versions).toHaveLength(2)
      expect(checkScriptLibrary(db)).toEqual([])

      // Mara edits hers: it is hers from then on.
      saveScript(db, mara, id, { source: 'let mine = 1\n' })
    })
    syncDefaultScripts(db)
    // Tobin's follows the default back; Mara's stays hers and tells her the default changed.
    expect(sourceOf(tobins)).toBe(WORK)
    expect(sourceOf(id)).toBe('let mine = 1\n')
    const edited = getScript(db, mara, id)
    expect(edited.followsDefault).toBe(false)
    expect(edited.gameDefault).toEqual({ source: WORK, editedFrom: 'workAt(null)\n' })
    expect(runnableScript(db, id)?.followsDefault).toBe(false)
    expect(checkScriptLibrary(db)).toEqual([])
  })

  it('stay the Player’s once a version is made active again, even one of the game’s', () => {
    const id = workId()
    saveScript(db, mara, id, { source: 'let mine = 1\n' })
    resetScript(db, mara, id)
    activateVersion(db, mara, id, { version: 2 })
    const s = getScript(db, mara, id)
    expect(s.followsDefault).toBe(false)
    expect(s.gameDefault?.editedFrom).toBe(WORK)
  })

  it('keep a saved version with syntax errors without running it, and are edited by it', () => {
    const id = workId()
    saveScript(db, mara, id, { source: 'let = ' })
    expect(sourceOf(id)).toBe(WORK)
    expect(getScript(db, mara, id).followsDefault).toBe(false)
  })

  it('are reset to the game’s current default, which they follow again', () => {
    const id = workId()
    saveScript(db, mara, id, { source: 'let mine = 1\n' })
    withGameDefault('work', 'workAt(null)\n', () => {
      const reset = resetScript(db, mara, id)
      expect(reset.versions.map((v) => v.source)).toEqual([
        WORK,
        'let mine = 1\n',
        'workAt(null)\n',
      ])
      expect(reset.activeVersion).toBe(3)
      expect(reset.followsDefault).toBe(true)
      expect(reset.gameDefault).toEqual({ source: 'workAt(null)\n', editedFrom: null })
    })
    // Following again, it takes the next default.
    ensureDefaultScripts(db, mara)
    expect(sourceOf(id)).toBe(WORK)
  })

  it('are flagged when one following the game’s default doesn’t run it (ADR 0004)', () => {
    const id = workId()
    db.insert(schema.scriptVersions).values({ scriptId: id, version: 2, source: 'let x = 1' }).run()
    db.update(schema.scripts).set({ activeVersion: 2 }).run()
    expect(checkScriptLibrary(db)).toEqual([
      expect.objectContaining({ invariant: 'default-scripts-follow' }),
    ])
  })
})

/** Realm r1 of Mara with a farm at (3, 3) and residents w1 and w2 on it; realm r2 of Tobin. */
function farmWorld() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: mara, leaderId: 'w1' })
  world.realms.push({ id: 'r2', userId: tobin, leaderId: 't1' })
  world.buildings.push({ id: 'farm', kind: 'farm', cityId: 'c1', x: 3, y: 3 })
  addCity(world, { id: 'c1', realmId: 'r1', x: 8, y: 8 })
  for (const [id, owner] of [
    ['w1', 'r1'],
    ['w2', 'r1'],
    ['t1', 'r2'],
  ] as const) {
    const r = newResident(mulberry32(world.residents.length + 1), {
      id,
      owner,
      x: 3,
      y: 3,
      tick: 0,
    })
    r.stats.strength = { base: 10, trained: 0 }
    world.residents.push(r)
  }
  return world
}

const sender = (userId = mara) => ({ userId, account: { name: 'Mara', isAdmin: false } })

const host = (): ScriptHost => ({
  script: (id) => runnableScript(db, id),
  sender: (userId) => sender(userId),
  explored: () => true,
})

function queue() {
  return new OrderQueue(
    {
      ...orderKinds,
      runScript: runScriptOrder(host()),
      task: taskOrder({ defaultScript: (userId, task) => defaultScriptId(db, userId, task) }),
    },
    terrain,
  )
}

/** Everything in the world as seen, which is enough for these tests. */
const seenAll = (world: WorldState) => (): SeenEntity[] =>
  world.residents.map(({ script, ...r }) => ({
    is: 'resident',
    ...r,
    ...(script ? { script: { scriptId: script.scriptId } } : {}),
  }))

describe('residents’ memory', () => {
  it('is readable by scripts for the Player’s own residents, never other Players’', () => {
    const world = farmWorld()
    const [w1, w2, t1] = world.residents
    w2!.script = { scriptId: 1, memory: { role: 'carrier' } }
    t1!.script = { scriptId: 2, memory: { secret: 'plans' } }
    const { globals } = bindScript({
      world,
      terrain,
      sender: sender(),
      residentId: w1!.id,
      memory: {},
      seen: seenAll(world),
      explored: () => true,
    })
    const result = run(
      parse(`
        let found = {}
        for (r of residents()) {
          if (r.script != null) { found[r.id] = r.script.memory }
        }
        memory.found = found
        let w2 = residents()[1]
        w2.script.memory.role = "changed"
      `),
      { globals, steps: SCRIPT_STEP_BUDGET },
    )
    expect(result.status).toBe('error')
    const found = (globals.memory as { found: Record<string, unknown> }).found
    expect(found).toEqual({ w2: { role: 'carrier' }, t1: null })
    // Read, never changed.
    expect(w2!.script.memory).toEqual({ role: 'carrier' })
  })
})

describe('Work from the UI', () => {
  it('runs the Player’s Work (default) with the workplace in memory', () => {
    const world = farmWorld()
    const orders = queue()
    const order = (o: object) => orders.receive(world, sender(), 'q', { kind: 'task', ...o })
    expect(order({ task: 'work', residentId: 'w1', workplaceId: 'farm' })).toMatchObject({
      type: 'ack',
    })
    expect(order({ task: 'work', residentId: 'w1', workplaceId: 'elsewhere' })).toMatchObject({
      reason: 'not standing on that workplace',
    })
    expect(order({ task: 'dance', residentId: 'w1', workplaceId: 'farm' })).toMatchObject({
      reason: 'no such task',
    })
    expect(order({ task: 'work', residentId: 't1', workplaceId: 'farm' })).toMatchObject({
      reason: 'not one of your residents',
    })
    orders.applyAll(world)
    expect(world.residents[0]!.script).toEqual({
      scriptId: workId(),
      memory: { workplaceId: 'farm' },
    })
  })

  it('is given to a resident working by a bare work-at order, but not twice', () => {
    const world = farmWorld()
    const orders = queue()
    const w1 = world.residents[0]!
    w1.order = { kind: 'workAt', buildingId: 'farm', at: { x: 3, y: 3 }, progress: 0.5 }
    const work = { kind: 'task', task: 'work', residentId: 'w1', workplaceId: 'farm' }
    expect(orders.receive(world, sender(), 'q', work)).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    new ScriptRunner(terrain, host()).runAll(world)
    expect(w1.script?.scriptId).toBe(workId())
    expect(w1.order?.kind).toBe('workAt')
    expect(orders.receive(world, sender(), 'q', work)).toMatchObject({
      reason: 'already working here',
    })
  })

  it('plays as the work-at order did: the same Food on the farm’s pile, tick for tick', () => {
    const world = farmWorld()
    world.residents = world.residents.filter((r) => r.owner === 'r1')
    const orders = queue()
    const runner = new ScriptRunner(terrain, host())
    // w1 is given Work from the UI, w2 the plain work-at order: equal residents, equal output.
    world.residents[1]!.stats = structuredClone(world.residents[0]!.stats)
    orders.receive(world, sender(), 'a', {
      kind: 'task',
      task: 'work',
      residentId: 'w1',
      workplaceId: 'farm',
    })
    orders.receive(world, sender(), 'b', { kind: 'workAt', residentId: 'w2' })
    const progress: [number, number][] = []
    for (let tick = 0; tick < 2000; tick++) {
      for (const r of world.residents) r.hunger = 100
      orders.applyAll(world)
      expect(runner.runAll(world, true)).toEqual([])
      stepWorld(world, terrain)
      const [w1, w2] = world.residents
      expect(w1!.order?.kind).toBe('workAt')
      progress.push([
        w1!.order?.kind === 'workAt' ? w1!.order.progress : -1,
        w2!.order?.kind === 'workAt' ? w2!.order.progress : -1,
      ])
    }
    for (const [a, b] of progress) expect(a).toBeCloseTo(b, 9)
    // They really worked: Food on the pile, or the next unit coming along.
    const food = pileAt(world, 3, 3)?.goods.food ?? 0
    expect(food + progress.at(-1)![0]).toBeGreaterThan(progress[0]![0])
    expect(world.residents[0]!.script?.memory).toEqual({ workplaceId: 'farm', at: { x: 3, y: 3 } })
  })
})

describe('the step budget', () => {
  /** Mara's residents all at work on the farm by Work. */
  const working = (world: WorldState) => {
    for (const r of world.residents.filter((x) => x.owner === 'r1')) {
      r.order = { kind: 'workAt', buildingId: 'farm', at: { x: 3, y: 3 }, progress: 0 }
      r.script = { scriptId: 1, memory: { workplaceId: 'farm' } }
    }
  }

  /** Steps a default script takes in one run for w1 of `farmWorld`, as it finds the world. */
  function steps(task: Task, prepare: (world: WorldState) => void): number {
    const world = farmWorld()
    prepare(world)
    const memory = structuredClone(world.residents[0]!.script?.memory ?? { workplaceId: 'farm' })
    const { globals } = bindScript({
      world,
      terrain,
      sender: sender(),
      residentId: 'w1',
      memory,
      seen: seenAll(world),
      explored: () => true,
    })
    const result = run(parse(DEFAULT_SCRIPTS[task].source), {
      globals,
      steps: SCRIPT_STEP_BUDGET,
      maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
    })
    expect(result.status).toBe('done')
    return result.steps
  }

  it('keeps every default at most a quarter of a resident’s budget (ADR 0009)', () => {
    const cases: Record<Task, ((world: WorldState) => void)[]> = {
      work: [
        // Starting work, and working on.
        () => {},
        (world) => {
          world.residents[0]!.order = {
            kind: 'workAt',
            buildingId: 'farm',
            at: { x: 3, y: 3 },
            progress: 0,
          }
        },
        // Away from the workplace: walking back.
        (world) => {
          world.residents[0]!.x = 5
        },
        // A full pile: picking who carries it, and the nearest of many storages.
        (world) => {
          working(world)
          world.piles.push({ id: 'p', x: 3, y: 3, goods: { food: 200 } })
          for (let i = 0; i < 10; i++) {
            world.buildings.push({ id: `s${i}`, kind: 'storage', cityId: 'c1', x: 5 + i, y: 8 })
          }
        },
        // Carrying: storing the load at the storage.
        (world) => {
          world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: 3, y: 3 })
          const w1 = world.residents[0]!
          w1.carried = { food: 30 }
          w1.script = {
            scriptId: 1,
            memory: {
              workplaceId: 'farm',
              carry: { storageId: 's1', goods: ['food'], step: 'store' },
            },
          }
        },
      ],
    }
    for (const task of TASKS) {
      for (const prepare of cases[task]) {
        expect(steps(task, prepare)).toBeLessThanOrEqual(SCRIPT_STEP_BUDGET / 4)
      }
    }
  })

  it('flags a resident running an unedited default that ran out of it (ADR 0004)', () => {
    const world = farmWorld()
    const loop = 'while (true) { }'
    for (const followsDefault of [true, false]) {
      world.residents[0]!.script = { scriptId: 1, memory: {} }
      const runner = new ScriptRunner(terrain, {
        ...host(),
        script: () => ({ userId: mara, source: loop, followsDefault }),
      })
      const violations = runner.runAll(world, true)
      expect(violations.map((v) => v.invariant)).toEqual(
        followsDefault ? ['default-scripts-in-budget'] : [],
      )
    }
  })
})
