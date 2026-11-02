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
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, type ScriptHost } from './script-runner.js'
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
  return new OrderQueue({ ...orderKinds, setWorkSettings: setWorkSettingsOrder(host) }, terrain)
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
