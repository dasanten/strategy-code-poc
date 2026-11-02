import {
  DEFAULT_SCRIPTS,
  Terrain,
  type Building,
  type OrderRequest,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'

import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { setScriptParamOrder } from './script-params.js'
import { ScriptRunner, runScriptOrder, taskOrder, type ScriptHost } from './script-runner.js'
import type { RunnableScript } from './scripts.js'
import { addCity } from './test-terrain.js'
import {
  setWorkSettingsOrder,
  stepWorkplaceSettings,
  workplaceSettingsSound,
} from './workplace-settings.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Workplace settings (`CONTEXT.md`; ADR 0020): per realm and per workplace, a work script and
 * values for its params, set with the set-work-settings order; other realms never see them.
 */

const SIZE = 32
const MARA = 1
const BO = 2

const WORK_SCRIPT = `param workplace: building
param out: storage // where the output goes
param take: number = 3
memory.done = true
`
const READS = 'memory.settings = building("farm").workSettings\n'
/** A work script noting what its params read. */
const NOTES = `param workplace: building
param out: storage // where the output goes
param take: number = 3
memory.take = params.take
if (params.out == null) { memory.out = null } else { memory.out = params.out.id }
if (params.workplace == null) { memory.at = null } else { memory.at = params.workplace.id }
`

/** Each Player's scripts: their Work default, a work script, one that isn't, and one reading. */
const SCRIPTS: Record<number, RunnableScript> = {
  10: {
    userId: MARA,
    name: 'Work',
    version: 1,
    followsDefault: true,
    task: 'work',
    source: DEFAULT_SCRIPTS.work.source,
  },
  11: { userId: MARA, name: 'Farming', version: 1, followsDefault: false, source: WORK_SCRIPT },
  12: {
    userId: MARA,
    name: 'Home',
    version: 1,
    followsDefault: false,
    source: 'param home: building\n',
  },
  13: { userId: MARA, name: 'Reads', version: 1, followsDefault: false, source: READS },
  14: { userId: MARA, name: 'Notes', version: 1, followsDefault: false, source: NOTES },
  20: {
    userId: BO,
    name: 'Work',
    version: 1,
    followsDefault: true,
    task: 'work',
    source: DEFAULT_SCRIPTS.work.source,
  },
  23: { userId: BO, name: 'Reads', version: 1, followsDefault: false, source: READS },
}

const host: ScriptHost = {
  script: (id) => SCRIPTS[id],
  sender: (userId) => ({
    userId,
    account: { name: userId === MARA ? 'Mara' : 'Bo', isAdmin: false },
  }),
  explored: () => true,
  defaultScript: (userId) => (userId === MARA ? 10 : 20),
}

const mara = { userId: MARA, account: { name: 'Mara', isAdmin: false } }
const bo = { userId: BO, account: { name: 'Bo', isAdmin: false } }

function resident(world: WorldState, id: string, owner: string, cityId: string, at: Building) {
  const r: Resident = newResident(mulberry32(1), { id, owner, cityId, x: at.x, y: at.y, tick: 0 })
  world.residents.push(r)
  return r
}

/**
 * Mara's realm r1 with city c1, a farm and storage s1; Bo's realm r2 with city c2 and storage s2,
 * whose Player remembers Mara's farm (`CONTEXT.md`: Last seen) but not her storage.
 */
function twoRealms(): { world: WorldState; terrain: TerrainMap; farm: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: MARA, leaderId: 'm1' })
  world.realms.push({ id: 'r2', userId: BO, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 20, y: 6 })
  addCity(world, { id: 'c2', realmId: 'r2', x: 6, y: 24 })
  const farm: Building = { id: 'farm', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
  world.buildings.push(farm)
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: 12, y: 6, stock: {} })
  world.buildings.push({ id: 's2', kind: 'storage', cityId: 'c2', x: 12, y: 24, stock: {} })
  resident(world, 'm1', 'r1', 'c1', farm)
  resident(
    world,
    'b1',
    'r2',
    'c2',
    world.buildings.find((b) => b.id === 'c2-hall')!,
  )
  world.lastSeen[BO] = [{ is: 'building', ...farm, seenAt: 0 }]
  return { world, terrain, farm }
}

function queue(terrain: TerrainMap) {
  return new OrderQueue({ ...orderKinds, ...kinds }, terrain)
}

/** The order kinds working by Workplace settings goes through, with the game's host. */
const kinds = {
  setWorkSettings: setWorkSettingsOrder(host),
  setScriptParam: setScriptParamOrder(host),
  runScript: runScriptOrder(host),
  task: taskOrder(host),
}

const order = (fields: Record<string, unknown>): OrderRequest => ({
  kind: 'setWorkSettings',
  buildingId: 'farm',
  ...fields,
})

/** Sends the orders in turn, each applied before the next; the answers that were turned down. */
function send(
  world: WorldState,
  terrain: TerrainMap,
  ...orders: [typeof mara, OrderRequest][]
): string[] {
  const q = queue(terrain)
  const rejected: string[] = []
  for (const [sender, o] of orders) {
    const answer = q.receive(world, sender, 'a', o)
    if (answer.type === 'rejected') rejected.push(answer.reason)
    q.applyAll(world)
  }
  return rejected
}

describe('the set-work-settings order', () => {
  it('keeps settings per realm and per workplace', () => {
    const { world, terrain } = twoRealms()
    world.buildings.push({ id: 'mine', kind: 'mine', cityId: 'c1', x: 6, y: 12 })
    expect(
      send(
        world,
        terrain,
        [mara, order({ scriptId: 11, params: { out: 's1', take: 5 } })],
        [mara, order({ buildingId: 'mine', params: { foodTake: 2 } })],
        [bo, order({ params: { storage: 's2' } })],
      ),
    ).toEqual([])
    expect(world.workplaceSettings).toEqual({
      r1: {
        farm: { scriptId: 11, params: { out: 's1', take: 5 } },
        mine: { params: { foodTake: 2 } },
      },
      r2: { farm: { params: { storage: 's2' } } },
    })
    expect(workplaceSettingsSound.check(world, terrain)).toEqual([])
  })

  it('sets and clears values one by one, keeping the others', () => {
    const { world, terrain } = twoRealms()
    send(
      world,
      terrain,
      [mara, order({ params: { storage: 's1', foodTake: 4 } })],
      [mara, order({ params: { foodTake: null } })],
    )
    expect(world.workplaceSettings.r1).toEqual({ farm: { params: { storage: 's1' } } })
    send(world, terrain, [mara, order({ params: { storage: null } })])
    expect(world.workplaceSettings).toEqual({})
  })

  it('switching the work script starts its values over; the Work default is kept as none', () => {
    const { world, terrain } = twoRealms()
    send(world, terrain, [mara, order({ params: { storage: 's1' } })])
    send(world, terrain, [mara, order({ scriptId: 11 })])
    expect(world.workplaceSettings.r1).toEqual({ farm: { scriptId: 11 } })
    send(world, terrain, [mara, order({ params: { take: 2 } })], [mara, order({ scriptId: 11 })])
    expect(world.workplaceSettings.r1).toEqual({ farm: { scriptId: 11, params: { take: 2 } } })
    send(world, terrain, [mara, order({ scriptId: 10 })])
    expect(world.workplaceSettings).toEqual({})
    send(world, terrain, [mara, order({ scriptId: 11 })], [mara, order({ scriptId: null })])
    expect(world.workplaceSettings).toEqual({})
  })

  it('checks the values against the script it switches to', () => {
    const { world, terrain } = twoRealms()
    expect(send(world, terrain, [mara, order({ scriptId: 11, params: { out: 's1' } })])).toEqual([])
    // `out` is no param of the Work default.
    expect(send(world, terrain, [mara, order({ scriptId: null, params: { out: 's1' } })])).toEqual([
      'out: the script has no such param',
    ])
  })

  it('turns down what is no workplace, or one the realm does not know', () => {
    const { world, terrain } = twoRealms()
    world.buildings.push({ id: 'far', kind: 'mine', cityId: 'c1', x: 28, y: 28 })
    expect(
      send(
        world,
        terrain,
        [mara, order({ buildingId: 's1', params: {} })],
        [mara, order({ buildingId: 'gone', params: {} })],
        [bo, order({ buildingId: 'far', params: {} })],
      ),
    ).toEqual([
      'not a workplace or construction site of one you know',
      'not a workplace or construction site of one you know',
      'not a workplace or construction site of one you know',
    ])
  })

  it('takes a construction site of a workplace kind', () => {
    const { world, terrain } = twoRealms()
    world.buildings.push({
      id: 'site',
      kind: 'smelter',
      cityId: 'c1',
      x: 14,
      y: 14,
      site: { delivered: {}, work: 0 },
    })
    expect(
      send(world, terrain, [mara, order({ buildingId: 'site', params: { foodTake: 1 } })]),
    ).toEqual([])
    expect(world.workplaceSettings.r1?.site).toEqual({ params: { foodTake: 1 } })
  })

  it('turns down a script that is no work script, or not theirs', () => {
    const { world, terrain } = twoRealms()
    expect(
      send(world, terrain, [mara, order({ scriptId: 12 })], [bo, order({ scriptId: 11 })]),
    ).toEqual([
      'not a work script: it declares no `param workplace: building`',
      'not one of your scripts with a version that can run',
    ])
  })

  it('turns down workplace, and values that do not fit or are not the realm’s', () => {
    const { world, terrain } = twoRealms()
    expect(
      send(
        world,
        terrain,
        [mara, order({ params: { workplace: 'farm' } })],
        [mara, order({ params: { foodTake: -1 } })],
        [bo, order({ params: { storage: 's1' } })],
        [mara, order({ params: { nope: 1 } })],
      ),
    ).toEqual([
      'workplace: is the workplace itself',
      'foodTake: must be a whole number of zero or more',
      'storage: must be a storage, a stable or a carriage of yours',
      'nope: the script has no such param',
    ])
    expect(world.workplaceSettings).toEqual({})
  })

  it('changes nobody’s order or script', () => {
    const { world, terrain } = twoRealms()
    const m = world.residents.find((r) => r.id === 'm1')!
    m.script = { scriptId: 13, memory: {} }
    send(world, terrain, [mara, order({ params: { foodTake: 2 } })])
    expect(m.script).toEqual({ scriptId: 13, memory: {} })
  })
})

/** The Work task for a resident at the farm, with values changed in the form before it starts. */
const work = (residentId: string, params?: Record<string, unknown>): OrderRequest => ({
  kind: 'task',
  task: 'work',
  residentId,
  workplaceId: 'farm',
  ...(params ? { params } : {}),
})

/** Mara's three residents at the farm, m1 to m3, the farm worked by Notes. */
function crew() {
  const { world, terrain, farm } = twoRealms()
  resident(world, 'm2', 'r1', 'c1', farm)
  resident(world, 'm3', 'r1', 'c1', farm)
  const [m1, m2, m3] = ['m1', 'm2', 'm3'].map((id) => world.residents.find((r) => r.id === id)!)
  send(world, terrain, [mara, order({ scriptId: 14, params: { out: 's1', take: 5 } })])
  const runner = new ScriptRunner(terrain, host)
  /** What each resident's script read the tick it ran, by id. */
  const reads = () => {
    expect(runner.runAll(world, true)).toEqual([])
    return Object.fromEntries(
      world.residents
        .filter((r) => r.script)
        .map((r) => {
          const { take, out, at } = r.script!.memory
          return [r.id, { take, out, at }]
        }),
    )
  }
  return { world, terrain, m1: m1!, m2: m2!, m3: m3!, reads }
}

describe('working by Workplace settings', () => {
  it('reads the resident’s override, else the workplace’s setting, else the default', () => {
    const { world, terrain, m1, m2, reads } = crew()
    expect(send(world, terrain, [mara, work('m1', { take: 2 })], [mara, work('m2')])).toEqual([])
    const byFarm = { scriptId: 14, memory: { workplaceId: 'farm' }, settingsFrom: 'farm' }
    expect(m1.script).toEqual(byFarm)
    expect(m1.scriptParams).toEqual({ 14: { workplace: 'farm', take: 2 } })
    expect(m2.scriptParams).toEqual({ 14: { workplace: 'farm' } })
    expect(reads()).toEqual({
      m1: { take: 2, out: 's1', at: 'farm' },
      m2: { take: 5, out: 's1', at: 'farm' },
    })
    send(world, terrain, [mara, order({ params: { take: null } })])
    expect(reads()).toMatchObject({ m1: { take: 2 }, m2: { take: 3 } })
  })

  it('runs the Work default without settings, and switches once the farm gets a work script', () => {
    const { world, terrain } = twoRealms()
    const m1 = world.residents.find((r) => r.id === 'm1')!
    send(world, terrain, [mara, work('m1')])
    const byFarm = { scriptId: 10, memory: { workplaceId: 'farm' }, settingsFrom: 'farm' }
    expect(m1.script).toEqual(byFarm)
    send(world, terrain, [mara, order({ scriptId: 14 })])
    expect(m1.script).toEqual({ ...byFarm, scriptId: 14 })
  })

  it('drops the values kept for the work script before; the form’s changes are all they keep', () => {
    const { world, terrain, m1, reads } = crew()
    m1.scriptParams = { 14: { take: 9, out: 's1' }, 13: { x: 1 } }
    send(world, terrain, [mara, work('m1', { take: 4, out: null, workplace: 'farm' })])
    expect(m1.scriptParams).toEqual({ 14: { workplace: 'farm', take: 4 }, 13: { x: 1 } })
    expect(reads()).toEqual({ m1: { take: 4, out: 's1', at: 'farm' } })
  })

  it('a changed setting reaches at once everyone working there without an override', () => {
    const { world, terrain, reads } = crew()
    send(world, terrain, [mara, work('m1', { take: 2 })], [mara, work('m2')], [mara, work('m3')])
    reads()
    send(world, terrain, [mara, order({ params: { take: 7, out: null } })])
    expect(reads()).toEqual({
      m1: { take: 2, out: null, at: 'farm' },
      m2: { take: 7, out: null, at: 'farm' },
      m3: { take: 7, out: null, at: 'farm' },
    })
  })

  it('clearing an override goes back to the workplace’s value', () => {
    const { world, terrain, m1, reads } = crew()
    send(world, terrain, [mara, work('m1', { take: 2 })])
    expect(reads()).toMatchObject({ m1: { take: 2 } })
    const clear = { kind: 'setScriptParam', residentId: 'm1', scriptId: 14, name: 'take' }
    expect(send(world, terrain, [mara, { ...clear, targetId: null }])).toEqual([])
    expect(m1.scriptParams).toEqual({ 14: { workplace: 'farm' } })
    expect(reads()).toMatchObject({ m1: { take: 5 } })
    // An override set on the card holds against the workplace's.
    send(world, terrain, [mara, { ...clear, value: 1 }], [mara, order({ params: { take: 8 } })])
    expect(reads()).toMatchObject({ m1: { take: 1 } })
  })

  it('switching the work script switches everyone working there by it, as if given Work again', () => {
    const { world, terrain, m1, m2, m3 } = crew()
    send(world, terrain, [mara, work('m1', { take: 2 })], [mara, work('m2')])
    // m3 runs the same script by hand: their own choice.
    send(world, terrain, [mara, { kind: 'runScript', residentId: 'm3', scriptId: 14 }])
    m1.order = { kind: 'workAt', buildingId: 'farm', at: { x: m1.x, y: m1.y }, progress: 0 }
    m1.script!.memory.done = true
    // m2 defends themselves meanwhile; the work goes on as the new script once they hand back.
    m2.interrupted = { order: null, script: m2.script }
    m2.script = { scriptId: 13, memory: {} }
    m2.scriptParams = { 11: { take: 6 } }

    send(world, terrain, [mara, order({ scriptId: 11 })])
    const byFarm = { scriptId: 11, memory: { workplaceId: 'farm' }, settingsFrom: 'farm' }
    expect(m1.script).toEqual(byFarm)
    expect(m1.order).toBeNull()
    expect(m1.scriptParams).toEqual({
      14: { workplace: 'farm', take: 2 },
      11: { workplace: 'farm' },
    })
    expect(m2.interrupted?.script).toEqual(byFarm)
    expect(m2.script).toEqual({ scriptId: 13, memory: {} })
    expect(m2.scriptParams).toEqual({ 11: { workplace: 'farm' } })
    expect(m3.script).toEqual({ scriptId: 14, memory: {} })

    send(world, terrain, [mara, order({ scriptId: null })])
    expect(m1.script?.scriptId).toBe(10)
    expect(m2.interrupted?.script?.scriptId).toBe(10)
    // Setting values alone switches nobody.
    m1.script = { scriptId: 14, memory: {}, settingsFrom: 'farm' }
    send(world, terrain, [mara, order({ params: { foodTake: 2 } })])
    expect(m1.script.scriptId).toBe(14)
  })

  it('keeps what a smithy’s worker makes when the work script switches', () => {
    const { world, terrain, m1 } = crew()
    const memory = { workplaceId: 'farm', makes: 'sword' }
    m1.script = { scriptId: 14, memory, settingsFrom: 'farm' }
    send(world, terrain, [mara, order({ scriptId: 11 })])
    expect(m1.script.memory).toEqual(memory)
  })

  it('checks the form’s values against the workplace’s work script', () => {
    const { world, terrain } = crew()
    expect(send(world, terrain, [mara, work('m1', { take: 2, foodTake: 1 })])).toEqual([
      'foodTake: the script has no such param',
    ])
  })

  it('a queue step giving Work there runs by the settings', () => {
    const { world, terrain, m1, reads } = crew()
    const step = { kind: 'task', task: 'work', workplaceId: 'farm', params: { take: 1 } }
    m1.queue = {
      realmId: 'r1',
      steps: [{ id: 1, order: step }],
      current: 0,
      startedAt: null,
      loop: false,
      nextStepId: 2,
    }
    new QueueRunner(host, { ...orderKinds, ...kinds }, terrain).runAll(world)
    const byFarm = { scriptId: 14, memory: { workplaceId: 'farm' }, settingsFrom: 'farm' }
    expect(m1.script).toEqual(byFarm)
    expect(reads()).toEqual({ m1: { take: 1, out: 's1', at: 'farm' } })
  })

  it('Bo’s settings for the same farm never reach Mara’s workers', () => {
    const { world, terrain, reads } = crew()
    send(world, terrain, [mara, work('m1')], [bo, order({ params: { foodTake: 6 } })])
    expect(reads()).toEqual({ m1: { take: 5, out: 's1', at: 'farm' } })
  })

  it('flags a resident working by settings who runs another than the work script', () => {
    const { world, terrain, m1 } = crew()
    send(world, terrain, [mara, work('m1')])
    m1.script = { scriptId: 11, memory: { workplaceId: 'farm' }, settingsFrom: 'farm' }
    const violations = new ScriptRunner(terrain, host).runAll(world, true)
    expect(violations.map((v) => v.invariant)).toEqual(['works-by-work-script'])
  })
})

describe('reading Workplace settings in a script', () => {
  it('gives each realm only its own', () => {
    const { world, terrain, farm } = twoRealms()
    const m = world.residents.find((r) => r.id === 'm1')!
    const b = world.residents.find((r) => r.id === 'b1')!
    // Bo's resident stands by the farm, so Bo's Player sees it.
    b.x = farm.x + 1
    b.y = farm.y
    m.script = { scriptId: 13, memory: {} }
    b.script = { scriptId: 23, memory: {} }
    const runner = new ScriptRunner(terrain, host)
    runner.runAll(world)
    expect(m.script.memory.settings).toBeNull()
    expect(b.script.memory.settings).toBeNull()

    send(world, terrain, [mara, order({ scriptId: 11, params: { out: 's1' } })])
    runner.runAll(world)
    expect(m.script.memory.settings).toEqual({ scriptId: 11, params: { out: 's1' } })
    expect(b.script.memory.settings).toBeNull()

    send(world, terrain, [bo, order({ params: { foodTake: 6 } })])
    runner.runAll(world)
    expect(b.script.memory.settings).toEqual({ scriptId: null, params: { foodTake: 6 } })
    expect(m.script.memory.settings).toEqual({ scriptId: 11, params: { out: 's1' } })
  })
})

describe('dropping Workplace settings', () => {
  it('drops them with the building, values naming what is gone, and realms that ended', () => {
    const { world, terrain } = twoRealms()
    world.buildings.push({ id: 'mine', kind: 'mine', cityId: 'c1', x: 6, y: 12 })
    send(
      world,
      terrain,
      [mara, order({ params: { storage: 's1', foodTake: 2 } })],
      [mara, order({ buildingId: 'mine', params: { storage: 's1' } })],
      [bo, order({ params: { foodTake: 1 } })],
    )
    world.buildings = world.buildings.filter((b) => b.id !== 'mine' && b.id !== 's1')
    stepWorkplaceSettings(world)
    expect(world.workplaceSettings).toEqual({
      r1: { farm: { params: { foodTake: 2 } } },
      r2: { farm: { params: { foodTake: 1 } } },
    })
    world.realms = world.realms.filter((r) => r.id !== 'r2')
    stepWorkplaceSettings(world)
    expect(world.workplaceSettings).toEqual({ r1: { farm: { params: { foodTake: 2 } } } })
  })

  it('drops them as the world steps', () => {
    const { world, terrain } = twoRealms()
    send(world, terrain, [mara, order({ params: { foodTake: 2 } })])
    world.buildings = world.buildings.filter((b) => b.id !== 'farm')
    stepWorld(world, terrain)
    expect(world.workplaceSettings).toEqual({})
  })
})

describe('workplaceSettingsSound', () => {
  it('flags settings of no realm or no workplace, empty groups and bad values', () => {
    const { world } = twoRealms()
    expect(workplaceSettingsSound.check(world, {} as TerrainMap)).toEqual([])
    world.workplaceSettings = {
      gone: { farm: { params: { foodTake: 1 } } },
      r1: { s1: { scriptId: 11 }, farm: { scriptId: 0, params: { workplace: 'farm', x: -1 } } },
      r2: {},
    }
    const messages = workplaceSettingsSound.check(world, {} as TerrainMap).map((v) => v.message)
    expect(messages).toEqual([
      'gone, no realm, keeps workplace settings',
      'realm r1 keeps settings for s1, no workplace',
      'realm r1 keeps script 0 for farm',
      'realm r1 keeps a workplace value for farm',
      'realm r1 keeps a value for farm that is no id or whole number',
      'realm r2 keeps an empty group',
    ])
  })
})
