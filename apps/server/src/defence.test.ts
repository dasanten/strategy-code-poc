import {
  AVERAGE_HORSE_STATS,
  DEFEND_CALM_TICKS,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  dodgeChance,
  isDown,
  standsStill,
  type Building,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it, vi } from 'vitest'
import { attackOrder, resolveStrikes } from './combat.js'
import {
  defenceScriptSound,
  givenUnderAttackSound,
  interruptedSound,
  struckDriverDrivesOn,
} from './defence.js'
import { goDown } from './survival.js'
import { checkInvariants } from './invariants.js'
import type { RunnableScript } from './scripts.js'
import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { hash, mulberry32, newResident } from './residents.js'
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

/**
 * Blows land on w1 every `STRIKE_TICKS`, x1 staying on their tile, and they don't die of it, for
 * at most `limit` ticks. Stops at `done`, and answers whether it came; `each` looks after each tick
 * before that one (a blow on the tick it comes is after it, and starts their defence script).
 */
function underBlows(
  s: ReturnType<typeof setup>,
  done: () => boolean,
  limit = 200,
  each: () => void = () => {},
) {
  for (let i = 0; i < limit && !done(); i++) {
    s.x1.x = s.r.x
    s.x1.y = s.r.y
    if (s.x1.order?.kind !== 'attack') s.strike()
    s.r.health = MAX_HEALTH
    s.tick()
    if (!done()) each()
  }
  return done()
}

/** w1 is struck, and their defence script runs. */
function attacked(s: ReturnType<typeof setup>) {
  expect(underBlows(s, () => s.r.interrupted !== undefined)).toBe(true)
  expect(s.r.script?.task).toBe('defend')
}

/** Mara's own script 760: it walks w1 to (20, 20), step by step, for as long as it runs. */
const wander = (): RunnableScript => ({
  userId: 7,
  name: 'Wander',
  version: 1,
  followsDefault: false,
  source: 'if (me.order == null && me.x != 20) { walkTo(20, 20) }',
})

describe('a Player’s order under attack', () => {
  const home = { x: 9, y: 3 }

  it('a walk given under attack gets there through constant blows', () => {
    const s = setup()
    attacked(s)
    expect(s.give({ kind: 'walkTo', x: 6, y: 20 })).toMatchObject({ type: 'ack' })
    const struckFrom = s.r.struck!.tick
    const arrived = () => s.r.x === 6 && s.r.y === 20
    const walking = underBlows(s, arrived, 200, () => {
      expect(s.r.interrupted).toBeUndefined()
      expect(s.r.script).toBeUndefined()
    })
    expect(walking).toBe(true)
    expect(s.r.struck!.tick).toBeGreaterThan(struckFrom)
  })

  it('a walk given under attack gets there with a Player-picked defence script too', () => {
    const walker = { ...shout(), source: 'walkTo(1, 1)' }
    const s = setup(new Map([[750, walker]]))
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.tick()
    attacked(s)
    expect(s.r.script).toMatchObject({ scriptId: 750 })
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    const arrived = () => s.r.x === 6 && s.r.y === 20
    expect(underBlows(s, arrived, 200, () => expect(s.r.interrupted).toBeUndefined())).toBe(true)
  })

  it('a walk given just after a blow, with no defence script running, stands too', () => {
    const s = setup()
    s.r.struck = { by: 'x1', tick: s.world.tick }
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    expect(s.r.givenUnderAttack).toBe('untilDone')
    const arrived = () => s.r.x === 6 && s.r.y === 20
    expect(underBlows(s, arrived, 200, () => expect(s.r.interrupted).toBeUndefined())).toBe(true)
  })

  it('a walk stands however long it takes, calm or not', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.x1.order = null
    s.tick()
    // Calm for longer than Defend waits, still on the way: the next blow doesn't stop them.
    s.world.tick += DEFEND_CALM_TICKS
    expect(s.r.order).toMatchObject({ kind: 'walkTo' })
    expect(underBlows(s, () => s.r.x === 6 && s.r.y === 20)).toBe(true)
    expect(s.r.interrupted).toBeUndefined()
  })

  it('a blow after it is done runs the defence script', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'walkTo', x: 6, y: 10 })
    expect(underBlows(s, () => s.r.x === 6 && s.r.y === 10 && s.r.order === null)).toBe(true)
    expect(s.r.interrupted).toBeUndefined()
    attacked(s)
    expect(s.r.givenUnderAttack).toBeUndefined()
  })

  it('a drive given under attack gets the carriage there through constant blows', () => {
    const s = setup()
    const { carriage: k1 } = withCarriage(s)
    attacked(s)
    expect(s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })).toMatchObject({ type: 'ack' })
    const there = () => k1.x === 6 && k1.y === 24
    const start = s.world.tick
    const drove = underBlows(s, there, 200, () => {
      expect(s.r.interrupted).toBeUndefined()
      s.world.horses[0]!.hunger = MAX_HUNGER
    })
    expect(drove).toBe(true)
    expect(s.r).toMatchObject({ x: 6, y: 24 })
    expect(s.world.tick - start).toBeLessThan(200)
  })

  it('Work given under attack holds during it, and a blow after the calm time interrupts', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.tick()
    const work = s.r.script!
    expect(work.scriptId).toBe(701)
    expect(s.r.givenUnderAttack).toBe('untilCalm')
    let ticks = 0
    const held = underBlows(
      s,
      () => ticks >= DEFEND_CALM_TICKS * 2,
      DEFEND_CALM_TICKS * 2,
      () => {
        ticks++
        expect(s.r.interrupted).toBeUndefined()
        expect(s.r.script?.scriptId).toBe(work.scriptId)
        expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
      },
    )
    expect(held).toBe(true)

    s.x1.order = null
    for (let i = 0; i < DEFEND_CALM_TICKS + 1; i++) s.tick()
    expect(s.r.interrupted).toBeUndefined()
    attacked(s)
    expect(s.r.interrupted).toMatchObject({ order: { kind: 'workAt' } })
    expect(s.r.givenUnderAttack).toBeUndefined()
  })

  it('a dodged blow after the calm time ends the hold too, and the next one interrupts', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.tick()
    s.x1.order = null
    for (let i = 0; i < DEFEND_CALM_TICKS + 1; i++) s.tick()
    expect(s.r.givenUnderAttack).toBe('untilCalm')
    // A tick on which x1's blow is dodged, as `resolveStrikes` rolls it.
    const dodged = (t: number) =>
      mulberry32(hash(`${s.world.seed}:${t}:x1:strike`))() < dodgeChance(s.r, t)
    while (!dodged(s.world.tick)) s.world.tick++
    const health = s.r.health
    s.x1.x = s.r.x
    s.x1.y = s.r.y
    s.x1.order = attackOrder('w1', true)
    resolveStrikes(s.world, [{ attackerId: 'x1', targetId: 'w1' }], SIZE)
    expect(s.r.health).toBe(health)
    expect(s.r.struck!.tick).toBe(s.world.tick)
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.givenUnderAttack).toBeUndefined()
    attacked(s)
  })

  it('a script given under attack holds during it, and a blow after the calm time interrupts', () => {
    const s = setup(new Map([[760, { ...wander(), source: 'let quiet = 1' }]]))
    attacked(s)
    s.give({ kind: 'runScript', scriptId: 760 })
    s.tick()
    expect(s.r.script?.scriptId).toBe(760)
    expect(s.r.givenUnderAttack).toBe('untilCalm')
    let ticks = 0
    underBlows(
      s,
      () => ticks >= DEFEND_CALM_TICKS,
      DEFEND_CALM_TICKS,
      () => {
        ticks++
        expect(s.r.interrupted).toBeUndefined()
        expect(s.r.script?.scriptId).toBe(760)
      },
    )
    s.x1.order = null
    for (let i = 0; i < DEFEND_CALM_TICKS + 1; i++) s.tick()
    attacked(s)
    expect(s.r.interrupted).toMatchObject({ script: { scriptId: 760 } })
  })

  it('a queue given under attack holds, its own steps too, and once done the next blow counts', () => {
    const s = setup()
    attacked(s)
    const walk = (x: number, y: number) => ({ order: { kind: 'walkTo', x, y } })
    s.give({ kind: 'queue', steps: [walk(6, 8), walk(6, 10)] })
    const arrived = () => s.r.queue === undefined && s.r.x === 6 && s.r.y === 10
    expect(underBlows(s, arrived, 200, () => expect(s.r.interrupted).toBeUndefined())).toBe(true)
    attacked(s)
  })

  it('an order given before any blow is still interrupted', () => {
    const s = setup()
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    expect(s.r.givenUnderAttack).toBeUndefined()
    attacked(s)
    expect(s.r.interrupted).toMatchObject({ order: { kind: 'walkTo', target: { x: 6, y: 20 } } })
  })

  it('an order given once it has been calm for the calm time is interrupted as usual', () => {
    const s = setup()
    s.r.struck = { by: 'x1', tick: s.world.tick - DEFEND_CALM_TICKS }
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    expect(s.r.givenUnderAttack).toBeUndefined()
    attacked(s)
  })

  it('a later order out of the fight replaces the mark', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    expect(s.r.givenUnderAttack).toBe('untilDone')
    s.x1.order = null
    s.world.tick += DEFEND_CALM_TICKS
    s.give({ kind: 'walkTo', x: 3, y: 20 })
    s.tick()
    expect(s.r.givenUnderAttack).toBeUndefined()
    attacked(s)
  })

  it('what a script requests itself doesn’t count as given by the Player', () => {
    const s = setup(new Map([[760, wander()]]))
    s.r.carried.spear = 1
    s.give({ kind: 'runScript', scriptId: 760 })
    s.tick()
    attacked(s)
    expect(s.r.interrupted).toMatchObject({ script: { scriptId: 760 } })
    // The attacker gone, the script goes on and walks again, a blow only just past.
    const foe = s.x1
    s.gone()
    expect(s.until(() => s.r.script?.scriptId === 760 && s.r.order?.kind === 'walkTo')).toBe(true)
    expect(s.world.tick - s.r.struck!.tick).toBeLessThan(DEFEND_CALM_TICKS)
    expect(s.r.givenUnderAttack).toBeUndefined()
    s.world.residents.push(foe)
    attacked(s)
  })

  it('what the defence script requests itself doesn’t count either', () => {
    const s = setup()
    attacked(s)
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: home })
    expect(s.r.givenUnderAttack).toBeUndefined()
    expect(s.r.script?.task).toBe('defend')
  })

  it('an order that replaces nothing leaves things as they were', () => {
    const s = setup(new Map([[750, shout()]]))
    attacked(s)
    const defence = s.r.script
    s.give({ kind: 'rename', name: 'Bo' })
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.tick()
    expect(s.r.interrupted).toBeDefined()
    expect(s.r.script?.scriptId).toBe(defence?.scriptId)
    expect(s.r.givenUnderAttack).toBeUndefined()

    // A walk standing keeps its mark through such an order.
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    s.give({ kind: 'rename', name: 'Cy' })
    s.tick()
    expect(s.r.givenUnderAttack).toBe('untilDone')
  })

  it('stopping leaves nothing to hold: the next blow runs the defence script', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    s.give({ kind: 'stop' })
    s.tick()
    expect(s.r.order).toBeNull()
    expect(s.r.givenUnderAttack).toBeUndefined()
    attacked(s)
  })

  it('going Down ends it', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    goDown(s.world, s.r)
    expect(s.r.givenUnderAttack).toBeUndefined()
  })

  it('isn’t seen by anyone', () => {
    const s = setup()
    attacked(s)
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    expect(s.r.givenUnderAttack).toBe('untilDone')
    for (const realmId of ['r1', 'r2']) {
      const seen = entitiesInSight(s.world, terrain, realmId).find((e) => e.id === 'w1')!
      expect(seen).not.toHaveProperty('givenUnderAttack')
    }
  })
})

/** A carriage k1 with its horse h1 hitched at (6, 6), of realm r1, where w1 stands. */
function withCarriage(s: ReturnType<typeof setup>) {
  const horse = {
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: 6,
    y: 6,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    name: 'Rowan',
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  }
  const carriage = {
    id: 'k1',
    realmId: 'r1',
    cityId: null,
    x: 6,
    y: 6,
    horseId: 'h1',
    load: {},
  }
  s.world.horses.push(horse)
  s.world.carriages.push(carriage)
  return { horse: s.world.horses.at(-1)!, carriage: s.world.carriages.at(-1)! }
}

/** Resident p1 of realm r1, unarmed, aboard k1. */
function passenger(s: ReturnType<typeof setup>) {
  const p = newResident(mulberry32(4), { id: 'p1', owner: 'r1', x: 6, y: 6, tick: 0 })
  p.cityId = 'c1'
  p.carried = { food: OWN_FOOD }
  p.aboard = 'k1'
  s.world.residents.push(p)
  return p
}

/** Blows land on `victim` as in `underBlows`, every tick keeping them and the horse up. */
function blowsOn(
  s: ReturnType<typeof setup>,
  victim: { id: string; x: number; y: number; health: number },
  done: () => boolean,
  limit = 300,
  each: () => void = () => {},
) {
  for (let i = 0; i < limit && !done(); i++) {
    s.x1.x = victim.x
    s.x1.y = victim.y
    if (s.x1.order?.kind !== 'attack') s.x1.order = attackOrder(victim.id)
    victim.health = MAX_HEALTH
    for (const h of s.world.horses) h.hunger = MAX_HUNGER
    s.tick()
    if (!done()) each()
  }
  return done()
}

describe('on a carriage under attack (`CONTEXT.md`)', () => {
  /** Ticks an unarmed w1 takes to drive k1 to (6, 24), with blows or without. */
  function driveThere(struck: boolean) {
    const s = setup()
    const { carriage, horse } = withCarriage(s)
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    const there = () => carriage.x === 6 && carriage.y === 24
    const start = s.world.tick
    if (struck) {
      expect(blowsOn(s, s.r, there)).toBe(true)
      expect(s.r.struck).toBeDefined()
    } else {
      const fedThere = () => {
        horse.hunger = MAX_HUNGER
        return there()
      }
      expect(s.until(fedThere, 300)).toBe(true)
    }
    return s.world.tick - start
  }

  it('an unarmed driver reaches their target at the same pace under constant blows', () => {
    expect(driveThere(true)).toBe(driveThere(false))
  })

  it('an unarmed driver holds their drive through every blow, and stands with their carriage', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    const there = () => carriage.x === 6 && carriage.y === 24
    const each = () => {
      expect(s.r.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
      expect(s.r).toMatchObject({ x: carriage.x, y: carriage.y })
    }
    expect(blowsOn(s, s.r, there, 300, each)).toBe(true)
  })

  it('an unarmed driver’s haul route goes on, there and back, its script with it', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    carriage.load = { wood: 5 }
    const route = { kind: 'task', task: 'haul', carriageId: 'k1', x: 6, y: 16 }
    s.give({ ...route, goods: ['wood'], returnGoods: [], keepFood: 0 })
    s.tick()
    const haul = s.r.script!
    expect(haul.scriptId).toBe(703)
    const reached = () => carriage.y === 16
    expect(blowsOn(s, s.r, reached)).toBe(true)
    const back = () => carriage.y === 6
    expect(blowsOn(s, s.r, back)).toBe(true)
    expect(s.world.piles.find((p) => p.x === 6 && p.y === 16)?.goods.wood).toBe(5)
    expect(s.r.order).toMatchObject({ kind: 'haul', carriageId: 'k1' })
    // No more blows: Defend, if a last blow started it, has handed back to the Haul script.
    s.x1.order = null
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.script).toMatchObject({ scriptId: haul.scriptId, memory: haul.memory })
  })

  it('an armed driver fights back, the carriage standing, then goes on', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    s.r.carried.spear = 1
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1', defending: true })
    expect(s.r.interrupted?.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
    const at = { x: carriage.x, y: carriage.y }
    s.tick()
    expect(carriage).toMatchObject(at)
    s.gone()
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
    expect(s.until(() => carriage.y === 24, 300)).toBe(true)
  })

  it('an armed driver who chased their attacker walks back to the carriage, then goes on', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    s.r.carried.spear = 1
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    s.x1.order = null
    s.x1.x = carriage.x + 4
    s.x1.y = carriage.y
    expect(s.until(() => s.r.x !== carriage.x || s.r.y !== carriage.y, 60)).toBe(true)
    const at = { x: carriage.x, y: carriage.y }
    s.gone()
    expect(s.until(() => s.r.interrupted === undefined, 60)).toBe(true)
    expect(s.r).toMatchObject(at)
    expect(s.r.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
    expect(s.until(() => carriage.y === 24, 300)).toBe(true)
  })

  it('an unarmed passenger stays aboard a carriage being driven, and arrives with it', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    const p = passenger(s)
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    const there = () => carriage.y === 24
    const each = () => expect(p.aboard).toBe('k1')
    expect(blowsOn(s, p, there, 300, each)).toBe(true)
    expect(p.struck).toBeDefined()
    expect(p).toMatchObject({ x: 6, y: 24 })
  })

  it('an unarmed passenger stays aboard whichever of them is struck first', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    const p = passenger(s)
    // Both struck on one tick: p1’s script may run first, and the driver still drives.
    const second = newResident(mulberry32(5), { id: 'x2', owner: 'r2', x: 6, y: 6, tick: 0 })
    s.world.residents.push(second)
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    const there = () => carriage.y === 24
    const each = () => expect(p.aboard).toBe('k1')
    const both = () => {
      second.x = carriage.x
      second.y = carriage.y
      second.order ??= attackOrder('w1')
      s.r.health = MAX_HEALTH
      each()
    }
    expect(blowsOn(s, p, there, 300, both)).toBe(true)
    expect(s.r.struck).toBeDefined()
  })

  it('an unarmed passenger gets off a carriage nobody drives, and walks home', () => {
    const s = setup()
    withCarriage(s)
    const p = passenger(s)
    s.r.x = 20
    s.x1.order = attackOrder('p1')
    expect(s.until(() => p.interrupted !== undefined)).toBe(true)
    s.x1.order = null
    s.tick()
    expect(p.aboard).toBeUndefined()
    expect(p.order).toMatchObject({ kind: 'walkTo', target: { x: 9, y: 3 } })
    expect(p.script!.memory.doing).toBe('Defending: fleeing home')
  })

  /** The horse goes Down of hunger, by the game's own step: it ends its driver's drive. */
  function horseDown(s: ReturnType<typeof setup>, horse: { hunger: number; health: number }) {
    horse.hunger = 0
    horse.health = 1e-9
    expect(s.until(() => isDown(horse), 20)).toBe(true)
  }

  it('an unarmed passenger gets off when the horse goes Down', () => {
    const s = setup()
    const { horse, carriage } = withCarriage(s)
    const p = passenger(s)
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    expect(standsStill(s.world, carriage)).toBe(false)
    horseDown(s, horse)
    expect(s.r.order).toBeNull()
    expect(standsStill(s.world, carriage)).toBe(true)
    s.x1.x = carriage.x + 1
    s.x1.y = carriage.y
    s.x1.order = attackOrder('p1')
    expect(s.until(() => p.interrupted !== undefined)).toBe(true)
    s.x1.order = null
    s.tick()
    expect(p.aboard).toBeUndefined()
    expect(p.order).toMatchObject({ kind: 'walkTo', target: { x: 9, y: 3 } })
  })

  it('a carriage with a driver stands still all the same while its horse is Down or gone', () => {
    const s = setup()
    const { horse, carriage } = withCarriage(s)
    s.r.order = { kind: 'drive', carriageId: 'k1', target: { x: 6, y: 24 }, path: null, progress: 0 }
    expect(standsStill(s.world, carriage)).toBe(false)
    horse.downUntil = s.world.tick + 1000
    expect(standsStill(s.world, carriage)).toBe(true)
    delete horse.downUntil
    s.world.horses = []
    expect(standsStill(s.world, carriage)).toBe(true)
  })

  it('a drive whose horse went Down during the fight doesn’t go on', () => {
    const s = setup()
    const { horse } = withCarriage(s)
    s.r.carried.spear = 1
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    s.tick()
    expect(s.r.interrupted?.order).toMatchObject({ kind: 'drive' })
    s.x1.order = null
    s.r.health = MAX_HEALTH
    horseDown(s, horse)
    s.gone()
    expect(s.until(() => s.r.interrupted === undefined, 20)).toBe(true)
    expect(s.r.order).toBeNull()
  })

  it('an armed passenger gets off and fights back', () => {
    const s = setup()
    withCarriage(s)
    const p = passenger(s)
    p.carried.spear = 1
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    s.x1.order = attackOrder('p1')
    expect(s.until(() => p.interrupted !== undefined)).toBe(true)
    s.tick()
    expect(p.aboard).toBeUndefined()
    expect(p.order).toMatchObject({ kind: 'attack', targetId: 'x1', defending: true })
  })

  it('a Player-picked defence script decides for itself', () => {
    const walker = { ...shout(), source: 'if (me.order.kind == "drive") { walkTo(1, 1) }' }
    const s = setup(new Map([[750, walker]]))
    const { carriage } = withCarriage(s)
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    expect(s.r.script).toMatchObject({ scriptId: 750, task: 'defend' })
    const at = { x: carriage.x, y: carriage.y }
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 1, y: 1 } })
    expect(s.r.interrupted?.order).toMatchObject({ kind: 'drive' })
    s.x1.order = null
    s.tick()
    expect(carriage).toMatchObject(at)
  })

  it('a picked script that does nothing leaves the drive going until it ends', () => {
    const idle = { ...shout(), source: 'let quiet = 1' }
    const s = setup(new Map([[750, idle]]))
    const { carriage } = withCarriage(s)
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    s.x1.order = null
    expect(s.until(() => carriage.y === 24, 300)).toBe(true)
  })

  it('a driver who left the carriage for good doesn’t drive it from afar when they go on', () => {
    const source = `if (memory.w == null) {
  memory.w = true
  walkTo(12, 12)
} else if (me.order == null) {
  end("away")
}`
    const s = setup(new Map([[750, { ...shout(), source }]]))
    const { carriage } = withCarriage(s)
    s.give({ kind: 'setDefenceScript', scriptId: 750 })
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    s.x1.order = null
    expect(s.until(() => s.r.interrupted === undefined, 200)).toBe(true)
    expect(s.r).toMatchObject({ x: 12, y: 12 })
    expect(s.r.order).toBeNull()
    expect(carriage).not.toMatchObject({ x: 12, y: 12 })
  })

  it('someone else driving the carriage meanwhile keeps it', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    const other = newResident(mulberry32(6), { id: 'w2', owner: 'r1', x: 6, y: 6, tick: 0 })
    other.carried = { food: OWN_FOOD }
    s.world.residents.push(other)
    s.r.carried.spear = 1
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'attack' })
    other.x = carriage.x
    other.y = carriage.y
    const to = { residentId: 'w2', kind: 'drive', carriageId: 'k1', x: 20, y: 6 }
    expect(s.orders.receive(s.world, me, 'q', to)).toMatchObject({ type: 'ack' })
    s.gone()
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.order).toBeNull()
    expect(other.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
  })

  it('a save between the blow and Defend loses nothing of the drive', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    s.give({ kind: 'drive', carriageId: 'k1', x: 6, y: 24 })
    s.tick()
    attacked(s)
    // Saved and loaded, the order and the one kept aside are no longer one object.
    const saved = JSON.parse(JSON.stringify(s.r)) as typeof s.r
    expect(saved.order).toEqual(saved.interrupted!.order)
    s.r.order = saved.order
    s.r.interrupted = saved.interrupted!
    s.x1.order = null
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
    expect(s.until(() => carriage.y === 24, 300)).toBe(true)
  })

  it('a queue’s drive goes on under blows, and so does the queue', () => {
    const s = setup()
    const { carriage } = withCarriage(s)
    const step = (y: number) => ({ order: { kind: 'drive', carriageId: 'k1', x: 6, y } })
    s.give({ kind: 'queue', steps: [step(12), step(18)] })
    s.tick()
    expect(blowsOn(s, s.r, () => carriage.y === 18 && s.r.queue === undefined)).toBe(true)
  })
})

describe('defence invariant', () => {
  it('flags a driver struck who no longer holds their drive before Defend decides (ADR 0004)', () => {
    const s = setup()
    withCarriage(s)
    const drive = { kind: 'drive' as const, carriageId: 'k1', target: { x: 6, y: 24 } }
    const order = { ...drive, path: null, progress: 0 }
    s.r.order = order
    s.r.interrupted = { order }
    s.r.script = { scriptId: 0, task: 'defend', memory: {} }
    s.r.struck = { by: 'x1', tick: s.world.tick - 1 }
    expect(struckDriverDrivesOn.check(s.world, terrain)).toEqual([])
    s.r.order = null
    expect(struckDriverDrivesOn.check(s.world, terrain)).toMatchObject([
      { invariant: 'struck-driver-drives-on', entityIds: ['w1'] },
    ])
    // A tick on, something else may have ended the drive with their script not run yet.
    s.r.struck = { by: 'x1', tick: s.world.tick - 2 }
    expect(struckDriverDrivesOn.check(s.world, terrain)).toEqual([])
    s.r.struck = { by: 'x1', tick: s.world.tick - 1 }
    // Once a defence script has run, it decides.
    s.r.script = { scriptId: 707, task: 'defend', memory: {} }
    expect(struckDriverDrivesOn.check(s.world, terrain)).toEqual([])
  })

  it('flags an order standing with a defence script running or anything interrupted (ADR 0004)', () => {
    const s = setup()
    s.r.givenUnderAttack = 'untilDone'
    expect(givenUnderAttackSound.check(s.world, terrain)).toEqual([])
    s.r.script = { scriptId: 0, task: 'defend', memory: {} }
    expect(givenUnderAttackSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'given-under-attack-sound', entityIds: ['w1'] },
    ])
    delete s.r.script
    s.r.interrupted = { order: null }
    expect(givenUnderAttackSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'given-under-attack-sound', entityIds: ['w1'] },
    ])
  })

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
