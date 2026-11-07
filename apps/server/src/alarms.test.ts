import {
  DEFEND_CALM_TICKS,
  OWN_FOOD,
  Terrain,
  townHallOf,
  type Alarm,
  type Building,
  type OrderRequest,
  type Stock,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  alarmedAttackersSound,
  alarmScriptSound,
  alarmsSound,
  raiseOccupied,
  raiseResidentAttacked,
  raiseWallAttacked,
  startAlarm,
} from './alarms.js'
import { attackOrder } from './combat.js'
import { interruptedSound } from './defence.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { noteOutsidersInside } from './outsiders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import type { RunnableScript } from './scripts.js'
import { entitiesInSight } from './sight.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Alarms (`CONTEXT.md`: Alarm, Alarm script; ADR 0028): an occupation of a city's town hall
 * starting interrupts its realm's residents in its area by their Alarm script, and what it
 * interrupted goes on after.
 */

const SIZE = 256
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const ALARM_DEFAULT = 711

/**
 * Realm r1 (Player 7) with city c1, its town hall at (9, 3): resident w1 standing on farm f1 at
 * (6, 6), a worker there. Realm r2 (Player 8): x1, armed, not there yet, its Leader l2 far off.
 */
function setup(library = new Map<number, RunnableScript>()) {
  const world = createWorld(terrain)
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'w1' },
    { id: 'r2', userId: 8, leaderId: 'l2' },
  )
  const city = addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const farm: Building = { id: 'f1', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
  world.buildings.push(farm)
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 6, y: 6, tick: 0 })
  r.cityId = 'c1'
  r.carried = { food: OWN_FOOD, spear: 1 }
  const x1 = newResident(mulberry32(2), { id: 'x1', owner: 'r2', x: 200, y: 200, tick: 0 })
  x1.carried = { sword: 1 }
  const l2 = newResident(mulberry32(3), { id: 'l2', owner: 'r2', x: 220, y: 220, tick: 0 })
  world.residents.push(r, x1, l2)
  const scripts = defaultScripts(terrain, [me], library)
  const orders = new OrderQueue(scripts.kinds, terrain)
  const queues = new QueueRunner(
    { sender: (id) => (id === 7 ? me : undefined) },
    scripts.kinds,
    terrain,
  )
  const walking = new Walking(terrain)
  const tick = () => {
    for (const x of world.residents) x.hunger = 100
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain)).toEqual([])
  }
  const until = (done: () => boolean, limit = 200) => {
    for (let i = 0; i < limit && !done(); i++) tick()
    return done()
  }
  const give = (order: OrderRequest) =>
    orders.receive(world, me, 'q', { residentId: 'w1', ...order })
  /** w1 goes to work at the farm. */
  const working = () => {
    expect(give({ kind: 'task', task: 'work', workplaceId: 'f1' })).toMatchObject({ type: 'ack' })
    tick()
    tick()
    expect(r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
  }
  /** x1 stands on the town hall: the next tick an occupation starts. */
  const occupy = () => {
    const hall = townHallOf(world, city)!
    x1.x = hall.x
    x1.y = hall.y
    x1.order = null
  }
  /** x1 leaves the world: they are gone. */
  const gone = () => {
    world.residents = world.residents.filter((x) => x !== x1)
  }
  /**
   * x1 stands beside w1 and strikes them until their defence script runs, at most `limit` ticks.
   * Each tick w1's Alarm script orders the attack anew, so they get in no blow of their own first,
   * which would stop x1's.
   */
  const struck = (limit = 60) => {
    x1.x = r.x + 1
    x1.y = r.y
    x1.order = attackOrder('w1')
    for (let i = 0; i < limit && r.script?.task !== 'defend'; i++) {
      r.order = null
      tick()
    }
    return r.script?.task === 'defend'
  }
  return { world, city, r, x1, l2, tick, until, give, working, occupy, gone, struck }
}

const logged = (r: { scriptLog?: { text: string }[] }) => (r.scriptLog ?? []).map((l) => l.text)

/** Mara's own script 750: it logs what its alarm says, and ends. */
const reader = (): RunnableScript => ({
  userId: 7,
  name: 'Bell',
  version: 1,
  followsDefault: false,
  source:
    'log(me.alarm.kind + " about " + me.alarm.about + " of " + me.alarm.realmId + " in " + me.alarm.cityId)\nlog("picked " + me.alarmScript)\nlog("at " + me.alarm.x + "," + me.alarm.y + " tick " + me.alarm.tick)\nend("rang")',
})

describe('the town hall occupied', () => {
  it('armed residents at home go after the occupier, and back to work with their memory', () => {
    const s = setup()
    s.working()
    const work = s.r.script!
    s.occupy()
    s.tick()
    expect(s.city.occupation).toMatchObject({ realmId: 'r2' })
    expect(s.r.script).toMatchObject({
      task: 'alarm',
      alarm: { kind: 'occupied', cityId: 'c1', about: 'x1', realmId: 'r2' },
    })
    expect(s.r.interrupted).toMatchObject({ order: { kind: 'workAt' }, script: work })
    const memory = structuredClone(s.r.interrupted!.script!.memory)

    s.tick()
    expect(s.r.script?.scriptId).toBe(ALARM_DEFAULT)
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1' })
    expect(s.r.script!.memory.doing).toBe(`On alarm: going after ${s.x1.name}`)

    s.gone()
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.script).toMatchObject({ scriptId: work.scriptId, memory })
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    expect(logged(s.r)).toContain('the occupier is gone')
  })

  it('ends once the occupier has left the area, in sight or not', () => {
    const s = setup()
    s.occupy()
    s.tick()
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1' })
    // Out of the area, but within sight of w1.
    s.x1.x = s.r.x + 15
    s.x1.y = s.r.y
    s.tick()
    expect(s.r.script).toBeUndefined()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.order).toBeNull()
  })

  it('goes after another armed one of theirs in the area once the first is gone', () => {
    const s = setup()
    const x2 = newResident(mulberry32(4), { id: 'x2', owner: 'r2', x: 8, y: 8, tick: 0 })
    x2.carried = { sword: 1 }
    s.world.residents.push(x2)
    s.occupy()
    s.tick()
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1' })
    s.gone()
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x2' })
  })

  it('reaches them once, when it starts, not each tick it holds', () => {
    const s = setup()
    s.r.alarmScriptId = 'none'
    s.occupy()
    s.tick()
    delete s.r.alarmScriptId
    s.tick()
    expect(s.city.occupation).toMatchObject({ realmId: 'r2' })
    expect(s.r.script).toBeUndefined()
  })

  it('doesn’t reach those away from the city', () => {
    const s = setup()
    s.r.x = 30
    s.r.y = 30
    s.occupy()
    s.tick()
    expect(s.city.occupation).toMatchObject({ realmId: 'r2' })
    expect(s.r.script).toBeUndefined()
    expect(s.r.interrupted).toBeUndefined()
  })

  it('leaves someone unarmed as they were, unless the Player picked a script', () => {
    const s = setup()
    delete s.r.carried.spear
    s.working()
    const work = s.r.script!
    s.occupy()
    s.tick()
    expect(s.r.script).toBe(work)
    expect(s.r.interrupted).toBeUndefined()
  })

  it('leaves someone set to None as they were, armed too', () => {
    const s = setup()
    s.working()
    expect(s.give({ kind: 'setAlarmScript', scriptId: 'none' })).toMatchObject({ type: 'ack' })
    s.tick()
    expect(s.r.alarmScriptId).toBe('none')
    const work = s.r.script!
    s.occupy()
    s.tick()
    expect(s.r.script).toBe(work)
    expect(s.r.interrupted).toBeUndefined()
  })

  it('reaches no army member, nobody hired out, no driver and nobody Down', () => {
    const s = setup()
    const add = (id: string) => {
      const x = newResident(mulberry32(id.length + 10), { id, owner: 'r1', x: 7, y: 7, tick: 0 })
      x.carried = { spear: 1 }
      s.world.residents.push(x)
      return x
    }
    const soldier = add('soldier')
    s.world.armies.push({
      id: 'a1',
      name: 'Guard',
      realmId: 'r1',
      memberIds: ['soldier'],
      order: null,
    })
    const hired = add('hired')
    s.world.contracts.push({
      id: 'c9',
      lenderId: 'r1',
      hirerId: 'r2',
      residentIds: ['hired'],
      startedAt: 0,
    } as never)
    const driver = add('driver')
    driver.order = { kind: 'drive', carriageId: 'k1', target: { x: 1, y: 1 }, path: null, progress: 0 }
    const down = add('down')
    down.downUntil = s.world.tick + 100
    const home = add('home')
    s.occupy()
    raiseOccupied(s.world, s.city, 'r2', SIZE)
    expect(home.script?.task).toBe('alarm')
    expect(s.r.script?.task).toBe('alarm')
    for (const x of [soldier, hired, driver, down]) expect(x.script).toBeUndefined()
  })

  it('reaches an NPC city too, with the game’s default', () => {
    const s = setup()
    s.city.realmId = null
    s.r.owner = null
    s.occupy()
    raiseOccupied(s.world, s.city, 'r2', SIZE)
    expect(s.r.script).toMatchObject({ scriptId: 0, task: 'alarm', alarm: { kind: 'occupied' } })
  })
})

describe('a wall or neighbour attacked', () => {
  type Setup = ReturnType<typeof setup>

  /** Another resident of r1, armed unless told otherwise, standing in the city's area beside w1. */
  const neighbour = (s: Setup, id = 'w2', x = 8, y = 6, carried: Stock = { spear: 1 }) => {
    const n = newResident(mulberry32(4), { id, owner: 'r1', x, y, tick: 0 })
    n.cityId = 'c1'
    n.carried = { food: OWN_FOOD, ...carried }
    s.world.residents.push(n)
    return n
  }
  /**
   * x1 stands beside w1, set on striking them. They came in long ago: an alarm for their coming in
   * would keep this one from reaching anyone.
   */
  const strikes = (s: Setup) => {
    s.x1.x = s.r.x - 1
    s.x1.y = s.r.y
    s.x1.order = attackOrder('w1')
    noteOutsidersInside(s.world, SIZE)
  }
  /** A row of houses of c1 out to (66, 6), so the area reaches out of sight of those at the farm. */
  const farSide = (s: Setup) => {
    for (let x = 16; x <= 66; x += 10) {
      s.world.buildings.push({ id: `h${x}`, kind: 'house', cityId: 'c1', x, y: 6 })
    }
  }
  const raise = (s: Setup) => raiseResidentAttacked(s.world, s.x1, s.r, SIZE)

  it('a blow on one worker brings armed neighbours in sight, who go back to what they did after', () => {
    const s = setup()
    const n = neighbour(s)
    n.order = { kind: 'walkTo', target: { x: 8, y: 9 }, path: null, progress: 0 }
    strikes(s)
    expect(s.until(() => n.script?.task === 'alarm', 10)).toBe(true)
    expect(n.script!.alarm).toMatchObject({
      kind: 'attacked',
      cityId: 'c1',
      about: 'x1',
      realmId: 'r2',
      x: s.r.x,
      y: s.r.y,
    })
    expect(n.interrupted).toMatchObject({ order: { kind: 'walkTo' } })
    // The one struck has their Defence script for it, not this.
    expect(s.r.script?.task).not.toBe('alarm')

    s.tick()
    expect(n.script?.scriptId).toBe(ALARM_DEFAULT)
    expect(n.order).toMatchObject({ kind: 'attack', targetId: 'x1', defending: true })
    expect(n.script!.memory.doing).toBe(`On alarm: going after ${s.x1.name}`)

    s.gone()
    s.tick()
    expect(n.script).toBeUndefined()
    expect(n.interrupted).toBeUndefined()
    expect(n.order).toMatchObject({ kind: 'walkTo' })
    expect(logged(n)).toContain('the attacker is gone')
  })

  it('a blow on someone out of sight doesn’t, though they stand in the same area', () => {
    const s = setup()
    farSide(s)
    const n = neighbour(s, 'w2', 66, 6)
    strikes(s)
    expect(s.until(() => s.r.struck !== undefined, 10)).toBe(true)
    s.tick()
    expect(n.script).toBeUndefined()
    expect(n.order).toBeNull()
  })

  it('doesn’t reach those in sight who stand outside the area', () => {
    const s = setup()
    const n = neighbour(s, 'w2', 6, 30)
    raise(s)
    expect(n.script).toBeUndefined()
  })

  it('a blow outside the realm’s city areas raises nothing', () => {
    const s = setup()
    const n = neighbour(s)
    s.r.y = 30
    raise(s)
    expect(n.script).toBeUndefined()
    expect(s.city.alarmedAttackers).toBeUndefined()
  })

  it.each(['wall', 'gate'] as const)('a %s attacked does, and they go after who strikes it', (kind) => {
    const s = setup()
    const n = neighbour(s)
    s.world.buildings.push({ id: 'b9', kind, cityId: 'c1', x: 12, y: 8 })
    s.x1.x = 13
    s.x1.y = 8
    s.x1.order = attackOrder('b9')
    noteOutsidersInside(s.world, SIZE)
    expect(s.until(() => n.script?.task === 'alarm', 10)).toBe(true)
    expect(n.script!.alarm).toMatchObject({ kind: 'attacked', about: 'x1', x: 12, y: 8 })
    // The first worker sees it too.
    expect(s.r.script?.task).toBe('alarm')
    s.tick()
    expect(n.order).toMatchObject({ kind: 'attack', targetId: 'x1', defending: true })
  })

  it('those already fighting aren’t interrupted', () => {
    const s = setup()
    s.l2.x = 8
    s.l2.y = 8
    const n = neighbour(s)
    n.order = attackOrder('l2')
    raise(s)
    expect(n.script).toBeUndefined()
    expect(n.order).toMatchObject({ kind: 'attack', targetId: 'l2' })
    // They count as having seen it, and the next one in sight gets none for this attacker.
    expect(s.city.alarmedAttackers).toEqual({ x1: s.world.tick })
  })

  it('doesn’t reach someone defending themselves', () => {
    const s = setup()
    const n = neighbour(s)
    n.script = { scriptId: 1, task: 'defend', memory: {} }
    n.interrupted = { order: null }
    const before = structuredClone(n.interrupted)
    raise(s)
    expect(n.script.task).toBe('defend')
    expect(n.interrupted).toEqual(before)
  })

  it('is raised once per attacker, and again once their blows have stopped for the calm time', () => {
    const s = setup()
    farSide(s)
    const first = neighbour(s)
    const later = neighbour(s, 'w3', 66, 6)
    raise(s)
    expect(first.script?.task).toBe('alarm')
    expect(later.script).toBeUndefined()

    // In sight now, with the blows still coming.
    later.x = 8
    later.y = 8
    for (let i = 0; i < 3; i++) {
      s.world.tick += DEFEND_CALM_TICKS - 1
      raise(s)
      expect(later.script).toBeUndefined()
    }

    s.world.tick += DEFEND_CALM_TICKS
    raise(s)
    expect(later.script?.task).toBe('alarm')
    expect(s.city.alarmedAttackers).toEqual({ x1: s.world.tick })
  })

  it('a long fight runs a picked script once', () => {
    const s = setup(new Map([[750, reader()]]))
    const n = neighbour(s)
    n.alarmScriptId = 750
    strikes(s)
    for (let i = 0; i < 30; i++) {
      s.r.order = null
      s.tick()
    }
    expect(logged(n).filter((l) => l.startsWith('attacked about x1'))).toHaveLength(1)
  })

  it('a second attacker raises one of their own', () => {
    const s = setup(new Map([[750, reader()]]))
    const n = neighbour(s)
    n.alarmScriptId = 750
    raise(s)
    raiseResidentAttacked(s.world, s.l2, s.r, SIZE)
    expect(s.city.alarmedAttackers).toEqual({ x1: s.world.tick, l2: s.world.tick })
  })

  it('an attack nobody at home saw has raised nothing: the next blow seen does', () => {
    const s = setup()
    farSide(s)
    const n = neighbour(s, 'w2', 66, 6)
    raise(s)
    expect(s.city.alarmedAttackers).toBeUndefined()
    n.x = 8
    raise(s)
    expect(n.script?.task).toBe('alarm')
  })

  it('leaves someone unarmed as they were, unless the Player picked a script, or None', () => {
    const s = setup(new Map([[750, reader()]]))
    const unarmed = neighbour(s, 'w2', 8, 6, {})
    const none = neighbour(s, 'w3', 8, 7)
    none.alarmScriptId = 'none'
    const picked = neighbour(s, 'w4', 8, 8, {})
    picked.alarmScriptId = 750
    raise(s)
    expect(unarmed.script).toBeUndefined()
    expect(none.script).toBeUndefined()
    s.tick()
    expect(logged(picked)[0]).toBe('attacked about x1 of r2 in c1')
  })

  it('a blow struck in fighting back raises nothing', () => {
    const s = setup()
    const n = neighbour(s)
    s.x1.order = attackOrder('w1', true, true)
    raise(s)
    expect(n.script).toBeUndefined()
    expect(s.city.alarmedAttackers).toBeUndefined()
  })

  it('someone of the realm raises nothing, nor does an NPC city have anyone to reach yet', () => {
    const s = setup()
    const n = neighbour(s)
    raiseResidentAttacked(s.world, n, s.r, SIZE)
    expect(s.r.script).toBeUndefined()
    expect(s.city.alarmedAttackers).toBeUndefined()

    s.city.realmId = null
    const wall: Building = { id: 'b9', kind: 'wall', cityId: 'c1', x: 12, y: 8 }
    raiseWallAttacked(s.world, s.x1, wall, SIZE)
    expect(n.script).toBeUndefined()
    expect(s.city.alarmedAttackers).toBeUndefined()
  })

  it('the default ends once the attacker has left the area, in sight or not', () => {
    const s = setup()
    const n = neighbour(s)
    s.x1.x = 7
    s.x1.y = 7
    raise(s)
    s.tick()
    expect(n.order).toMatchObject({ kind: 'attack', targetId: 'x1' })
    // Out of the area, but within sight of them.
    s.x1.x = n.x + 15
    s.tick()
    expect(n.script).toBeUndefined()
    expect(n.interrupted).toBeUndefined()
    expect(logged(n)).toContain('the attacker is gone')
  })

  it('the default ends once the attacker is out of sight, still in the area', () => {
    const s = setup()
    farSide(s)
    const n = neighbour(s)
    s.x1.x = 7
    s.x1.y = 7
    raise(s)
    s.tick()
    expect(n.script?.task).toBe('alarm')
    s.x1.x = 66
    s.x1.y = 6
    s.tick()
    expect(n.script).toBeUndefined()
    expect(n.interrupted).toBeUndefined()
  })

  it('striking back at the attacker is no crime, whatever they have gone on to since', () => {
    const s = setup()
    const n = neighbour(s)
    s.x1.x = n.x + 1
    s.x1.y = n.y
    raise(s)
    // Their victim dead or left behind, they aren't attacking anyone now.
    s.x1.order = null
    expect(
      s.until(() => n.order?.kind === 'attack' && n.order.started, 20),
    ).toBe(true)
    expect(s.world.crimes).toEqual([])
    // In a fight of its own, which goes in the realm logs.
    expect(s.world.events.some((e) => e.kind === 'fight')).toBe(true)
  })

  it('striking anyone but the attacker on that alarm stays a crime', () => {
    const script: RunnableScript = {
      ...reader(),
      source: 'if (me.order == null) { attack("l2") }',
    }
    const s = setup(new Map([[750, script]]))
    const n = neighbour(s)
    n.alarmScriptId = 750
    s.l2.x = n.x + 1
    s.l2.y = n.y
    raise(s)
    expect(s.until(() => s.world.crimes.length > 0, 20)).toBe(true)
    expect(s.world.crimes).toMatchObject([{ kind: 'attack', culprit: { residentId: 'w2' } }])
  })

  it('who raised it stays on the server', () => {
    const s = setup()
    neighbour(s)
    raise(s)
    expect(s.city.alarmedAttackers).toBeDefined()
    const seen = entitiesInSight(s.world, terrain, 'r1').find((e) => e.id === 'c1')!
    expect(seen).not.toHaveProperty('alarmedAttackers')
  })
})

describe('what an alarm interrupts', () => {
  it('a Player’s order given meanwhile ends both', () => {
    const s = setup()
    s.working()
    s.occupy()
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    expect(s.r.script).toBeUndefined()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'walkTo' })
    // It is no order under attack: a blow later still runs the defence script.
    expect(s.r.givenUnderAttack).toBeUndefined()
  })

  it('a blow runs the defence script, which hands back to the Alarm script, and that to work', () => {
    const s = setup()
    s.working()
    const work = s.r.script!
    s.occupy()
    s.tick()
    s.tick()
    const alarm = s.r.script!
    expect(alarm.task).toBe('alarm')
    expect(s.struck()).toBe(true)
    expect(s.r.interrupted).toMatchObject({
      order: { kind: 'workAt' },
      script: work,
      alarm: { script: alarm },
    })

    // The attacker gone from sight: Defend ends, and the Alarm script is back, memory and all.
    s.x1.order = null
    s.x1.x = 120
    s.x1.y = 120
    expect(s.until(() => s.r.script?.task !== 'defend', 5)).toBe(true)
    expect(s.r.script).toBe(alarm)
    expect(s.r.interrupted).toMatchObject({ script: work })
    expect(s.r.interrupted).not.toHaveProperty('alarm')

    expect(s.until(() => s.r.script !== alarm, 5)).toBe(true)
    expect(s.r.script).toMatchObject({ scriptId: work.scriptId })
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
  })

  it('a Player’s order given while the defence script runs over it ends all of them', () => {
    const s = setup()
    s.working()
    s.occupy()
    s.tick()
    s.tick()
    expect(s.struck()).toBe(true)
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.tick()
    expect(s.r.script).toBeUndefined()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'walkTo' })
  })

  it('a second alarm doesn’t interrupt the first, nor one a defence script running', () => {
    const s = setup()
    s.working()
    s.occupy()
    s.tick()
    const first = s.r.script!
    const kept = structuredClone(s.r.interrupted)
    const another: Alarm = { ...first.alarm!, about: 'someone', tick: first.alarm!.tick + 1 }
    startAlarm(s.world, s.r, another)
    expect(s.r.script).toBe(first)
    expect(s.r.interrupted).toEqual(kept)

    first.task = 'defend'
    delete first.alarm
    startAlarm(s.world, s.r, another)
    expect(s.r.script).toBe(first)
  })

  it('doesn’t interrupt what the Player gave them under attack', () => {
    const s = setup()
    s.give({ kind: 'walkTo', x: 6, y: 20 })
    s.r.struck = { by: 'x1', tick: s.world.tick }
    s.tick()
    s.r.givenUnderAttack = 'untilDone'
    s.occupy()
    s.tick()
    expect(s.r.script).toBeUndefined()
    expect(s.r.order).toMatchObject({ kind: 'walkTo' })
  })

  it('a queue waits, and its step goes on after', () => {
    const s = setup()
    s.give({
      kind: 'queue',
      steps: [
        { order: { kind: 'walkTo', x: 6, y: 20 } },
        { order: { kind: 'walkTo', x: 6, y: 21 } },
      ],
    })
    s.tick()
    const step = s.r.queue!.current
    s.occupy()
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    s.gone()
    s.tick()
    s.tick()
    expect(s.r.script).toBeUndefined()
    expect(s.r.queue?.current).toBe(step)
    expect(s.r.order).toMatchObject({ kind: 'walkTo', target: { x: 6, y: 20 } })
  })
})

describe('an Alarm script picked', () => {
  it('runs in place of the default, for someone unarmed too, reading me.alarm', () => {
    const s = setup(new Map([[750, reader()]]))
    delete s.r.carried.spear
    s.working()
    expect(s.give({ kind: 'setAlarmScript', scriptId: 750 })).toMatchObject({ type: 'ack' })
    s.tick()
    expect(s.r.alarmScriptId).toBe(750)
    // Picking it leaves the work going.
    expect(s.r.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    const work = s.r.script!
    s.occupy()
    s.tick()
    expect(s.r.script).toMatchObject({ scriptId: 750, task: 'alarm' })
    const hall = townHallOf(s.world, s.city)!
    const at = s.r.script!.alarm!.tick
    s.tick()
    expect(logged(s.r)).toEqual(
      expect.arrayContaining([
        'occupied about x1 of r2 in c1',
        'picked 750',
        `at ${hall.x},${hall.y} tick ${at}`,
        'rang',
      ]),
    )
    expect(s.r.script).toBe(work)
    expect(s.r.interrupted).toBeUndefined()
  })

  it('cleared, or picked as Alarm itself, is the Alarm default again', () => {
    const s = setup(new Map([[750, reader()]]))
    s.give({ kind: 'setAlarmScript', scriptId: 750 })
    s.tick()
    s.give({ kind: 'setAlarmScript', scriptId: null })
    s.tick()
    expect(s.r.alarmScriptId).toBeUndefined()
    s.give({ kind: 'setAlarmScript', scriptId: 750 })
    s.give({ kind: 'setAlarmScript', scriptId: ALARM_DEFAULT })
    s.tick()
    expect(s.r.alarmScriptId).toBeUndefined()
    s.occupy()
    s.tick()
    s.tick()
    expect(s.r.script).toMatchObject({ scriptId: ALARM_DEFAULT, task: 'alarm' })
  })

  it('deleted, falls back to the Alarm default and tells the realm log once', () => {
    const library = new Map([[750, reader()]])
    const s = setup(library)
    s.give({ kind: 'setAlarmScript', scriptId: 750 })
    s.tick()
    library.delete(750)
    s.occupy()
    s.tick()
    s.tick()
    expect(s.r.alarmScriptId).toBeUndefined()
    expect(s.r.script).toMatchObject({ scriptId: ALARM_DEFAULT, task: 'alarm' })
    const told = () => s.world.events.filter((e) => e.kind === 'alarmScriptGone')
    expect(told()).toMatchObject([{ residentId: 'w1', scriptId: 750 }])
    s.tick()
    expect(told()).toHaveLength(1)
  })

  it('is one of the Player’s own scripts or None, for a resident of their own', () => {
    const theirs = { ...reader(), userId: 8 }
    const s = setup(
      new Map([
        [750, reader()],
        [751, theirs],
      ]),
    )
    const pick = (o: object) => s.give({ kind: 'setAlarmScript', ...o })
    expect(pick({ scriptId: 751 })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: 750, residentId: 'x1' })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: 'none', residentId: 'x1' })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: 'none', params: { n: 1 } })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: 'loud' })).toMatchObject({ type: 'rejected' })
    expect(pick({ scriptId: 750 })).toMatchObject({ type: 'ack' })
  })

  it('is seen by its owner only', () => {
    const s = setup(new Map([[750, reader()]]))
    s.give({ kind: 'setAlarmScript', scriptId: 750 })
    s.tick()
    s.x1.x = s.r.x + 1
    s.x1.y = s.r.y
    const seen = (realmId: string) =>
      entitiesInSight(s.world, terrain, realmId).find((e) => e.id === 'w1')!
    expect(seen('r1')).toMatchObject({ alarmScriptId: 750 })
    expect(seen('r2')).not.toHaveProperty('alarmScriptId')
  })

  it('can’t be given as a task', () => {
    const s = setup()
    expect(s.give({ kind: 'task', task: 'alarm' })).toMatchObject({ type: 'rejected' })
  })

  it('run by hand, the Alarm default has no alarm to read and ends', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: ALARM_DEFAULT })
    s.tick()
    s.tick()
    expect(s.r.script).toBeUndefined()
  })
})

describe('inCityArea', () => {
  const asker = (source: string): RunnableScript => ({
    userId: 7,
    name: 'Asker',
    version: 1,
    followsDefault: false,
    source,
  })

  it('says whether a tile lies in a city’s area, for a city of my realm’s or a tile in sight', () => {
    const s = setup(
      new Map([
        [
          750,
          asker(
            'log(inCityArea("c1", 6, 6) + " " + inCityArea("c1", 200, 200) + " " + inCityArea("nope", 6, 6))\nend()',
          ),
        ],
      ]),
    )
    s.give({ kind: 'runScript', scriptId: 750 })
    s.tick()
    expect(logged(s.r)).toContain('true false false')
  })

  it('says nothing of another realm’s city out of sight', () => {
    const s = setup(
      new Map([
        [750, asker('log(inCityArea("c2", 120, 120) + " " + inCityArea("c2", 121, 121))\nend()')],
      ]),
    )
    addCity(s.world, { id: 'c2', realmId: 'r2', x: 120, y: 120 })
    s.give({ kind: 'runScript', scriptId: 750 })
    s.tick()
    expect(logged(s.r)).toContain('false false')
  })
})

describe('invariants (ADR 0004)', () => {
  const alarm: Alarm = {
    kind: 'occupied',
    cityId: 'c1',
    about: 'x1',
    realmId: 'r2',
    x: 9,
    y: 3,
    tick: 0,
  }

  it('flags an Alarm script with no alarm, or nothing kept aside', () => {
    const s = setup()
    s.r.script = { scriptId: 0, task: 'alarm', memory: {} }
    s.r.interrupted = { order: null }
    expect(alarmsSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'alarms-sound', entityIds: ['w1'] },
    ])
    s.r.script.alarm = alarm
    expect(alarmsSound.check(s.world, terrain)).toEqual([])
    delete s.r.interrupted
    expect(alarmsSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'alarms-sound', entityIds: ['w1'] },
    ])
  })

  it('flags two Alarm scripts, one running over the other', () => {
    const s = setup()
    const kept = { scriptId: 0, task: 'alarm' as const, memory: {}, alarm }
    s.r.script = { scriptId: 0, task: 'alarm', memory: {}, alarm }
    const said = () => alarmsSound.check(s.world, terrain).map((v) => v.message)
    s.r.interrupted = { order: null, script: kept }
    expect(said()).toEqual(['w1 came back to an Alarm script as what it interrupted'])
    s.r.interrupted = { order: null, alarm: { order: null, script: kept } }
    expect(said()).toContain('w1 runs two Alarm scripts')
  })

  it('takes an Alarm script kept aside under a defence script, and nothing else', () => {
    const s = setup()
    const kept = { scriptId: 0, task: 'alarm' as const, memory: {}, alarm }
    s.r.script = { scriptId: 0, task: 'defend', memory: {} }
    s.r.interrupted = { order: null, alarm: { order: null, script: kept } }
    expect(alarmsSound.check(s.world, terrain)).toEqual([])
    s.r.script = { scriptId: 5, memory: {} }
    expect(alarmsSound.check(s.world, terrain)).toMatchObject([{ entityIds: ['w1'] }])
  })

  it('keeps interrupted-runs-defence true for an Alarm script', () => {
    const s = setup()
    s.r.interrupted = { order: null }
    s.r.script = { scriptId: 0, task: 'alarm', memory: {}, alarm }
    expect(interruptedSound.check(s.world, terrain)).toEqual([])
  })

  it('flags a picked Alarm script that can’t be one', () => {
    const s = setup()
    s.r.alarmScriptId = 0
    expect(alarmScriptSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'alarm-script-sound', entityIds: ['w1'] },
    ])
    s.r.alarmScriptId = 'none'
    expect(alarmScriptSound.check(s.world, terrain)).toEqual([])
    s.r.alarmScriptId = 750
    expect(alarmScriptSound.check(s.world, terrain)).toEqual([])
  })

  it('flags an attacker kept with a blow still to come', () => {
    const s = setup()
    s.world.tick = 10
    s.city.alarmedAttackers = { x1: 10 }
    expect(alarmedAttackersSound.check(s.world, terrain)).toEqual([])
    s.city.alarmedAttackers = { x1: 11 }
    expect(alarmedAttackersSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'alarmed-attackers-sound', entityIds: ['c1', 'x1'] },
    ])
  })
})
