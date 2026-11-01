import {
  OWN_FOOD,
  Terrain,
  freeHousing,
  type OrderRequest,
  type RealmEvent,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { QueueRunner, queuesSound } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import type { RunnableScript } from './scripts.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Relocate in queues and scripts (`CONTEXT.md`: Relocate, Queue, Script): a queue step or a
 * script's `relocate(cityId)` gives the same order as the card, checked the same way.
 */

const SIZE = 64
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const SCRIPT_ID = 750

/**
 * Realm r1 (Player 7) with its city c1 (town hall at (9, 3)), where Ana (a1) lives and stands,
 * and its city c2, Redbank (town hall at (40, 3)), with one house and nobody living there; or
 * full, when `full`. Realm r2 has a city c3 of its own. `source` is the script Ana can run.
 */
function setup({ full = false, source = '' } = {}) {
  const world = createWorld(terrain)
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'a1' },
    { id: 'r2', userId: 8, leaderId: 'x1' },
  )
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const redbank = addCity(world, { id: 'c2', realmId: 'r1', x: 40, y: 3, name: 'Redbank' })
  addCity(world, { id: 'c3', realmId: 'r2', x: 9, y: 40 })
  world.buildings.push({ id: 'h2', kind: 'house', cityId: 'c2', x: 40, y: 7 })
  const ana = newResident(mulberry32(1), { id: 'a1', owner: 'r1', x: 9, y: 7, tick: 0 })
  ana.name = 'Ana'
  ana.cityId = 'c1'
  ana.carried = { food: OWN_FOOD }
  const x1 = newResident(mulberry32(2), { id: 'x1', owner: 'r2', x: 9, y: 44, tick: 0 })
  x1.cityId = 'c3'
  x1.carried = { food: OWN_FOOD }
  world.residents.push(ana, x1)
  if (full) {
    const room = freeHousing(world, redbank)
    for (let i = 0; i < room; i++) {
      const r = newResident(mulberry32(10 + i), { id: `b${i}`, owner: 'r1', x: 44, y: 9, tick: 0 })
      r.cityId = 'c2'
      r.carried = { food: OWN_FOOD }
      world.residents.push(r)
    }
  }
  const library = new Map<number, RunnableScript>([
    [SCRIPT_ID, { userId: 7, name: 'Move', version: 1, source, followsDefault: false }],
  ])
  const scripts = defaultScripts(terrain, [me], library)
  const orders = new OrderQueue(scripts.kinds, terrain)
  const queues = new QueueRunner(
    { sender: (id) => (id === 7 ? me : undefined) },
    scripts.kinds,
    terrain,
  )
  const walking = new Walking(terrain)
  /** One tick as the game runs it: orders, queues, scripts, then the world steps. */
  const tick = () => {
    for (const r of world.residents) r.hunger = 100
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
    expect(queuesSound.check(world, terrain)).toEqual([])
  }
  /** Ticks until `done`, at most `max` ticks. */
  const until = (done: () => boolean, max = 300) => {
    for (let i = 0; i < max && !done(); i++) tick()
    expect(done()).toBe(true)
  }
  const give = (order: OrderRequest) =>
    orders.receive(world, me, 'q', { residentId: 'a1', ...order })
  return { world, ana, redbank, tick, until, give }
}

const relocateStep = (cityId = 'c2') => ({ order: { kind: 'relocate', cityId } })
const walk = (x: number, y: number) => ({ order: { kind: 'walkTo', x, y } })
const ofKind = (events: RealmEvent[], kind: string) => events.filter((e) => e.kind === kind)

// Asks to relocate to Redbank once and waits on it; then keeps how it ended.
const RELOCATE_AND_READ = `
if (memory.started == null) {
  memory.started = true
  memory.asked = relocate("c2")
  if (memory.asked == null) { wait() }
} else if (memory.ended == null) {
  memory.ended = me.orderEnded
  memory.cityId = me.cityId
}`

describe('a script’s relocate(cityId)', () => {
  it('moves the resident in, and once it waited reads that it ended well', () => {
    const s = setup({ source: RELOCATE_AND_READ })
    s.give({ kind: 'runScript', scriptId: SCRIPT_ID })
    s.tick()
    expect(s.ana.order).toMatchObject({ kind: 'relocate', cityId: 'c2' })
    expect(s.ana.script?.waitingSince).toBeDefined()
    s.until(() => s.ana.script?.memory.ended != null)
    expect(s.ana.cityId).toBe('c2')
    expect(s.ana.script!.memory).toMatchObject({
      asked: null,
      ended: { kind: 'relocate', reason: null },
      cityId: 'c2',
    })
    expect(checkInvariants(s.world, terrain)).toEqual([])
  })

  it('reads why not when the city filled up on the way, and keeps the old city', () => {
    const s = setup({ source: RELOCATE_AND_READ })
    s.give({ kind: 'runScript', scriptId: SCRIPT_ID })
    s.tick()
    expect(s.ana.order?.kind).toBe('relocate')
    // Someone else moves in meanwhile, filling Redbank.
    const room = freeHousing(s.world, s.redbank)
    for (let i = 0; i < room; i++) {
      const r = newResident(mulberry32(20 + i), { id: `n${i}`, owner: 'r1', x: 44, y: 9, tick: 0 })
      r.cityId = 'c2'
      r.carried = { food: OWN_FOOD }
      s.world.residents.push(r)
    }
    s.until(() => s.ana.script?.memory.ended != null)
    expect(s.ana.cityId).toBe('c1')
    expect(s.ana.script!.memory).toMatchObject({
      ended: { kind: 'relocate', reason: 'no free housing' },
      cityId: 'c1',
    })
    expect(ofKind(s.world.events, 'relocateFailed')).toHaveLength(1)
  })

  it('is refused with the order’s reasons', () => {
    const full = setup({ full: true, source: RELOCATE_AND_READ })
    full.give({ kind: 'runScript', scriptId: SCRIPT_ID })
    full.tick()
    expect(full.ana.script!.memory.asked).toBe('no free housing')
    expect(full.ana.order).toBeNull()

    const theirs = setup({ source: 'memory.asked = relocate("c3")' })
    theirs.give({ kind: 'runScript', scriptId: SCRIPT_ID })
    theirs.tick()
    expect(theirs.ana.script!.memory.asked).toBe('not a city of your realm')

    const home = setup({ source: 'memory.asked = relocate("c1")' })
    home.give({ kind: 'runScript', scriptId: SCRIPT_ID })
    home.tick()
    expect(home.ana.script!.memory.asked).toBe('Ana already lives in Ashford')
  })
})

describe('a Relocate queue step', () => {
  it('moves the resident in, then the next step starts', () => {
    const s = setup()
    expect(s.give({ kind: 'queue', steps: [relocateStep(), walk(44, 10)] })).toMatchObject({
      type: 'ack',
    })
    s.tick()
    expect(s.ana.order).toMatchObject({ kind: 'relocate', cityId: 'c2' })
    s.until(() => s.ana.cityId === 'c2')
    s.tick()
    expect(s.ana.queue).toMatchObject({ current: 1 })
    expect(s.ana.order).toMatchObject({ kind: 'walkTo', target: { x: 44, y: 10 } })
    s.until(() => s.ana.queue === undefined)
    expect(s.ana).toMatchObject({ x: 44, y: 10, cityId: 'c2' })
    expect(ofKind(s.world.events, 'queueStepSkipped')).toEqual([])
  })

  it('is skipped for lack of housing when its turn comes, and noted in the realm log', () => {
    const s = setup({ full: true })
    // Adding it only checks that the city is the realm's.
    expect(s.give({ kind: 'queue', steps: [relocateStep(), walk(9, 10)] })).toMatchObject({
      type: 'ack',
    })
    s.tick()
    expect(ofKind(s.world.events, 'queueStepSkipped')).toMatchObject([
      { name: 'Ana', step: 1, order: 'relocate', reason: 'no free housing' },
    ])
    expect(s.ana.order).toMatchObject({ kind: 'walkTo', target: { x: 9, y: 10 } })
    expect(s.ana.cityId).toBe('c1')
  })

  it('that fails on arrival goes in the realm log once, and the next step starts', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [relocateStep(), walk(44, 10)] })
    s.tick()
    s.world.cities.find((c) => c.id === 'c2')!.realmId = 'r2'
    s.until(() => s.ana.queue?.current === 1)
    expect(s.ana.cityId).toBe('c1')
    expect(ofKind(s.world.events, 'relocateFailed')).toHaveLength(1)
    expect(ofKind(s.world.events, 'queueStepSkipped')).toEqual([])
  })

  it('can only be added for a city of the realm', () => {
    const s = setup()
    expect(s.give({ kind: 'queue', steps: [walk(9, 10), relocateStep('c3')] })).toMatchObject({
      type: 'rejected',
      reason: 'step 2: not a city of your realm',
    })
    expect(s.give({ kind: 'queue', steps: [relocateStep('nowhere')] })).toMatchObject({
      type: 'rejected',
      reason: 'step 1: not a city of your realm',
    })
  })
})
