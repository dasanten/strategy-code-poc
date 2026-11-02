import { parse, run, type ScriptObject } from '@csp/lang'
import {
  OWN_FOOD,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_VALUE_LIMITS,
  Terrain,
  WAYPOINTS_MAX,
  type OrderRequest,
  type TerrainMap,
  type Waypoint,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue, orderKinds, type OrderSender } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { bindScript, scriptRequestsSound } from './script-bindings.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { waypointsOf } from './waypoints.js'
import { createWorld, stepWorld } from './world.js'

/*
 * A waypoint is a place like a tile (`CONTEXT.md`: Waypoint): picked for a walk-to or a queue
 * step, the UI gives the order the waypoint's tile; scripts read, add and remove their Player's
 * waypoints.
 */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const edda = { userId: 8, account: { name: 'Edda', isAdmin: false } }

/**
 * Realm r1 (Player 7) with w1 at (6, 6), realm r2 (Player 8) with x1. A tick runs orders, queues
 * and scripts as the game does, then steps the world.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'w1' },
    { id: 'r2', userId: 8, leaderId: 'x1' },
  )
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 6, y: 6, tick: 0 })
  r.cityId = 'c1'
  r.carried = { food: OWN_FOOD }
  const x1 = newResident(mulberry32(2), { id: 'x1', owner: 'r2', x: 1, y: 1, tick: 0 })
  world.residents.push(r, x1)
  const scripts = defaultScripts(terrain, [mara])
  const orders = new OrderQueue(scripts.kinds, terrain)
  const queues = new QueueRunner(
    { sender: (id) => (id === 7 ? mara : undefined) },
    scripts.kinds,
    terrain,
  )
  const walking = new Walking(terrain)
  const tick = () => {
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
  }
  const give = (order: OrderRequest) => {
    const answer = orders.receive(world, mara, 'q', order)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  /** Runs `source` once as a script of `residentId` for `sender`, applying what it requested. */
  const runOnce = (source: string, sender: OrderSender = mara, residentId = 'w1') => {
    const memory: ScriptObject = {}
    const bound = bindScript({
      world,
      terrain,
      sender,
      residentId,
      memory,
      seen: () => [],
      explored: () => true,
    })
    const result = run(parse(source), {
      globals: bound.globals,
      steps: 10_000,
      maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
      limits: SCRIPT_VALUE_LIMITS,
    })
    expect(result.status).toBe('done')
    expect(scriptRequestsSound(world, terrain, sender, residentId, bound.requests)).toEqual([])
    // Applied as the script runner applies them.
    for (const order of bound.requests) orderKinds[order.kind]!.apply(world, sender, order, terrain)
    return { memory, requests: bound.requests }
  }
  return { world, r, tick, give, runOnce }
}

describe('waypoints as places', () => {
  it('take a resident walking to one there', () => {
    const s = setup()
    s.give({ kind: 'addWaypoint', x: 12, y: 9, name: 'Pass' })
    s.tick()
    const pass = waypointsOf(s.world, 7)[0]!
    // Walk to with the waypoint picked: the order gets its tile.
    expect(s.give({ kind: 'walkTo', residentId: 'w1', x: pass.x, y: pass.y })).toBe('ok')
    for (let i = 0; i < 200 && (i === 0 || s.r.order); i++) s.tick()
    expect(s.r).toMatchObject({ x: 12, y: 9, order: null })
  })

  it('give a queue step their tile, which it keeps once the waypoint is removed', () => {
    const s = setup()
    s.give({ kind: 'addWaypoint', x: 6, y: 12, name: 'Ford' })
    s.give({ kind: 'addWaypoint', x: 12, y: 12, name: 'Pass' })
    s.tick()
    const [ford, pass] = waypointsOf(s.world, 7)
    const walk = (w: Waypoint) => ({ order: { kind: 'walkTo', x: w.x, y: w.y } })
    const steps = [walk(ford!), walk(pass!)]
    expect(s.give({ kind: 'queue', residentId: 'w1', steps })).toBe('ok')
    s.tick()
    expect(s.give({ kind: 'removeWaypoint', waypointId: pass!.id })).toBe('ok')
    const been: string[] = []
    for (let i = 0; i < 200 && s.r.queue; i++) {
      s.tick()
      been.push(`${s.r.x},${s.r.y}`)
    }
    expect(waypointsOf(s.world, 7)).toEqual([ford])
    expect(been).toContain('6,12')
    expect(been.indexOf('6,12')).toBeLessThan(been.indexOf('12,12'))
    expect(s.r).toMatchObject({ x: 12, y: 12, order: null })
  })

  it('are read, added and removed by their Player’s scripts', () => {
    const s = setup()
    const added = s.runOnce(`
memory.pass = addWaypoint(3, 4, "  Pass ")
memory.ford = addWaypoint(5, 6, "Ford")
memory.unnamed = addWaypoint(5, 6, "")
memory.off = addWaypoint(${SIZE}, 6, "Off")
`)
    expect(added.memory).toEqual({
      pass: null,
      ford: null,
      unnamed: 'Name: needs a name',
      off: 'not a tile on the map',
    })
    const held = waypointsOf(s.world, 7)
    expect(held.map(({ name, x, y }) => ({ name, x, y }))).toEqual([
      { name: 'Pass', x: 3, y: 4 },
      { name: 'Ford', x: 5, y: 6 },
    ])
    // Their own Player's only, as the waypoint script view shows them.
    expect(s.runOnce('memory.seen = waypoints()').memory.seen).toEqual(held)
    expect(s.runOnce('memory.seen = waypoints()', edda, 'x1').memory.seen).toEqual([])

    // By the waypoint or its id; removing the same one twice in a run is turned down the second time.
    const removed = s.runOnce(`
memory.first = removeWaypoint(waypoints()[0])
memory.again = removeWaypoint(waypoints()[0].id)
memory.unknown = removeWaypoint("wp999")
`)
    expect(removed.memory).toEqual({
      first: null,
      again: 'not one of your waypoints',
      unknown: 'not one of your waypoints',
    })
    expect(waypointsOf(s.world, 7)).toEqual([held[1]])
    // Another Player's script can't remove it.
    const id = held[1]!.id
    expect(s.runOnce(`memory.r = removeWaypoint("${id}")`, edda, 'x1').memory.r).toBe(
      'not one of your waypoints',
    )
    expect(s.runOnce(`memory.r = removeWaypoint("${id}")`).memory.r).toBeNull()
    expect(s.world.waypoints).toEqual({})
    expect(checkInvariants(s.world, terrain)).toEqual([])
  })

  it(`stop a script at ${WAYPOINTS_MAX}, counting those the same run added`, () => {
    const s = setup()
    s.world.waypoints[7] = Array.from({ length: WAYPOINTS_MAX - 1 }, (_, i) => ({
      id: `wp${100 + i}`,
      name: `W${i}`,
      x: i % SIZE,
      y: 1,
    }))
    const full = `you hold ${WAYPOINTS_MAX} waypoints already, the most`
    const first = s.runOnce(`
memory.last = addWaypoint(1, 2, "Last")
memory.over = addWaypoint(2, 2, "Too many")
`)
    expect(first.memory).toEqual({ last: null, over: full })
    expect(first.requests).toHaveLength(1)
    expect(waypointsOf(s.world, 7)).toHaveLength(WAYPOINTS_MAX)
    // Removing one makes room from the next run on: requests are applied after the run.
    const out = s.runOnce(`
memory.out = removeWaypoint(waypoints()[0])
memory.in = addWaypoint(3, 2, "Too soon")
`)
    expect(out.memory).toEqual({ out: null, in: full })
    expect(waypointsOf(s.world, 7)).toHaveLength(WAYPOINTS_MAX - 1)
    expect(s.runOnce('memory.in = addWaypoint(3, 2, "Instead")').memory.in).toBeNull()
    expect(waypointsOf(s.world, 7)).toHaveLength(WAYPOINTS_MAX)
    expect(waypointsOf(s.world, 7).at(-1)!.name).toBe('Instead')
    expect(checkInvariants(s.world, terrain)).toEqual([])
  })

  it('are none for an NPC city’s script, which can’t add any', () => {
    const s = setup()
    addCity(s.world, { id: 'n1', realmId: null, x: 22, y: 22 })
    const npc = newResident(mulberry32(3), { id: 'v1', owner: null, x: 22, y: 23, tick: 0 })
    npc.cityId = 'n1'
    s.world.residents.push(npc)
    const city = { userId: 0, account: { name: 'n1', isAdmin: false }, npcCityId: 'n1' }
    const out = s.runOnce(
      'memory.seen = waypoints() memory.add = addWaypoint(1, 1, "Mine")',
      city,
      'v1',
    )
    expect(out.memory).toEqual({ seen: [], add: 'only a Player holds waypoints' })
    expect(s.world.waypoints).toEqual({})
  })
})
