import {
  OWN_FOOD,
  SIGHT_RANGE,
  Terrain,
  townHallOf,
  type Building,
  type City,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { raiseResidentAttacked, raiseTheft } from './alarms.js'
import { attackOrder } from './combat.js'
import { startDefence } from './defence.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { noteOutsidersInside, outsidersSound, stepOutsiders } from './outsiders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import type { RunnableScript } from './scripts.js'
import { entitiesInSight } from './sight.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * An outsider in the area (`CONTEXT.md`: Alarm; ADR 0028): someone of another realm, not allied,
 * coming into a City area raises the alarm once for those at home who see them. The Alarm default
 * holds the town hall against an armed one and only logs an unarmed one.
 */

const SIZE = 256
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with city c1, its town hall at (9, 3): w1, armed, on farm f1 at (6, 6). Realm
 * r2 (Player 8): x1, armed, far off, its Leader l2 further off still.
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
  /** x1 stands in the city's area, off its hall, and stays there. */
  const enter = (who = x1, x = 12, y = 9) => {
    who.x = x
    who.y = y
    who.order = null
  }
  /** x1 goes off out of the area. */
  const leave = (who = x1) => {
    who.x = 200
    who.y = 200
    who.order = null
  }
  const onHall = () => {
    const hall = townHallOf(world, city)!
    const side = 3
    return r.x >= hall.x && r.x < hall.x + side && r.y >= hall.y && r.y < hall.y + side
  }
  return { world, city, r, x1, l2, tick, until, give, working, enter, leave, onHall }
}

const logged = (r: { scriptLog?: { text: string }[] }) => (r.scriptLog ?? []).map((l) => l.text)

/** Mara's own script 750: it logs what its alarm says, and ends. */
const reader = (): RunnableScript => ({
  userId: 7,
  name: 'Bell',
  version: 1,
  followsDefault: false,
  source: 'log(me.alarm.kind + " about " + me.alarm.about)\nend("rang")',
})

describe('an outsider coming into the area', () => {
  it('raises the alarm once on entering, not every tick', () => {
    const s = setup(new Map([[750, reader()]]))
    s.r.alarmScriptId = 750
    s.tick()
    expect(s.city.outsiders).toBeUndefined()
    s.enter()
    s.tick()
    expect(s.city.outsiders).toEqual(['x1'])
    expect(s.r.script).toMatchObject({
      task: 'alarm',
      alarm: { kind: 'outsider', cityId: 'c1', about: 'x1', realmId: 'r2', x: 12, y: 9 },
    })
    s.tick()
    expect(s.r.script).toBeUndefined()
    for (let i = 0; i < 5; i++) s.tick()
    expect(s.r.script).toBeUndefined()
    expect(logged(s.r).filter((l) => l === 'outsider about x1')).toHaveLength(1)
  })

  it('raises it again if they leave and come back', () => {
    const s = setup(new Map([[750, reader()]]))
    s.r.alarmScriptId = 750
    s.enter()
    s.tick()
    s.tick()
    s.leave()
    s.tick()
    expect(s.city.outsiders).toBeUndefined()
    s.enter()
    s.tick()
    s.tick()
    expect(logged(s.r).filter((l) => l === 'outsider about x1')).toHaveLength(2)
  })

  it('raises it once for each who comes in, the armed first', () => {
    const s = setup()
    const walker = newResident(mulberry32(9), { id: 'a0', owner: 'r2', x: 11, y: 9, tick: 0 })
    s.world.residents.unshift(walker)
    s.enter()
    s.tick()
    expect(s.city.outsiders).toEqual(['a0', 'x1'])
    // The unarmed one stands first in the world, and one alarm doesn't interrupt another.
    expect(s.r.script?.alarm?.about).toBe('x1')
  })

  it('leaves out an ally, someone hired by the realm, and its own from another city', () => {
    const s = setup()
    s.world.alliances.push({
      id: 'al',
      name: 'Friends',
      leaderId: 'r1',
      members: ['r1', 'r3'].map((realmId) => ({ realmId, joinedAt: 0, leaving: null })),
      invites: [],
      army: [],
    })
    const ally = newResident(mulberry32(4), { id: 'y1', owner: 'r3', x: 8, y: 9, tick: 0 })
    ally.carried = { sword: 1 }
    const hired = newResident(mulberry32(5), { id: 'h1', owner: 'r2', x: 8, y: 8, tick: 0 })
    hired.carried = { sword: 1 }
    s.world.contracts.push({
      id: 'k1',
      lenderId: 'r2',
      hirerId: 'r1',
      residentIds: ['h1'],
      startedAt: 0,
    } as never)
    const own = newResident(mulberry32(6), { id: 'o1', owner: 'r1', x: 9, y: 9, tick: 0 })
    own.carried = { sword: 1 }
    own.cityId = 'elsewhere'
    s.world.residents.push(ally, hired, own)
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toBeUndefined()
    expect(s.r.script).toBeUndefined()
  })

  it('leaves out the crews of a caravan and of a wandering trader', () => {
    const s = setup()
    const crew = (id: string, y: number) => {
      const c = newResident(mulberry32(y), { id, owner: null, x: 12, y, tick: 0 })
      c.cityId = 'hq'
      c.carried = { sword: 1 }
      s.world.residents.push(c)
      return c
    }
    crew('d1', 8)
    crew('e1', 9)
    crew('d2', 10)
    crew('e2', 11)
    s.world.caravans.push({
      id: 'cv',
      carriageId: 'k',
      driverId: 'd1',
      escortIds: ['e1'],
    } as never)
    s.world.traders.push({
      id: 'tr',
      carriageId: 'k2',
      driverId: 'd2',
      escortIds: ['e2'],
    } as never)
    const soldier = crew('s1', 7)
    stepOutsiders(s.world, SIZE)
    // A Trade Organization soldier who is on no caravan is no such crew: only they count.
    expect(s.city.outsiders).toEqual([soldier.id])
  })

  it('reaches only those at home who see them', () => {
    const s = setup(new Map([[750, reader()]]))
    s.r.alarmScriptId = 750
    // The city reaches further east: a storage there, with far standing by it, out of sight of x1.
    const far = SIGHT_RANGE + 20
    s.world.buildings.push({ id: 'st', kind: 'storage', cityId: 'c1', x: 12 + far, y: 9 })
    const faraway = newResident(mulberry32(7), { id: 'w2', owner: 'r1', x: 12 + far, y: 9, tick: 0 })
    faraway.carried = { spear: 1 }
    faraway.cityId = 'c1'
    // And someone armed of the realm who stands in sight, but outside the area.
    const outside = newResident(mulberry32(8), { id: 'w3', owner: 'r1', x: 12, y: 30, tick: 0 })
    outside.carried = { spear: 1 }
    s.world.residents.push(faraway, outside)
    s.enter()
    stepOutsiders(s.world, SIZE)
    expect(s.r.script?.task).toBe('alarm')
    expect(faraway.script).toBeUndefined()
    expect(outside.script).toBeUndefined()
  })

  it('leaves someone already attacking at it', () => {
    const s = setup()
    s.r.order = attackOrder('l2')
    s.enter()
    stepOutsiders(s.world, SIZE)
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'l2' })
    expect(s.r.script).toBeUndefined()
    expect(s.r.interrupted).toBeUndefined()
  })

  it('counts for an NPC city too, though nobody there has an alarm yet', () => {
    const s = setup()
    const npc = addCity(s.world, { id: 'n1', realmId: null, x: 120, y: 120 })
    const home = newResident(mulberry32(10), { id: 'n', owner: null, x: 121, y: 118, tick: 0 })
    home.cityId = 'n1'
    home.carried = { spear: 1 }
    s.world.residents.push(home)
    s.enter(s.x1, 122, 119)
    stepOutsiders(s.world, SIZE)
    expect(npc.outsiders).toEqual(['x1'])
    expect(home.script).toBeUndefined()
  })

  it('counts a resident of another NPC city, with no realm in the alarm', () => {
    const s = setup()
    const stranger = newResident(mulberry32(11), { id: 'v1', owner: null, x: 12, y: 9, tick: 0 })
    stranger.cityId = 'n9'
    stranger.carried = { spear: 1 }
    s.world.residents.push(stranger)
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toEqual(['v1'])
    expect(s.r.script?.alarm).toMatchObject({ about: 'v1', realmId: null })
  })

  it('keeps no list for a trading post or the HQ', () => {
    const s = setup()
    const post = addCity(s.world, { id: 'p1', realmId: null, x: 120, y: 120 }) as City
    post.tradeOrg = 'post'
    s.enter(s.x1, 122, 119)
    stepOutsiders(s.world, SIZE)
    expect(post.outsiders).toBeUndefined()
  })

  it('shows nobody the list, not even the realm whose city it is', () => {
    const s = setup()
    s.enter()
    s.tick()
    expect(s.city.outsiders).toEqual(['x1'])
    const seen = entitiesInSight(s.world, terrain, 'r1').find(
      (e) => e.is === 'city' && e.id === 'c1',
    )
    expect(seen).toBeDefined()
    expect(seen).not.toHaveProperty('outsiders')
  })
})

describe('the Alarm default against an armed outsider', () => {
  it('holds the hall until the area is clear, then back to work with its memory', () => {
    const s = setup()
    s.working()
    const work = s.r.script!
    const memory = structuredClone(work.memory)
    s.enter()
    s.tick()
    expect(s.r.interrupted).toMatchObject({ order: { kind: 'workAt' }, script: work })
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'walkTo' })
    expect(s.r.script!.memory.doing).toBe('On alarm: going to hold the town hall')
    expect(s.until(s.onHall)).toBe(true)
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    expect(s.r.script!.memory.doing).toBe('On alarm: holding the town hall')
    // They stay as long as it takes.
    const { x, y } = s.r
    for (let i = 0; i < 10; i++) s.tick()
    expect(s.r).toMatchObject({ x, y })
    expect(s.r.script?.task).toBe('alarm')

    s.leave()
    s.tick()
    s.tick()
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r.script?.scriptId).toBe(work.scriptId)
    expect(s.r.script!.memory.workplaceId).toBe(memory.workplaceId)
    expect(logged(s.r)).toContain('no armed outsider left in the area')
    expect(s.until(() => s.r.order?.kind === 'workAt')).toBe(true)
    expect(s.r.order).toMatchObject({ buildingId: 'f1' })
  })

  it('stays while another armed outsider is left, of any realm', () => {
    const s = setup()
    s.world.realms.push({ id: 'r3', userId: 9, leaderId: 'z1' })
    const other = newResident(mulberry32(12), { id: 'z1', owner: 'r3', x: 13, y: 9, tick: 0 })
    other.carried = { spear: 1 }
    s.world.residents.push(other)
    s.enter()
    s.tick()
    expect(s.until(s.onHall)).toBe(true)
    s.leave()
    for (let i = 0; i < 5; i++) s.tick()
    expect(s.r.script?.task).toBe('alarm')
    s.leave(other)
    s.tick()
    s.tick()
    expect(s.r.script).toBeUndefined()
  })

  it('stops holding for someone who laid down their arms', () => {
    const s = setup()
    s.enter()
    s.tick()
    expect(s.until(s.onHall)).toBe(true)
    s.x1.carried = {}
    s.tick()
    expect(s.r.script).toBeUndefined()
    expect(s.city.outsiders).toEqual(['x1'])
  })

  it('blocks an occupation: none starts while they hold the hall', () => {
    const s = setup()
    s.enter()
    s.tick()
    expect(s.until(s.onHall)).toBe(true)
    const hall = townHallOf(s.world, s.city)!
    // On the hall itself, x1 occupies nothing while w1 stands there too.
    s.enter(s.x1, hall.x, hall.y)
    for (let i = 0; i < 20; i++) {
      s.tick()
      expect(s.city.occupation).toBeNull()
      expect(s.onHall()).toBe(true)
    }
    expect(s.r.script?.task).toBe('alarm')
    // Unlike with nobody there: the hall empty, the next tick it starts.
    s.world.residents = s.world.residents.filter((x) => x !== s.r)
    s.world.realms[0]!.leaderId = 'nobody'
    stepWorld(s.world, terrain, new Walking(terrain))
    expect(s.city.occupation).toMatchObject({ realmId: 'r2' })
  })

  it('holding, they don’t answer an attack or a theft: one alarm doesn’t interrupt another', () => {
    const s = setup()
    const other = newResident(mulberry32(13), { id: 'w2', owner: 'r1', x: 7, y: 7, tick: 0 })
    other.cityId = 'c1'
    s.world.residents.push(other)
    s.enter()
    s.tick()
    expect(s.until(s.onHall)).toBe(true)
    raiseResidentAttacked(s.world, s.x1, other, SIZE)
    raiseTheft(s.world, s.x1, 'r1', SIZE)
    expect(s.r.script?.alarm?.kind).toBe('outsider')
    s.tick()
    expect(s.r.order?.kind).not.toBe('attack')
    expect(s.onHall()).toBe(true)
  })

  it('leaves someone set to None where they are, and someone unarmed', () => {
    const s = setup()
    s.r.alarmScriptId = 'none'
    s.working()
    const work = s.r.script!
    s.enter()
    s.tick()
    expect(s.r.script).toBe(work)
    expect(s.r.interrupted).toBeUndefined()

    const t = setup()
    delete t.r.carried.spear
    t.working()
    const theirs = t.r.script!
    t.enter()
    t.tick()
    expect(t.r.script).toBe(theirs)
    expect(t.r.interrupted).toBeUndefined()
  })

  it('a blow meanwhile runs the defence script, and holding goes on after', () => {
    const s = setup()
    s.enter()
    s.tick()
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    startDefence(s.world, s.r)
    expect(s.r.script?.task).toBe('defend')
    expect(s.until(() => s.r.script?.task === 'alarm', 10)).toBe(true)
    expect(s.until(s.onHall)).toBe(true)
  })
})

describe('the Alarm default against an unarmed outsider', () => {
  it('moves nobody: it logs them, and what they were doing goes on where it was', () => {
    const s = setup()
    s.x1.carried = {}
    s.working()
    const work = s.r.script!
    const order = s.r.order
    s.enter()
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    s.tick()
    expect(s.r.script).toBe(work)
    expect(s.r.order).toBe(order)
    expect(s.r.interrupted).toBeUndefined()
    expect(s.r).toMatchObject({ x: 6, y: 6 })
    expect(logged(s.r)).toContain(`${s.x1.name} came into the area, unarmed`)
    // In their script log only: one peddler isn't a line in the realm log per armed resident.
    expect(s.world.events.some((e) => e.kind === 'scriptStopped')).toBe(false)
  })
})

describe('what scripts read', () => {
  /** Mara's own script 750, which runs the given lines and ends. */
  const running = (lines: string): RunnableScript => ({
    userId: 7,
    name: 'Says',
    version: 1,
    followsDefault: false,
    source: `${lines}\nend("rang")`,
  })
  /** It logs who `outsidersIn` lists, and how many. */
  const listing = running(
    'let n = 0\nfor (r of outsidersIn("c1")) {\n  log(r.id)\n  n = n + 1\n}\nlog("listed " + n)',
  )

  it('outsidersIn lists those in the area the Player sees', () => {
    const s = setup(new Map([[750, listing]]))
    s.r.alarmScriptId = 750
    s.enter()
    s.tick()
    s.tick()
    expect(logged(s.r)).toEqual(expect.arrayContaining(['x1', 'listed 1']))
  })

  it('outsidersIn leaves out one on the list the Player doesn’t see', () => {
    const s = setup(new Map([[750, listing]]))
    s.r.alarmScriptId = 750
    s.enter()
    s.tick()
    // Still on the list from last tick, but gone from everyone's sight now.
    s.x1.x = 200
    s.x1.y = 200
    s.tick()
    expect(logged(s.r)).toContain('listed 0')
  })

  it('cityAreaAt says whose area a tile lies in', () => {
    const s = setup(
      new Map([[750, running('log(cityAreaAt(12, 9) + " " + cityAreaAt(150, 150))')]]),
    )
    s.r.alarmScriptId = 750
    s.enter()
    s.tick()
    s.tick()
    expect(logged(s.r)).toContain('c1 null')
  })
})

describe('who is inside as plain data', () => {
  it('counts someone in the area of two cities in each', () => {
    const s = setup()
    const second = addCity(s.world, { id: 'c2', realmId: 'r1', x: 18, y: 3 })
    s.enter(s.x1, 15, 4)
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toEqual(['x1'])
    expect(second.outsiders).toEqual(['x1'])
  })

  it('finds them across the map’s joins', () => {
    const s = setup()
    s.world.buildings.push({ id: 'st', kind: 'storage', cityId: 'c1', x: 1, y: 2 })
    s.enter(s.x1, SIZE - 2, 2)
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toEqual(['x1'])
  })

  it('counts someone on the area’s very edge, in any square of the index', () => {
    const s = setup()
    // Each corner of the area of a storage on the far side of a square's edge.
    s.world.buildings.push({ id: 'st', kind: 'storage', cityId: 'c1', x: 31, y: 31 })
    for (const [x, y] of [
      [27, 27],
      [36, 27],
      [27, 36],
      [36, 36],
    ] as const) {
      s.enter(s.x1, x, y)
      stepOutsiders(s.world, SIZE)
      expect(s.city.outsiders, `${x},${y}`).toEqual(['x1'])
      s.leave()
      stepOutsiders(s.world, SIZE)
    }
    s.enter(s.x1, 37, 36)
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toBeUndefined()
  })

  it('follows the city as it grows, shrinks and changes hands, kept index or not', () => {
    const s = setup()
    s.enter(s.x1, 100, 100)
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toBeUndefined()
    // A storage goes up beside them: its site doesn't count, finished it does.
    const storage: Building = {
      id: 'st',
      kind: 'storage',
      cityId: 'c1',
      x: 100,
      y: 100,
      site: { work: 0, materials: {} },
    } as never
    s.world.buildings.push(storage)
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toBeUndefined()
    delete storage.site
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toEqual(['x1'])
    // It goes to another city, in place.
    const second = addCity(s.world, { id: 'c2', realmId: 'r1', x: 180, y: 180 })
    storage.cityId = 'c2'
    stepOutsiders(s.world, SIZE)
    expect(s.city.outsiders).toBeUndefined()
    expect(second.outsiders).toEqual(['x1'])
    // Their own realm takes it over: they are no outsiders any more.
    second.realmId = 'r2'
    stepOutsiders(s.world, SIZE)
    expect(second.outsiders).toBeUndefined()
    // Torn down, the area goes with it.
    second.realmId = 'r1'
    stepOutsiders(s.world, SIZE)
    expect(second.outsiders).toEqual(['x1'])
    s.world.buildings = s.world.buildings.filter((b) => b !== storage)
    stepOutsiders(s.world, SIZE)
    expect(second.outsiders).toBeUndefined()
  })

  it('puts those inside on the list without an alarm, for a world from before', () => {
    const s = setup()
    s.enter()
    noteOutsidersInside(s.world, SIZE)
    expect(s.city.outsiders).toEqual(['x1'])
    expect(s.r.script).toBeUndefined()
    stepOutsiders(s.world, SIZE)
    expect(s.r.script).toBeUndefined()
  })

  it('the invariant catches a list that is wrong', () => {
    const s = setup()
    const wrong = (list: string[]) => {
      s.city.outsiders = list
      return outsidersSound.check(s.world, terrain).map((v) => v.message)
    }
    expect(wrong([])).toEqual(['c1 keeps an empty list of outsiders'])
    expect(wrong(['nobody'])).toEqual(['c1 lists nobody, who is gone'])
    expect(wrong(['w1'])).toEqual(['c1 lists w1, who is no outsider'])
    expect(wrong(['x1'])).toEqual(['c1 lists x1, who stands outside its area'])
    s.enter()
    expect(wrong(['x1'])).toEqual([])
    expect(wrong(['x1', 'x1'])).toEqual(['c1 lists an outsider twice'])
    s.city.tradeOrg = 'post'
    expect(wrong(['x1'])).toEqual(['c1 keeps outsiders, but keeps its own rules'])
  })
})
