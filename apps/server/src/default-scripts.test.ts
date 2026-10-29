import { parse, run } from '@csp/lang'
import {
  AVERAGE_HORSE_STATS,
  DEFAULT_SCRIPTS,
  MAX_HEALTH,
  MAX_HUNGER,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_STEP_BUDGET,
  STABLE_CAPACITY,
  TASKS,
  Terrain,
  nodeCorner,
  pileAt,
  ticksForAge,
  type ScriptMemory,
  type SeenEntity,
  type Task,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { checkScript } from '@csp/lang'
import { eq } from 'drizzle-orm'
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
import { Walking } from './walking.js'
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
      ['Breed horses (default)', 'breed', true],
      ['Build (default)', 'build', true],
      ['Feed the stable (default)', 'feedStable', true],
      ['Haul (default)', 'haul', true],
      ['Tear down (default)', 'tearDown', true],
      ['Work (default)', 'work', true],
    ])
    const work = getScript(db, mara, workId())
    expect(work.versions.map((v) => v.source)).toEqual([WORK])
    expect(work.activeVersion).toBe(1)
    expect(work.gameDefault).toEqual({ source: WORK, editedFrom: null })
    // Listing again makes no second one.
    expect(listScripts(db, mara)).toHaveLength(TASKS.length)
    expect(list.map((s) => s.id)).toContain(workId())
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
    expect(names).toHaveLength(TASKS.length + 1)
    expect(names).toEqual(
      expect.arrayContaining([
        ['Work (default)', 'work'],
        ['Work (default) 2', null],
      ]),
    )
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
    db.update(schema.scripts).set({ activeVersion: 2 }).where(eq(schema.scripts.id, id)).run()
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

/** Carriage k1 of realm r1 with its horse, at w1's tile in `farmWorld`. */
function withCarriage(world: WorldState) {
  world.horses.push({
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: 3,
    y: 3,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  })
  const k1 = { id: 'k1', realmId: 'r1', cityId: null, x: 3, y: 3, horseId: null, load: {} }
  world.carriages.push(k1)
}

/** What a default script finds as it runs: its memory, and the world made ready for it. */
interface Case {
  memory: ScriptMemory
  prepare: (world: WorldState) => void
}

describe('Haul and Tear down from the UI', () => {
  it('run the Player’s defaults with the route or the building in memory', () => {
    const world = farmWorld()
    withCarriage(world)
    const orders = queue()
    const order = (o: object) => orders.receive(world, sender(), 'q', { kind: 'task', ...o })
    const haul = { task: 'haul', residentId: 'w1', carriageId: 'k1', x: 10, y: 3, keepFood: 4 }
    // Checked as the haul order is; a supply line to an army stays the bare haul order's.
    expect(order({ ...haul, goods: [] })).toMatchObject({ reason: 'pick the goods to haul' })
    expect(order({ ...haul, goods: ['food'], x: 3 })).toMatchObject({
      reason: 'the other stop must be another tile',
    })
    expect(order({ ...haul, goods: ['food'], x: undefined, armyId: 'a1' })).toMatchObject({
      reason: 'the other stop must be a tile',
    })
    expect(order({ ...haul, goods: ['food'], returnGoods: ['wood'] })).toMatchObject({
      type: 'ack',
    })
    // Checked as the tear-down order is.
    expect(order({ task: 'tearDown', residentId: 'w2', buildingId: 'nope' })).toMatchObject({
      reason: 'the resident is not at that building',
    })
    expect(order({ task: 'tearDown', residentId: 'w2', buildingId: 'farm' })).toMatchObject({
      type: 'ack',
    })
    orders.applyAll(world)
    const [w1, w2] = world.residents
    expect(w1!.script).toEqual({
      scriptId: defaultScriptId(db, mara, 'haul'),
      memory: {
        carriageId: 'k1',
        from: { x: 3, y: 3 },
        to: { x: 10, y: 3 },
        goods: ['food'],
        returnGoods: ['wood'],
        keepFood: 4,
      },
    })
    expect(w2!.script).toEqual({
      scriptId: defaultScriptId(db, mara, 'tearDown'),
      memory: { buildingId: 'farm' },
    })
    // Their first run starts the built-in orders.
    expect(new ScriptRunner(terrain, host()).runAll(world, true)).toEqual([])
    expect(w1!.order).toMatchObject({ kind: 'haul', to: { x: 10, y: 3 }, keepFood: 4 })
    expect(w2!.order).toEqual({ kind: 'tearDown', buildingId: 'farm', at: { x: 3, y: 3 } })
  })
})

describe('Build a … here from a node’s card', () => {
  it('walks the resident to where the node’s workplace fits and lays out its site there', () => {
    const world = farmWorld()
    world.residents = world.residents.filter((r) => r.owner === 'r1')
    // A forest node with the farm's corner west of it: the footprint over the node goes east.
    world.nodes.push({ id: 'n1', kind: 'forest', x: 11, y: 9 })
    const corner = nodeCorner(world, terrain, world.nodes[0]!)
    expect(corner).toEqual({ x: 11, y: 9 })
    const orders = queue()
    const order = (o: object) =>
      orders.receive(world, sender(), 'q', { kind: 'task', task: 'build', residentId: 'w1', ...o })
    // Checked as the build order there: off the node it doesn't fit, nor for a child.
    expect(order({ building: 'lumberCamp', at: { x: 1, y: 12 } })).toMatchObject({
      reason: 'a lumberCamp goes with one tile on a fitting resource node',
    })
    expect(order({ building: 'lumberCamp', at: { x: 11.5, y: 9 } })).toMatchObject({
      reason: 'the target must be a tile',
    })
    const w2 = world.residents[1]!
    w2.bornAt = world.tick - ticksForAge(5)
    expect(order({ residentId: 'w2', building: 'lumberCamp', at: corner })).toMatchObject({
      reason: 'children can’t build',
    })
    expect(order({ building: 'lumberCamp', at: corner })).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    const w1 = world.residents[0]!
    expect(w1.script?.memory).toEqual({ building: 'lumberCamp', at: corner })
    const runner = new ScriptRunner(terrain, host())
    const walking = new Walking(terrain)
    for (
      let tick = 0;
      tick < 500 && !world.buildings.some((b) => b.kind === 'lumberCamp');
      tick++
    ) {
      for (const r of world.residents) r.hunger = MAX_HUNGER
      expect(runner.runAll(world, true)).toEqual([])
      stepWorld(world, terrain, walking)
    }
    expect(w1).toMatchObject(corner!)
    const site = world.buildings.find((b) => b.kind === 'lumberCamp')
    expect(site).toMatchObject({ ...corner, site: { work: expect.any(Number) } })
    expect(w1.order).toMatchObject({ kind: 'build', siteId: site!.id })
  })
})

describe('Build for a group (`CONTEXT.md`: Group)', () => {
  it('walks each to the same tile: the first lays out the site and the others join it', () => {
    const world = farmWorld()
    world.residents = world.residents.filter((r) => r.owner === 'r1')
    world.residents[1]!.x = 12
    world.residents[1]!.y = 12
    const at = { x: 8, y: 12 }
    const orders = queue()
    for (const id of ['w1', 'w2']) {
      const order = { kind: 'task', task: 'build', residentId: id, building: 'house', at }
      expect(orders.receive(world, sender(), id, order)).toEqual({ type: 'ack', requestId: id })
    }
    orders.applyAll(world)
    const runner = new ScriptRunner(terrain, host())
    const walking = new Walking(terrain)
    const joined = () =>
      world.residents.every((r) => r.order?.kind === 'build' && r.order.siteId !== null)
    for (let tick = 0; tick < 500 && !joined(); tick++) {
      for (const r of world.residents) r.hunger = MAX_HUNGER
      expect(runner.runAll(world, true)).toEqual([])
      stepWorld(world, terrain, walking)
    }
    const sites = world.buildings.filter((b) => b.kind === 'house')
    expect(sites).toHaveLength(1)
    expect(sites[0]).toMatchObject({ ...at, site: expect.any(Object) })
    for (const r of world.residents) {
      expect(r.order).toMatchObject({ kind: 'build', siteId: sites[0]!.id })
    }
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
  function steps(task: Task, { memory, prepare }: Case): number {
    const world = farmWorld()
    prepare(world)
    const { globals } = bindScript({
      world,
      terrain,
      sender: sender(),
      residentId: 'w1',
      // A copy: the run changes it, and cases share theirs.
      memory: structuredClone(memory),
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
    const work = { workplaceId: 'farm' }
    const route = {
      carriageId: 'k1',
      from: { x: 3, y: 3 },
      to: { x: 10, y: 3 },
      goods: ['food'],
      returnGoods: ['wood'],
      keepFood: 4,
    }
    const tearDown = { buildingId: 'farm' }
    const breeding = { stableId: 'st', horseIds: ['h1', 'h2'] }
    /** A stable of Mara's where the farm was, with two of her horses and Food in it. */
    const stabled = (world: WorldState) => {
      world.buildings = [
        { id: 'st', kind: 'stable', cityId: 'c1', x: 3, y: 3, stock: { food: 50 } },
      ]
      for (const id of ['h1', 'h2']) {
        world.horses.push({
          id,
          realmId: 'r1',
          cityId: null,
          x: 3,
          y: 3,
          hunger: MAX_HUNGER,
          health: MAX_HEALTH,
          stats: { ...AVERAGE_HORSE_STATS },
          bornAt: 0,
        })
      }
    }
    const feed = { stableId: 'stable' }
    /** A finished stable where the farm was, holding `food`, with as many horses as fit. */
    const feeding = (world: WorldState, food: number) => {
      world.buildings = world.buildings.filter((b) => b.id !== 'farm')
      world.buildings.push({
        id: 'stable',
        kind: 'stable',
        cityId: 'c1',
        x: 3,
        y: 3,
        stock: { food },
      })
      for (let i = 0; i < STABLE_CAPACITY; i++) {
        const at = { x: 3 + (i % 3), y: 3 + Math.floor(i / 3) }
        world.horses.push({
          id: `h${i}`,
          realmId: 'r1',
          cityId: null,
          ...at,
          hunger: 100,
          health: 100,
          stats: { ...AVERAGE_HORSE_STATS },
          bornAt: 0,
        })
      }
    }
    const stable = { building: 'stable', at: { x: 3, y: 3 }, siteId: 'site' }
    /** Mara's residents all building a stable's site where the farm was, lacking its Wood. */
    const building = (world: WorldState) => {
      world.buildings = world.buildings.filter((b) => b.id !== 'farm')
      const site = { delivered: {}, work: 0 }
      world.buildings.push({ id: 'site', kind: 'stable', cityId: null, x: 3, y: 3, site })
      for (const r of world.residents.filter((x) => x.owner === 'r1')) {
        r.order = { kind: 'build', building: 'stable', at: { x: 3, y: 3 }, siteId: 'site' }
        r.script = { scriptId: 1, memory: { ...stable } }
      }
    }
    const cases: Record<Task, Case[]> = {
      build: [
        // Starting: laying out, or turned down with the tile taken.
        { memory: { building: 'stable', at: { x: 3, y: 3 } }, prepare: () => {} },
        // Away from the site: walking there.
        { memory: stable, prepare: (world) => void (world.residents[0]!.x = 5) },
        // Picking who fetches, from the nearest of many storages, the farthest holding Wood.
        {
          memory: stable,
          prepare: (world) => {
            building(world)
            for (let i = 0; i < 10; i++) {
              const stock = i === 9 ? { wood: 100 } : { stone: 5 }
              world.buildings.push({
                id: `s${i}`,
                kind: 'storage',
                cityId: 'c1',
                x: 5 + 2 * i,
                y: 12,
                stock,
              })
            }
          },
        },
        // Fetching: picking up at the storage.
        {
          memory: { ...stable, fetch: { storageId: 's1', goods: { wood: 40 }, step: 'pickUp' } },
          prepare: (world) => {
            building(world)
            world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: 3, y: 5 })
            world.residents[0]!.y = 5
          },
        },
        // Back with it: delivering.
        {
          memory: stable,
          prepare: (world) => {
            building(world)
            world.residents[0]!.carried = { food: 4, wood: 40 }
          },
        },
      ],
      work: [
        // Starting work, and working on.
        { memory: work, prepare: () => {} },
        {
          memory: work,
          prepare: (world) => {
            world.residents[0]!.order = {
              kind: 'workAt',
              buildingId: 'farm',
              at: { x: 3, y: 3 },
              progress: 0,
            }
          },
        },
        // Away from the workplace: walking back.
        { memory: work, prepare: (world) => void (world.residents[0]!.x = 5) },
        // A full pile: picking who carries it, and the nearest of many storages.
        {
          memory: work,
          prepare: (world) => {
            working(world)
            world.piles.push({ id: 'p', x: 3, y: 3, goods: { food: 200 } })
            for (let i = 0; i < 10; i++) {
              world.buildings.push({ id: `s${i}`, kind: 'storage', cityId: 'c1', x: 5 + i, y: 8 })
            }
          },
        },
        // Carrying: ordering the load stored.
        {
          memory: { ...work, carry: { storageId: 's1', goods: ['food'] } },
          prepare: (world) => {
            world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: 3, y: 3 })
            world.residents[0]!.carried = { food: 30 }
          },
        },
      ],
      haul: [
        // Starting the route, and on it.
        { memory: route, prepare: withCarriage },
        {
          memory: route,
          prepare: (world) => {
            withCarriage(world)
            const { carriageId, to, goods, returnGoods, keepFood } = route
            const haul = { kind: 'haul', residentId: 'w1', carriageId, ...to, goods, returnGoods }
            orderKinds.haul!.apply(world, sender(), { ...haul, keepFood })
          },
        },
        // Not at the first stop, and no carriage: nothing to start.
        { memory: route, prepare: (world) => void (world.residents[0]!.x = 5) },
        { memory: route, prepare: () => {} },
      ],
      tearDown: [
        // Starting, tearing down, the building gone, and standing idle after.
        { memory: tearDown, prepare: () => {} },
        {
          memory: tearDown,
          prepare: (world) => {
            world.residents[0]!.order = { kind: 'tearDown', buildingId: 'farm', at: { x: 3, y: 3 } }
          },
        },
        { memory: tearDown, prepare: (world) => void (world.buildings = []) },
        { memory: { ...tearDown, done: true }, prepare: (world) => void (world.buildings = []) },
      ],
      breed: [
        // Taking Food along, breeding, away from the stable, breeding, turned down, and done.
        { memory: breeding, prepare: stabled },
        {
          memory: { ...breeding, fed: true },
          prepare: (world) => {
            stabled(world)
            world.residents[0]!.x = 20
          },
        },
        {
          memory: { ...breeding, fed: true, started: true },
          prepare: (world) => {
            stabled(world)
            const at = { x: 3, y: 3 }
            const order = { kind: 'breed' as const, stableId: 'st', at, progress: 5 }
            world.residents[0]!.order = { ...order, horseIds: ['h1', 'h2'] }
          },
        },
        { memory: { ...breeding, fed: true }, prepare: () => {} },
        { memory: { ...breeding, done: true }, prepare: stabled },
      ],
      feedStable: [
        // A full stable short of Food: counting its horses, fetching from the nearest of many
        // storages, the farthest holding Food.
        {
          memory: feed,
          prepare: (world) => {
            feeding(world, 0)
            for (let i = 0; i < 10; i++) {
              const stock = i === 9 ? { food: 100 } : { stone: 5 }
              world.buildings.push({
                id: `s${i}`,
                kind: 'storage',
                cityId: 'c1',
                x: 5 + 2 * i,
                y: 12,
                stock,
              })
            }
          },
        },
        // Back with Food: storing it.
        {
          memory: { ...feed, fetched: { before: 4 } },
          prepare: (world) => {
            feeding(world, 0)
            world.residents[0]!.carried = { food: 30 }
          },
        },
        // Enough, away from it: walking back.
        {
          memory: feed,
          prepare: (world) => {
            feeding(world, 100)
            world.residents[0]!.x = 5
          },
        },
      ],
    }
    for (const task of TASKS) {
      for (const c of cases[task]) {
        expect(steps(task, c)).toBeLessThanOrEqual(SCRIPT_STEP_BUDGET / 4)
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
        script: () => ({ userId: mara, version: 1, source: loop, followsDefault }),
      })
      const violations = runner.runAll(world, true)
      expect(violations.map((v) => v.invariant)).toEqual(
        followsDefault ? ['default-scripts-in-budget'] : [],
      )
    }
  })
})
