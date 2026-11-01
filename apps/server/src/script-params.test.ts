import {
  BUILD_MATERIALS,
  DEFAULT_SCRIPTS,
  OWN_FOOD,
  Terrain,
  type Building,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'

import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { runScriptOrder, ScriptRunner, taskOrder, type ScriptHost } from './script-runner.js'
import { scriptParamsSound, setScriptParamOrder } from './script-params.js'
import { entitiesInSight } from './sight.js'
import { addCity } from './test-terrain.js'
import { createWorld } from './world.js'

/**
 * Script parameters (`CONTEXT.md`: Script parameter): `param name: type` lines read as
 * `params.name`, with the values picked kept per resident per script; the Work and Build
 * defaults declare `storage` and `source`, falling back to the nearest when unset.
 */

const SIZE = 32
const SCRIPT = 1
const MARA = 1

/** Mara's realm r1 with city c1, a farm at (6, 6) and worker w1 on it running script 1. */
function farmWorld(): { world: WorldState; terrain: TerrainMap; farm: Building; w: Resident } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: MARA, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 20, y: 6 })
  const farm: Building = { id: 'farm', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
  world.buildings.push(farm)
  const w = newResident(mulberry32(1), {
    id: 'w1',
    owner: 'r1',
    cityId: 'c1',
    x: farm.x,
    y: farm.y,
    tick: 0,
  })
  w.stats.strength = { base: 10, trained: 0 }
  w.carried = { food: OWN_FOOD }
  w.order = { kind: 'workAt', buildingId: farm.id, at: { x: farm.x, y: farm.y }, progress: 0 }
  w.script = { scriptId: SCRIPT, memory: { workplaceId: farm.id } }
  world.residents.push(w)
  return { world, terrain, farm, w }
}

function storage(world: WorldState, id: string, x: number, y: number, stock: Stock = {}) {
  const b: Building = { id, kind: 'storage', cityId: 'c1', x, y, stock }
  world.buildings.push(b)
  return b
}

/** A host whose script 1 is Mara's, with `source` as its active version. */
const host = (source: { value: string }): ScriptHost => ({
  script: (id) =>
    id === SCRIPT
      ? { userId: MARA, name: 'Test', version: 1, source: source.value, followsDefault: false }
      : undefined,
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
})

const READS = `param home: building
param store: storage
memory.home = params.home
memory.store = params.store
`

describe('params in a script', () => {
  it('read null while unset, and what was picked once picked', () => {
    const { world, terrain, w } = farmWorld()
    storage(world, 's1', 12, 6)
    const runner = new ScriptRunner(terrain, host({ value: READS }))
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory).toMatchObject({ home: null, store: null })

    w.scriptParams = { [SCRIPT]: { home: 'farm', store: 's1' } }
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.home).toMatchObject({ id: 'farm', kind: 'farm' })
    expect(w.script!.memory.store).toMatchObject({ id: 's1', kind: 'storage' })
  })

  it('read null once the one picked is gone, and drop it', () => {
    const { world, terrain, w } = farmWorld()
    storage(world, 's1', 12, 6)
    w.scriptParams = { [SCRIPT]: { home: 'farm', store: 's1' } }
    world.buildings = world.buildings.filter((b) => b.id !== 's1')
    new ScriptRunner(terrain, host({ value: READS })).runAll(world)
    expect(w.script!.memory).toMatchObject({ store: null })
    expect(w.scriptParams).toEqual({ [SCRIPT]: { home: 'farm' } })
  })

  it('read null for one no longer of the realm or of the wrong type', () => {
    const { world, terrain, w } = farmWorld()
    world.cities.push({
      id: 'c2',
      name: 'Elsewhere',
      realmId: 'r2',
      townHallId: 'none',
      occupation: null,
    })
    world.buildings.push({ id: 'theirs', kind: 'storage', cityId: 'c2', x: 9, y: 9 })
    // The farm is no storage.
    w.scriptParams = { [SCRIPT]: { home: 'theirs', store: 'farm' } }
    new ScriptRunner(terrain, host({ value: READS })).runAll(world)
    expect(w.script!.memory).toMatchObject({ home: null, store: null })
  })

  it('drop a param removed from the script; a new one starts unset', () => {
    const { world, terrain, w } = farmWorld()
    storage(world, 's1', 12, 6)
    w.scriptParams = { [SCRIPT]: { home: 'farm', store: 's1' } }
    const source = { value: READS }
    const runner = new ScriptRunner(terrain, host(source))
    runner.runAll(world)
    source.value = 'param store: storage\nparam other: building\nmemory.other = params.other'
    runner.runAll(world)
    expect(w.scriptParams).toEqual({ [SCRIPT]: { store: 's1' } })
    expect(w.script!.memory.other).toBeNull()
    source.value = 'memory.none = true'
    runner.runAll(world)
    expect(w.scriptParams).toBeUndefined()
  })

  it('are kept across giving the task again', () => {
    const { world, w } = farmWorld()
    w.scriptParams = { [SCRIPT]: { store: 's1' } }
    const task = taskOrder({ defaultScript: () => SCRIPT })
    const sender = { userId: MARA, account: { name: 'Mara', isAdmin: false } }
    task.apply(world, sender, { kind: 'task', task: 'work', residentId: 'w1', workplaceId: 'farm' })
    expect(w.script).toMatchObject({ scriptId: SCRIPT, memory: { workplaceId: 'farm' } })
    expect(w.scriptParams).toEqual({ [SCRIPT]: { store: 's1' } })
  })

  it('read a number param as the whole number typed, null while unset', () => {
    const { world, terrain, w } = farmWorld()
    const source = 'param foodAt: number\nmemory.foodAt = params.foodAt'
    const runner = new ScriptRunner(terrain, host({ value: source }))
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.foodAt).toBeNull()

    w.scriptParams = { [SCRIPT]: { foodAt: 4 } }
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.foodAt).toBe(4)
    w.scriptParams = { [SCRIPT]: { foodAt: 0 } }
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.foodAt).toBe(0)
  })

  it('read a number param’s default while unset, the value set, and the default once cleared', () => {
    const { world, terrain, w } = farmWorld()
    const source = 'param foodAt: number = 3\nmemory.foodAt = params.foodAt'
    const runner = new ScriptRunner(terrain, host({ value: source }))
    const kind = setScriptParamOrder({ script: () => ({ userId: MARA, source }) })
    const sender = { userId: MARA, account: { name: 'Mara', isAdmin: false } }
    const set = (value: number | null) => ({
      kind: 'setScriptParam',
      residentId: 'w1',
      scriptId: SCRIPT,
      name: 'foodAt',
      ...(value === null ? { targetId: null } : { value }),
    })
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.foodAt).toBe(3)

    for (const value of [7, 0]) {
      expect(kind.validate(world, sender, set(value))).toBeUndefined()
      kind.apply(world, sender, set(value))
      expect(runner.runAll(world, true)).toEqual([])
      expect(w.script!.memory.foodAt).toBe(value)
    }

    expect(kind.validate(world, sender, set(null))).toBeUndefined()
    kind.apply(world, sender, set(null))
    expect(w.scriptParams).toBeUndefined()
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.foodAt).toBe(3)
  })

  it('drop a value that no longer fits its param’s type', () => {
    const { world, terrain, w } = farmWorld()
    w.scriptParams = { [SCRIPT]: { home: 4, store: 'farm' } }
    const source = 'param home: building\nparam store: number\nmemory.n = params.store'
    new ScriptRunner(terrain, host({ value: source })).runAll(world)
    expect(w.scriptParams).toBeUndefined()
    expect(w.script!.memory.n).toBeNull()
  })

  it('show only to the realm running the script, and only the running script’s', () => {
    const { world, terrain, w } = farmWorld()
    w.scriptParams = { [SCRIPT]: { store: 's1' }, 7: { other: 'farm' } }
    const seen = (realmId: string) =>
      entitiesInSight(world, terrain, realmId).find((e) => e.id === 'w1')
    expect(seen('r1')).toMatchObject({ script: { scriptId: SCRIPT, params: { store: 's1' } } })
    // All it keeps, to fill in before another script starts (`CONTEXT.md`: Before it starts).
    expect(seen('r1')!.scriptParams).toEqual(w.scriptParams)
    world.realms.push({ id: 'r2', userId: 2, leaderId: 'x' })
    addCity(world, { id: 'c2', realmId: 'r2', x: 8, y: 6 })
    world.residents.push(
      newResident(mulberry32(2), { id: 'x', owner: 'r2', cityId: 'c2', x: 7, y: 6, tick: 0 }),
    )
    expect(seen('r2')).toMatchObject({ script: { scriptId: SCRIPT } })
    expect(seen('r2')!.script).not.toHaveProperty('params')
    expect(seen('r2')).not.toHaveProperty('scriptParams')
  })
})

describe('the set-script-param order', () => {
  const sender = { userId: MARA, account: { name: 'Mara', isAdmin: false } }
  const kind = setScriptParamOrder({ script: () => ({ userId: MARA, source: READS }) })
  const order = (name: string, targetId: string | null, scriptId = SCRIPT) => ({
    kind: 'setScriptParam',
    residentId: 'w1',
    scriptId,
    name,
    targetId,
  })

  it('picks a value that fits the param, and clears it with null', () => {
    const { world } = farmWorld()
    storage(world, 's1', 12, 6)
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 7,
      y: 6,
      horseId: null,
      load: {},
    })
    for (const o of [order('store', 's1'), order('store', 'k1'), order('home', 's1')]) {
      expect(kind.validate(world, sender, o)).toBeUndefined()
    }
    kind.apply(world, sender, order('store', 'k1'))
    kind.apply(world, sender, order('home', 'farm'))
    expect(world.residents[0]!.scriptParams).toEqual({ [SCRIPT]: { store: 'k1', home: 'farm' } })
    kind.apply(world, sender, order('store', null))
    kind.apply(world, sender, order('home', null))
    expect(world.residents[0]!.scriptParams).toBeUndefined()
    expect(scriptParamsSound(world)).toEqual([])
  })

  it('turns down what doesn’t fit', () => {
    const { world } = farmWorld()
    world.cities.push({
      id: 'c2',
      name: 'Elsewhere',
      realmId: 'r2',
      townHallId: 'none',
      occupation: null,
    })
    world.buildings.push({ id: 'theirs', kind: 'storage', cityId: 'c2', x: 9, y: 9 })
    expect(kind.validate(world, sender, order('store', 'farm'))).toBe(
      'must be a storage, a stable or a carriage of yours',
    )
    expect(kind.validate(world, sender, order('home', 'theirs'))).toBe(
      'must be a building of yours, or a workplace or construction site you know',
    )
    expect(kind.validate(world, sender, order('away', 'farm'))).toBe('the script has no such param')
    expect(kind.validate(world, sender, order('home', 'farm', 9))).toBe('not the script they run')
    const tobin = { userId: 2, account: { name: 'Tobin', isAdmin: false } }
    expect(kind.validate(world, tobin, order('home', 'farm'))).toBe('not one of your residents')
  })

  describe('for a number param', () => {
    const SOURCE = 'param home: building\nparam take: number'
    const numbers = setScriptParamOrder({ script: () => ({ userId: MARA, source: SOURCE }) })
    const typed = (name: string, value: unknown) => ({
      kind: 'setScriptParam',
      residentId: 'w1',
      scriptId: SCRIPT,
      name,
      value,
    })

    it('keeps a whole number of zero or more, and clears it with null', () => {
      const { world } = farmWorld()
      for (const n of [0, 12])
        expect(numbers.validate(world, sender, typed('take', n))).toBeUndefined()
      numbers.apply(world, sender, typed('take', 12))
      expect(world.residents[0]!.scriptParams).toEqual({ [SCRIPT]: { take: 12 } })
      expect(scriptParamsSound(world)).toEqual([])
      numbers.apply(world, sender, order('take', null))
      expect(world.residents[0]!.scriptParams).toBeUndefined()
    })

    it('refuses a negative or fractional value, or anything else', () => {
      const { world } = farmWorld()
      for (const n of [-1, 1.5, '3', null, undefined, Number.NaN, Infinity]) {
        expect(numbers.validate(world, sender, typed('take', n))).toBe(
          'must be a whole number of zero or more',
        )
      }
      expect(numbers.validate(world, sender, order('take', 'farm'))).toBe(
        'must be a whole number of zero or more',
      )
      expect(numbers.validate(world, sender, typed('home', 3))).toBe('takes no number')
    })
  })

  it('a number value is sound only as a whole number of zero or more', () => {
    const { world, w } = farmWorld()
    w.scriptParams = { [SCRIPT]: { take: -2 } }
    expect(scriptParamsSound(world)).toHaveLength(1)
    w.scriptParams = { [SCRIPT]: { take: 2.5 } }
    expect(scriptParamsSound(world)).toHaveLength(1)
    w.scriptParams = { [SCRIPT]: { take: 2, home: 'farm' } }
    expect(scriptParamsSound(world)).toEqual([])
  })

  it('leaves the script running', () => {
    const { world, terrain } = farmWorld()
    const queue = new OrderQueue({ ...orderKinds, setScriptParam: kind }, terrain)
    expect(queue.receive(world, sender, 'a', order('home', 'farm'))).toEqual({
      type: 'ack',
      requestId: 'a',
    })
    queue.applyAll(world)
    expect(world.residents[0]!.script?.scriptId).toBe(SCRIPT)
    expect(world.residents[0]!.scriptParams).toEqual({ [SCRIPT]: { home: 'farm' } })
  })
})

describe('params given with the order starting a script', () => {
  const sender = { userId: MARA, account: { name: 'Mara', isAdmin: false } }
  const SOURCE = `param store: storage
param rounds: number = 5
param take: number
memory.store = params.store
memory.rounds = params.rounds
memory.take = params.take
`
  const scripts = host({ value: SOURCE })
  const kinds = {
    ...orderKinds,
    runScript: runScriptOrder(scripts),
    task: taskOrder({ defaultScript: () => SCRIPT, script: scripts.script }),
  }
  const run = (params?: unknown) => ({
    kind: 'runScript',
    residentId: 'w1',
    scriptId: SCRIPT,
    ...(params === undefined ? {} : { params }),
  })

  /** Gives the order as the UI does, then runs scripts once, as the next tick does. */
  function give(world: WorldState, terrain: TerrainMap, order: object) {
    const queue = new OrderQueue(kinds, terrain)
    expect(queue.receive(world, sender, 'a', order)).toEqual({ type: 'ack', requestId: 'a' })
    queue.applyAll(world)
    expect(new ScriptRunner(terrain, scripts).runAll(world, true)).toEqual([])
  }

  it('sets them before the script’s first tick', () => {
    const { world, terrain, w } = farmWorld()
    storage(world, 's1', 12, 6)
    give(world, terrain, run({ store: 's1', rounds: 3 }))
    expect(w.script!.memory).toMatchObject({ store: { id: 's1' }, rounds: 3, take: null })
    expect(w.scriptParams).toEqual({ [SCRIPT]: { store: 's1', rounds: 3 } })
    expect(scriptParamsSound(world)).toEqual([])
  })

  it('null clears a kept value back to its default, and one left out keeps its value', () => {
    const { world, terrain, w } = farmWorld()
    storage(world, 's1', 12, 6)
    w.scriptParams = { [SCRIPT]: { store: 's1', rounds: 3, take: 2 } }
    give(world, terrain, run({ rounds: null, take: 7 }))
    expect(w.script!.memory).toMatchObject({ store: { id: 's1' }, rounds: 5, take: 7 })
    expect(w.scriptParams).toEqual({ [SCRIPT]: { store: 's1', take: 7 } })
  })

  it('the task order sets them for the default script too', () => {
    const { world, terrain, farm, w } = farmWorld()
    w.script = undefined
    give(world, terrain, {
      kind: 'task',
      task: 'work',
      residentId: 'w1',
      workplaceId: farm.id,
      params: { take: 4 },
    })
    expect(w.script!.memory).toMatchObject({ workplaceId: farm.id, rounds: 5, take: 4 })
  })

  it('turns down values that don’t fit the script’s params', () => {
    const { world, farm, w } = farmWorld()
    // Working there by a bare work-at order, so the Work task can be given.
    w.script = undefined
    const check = (order: { kind: string }) => kinds[order.kind]!.validate(world, sender, order)
    expect(check(run({ away: 3 }))).toBe('away: the script has no such param')
    expect(check(run({ rounds: -1 }))).toBe('rounds: must be a whole number of zero or more')
    expect(check(run({ store: 'farm' }))).toBe(
      'store: must be a storage, a stable or a carriage of yours',
    )
    expect(check(run([3]))).toBe('params must be values by name')
    const task = { kind: 'task', task: 'work', residentId: 'w1', workplaceId: farm.id }
    expect(check({ ...task, params: { take: 'farm' } })).toBe(
      'take: must be a whole number of zero or more',
    )
    expect(check(run({ rounds: 0, take: null }))).toBeUndefined()
  })

  it('a queue step keeps its values and sets them when it starts', () => {
    const { world, terrain, w } = farmWorld()
    w.script = undefined
    w.order = null
    give(world, terrain, {
      kind: 'queue',
      residentId: 'w1',
      steps: [{ order: run({ take: 9 }) }],
    })
    expect(w.queue!.steps[0]!.order).toMatchObject({ params: { take: 9 } })
    new QueueRunner(scripts, kinds, terrain).runAll(world)
    expect(w.scriptParams).toEqual({ [SCRIPT]: { take: 9 } })
    expect(new ScriptRunner(terrain, scripts).runAll(world, true)).toEqual([])
    expect(w.script!.memory).toMatchObject({ take: 9 })
  })
})

describe('the defaults’ params', () => {
  it('Work stores in the storage picked, else the nearest', () => {
    const { world, terrain, farm, w } = farmWorld()
    storage(world, 'near', farm.x + 6, farm.y)
    storage(world, 'far', farm.x + 14, farm.y)
    world.piles.push({ id: 'p', x: farm.x, y: farm.y, goods: { food: 100 } })
    const runner = new ScriptRunner(terrain, host({ value: DEFAULT_SCRIPTS.work.source }))
    w.scriptParams = { [SCRIPT]: { storage: 'far' } }
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.carry).toMatchObject({ storageId: 'far' })

    const { world: other, terrain: t2, farm: f2, w: w2 } = farmWorld()
    storage(other, 'near', f2.x + 6, f2.y)
    storage(other, 'far', f2.x + 14, f2.y)
    other.piles.push({ id: 'p', x: f2.x, y: f2.y, goods: { food: 100 } })
    new ScriptRunner(t2, host({ value: DEFAULT_SCRIPTS.work.source })).runAll(other)
    expect(w2.script!.memory.carry).toMatchObject({ storageId: 'near' })
  })

  it('Build fetches from the source picked, a carriage too, while it holds some', () => {
    const { world, terrain, w } = farmWorld()
    const at = { x: 6, y: 6 }
    world.buildings = world.buildings.filter((b) => b.id !== 'farm')
    world.buildings.push({
      id: 'site',
      kind: 'house',
      cityId: 'c1',
      ...at,
      site: { delivered: {}, work: 0 },
    })
    storage(world, 'near', at.x + 2, at.y, { wood: 100 })
    const load = { wood: BUILD_MATERIALS.house!.wood! }
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 12,
      y: 6,
      horseId: null,
      load: {},
    })
    w.order = { kind: 'build', siteId: 'site', progress: 0 } as Resident['order']
    w.script = { scriptId: SCRIPT, memory: { building: 'house', at, siteId: 'site' } }
    w.scriptParams = { [SCRIPT]: { source: 'k1' } }
    const runner = new ScriptRunner(terrain, host({ value: DEFAULT_SCRIPTS.build.source }))
    // An empty carriage: nothing to fetch there, so they just build.
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.fetch).toBeUndefined()

    world.carriages[0]!.load = { wood: 100 }
    expect(runner.runAll(world, true)).toEqual([])
    expect(w.script!.memory.fetch).toMatchObject({ storageId: 'k1', goods: load })
  })
})
