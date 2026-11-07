import {
  AVERAGE_HORSE_STATS,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  SIGHT_RANGE,
  SCRIPT_VIEWS,
  Terrain,
  standingOf,
  townHallOf,
  type Building,
  type Carriage,
  type Horse,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { alarmsSound } from './alarms.js'
import { resolveCarrying } from './carrying.js'
import { attackOrder } from './combat.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import type { RunnableScript } from './scripts.js'
import { takeOver } from './stealing.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * A theft seen, and force at home (`CONTEXT.md`: Alarm, Crime; ADR 0028): a theft from a realm in
 * its City area raises an alarm for those there who see it, and in that area striking someone
 * occupying the town hall, or a thief the realm knows of, is no crime.
 */

const SIZE = 256
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** The stock food stolen from in one go. */
const STOLEN = { food: 2 }

/**
 * Realm r1 (Player 7) with city c1, its town hall at (9, 3): armed w1 on farm f1 at (6, 6), storage
 * s1 at (14, 9). Realm r2 (Player 8): x1, armed, not there yet. Realm r3 has an outpost storage at (40, 12).
 */
function setup(library = new Map<number, RunnableScript>()) {
  const world = createWorld(terrain)
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'w1' },
    { id: 'r2', userId: 8, leaderId: 'l2' },
    { id: 'r3', userId: 9, leaderId: 'l3' },
  )
  const city = addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const storage: Building = {
    id: 's1',
    kind: 'storage',
    cityId: 'c1',
    x: 14,
    y: 9,
    stock: { food: 50 },
  }
  const theirs: Building = {
    id: 's3',
    kind: 'storage',
    cityId: null,
    realmId: 'r3',
    x: 40,
    y: 12,
    stock: { food: 50 },
  }
  world.buildings.push({ id: 'f1', kind: 'farm', cityId: 'c1', x: 6, y: 6 }, storage, theirs)
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 6, y: 6, tick: 0 })
  r.cityId = 'c1'
  r.carried = { food: OWN_FOOD, spear: 1 }
  const x1 = newResident(mulberry32(2), { id: 'x1', owner: 'r2', x: 200, y: 200, tick: 0 })
  x1.carried = { sword: 1 }
  const l2 = newResident(mulberry32(3), { id: 'l2', owner: 'r2', x: 220, y: 220, tick: 0 })
  const l3 = newResident(mulberry32(4), { id: 'l3', owner: 'r3', x: 150, y: 220, tick: 0 })
  world.residents.push(r, x1, l2, l3)
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
  /** x1 stands at `from` (the storage s1 unless said) and takes food from it. */
  const steal = (from: Building = storage) => {
    x1.x = from.x
    x1.y = from.y
    x1.order = null
    resolveCarrying(
      world,
      [
        {
          kind: 'take',
          residentId: 'x1',
          spot: { kind: 'storage', storageId: from.id },
          goods: { ...STOLEN },
        },
      ],
      SIZE,
    )
  }
  /** w1, running no Alarm script, walks beside x1 and strikes them, until the first blow is out. */
  const strike = () => {
    r.alarmScriptId = 'none'
    r.script = null
    delete r.interrupted
    r.x = x1.x + 1
    r.y = x1.y
    r.order = attackOrder('x1')
    expect(until(() => x1.struck !== undefined)).toBe(true)
  }
  /** What w1 has done that counts as a crime, by kind. */
  const crimesOfW1 = () =>
    world.crimes.filter((c) => c.culprit.residentId === 'w1').map((c) => c.kind)
  return { world, city, storage, theirs, r, x1, tick, until, give, steal, strike, crimesOfW1 }
}

const logged = (r: { scriptLog?: { text: string }[] }) => (r.scriptLog ?? []).map((l) => l.text)

describe('a theft seen', () => {
  it('sends armed residents who see it after the thief', () => {
    const s = setup()
    s.steal()
    expect(s.r.script).toMatchObject({
      task: 'alarm',
      alarm: { kind: 'theft', cityId: 'c1', about: 'x1', realmId: 'r2', x: 14, y: 9 },
    })
    s.tick()
    expect(s.r.order).toMatchObject({ kind: 'attack', targetId: 'x1' })
    expect(s.r.script?.memory.doing).toContain(s.x1.name)
  })

  it('ends once the thief has left the area, and back to work', () => {
    const s = setup()
    expect(s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })).toMatchObject({ type: 'ack' })
    s.tick()
    s.tick()
    s.steal()
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    // Still in sight, out of the area.
    s.x1.x = 30
    s.x1.y = 30
    expect(s.until(() => s.r.script?.task !== 'alarm', 5)).toBe(true)
    expect(s.until(() => s.r.order?.kind === 'workAt')).toBe(true)
    expect(s.r.interrupted).toBeUndefined()
  })

  it('ends once the thief is out of sight, in the area or not', () => {
    const s = setup()
    s.steal()
    s.tick()
    expect(s.r.script?.task).toBe('alarm')
    s.x1.x = 200
    s.x1.y = 200
    expect(s.until(() => s.r.script?.task !== 'alarm', 5)).toBe(true)
  })

  it('ends once the thief is dead', () => {
    const s = setup()
    s.steal()
    s.tick()
    s.world.residents = s.world.residents.filter((x) => x !== s.x1)
    expect(s.until(() => s.r.script?.task !== 'alarm', 5)).toBe(true)
  })

  it('raises nothing for someone in the area out of sight of it', () => {
    const s = setup()
    // The farm far off stretches the city's area past sight range of the storage.
    const x = s.storage.x + SIGHT_RANGE + 10
    s.world.buildings.push({ id: 'f2', kind: 'farm', cityId: 'c1', x, y: s.storage.y })
    s.r.x = x
    s.r.y = s.storage.y
    s.steal()
    expect(s.r.script ?? null).toBeNull()
  })

  it('raises nothing for a theft outside the area, in sight of them or not', () => {
    const s = setup()
    const out: Building = {
      id: 's2',
      kind: 'storage',
      cityId: null,
      realmId: 'r1',
      x: 30,
      y: 30,
      stock: { food: 5 },
    }
    s.world.buildings.push(out)
    s.steal(out)
    expect(s.world.crimes).toHaveLength(1)
    expect(s.r.script ?? null).toBeNull()
  })

  it('raises nothing for a theft from another realm, nor for taking from one’s own', () => {
    const s = setup()
    s.steal(s.theirs)
    expect(s.world.crimes).toHaveLength(1)
    expect(s.r.script ?? null).toBeNull()
    s.x1.owner = 'r1'
    s.steal()
    expect(s.world.crimes).toHaveLength(1)
    expect(s.r.script ?? null).toBeNull()
  })

  it('raises nothing for what lies in a pile, which is anyone’s to take', () => {
    const s = setup()
    s.world.piles.push({ x: 12, y: 8, goods: { food: 5 } })
    s.x1.x = 12
    s.x1.y = 8
    resolveCarrying(
      s.world,
      [{ kind: 'take', residentId: 'x1', spot: { kind: 'ground' }, goods: { food: 1 } }],
      SIZE,
    )
    expect(s.x1.carried.food).toBe(1)
    expect(s.world.crimes).toHaveLength(0)
    expect(s.r.script ?? null).toBeNull()
  })

  it('raises nothing on a resident set to None, and nothing for an unarmed one', () => {
    const s = setup()
    s.r.alarmScriptId = 'none'
    s.steal()
    expect(s.r.script ?? null).toBeNull()
    delete s.r.alarmScriptId
    s.r.carried = { food: OWN_FOOD }
    s.steal()
    expect(s.r.script ?? null).toBeNull()
  })

  it('takes goods from a carriage, a carriage and a horse as thefts too', () => {
    const horse: Horse = {
      id: 'h1',
      realmId: 'r1',
      cityId: null,
      x: 12,
      y: 8,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
      name: 'Bay',
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    }
    const carriage = (id: string): Carriage => ({
      id,
      realmId: 'r1',
      cityId: null,
      x: 12,
      y: 8,
      horseId: null,
      load: { food: 5 },
    })
    const rung = (take: (s: ReturnType<typeof setup>) => void) => {
      const s = setup()
      s.x1.x = 12
      s.x1.y = 8
      take(s)
      return s.r.script?.alarm?.kind
    }
    expect(
      rung((s) => {
        s.world.horses.push({ ...horse })
        takeOver(s.world, s.x1, 'r2', { horse: s.world.horses[0]! }, SIZE)
      }),
    ).toBe('theft')
    expect(
      rung((s) => {
        s.world.carriages.push(carriage('k1'))
        takeOver(s.world, s.x1, 'r2', { carriage: s.world.carriages[0]! }, SIZE)
      }),
    ).toBe('theft')
    expect(
      rung((s) => {
        s.world.carriages.push(carriage('k2'))
        resolveCarrying(
          s.world,
          [
            {
              kind: 'take',
              residentId: 'x1',
              spot: { kind: 'carriage', carriageId: 'k2' },
              goods: { food: 1 },
            },
          ],
          SIZE,
        )
      }),
    ).toBe('theft')
  })

  it('doesn’t interrupt the alarm already running', () => {
    const s = setup()
    s.steal()
    const running = s.r.script
    s.tick()
    s.steal()
    expect(s.r.script).toBe(running)
  })
})

describe('force at home', () => {
  /** Stands x1 on the town hall. */
  const onHall = (s: ReturnType<typeof setup>) => {
    const hall = townHallOf(s.world, s.city)!
    s.x1.x = hall.x
    s.x1.y = hall.y
  }

  it('striking a thief one of my residents saw costs nothing', () => {
    const s = setup()
    s.steal()
    const before = standingOf(s.world, 'r2', 'r1')
    s.strike()
    expect(s.crimesOfW1()).toEqual([])
    expect(standingOf(s.world, 'r2', 'r1')).toBe(before)
  })

  it('killing them costs nothing either', () => {
    const s = setup()
    s.steal()
    s.x1.carried = {}
    s.x1.health = 1
    s.strike()
    expect(s.until(() => !s.world.residents.includes(s.x1), 300)).toBe(true)
    expect(s.crimesOfW1()).toEqual([])
  })

  it('goes by what news brought home too, the witness’s part done', () => {
    const s = setup()
    s.steal()
    s.tick()
    expect(s.world.crimes[0]).toMatchObject({ knownBy: ['r1'], witnesses: [] })
    s.strike()
    expect(s.crimesOfW1()).toEqual([])
  })

  it('goes by what a resident saw before it is known at home', () => {
    const s = setup()
    // w2 sees it from outside the area, and stays out of it.
    const w2 = newResident(mulberry32(5), { id: 'w2', owner: 'r1', x: 40, y: 9, tick: 0 })
    s.world.residents.push(w2)
    s.r.x = 200
    s.r.y = 100
    s.steal()
    expect(s.world.crimes[0]).toMatchObject({ witnesses: ['w2'], knownBy: [] })
    s.strike()
    expect(s.crimesOfW1()).toEqual([])
  })

  it('a thief nobody of mine saw and no news of is still a crime', () => {
    const s = setup()
    s.r.x = 200
    s.r.y = 100
    s.steal()
    expect(s.world.crimes.filter((c) => c.witnesses.includes('w1'))).toEqual([])
    s.strike()
    expect(s.crimesOfW1()).toEqual(['attack'])
  })

  it('a thief of another realm only is still a crime', () => {
    const s = setup()
    s.steal(s.theirs)
    s.x1.x = 12
    s.x1.y = 8
    s.strike()
    expect(s.crimesOfW1()).toEqual(['attack'])
  })

  it('a known thief outside the area is still a crime', () => {
    const s = setup()
    s.steal()
    s.x1.x = 60
    s.x1.y = 60
    s.strike()
    expect(s.crimesOfW1()).toEqual(['attack'])
  })

  it('a peaceful passer-by is still a crime, armed or not', () => {
    const s = setup()
    s.x1.x = 12
    s.x1.y = 8
    s.strike()
    expect(s.crimesOfW1()).toEqual(['attack'])
    const t = setup()
    t.x1.carried = {}
    t.x1.x = 12
    t.x1.y = 8
    t.strike()
    expect(t.crimesOfW1()).toEqual(['attack'])
  })

  it('someone occupying the town hall costs nothing', () => {
    const s = setup()
    onHall(s)
    s.tick()
    expect(s.city.occupation).toMatchObject({ realmId: 'r2' })
    s.strike()
    expect(s.crimesOfW1()).toEqual([])
  })

  it('stays so once a defender on the hall has broken the occupation', () => {
    const s = setup()
    onHall(s)
    s.tick()
    const w2 = newResident(mulberry32(5), { id: 'w2', owner: 'r1', x: s.x1.x, y: s.x1.y, tick: 0 })
    w2.carried = { spear: 1 }
    w2.alarmScriptId = 'none'
    s.world.residents.push(w2)
    s.tick()
    expect(s.city.occupation).toBeNull()
    s.strike()
    expect(s.crimesOfW1()).toEqual([])
  })

  it('one of theirs off the hall isn’t occupying, nor is someone unarmed on it', () => {
    const s = setup()
    s.x1.x = 12
    s.x1.y = 8
    const on = newResident(mulberry32(5), { id: 'x2', owner: 'r2', x: 9, y: 3, tick: 0 })
    on.carried = { sword: 1 }
    s.world.residents.push(on)
    s.tick()
    expect(s.city.occupation).toMatchObject({ realmId: 'r2' })
    s.strike()
    expect(s.crimesOfW1()).toEqual(['attack'])
    const t = setup()
    onHall(t)
    t.x1.carried = {}
    t.strike()
    expect(t.crimesOfW1()).toEqual(['attack'])
  })

  it('the Alarm default’s own chase costs nothing', () => {
    const s = setup()
    s.steal()
    s.x1.x = 12
    s.x1.y = 8
    expect(s.until(() => s.x1.struck !== undefined)).toBe(true)
    expect(s.crimesOfW1()).toEqual([])
  })
})

describe('knownThief', () => {
  /** A script that logs what `residents()` says of x1, and `me`'s own. */
  const reader = (): RunnableScript => ({
    userId: 7,
    name: 'Eyes',
    version: 1,
    followsDefault: false,
    source:
      'for (r of residents()) { if (r.id == "x1") { log("x1 " + r.knownThief) } }\nlog("me " + me.knownThief)\nend()',
  })
  const asked = () => {
    const s = setup(new Map([[750, reader()]]))
    s.r.alarmScriptId = 'none'
    return s
  }
  const ask = (s: ReturnType<typeof asked>) => {
    s.give({ kind: 'runScript', scriptId: 750 })
    s.tick()
    return logged(s.r)
  }

  it('is documented, in the view scripts read', () => {
    const fields = SCRIPT_VIEWS.resident.fields.map((f) => f.name)
    expect(fields).toContain('knownThief')
  })

  it('says yes of a thief one of my residents saw', () => {
    const s = asked()
    s.steal()
    expect(ask(s)).toContain('x1 true')
  })

  it('says no of someone who stole unseen by mine', () => {
    const s = asked()
    s.r.x = 200
    s.r.y = 100
    s.steal()
    s.r.x = 6
    s.r.y = 6
    expect(ask(s)).toContain('x1 false')
  })

  it('says no of a thief who stole only from someone else, seen or not', () => {
    const s = asked()
    s.steal(s.theirs)
    expect(s.world.crimes[0]).toMatchObject({ victimOrg: 'r3', witnesses: ['w1'] })
    expect(ask(s)).toContain('x1 false')
  })

  it('says no of someone who has stolen nothing, and is there only for those in `residents()`', () => {
    const s = asked()
    s.x1.x = 12
    s.x1.y = 8
    const said = ask(s)
    expect(said).toContain('x1 false')
    expect(said).toContain('me null')
  })
})

describe('invariants (ADR 0004)', () => {
  it('flags an Alarm script about the one running it', () => {
    const s = setup()
    s.r.script = {
      scriptId: 0,
      task: 'alarm',
      memory: {},
      alarm: {
        kind: 'theft',
        cityId: 'c1',
        about: 'w1',
        realmId: 'r1',
        x: 14,
        y: 9,
        tick: 0,
      },
    }
    s.r.interrupted = { order: null }
    expect(alarmsSound.check(s.world, terrain)).toMatchObject([
      { invariant: 'alarms-sound', entityIds: ['w1'] },
    ])
  })
})
