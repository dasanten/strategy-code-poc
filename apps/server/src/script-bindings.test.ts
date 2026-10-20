import { parse, run, type ScriptObject, type Value } from '@csp/lang'
import {
  HAUL_KEEP_FOOD,
  SCRIPT_API,
  SCRIPT_MAX_CALL_DEPTH,
  SIGHT_RANGE,
  TICKS_PER_GAME_YEAR,
  Terrain,
  type OrderRequest,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { allianceOrders } from './alliances.js'
import { ExploredTerrain } from './explored.js'
import { OrderQueue, orderKinds } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { SCRIPT_ORDER_KINDS, bindScript, scriptRequestsSound } from './script-bindings.js'
import { entitiesInSight } from './sight.js'
import { createWorld } from './world.js'

const SIZE = 64
const tiles = new Uint8Array(SIZE * SIZE).fill(Terrain.Plains)
tiles[10 * SIZE + 11] = Terrain.Forest
tiles[50 * SIZE + 50] = Terrain.Hills
const terrain: TerrainMap = { size: SIZE, tiles }
const sender = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with a1 at (10, 10) and a pile of food under them; realm r2 (Player 8) with
 * b1 next to a1, in sight, and b2 at (40, 40), out of sight. Player 7 explored around a1.
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = [
    { id: 'n1', kind: 'forest', x: 11, y: 10 },
    { id: 'n2', kind: 'stone', x: 50, y: 50 },
  ]
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  const a1 = resident(world, 'a1', 'r1', 10, 10)
  resident(world, 'b1', 'r2', 11, 10)
  resident(world, 'b2', 'r2', 40, 40)
  world.piles.push({ id: 'p1', x: 10, y: 10, goods: { food: 5 } })
  world.piles.push({ id: 'p2', x: 40, y: 40, goods: { wood: 5 } })
  const explored = new ExploredTerrain(terrain, world.nodes)
  explored.explore(7, 10, 10, SIGHT_RANGE)
  return { world, a1, explored }
}

function resident(world: WorldState, id: string, owner: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.bornAt = -20 * TICKS_PER_GAME_YEAR
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** Runs `source` as a1's script; answers the run, the bindings and the memory. */
function runAs(
  world: WorldState,
  explored: ExploredTerrain,
  source: string,
  memory: ScriptObject = {},
  residentId = 'a1',
) {
  const bindings = bindScript({
    world,
    terrain,
    sender,
    residentId,
    memory,
    seen: () => entitiesInSight(world, terrain, 'r1'),
    explored: (x, y) => explored.isExplored({ id: 7 }, x, y),
  })
  const result = run(parse(source), {
    globals: bindings.globals,
    steps: 10_000,
    maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
  })
  return { result, ...bindings, memory }
}

describe('script bindings', () => {
  it('bind every name in the script API, and every order a resident can get', () => {
    const { world, explored } = setup()
    const { globals } = runAs(world, explored, '')
    expect(Object.keys(globals).sort()).toEqual(SCRIPT_API.map((b) => b.name).sort())
    // Alliance orders and the gate order are the realm's, not a resident's.
    const residentOrders = Object.keys(orderKinds).filter(
      (k) => !(k in allianceOrders) && k !== 'setGate',
    )
    expect([...SCRIPT_ORDER_KINDS].sort()).toEqual(residentOrders.sort())
  })

  it.each(SCRIPT_API.filter((b) => b.is !== 'value').map((b) => [b.name, b.cost] as const))(
    '%s costs its step cost on top of the call',
    (name, cost) => {
      const { world, explored } = setup()
      // `name()`: the statement, the call and the name are 1 step each.
      const { result } = runAs(world, explored, `${name}()`)
      expect(result.steps).toBe(3 + cost)
      expect(cost).toBeGreaterThan(0)
    },
  )

  it('give `me`, `tick`, `mapSize` and a memory kept by the caller', () => {
    const { world, explored } = setup()
    world.tick = 77
    const memory: ScriptObject = {}
    const { result } = runAs(
      world,
      explored,
      'memory.seen = [me.id, me.x, me.y, me.owner, tick, mapSize, me.age > 19]',
      memory,
    )
    expect(result.status).toBe('done')
    expect(memory.seen).toEqual(['a1', 10, 10, 'r1', 77, SIZE, true])
  })

  it('never let a script change the world through what it reads', () => {
    const { world, a1, explored } = setup()
    for (const source of ['me.x = 3', 'me.carried.food = 9', 'residents()[0].x = 1']) {
      const { result } = runAs(world, explored, source)
      expect(result.status).toBe('error')
    }
    expect(a1.x).toBe(10)
    expect(a1.carried.food).toBeUndefined()
    expect(world.residents.every((r) => r.x !== 1)).toBe(true)
  })

  it('answer queries with only what the Player sees and has explored', () => {
    const { world, explored } = setup()
    const memory: ScriptObject = {}
    runAs(
      world,
      explored,
      `
      let ids = fn (list) { let out = []; for (x of list) { out[out.length] = x.id } return out }
      memory.residents = ids(residents())
      memory.piles = ids(piles())
      memory.nodes = ids(nodes())
      memory.here = terrainAt(11, 10)
      memory.far = terrainAt(50, 50)
      memory.d = distance(me, { x: 60, y: 10 })
      `,
      memory,
    )
    expect(memory.residents).toEqual(['a1', 'b1'])
    expect(memory.piles).toEqual(['p1'])
    expect(memory.nodes).toEqual(['n1'])
    expect(memory.here).toBe('forest')
    expect(memory.far).toBeNull()
    // Round the side of the map: 10 → 60 is 14 tiles the short way.
    expect(memory.d).toBe(14)
  })

  it('stop at a query used wrong', () => {
    const { world, explored } = setup()
    const { result } = runAs(world, explored, 'terrainAt("here")')
    expect(result).toMatchObject({ status: 'error', line: 1 })
  })

  /** Each action as a script calls it, and the order the UI would send for the same thing. */
  const actions: [string, Omit<OrderRequest, 'residentId'>][] = [
    ['walkTo(15, 10)', { kind: 'walkTo', x: 15, y: 10 }],
    ['walkTo("far", 1)', { kind: 'walkTo', x: 'far', y: 1 }],
    ['drive("c9", 20, 10)', { kind: 'drive', carriageId: 'c9', x: 20, y: 10 }],
    [
      'haul("c9", 20, 10, ["wood"])',
      { kind: 'haul', carriageId: 'c9', x: 20, y: 10, goods: ['wood'], keepFood: HAUL_KEEP_FOOD },
    ],
    ['stop()', { kind: 'stop' }],
    [
      'pickUp({ kind: "ground" }, { food: 2 })',
      { kind: 'pickUp', spot: { kind: 'ground' }, goods: { food: 2 } },
    ],
    [
      'pickUp({ kind: "ground" }, { iron: 2 })',
      { kind: 'pickUp', spot: { kind: 'ground' }, goods: { iron: 2 } },
    ],
    [
      'drop({ kind: "ground" }, { food: 1 })',
      { kind: 'drop', spot: { kind: 'ground' }, goods: { food: 1 } },
    ],
    ['build("house")', { kind: 'build', building: 'house' }],
    ['build("castle")', { kind: 'build', building: 'castle' }],
    ['tearDown("p1")', { kind: 'tearDown', buildingId: 'p1' }],
    ['workAt()', { kind: 'workAt' }],
    ['workAt("sword")', { kind: 'workAt', makes: 'sword' }],
    ['pair("b1")', { kind: 'pair', partnerId: 'b1' }],
    ['attack("b1")', { kind: 'attack', targetId: 'b1' }],
    ['attack("b2")', { kind: 'attack', targetId: 'b2' }],
    ['attack("a1")', { kind: 'attack', targetId: 'a1' }],
    ['roadLine(13, 10)', { kind: 'roadLine', from: { x: 10, y: 10 }, to: { x: 13, y: 10 } }],
    ['roadLine(60, 10)', { kind: 'roadLine', from: { x: 10, y: 10 }, to: { x: 60, y: 10 } }],
  ]

  it.each(actions)('request %s exactly as the UI order would be', (call, order) => {
    const { world, explored } = setup()
    const memory: ScriptObject = {}
    const { result, requests } = runAs(world, explored, `memory.answer = ${call}`, memory)
    expect(result.status).toBe('done')
    const request = { ...order, residentId: 'a1' }
    const ui = new OrderQueue(undefined, terrain).receive(world, sender, 'q', request)
    if (ui.type === 'ack') {
      expect(memory.answer).toBeNull()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject(request)
    } else {
      expect(ui.type).toBe('rejected')
      expect(memory.answer).toBe((ui as { reason: string }).reason)
      expect(requests).toEqual([])
    }
  })

  it('reach the order kinds of every action in the cases above, some accepted', () => {
    const kinds = new Set(actions.map(([, order]) => order.kind))
    expect([...kinds].sort()).toEqual([...SCRIPT_ORDER_KINDS].sort())
    const { world, explored } = setup()
    const { requests } = runAs(
      world,
      explored,
      'walkTo(15, 10) pickUp({ kind: "ground" }, { food: 2 }) attack("b1")',
    )
    expect(requests.map((r) => r.kind)).toEqual(['walkTo', 'pickUp', 'attack'])
  })

  it('act only for the resident running the script', () => {
    const { world, explored } = setup()
    const memory: ScriptObject = {}
    // b1 is Player 8's: Player 7's script can't run as them, nor order them about.
    const { requests } = runAs(world, explored, 'memory.answer = walkTo(1, 1)', memory, 'b1')
    expect(memory.answer).toBe('not one of your residents')
    expect(requests).toEqual([])
  })

  it('pass no function to an action', () => {
    const { world, explored } = setup()
    const { result, requests } = runAs(world, explored, 'walkTo(fn () {}, 1)')
    expect(result).toMatchObject({ status: 'error' })
    expect(requests).toEqual([])
  })
})

describe('invariant: a script can request nothing an order couldn’t', () => {
  it('holds for whatever a script throws at the actions', () => {
    const rand = mulberry32(133)
    const args: Value[] = [
      null,
      0,
      10,
      15,
      -3,
      2.5,
      'a1',
      'b1',
      'b2',
      'p1',
      'c9',
      'house',
      'sword',
      'food',
      ['food'],
      ['food', 'food'],
      { kind: 'ground' },
      { kind: 'storage', storageId: 'p1' },
      { food: 2 },
      { food: -1 },
      { nonsense: 1 },
    ]
    const literal = (v: Value): string => JSON.stringify(v).replace(/"(\w+)":/g, '$1:')
    const names = SCRIPT_API.filter((b) => b.is === 'action')
    for (let i = 0; i < 300; i++) {
      const { world, explored } = setup()
      const binding = names[Math.floor(rand() * names.length)]!
      const callArgs = Array.from({ length: Math.floor(rand() * 7) }, () =>
        literal(args[Math.floor(rand() * args.length)]!),
      )
      const { requests } = runAs(world, explored, `${binding.name}(${callArgs.join(', ')})`)
      expect(scriptRequestsSound(world, terrain, sender, 'a1', requests)).toEqual([])
    }
  })

  it('flags a request no order could make', () => {
    const { world } = setup()
    const bad: OrderRequest[] = [
      { kind: 'foundAlliance', residentId: 'a1', name: 'North' },
      { kind: 'walkTo', residentId: 'b1', x: 1, y: 1 },
      { kind: 'attack', residentId: 'a1', targetId: 'a1' },
    ]
    const found = scriptRequestsSound(world, terrain, sender, 'a1', bad)
    expect(found.map((v) => v.invariant)).toEqual(Array(3).fill('script-requests-as-orders'))
  })

  it('uses the order kinds as given', () => {
    const { world } = setup()
    const never = { validate: () => 'never', apply: () => {} }
    const found = scriptRequestsSound(
      world,
      terrain,
      sender,
      'a1',
      [{ kind: 'stop', residentId: 'a1' }],
      { ...orderKinds, stop: never },
    )
    expect(found).toHaveLength(1)
  })
})
