import {
  DEFEND_CALM_TICKS,
  OWN_FOOD,
  Terrain,
  type Building,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it, vi } from 'vitest'
import { attackOrder, resolveStrikes } from './combat.js'
import { defenceScriptSound, interruptedSound } from './defence.js'
import { checkInvariants } from './invariants.js'
import type { RunnableScript } from './scripts.js'
import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Defence scripts (`CONTEXT.md`: Defence script; ADR 0015): a blow interrupts what a Player's
 * resident does, the Defend default fights back or flees home, and what it interrupted goes on.
 */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with city c1 (its town hall at (9, 3)): resident w1 standing on farm f1 at
 * (6, 6), and resident x1 of Player 8's realm r2 beside them (its Leader l2 far off).
 */
function setup(library = new Map<number, RunnableScript>()) {
  const world = createWorld(terrain)
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'w1' },
    { id: 'r2', userId: 8, leaderId: 'l2' },
  )
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const farm: Building = { id: 'f1', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
  world.buildings.push(farm)
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 6, y: 6, tick: 0 })
  r.cityId = 'c1'
  r.carried = { food: OWN_FOOD }
  const x1 = newResident(mulberry32(2), { id: 'x1', owner: 'r2', x: 7, y: 6, tick: 0 })
  const l2 = newResident(mulberry32(3), { id: 'l2', owner: 'r2', x: 28, y: 28, tick: 0 })
  world.residents.push(r, x1, l2)
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
    for (const x of world.residents) x.hunger = 100
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain)).toEqual([])
  }
  /** Ticks until `done`, at most `limit` ticks; answers whether it came. */
  const until = (done: () => boolean, limit = 200) => {
    for (let i = 0; i < limit && !done(); i++) tick()
    return done()
  }
  const give = (order: OrderRequest) =>
    orders.receive(world, me, 'q', { residentId: 'w1', ...order })
  /** x1 goes after w1. */
  const strike = () => {
    x1.order = attackOrder('w1')
  }
  /** x1 leaves the world: they are gone. */
  const gone = () => {
    world.residents = world.residents.filter((x) => x !== x1)
  }
  return { world, r, x1, orders, tick, until, give, strike, gone }
}

const logged = (r: { scriptLog?: { text: string }[] }) => (r.scriptLog ?? []).map((l) => l.text)

describe('the Defend default', () => {
  it('an armed worker struck mid-task fights back, then goes back to work, memory intact', () => {
    const s = setup()
    s.r.carried.spear = 1
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.tick()
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    const work = s.r.script!
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
    expect(s.r.interrupted).toMatchObject({ order: { kind: 'workAt' }, script: work })
    const memory = structuredClone(s.r.interrupted!.script!.memory)
    expect(s.r.script).toMatchObject({ task: 'defend' })
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1', defending: true })
    expect(s.r.script!.memory.doing).toBe(`Defending: fighting back at ${s.x1.name}`)

    s.gone()
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.script).toMatchObject({ scriptId: work.scriptId, memory })
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    expect(logged(s.r)).toContain('the attacker is gone')
    s.tick()
    expect(s.r.script?.scriptId).toBe(work.scriptId)
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
  })

  it('an unarmed resident walks home, and their queue goes on from the step it was at', () => {
    const s = setup()
    const walk = (x: number, y: number) => ({ order: { kind: 'walkTo', x, y } })
    s.give({ kind: 'queue', steps: [walk(6, 20), walk(20, 20)] })
    s.tick()
    s.x1.x = s.r.x + 1
    s.x1.y = s.r.y
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined, 20)).toBe(true)
    expect(s.r.interrupted!.order).toMatchObject({ kind: 'walkTo', target: { x: 6, y: 20 } })
    expect(s.r.queue).toMatchObject({ current: 0 })
    s.x1.order = null
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 9, y: 3 } })
    expect(s.r.script!.memory.doing).toBe('Defending: fleeing home')
    // Home at the town hall, it ends, and the walk the queue was at goes on.
    expect(s.until(() => s.r.interrupted === undefined, 100)).toBe(true)
    expect(logged(s.r).at(-1)).toMatch(/^(home|no blow for a while)$/)
    expect(s.r.queue).toMatchObject({ current: 0 })
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 6, y: 20 } })
    expect(s.until(() => s.r.queue === undefined, 300)).toBe(true)
    expect(s.r).toMatchObject({ x: 20, y: 20 })
  })

  it('ends once no blow has landed for a while, fleeing', () => {
    const s = setup()
    s.r.cityId = null
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined, 20)).toBe(true)
    s.x1.order = null
    // With no home to flee to, it ends at once.
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(logged(s.r)).toContain('no home to flee to')

    s.r.cityId = 'c1'
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined, 20)).toBe(true)
    const at = s.r.struck!.tick
    s.x1.order = null
    s.world.buildings = s.world.buildings.filter((b) => b.kind !== 'townHall')
    s.world.buildings.push({ id: 'far', kind: 'townHall', cityId: 'c1', x: 6, y: 28 })
    s.world.cities[0]!.townHallId = 'far'
    expect(s.until(() => s.r.interrupted === undefined, DEFEND_CALM_TICKS + 5)).toBe(true)
    expect(s.world.tick - at).toBeGreaterThanOrEqual(DEFEND_CALM_TICKS)
    expect(logged(s.r)).toContain('no blow for a while')
  })

  it('a second blow doesn’t start it again', () => {
    const s = setup()
    s.r.carried.spear = 1
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.tick()
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
    const kept = structuredClone(s.r.interrupted)
    s.tick()
    const defence = s.r.script!
    expect(defence.memory.doing).toMatch(/^Defending/)
    s.strike()
    resolveStrikes(s.world, [{ attackerId: 'x1', targetId: 'w1' }], SIZE)
    expect(s.r.struck!.tick).toBe(s.world.tick)
    expect(s.r.script).toBe(defence)
    expect(s.r.interrupted).toEqual(kept)
  })

  it('a Player order given meanwhile ends both, the queue too', () => {
    const s = setup()
    s.give({ kind: 'queue', steps: [{ order: { kind: 'task', task: 'work', workplaceId: 'f1' } }] })
    s.tick()
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
    s.give({ kind: 'walkTo', x: 3, y: 3 })
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.script).toBeUndefined()
    expect(s.r.queue).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 3, y: 3 } })
  })

  it('can’t be given as a task', () => {
    const s = setup()
    expect(s.give({ kind: 'task', task: 'defend' })).toMatchObject({ type: 'rejected' })
  })

  it('shows its owner what goes on after it, never its memory', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.tick()
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
    const seen = (realmId: string) =>
      entitiesInSight(s.world, terrain, realmId).find((e) => e.id === 'w1')!
    expect(seen('r1')).toMatchObject({
      interrupted: { order: { kind: 'workAt' }, script: { scriptId: 701, building: 'farm' } },
    })
    expect(JSON.stringify(seen('r1'))).not.toContain('workplaceId')
    expect(seen('r2')).not.toHaveProperty('interrupted')
  })
})

/** Mara's own script 750, picked as a defence script: it logs what it sees, and ends. */
const shout = (): RunnableScript => ({
  userId: 7,
  name: 'Shout',
  version: 1,
  followsDefault: false,
  source:
    'param times: number = 2\nlog("shouting " + params.times + " by " + me.defenceScript)\nend("shouted")',
})

describe('a defence script picked', () => {
  it('runs when they are struck, in place of Defend, and what it interrupted goes on after', () => {
    const s = setup(new Map([[750, shout()]]))
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.tick()
    const picked = { kind: 'setDefenceScript', scriptId: 750, params: { times: 3 } }
    expect(s.give(picked)).toMatchObject({ type: 'ack' })
    s.tick()
    expect(s.r.defenceScriptId).toBe(750)
    expect(s.r.scriptParams?.[750]).toEqual({ times: 3 })
    // Picking it leaves the work going.
    expect(s.r.script?.scriptId).toBe(701)
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })

    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
    expect(s.r.script).toMatchObject({ scriptId: 750, task: 'defend' })
    s.x1.order = null
    s.tick()
    expect(logged(s.r)).toEqual(expect.arrayContaining(['shouting 3 by 750', 'shouted']))
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.script?.scriptId).toBe(701)
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
  })

  it('cleared, or picked as Defend itself, is the Defend default again', () => {
    const s = setup(new Map([[750, shout()]]))
    s.r.carried.spear = 1
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.tick()
    expect(s.r.defenceScriptId).toBe(750)
    s.give({ kind: 'setDefenceScript', scriptId: null })
    s.tick()
    expect(s.r.defenceScriptId).toBeUndefined()
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.give({ kind: 'setDefenceScript', scriptId: 707 })
    s.tick()
    expect(s.r.defenceScriptId).toBeUndefined()

    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
    s.tick()
    expect(s.r.script).toMatchObject({ scriptId: 707, task: 'defend' })
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1', defending: true })
  })

  it('deleted, falls back to the Defend default and tells the realm log once', () => {
    const library = new Map([[750, shout()]])
    const s = setup(library)
    s.r.carried.spear = 1
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.tick()
    library.delete(750)
    s.strike()
    expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
    s.tick()
    expect(s.r.script).toMatchObject({ scriptId: 707, task: 'defend' })
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1', defending: true })
    expect(s.r.defenceScriptId).toBeUndefined()
    const told = () => s.world.events.filter((e) => e.kind === 'defenceScriptGone')
    expect(told()).toMatchObject([{ residentId: 'w1', scriptId: 750 }])
    s.tick()
    s.tick()
    expect(told()).toHaveLength(1)
  })

  it('is one of the Player’s own scripts, for a resident of their own', () => {
    const theirs = { ...shout(), userId: 8 }
    const s = setup(
      new Map([
        [750, shout()],
        [751, theirs],
      ]),
    )
    const pick = (o: object) => s.give({ kind: 'setDefenceScript', ...o })
    expect(pick({ scriptId: 751 })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: 750, residentId: 'x1' })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: 750, params: { times: -1 } })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: null, params: { times: 1 } })).toMatchObject({ type: 'rejected' })
    // A default other than Defend may be picked too.
    expect(pick({ scriptId: 701 })).toMatchObject({ type: 'ack' })
  })

  it('ended by an error of the game’s own, hands back to what it interrupted', () => {
    const walker = { ...shout(), source: 'walkTo(1, 1)' }
    const s = setup(new Map([[750, walker]]))
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.tick()
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.tick()
    const work = s.r.script!
    // walkTo's check throws while w1 defends: a native of the game's failing, not the script.
    const walkTo = orderKinds.walkTo!
    const validate = walkTo.validate
    const spy = vi.spyOn(walkTo, 'validate').mockImplementation((world, sender, order, t) => {
      if (s.r.script?.task === 'defend') throw new Error('boom')
      return validate(world, sender, order, t)
    })
    try {
      s.strike()
      expect(s.until(() => s.r.interrupted !== undefined)).toBe(true)
      s.x1.order = null
      s.tick()
    } finally {
      spy.mockRestore()
    }
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.script).toBe(work)
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
  })

  it('is seen by its owner only', () => {
    const s = setup(new Map([[750, shout()]]))
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.tick()
    const seen = (realmId: string) =>
      entitiesInSight(s.world, terrain, realmId).find((e) => e.id === 'w1')!
    expect(seen('r1')).toMatchObject({ defenceScriptId: 750 })
    expect(seen('r2')).not.toHaveProperty('defenceScriptId')
  })
})

describe('defence invariant', () => {
  it('flags something interrupted with no defence script running (ADR 0004)', () => {
    const s = setup()
    s.r.interrupted = { order: null }
    expect(interruptedSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'interrupted-runs-defence', entityIds: ['w1'] },
    ])
    s.r.script = { scriptId: 0, task: 'defend', memory: {} }
    expect(interruptedSound.check(s.world, terrain)).toEqual([])
  })

  it('flags a defence script that is no script id (ADR 0004)', () => {
    const s = setup()
    s.r.defenceScriptId = 0
    expect(defenceScriptSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'defence-script-sound', entityIds: ['w1'] },
    ])
    s.r.defenceScriptId = 750
    expect(defenceScriptSound.check(s.world, terrain)).toEqual([])
  })
})
