import {
  AVERAGE_HORSE_STATS,
  CARRIAGE_STOLEN_WORTH,
  DEFAULT_SCRIPTS,
  HORSE_STOLEN_WORTH,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  SIGHT_RANGE,
  Terrain,
  ticksForAge,
  type Carriage,
  type Horse,
  type OrderRequest,
  type RealmEvent,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { joinRealm } from './capture.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { eventsFor } from './events.js'
import { checkInvariants, carriagesInPlace, driversOnCarriages } from './invariants.js'
import { OrderQueue, orderKinds } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { lossOf } from './trade-org-punishment.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const size = 256
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const owner = { userId: 8, account: { name: 'Ovid', isAdmin: false } }

/**
 * Realm r1 (Player 7, Leader t1 at (20, 20)) and realm r2 (Player 8, Leader o1 at (40, 40)), and at
 * (20, 20) r2's parked carriage k2, loaded with 5 Food and with its horse h2 hitched.
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 't1' },
    { id: 'r2', userId: 8, leaderId: 'o1' },
  )
  const person = (id: string, realm: string | null, x: number, y: number) => {
    const r = newResident(mulberry32(id.length), { id, owner: realm, x, y, tick: 0 })
    r.carried = { food: OWN_FOOD }
    world.tick = Math.max(world.tick, ticksForAge(30))
    world.residents.push(r)
    return r
  }
  const thief = person('t1', 'r1', 20, 20)
  person('o1', 'r2', 40, 40)
  const horseOf = (id: string, realmId: string | null, x = 20, y = 20): Horse => {
    const horse: Horse = {
      id,
      realmId,
      cityId: null,
      x,
      y,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
      name: `Horse ${id}`,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    }
    world.horses.push(horse)
    return horse
  }
  const horse = horseOf('h2', 'r2')
  const carriage: Carriage = {
    id: 'k2',
    realmId: 'r2',
    cityId: null,
    x: 20,
    y: 20,
    horseId: 'h2',
    load: { food: 5 },
  }
  world.carriages.push(carriage)
  const orders = new OrderQueue(undefined, terrain)
  const driveOff = (residentId = 't1', more: object = {}) =>
    orders.receive(world, mara, 'q', {
      kind: 'drive',
      residentId,
      carriageId: 'k2',
      x: 25,
      y: 20,
      ...more,
    })
  return { world, thief, horse, carriage, person, horseOf, orders, driveOff }
}

const logged = (world: ReturnType<typeof createWorld>, userId: number, kind: RealmEvent['kind']) =>
  eventsFor(world, userId).filter((e) => e.kind === kind)

describe('driving off in another organization’s carriage', () => {
  it('moves carriage, load and horse to the thief’s realm and commits one theft', () => {
    const { world, thief, horse, carriage, orders, driveOff } = setup()
    expect(driveOff()).toEqual({ type: 'ack', requestId: 'q' })
    // Nothing changes hands before the order is applied.
    expect(carriage.realmId).toBe('r2')
    orders.applyAll(world)
    expect(carriage).toMatchObject({ realmId: 'r1', cityId: null, load: { food: 5 } })
    expect(horse).toMatchObject({ realmId: 'r1', cityId: null })
    expect(carriage.horseId).toBe('h2')
    expect(thief.order).toMatchObject({ kind: 'drive', carriageId: 'k2', target: { x: 25, y: 20 } })
    expect(world.crimes).toHaveLength(1)
    expect(world.crimes[0]).toMatchObject({
      kind: 'theft',
      victimOrg: 'r2',
      carriage: true,
      horse: 'Horse h2',
      goods: { food: 5 },
      culprit: { residentId: 't1', org: 'r1' },
    })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('then drives it like any carriage of the realm, keeping to the invariants', () => {
    const { world, thief, carriage, horse, orders, driveOff } = setup()
    driveOff()
    orders.applyAll(world)
    const walking = new Walking(terrain)
    while (thief.order) {
      stepWorld(world, terrain, walking)
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect([carriage.x, carriage.y, horse.x, horse.y]).toEqual([25, 20, 25, 20])
    // It is the thief's own now: driving it again steals nothing more.
    expect(
      orders.receive(world, mara, 'q', {
        kind: 'drive',
        residentId: 't1',
        carriageId: 'k2',
        x: 20,
        y: 20,
      }),
    ).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(world.crimes).toHaveLength(1)
  })

  it('tells the victim at once it is gone and where, without the thief; the thief what they took', () => {
    const { world, orders, driveOff } = setup()
    driveOff()
    orders.applyAll(world)
    const gone = logged(world, 8, 'transportGone')
    expect(gone).toEqual([
      expect.objectContaining({
        kind: 'transportGone',
        x: 20,
        y: 20,
        carriage: true,
        horse: 'Horse h2',
      }),
    ])
    expect(JSON.stringify(gone)).not.toMatch(/t1|r1/)
    expect(logged(world, 8, 'crimeKnown')).toEqual([])
    expect(logged(world, 7, 'transportTaken')).toEqual([
      expect.objectContaining({
        kind: 'transportTaken',
        residentId: 't1',
        carriage: true,
        horse: 'Horse h2',
        goods: { food: 5 },
        from: expect.stringContaining('realm') as string,
      }),
    ])
  })

  it('is known through a witness like any crime', () => {
    const { world, person, orders, driveOff } = setup()
    const near = person('w2', 'r2', 20 + SIGHT_RANGE, 20)
    const far = person('w3', 'r2', 20 + SIGHT_RANGE + 2, 20)
    driveOff()
    orders.applyAll(world)
    expect(world.crimes[0]!.witnesses).toContain(near.id)
    expect(world.crimes[0]!.witnesses).not.toContain(far.id)
  })

  it('makes each taking a theft of its own, apart from goods taken there', () => {
    const { world, thief, orders, driveOff } = setup()
    world.crimes.push({
      id: 'x1',
      kind: 'theft',
      tick: world.tick,
      x: thief.x,
      y: thief.y,
      culprit: { residentId: 't1', name: thief.name, org: 'r1', orgName: 'r1' },
      victimOrg: 'r2',
      goods: { wood: 1 },
      witnesses: [],
      knownBy: [],
    })
    driveOff()
    orders.applyAll(world)
    expect(world.crimes.map((c) => c.goods)).toEqual([{ wood: 1 }, { food: 5 }])
  })

  it('counts the carriage, the horse and the load in what the theft is worth', () => {
    const { world, orders, driveOff } = setup()
    driveOff()
    orders.applyAll(world)
    const loadWorth = lossOf({
      ...world.crimes[0]!,
      carriage: undefined,
      horse: undefined,
    } as never)
    expect(lossOf(world.crimes[0]!)).toBe(loadWorth + CARRIAGE_STOLEN_WORTH + HORSE_STOLEN_WORTH)
  })

  it('is refused while someone drives it', () => {
    const { person, driveOff, carriage } = setup()
    const driver = person('o2', 'r2', 20, 20)
    driver.order = {
      kind: 'drive',
      carriageId: 'k2',
      target: { x: 30, y: 20 },
      path: null,
      progress: 0,
    }
    expect(driveOff()).toMatchObject({ reason: 'someone is driving that carriage' })
    expect(carriage.realmId).toBe('r2')
  })

  it('is refused with anyone aboard', () => {
    const { person, driveOff } = setup()
    person('o2', 'r2', 20, 20).aboard = 'k2'
    expect(driveOff()).toMatchObject({ reason: 'someone is aboard that carriage' })
  })

  it('is refused while guarded, and allowed when an armed resident of the thief’s realm is there too', () => {
    const { world, person, thief, carriage, orders, driveOff } = setup()
    const guard = person('o2', 'r2', 20, 20)
    // Unarmed, they guard nothing.
    expect(driveOff()).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(carriage.realmId).toBe('r1')
    carriage.realmId = 'r2'
    world.horses[0]!.realmId = 'r2'
    thief.order = null
    world.crimes = []

    guard.carried.spear = 1
    const refused = 'an armed resident guards that carriage'
    expect(driveOff()).toMatchObject({ reason: refused })
    // Next to it is not on its tile.
    guard.x = 21
    expect(driveOff()).toMatchObject({ type: 'ack' })
    guard.x = 20
    // Someone else's armed resident doesn't lift the guard, one of the thief's realm does.
    const other = person('z1', null, 20, 20)
    other.carried.sword = 1
    expect(driveOff()).toMatchObject({ reason: refused })
    const armed = person('t2', 'r1', 20, 20)
    armed.carried.sword = 1
    expect(driveOff()).toMatchObject({ type: 'ack' })
    armed.carried = {}
    // The thief themselves armed counts as well.
    thief.carried.spear = 1
    expect(driveOff()).toMatchObject({ type: 'ack' })
  })

  it('needs a grown resident on its tile', () => {
    const { world, thief, driveOff } = setup()
    thief.x = 21
    expect(driveOff()).toMatchObject({ reason: 'that carriage is not on the resident’s tile' })
    thief.x = 20
    thief.bornAt = world.tick - ticksForAge(5)
    expect(driveOff()).toMatchObject({ reason: 'children can’t steal' })
  })

  it('hitches a free horse of the thief’s own before stealing one', () => {
    const { world, horse, carriage, horseOf, thief, orders, driveOff } = setup()
    carriage.horseId = null
    const own = horseOf('h1', 'r1')
    expect(driveOff()).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(carriage.realmId).toBe('r1')
    expect(horse.realmId).toBe('r2')
    expect(world.crimes[0]!.horse).toBeUndefined()
    const walking = new Walking(terrain)
    while (thief.order) stepWorld(world, terrain, walking)
    expect(carriage.horseId).toBe(own.id)
  })

  it('refuses a Down hitched horse', () => {
    const { world, horse, driveOff } = setup()
    horse.downUntil = world.tick + 100
    expect(driveOff()).toMatchObject({ reason: 'its horse is Down' })
  })

  it('lets the first of two thieves in a tick have it', () => {
    const { world, person, thief, carriage, orders, driveOff } = setup()
    const second = person('t2', 'r1', 20, 20)
    expect(driveOff()).toMatchObject({ type: 'ack' })
    expect(driveOff('t2')).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(thief.order?.kind).toBe('drive')
    expect(second.order).toBeNull()
    expect(carriage.realmId).toBe('r1')
    expect(world.crimes).toHaveLength(1)
  })

  it('takes a carriage of nobody with no crime and no one to tell', () => {
    const { world, horse, carriage, orders, driveOff } = setup()
    carriage.realmId = null
    horse.realmId = null
    expect(driveOff()).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(carriage.realmId).toBe('r1')
    expect(horse.realmId).toBe('r1')
    expect(world.crimes).toEqual([])
    expect(logged(world, 8, 'transportGone')).toEqual([])
    expect(logged(world, 7, 'transportTaken')).toEqual([
      expect.objectContaining({ from: null, goods: { food: 5 } }),
    ])
  })

  it('takes an NPC city’s carriage from the city, and its armed residents guard it', () => {
    const { world, person, horse, carriage, orders, driveOff } = setup()
    carriage.realmId = null
    carriage.cityId = 'n1'
    horse.realmId = null
    horse.cityId = 'n1'
    const guard = person('n2', null, 20, 20)
    guard.cityId = 'n1'
    guard.carried.spear = 1
    expect(driveOff()).toMatchObject({ reason: 'an armed resident guards that carriage' })
    guard.carried = {}
    expect(driveOff()).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(carriage).toMatchObject({ realmId: 'r1', cityId: null })
    expect(horse).toMatchObject({ realmId: 'r1', cityId: null })
    expect(world.crimes[0]).toMatchObject({ victimOrg: 'n1' })
  })
})

describe('the alliance army’s carriages', () => {
  const allied = (s: ReturnType<typeof setup>, leaderId: string) => {
    const alliance = {
      id: 'a1',
      name: 'North',
      leaderId,
      members: [
        { realmId: 'r1', joinedAt: 0 },
        { realmId: 'r2', joinedAt: 0 },
      ],
      invites: [],
      army: [{ is: 'carriage' as const, id: 'k2', recallAt: null }],
    }
    s.world.alliances.push(alliance)
    return alliance
  }

  it('are driven by their commander, which is no theft', () => {
    const s = setup()
    allied(s, 'r1')
    expect(s.driveOff()).toMatchObject({ type: 'ack' })
    s.orders.applyAll(s.world)
    expect(s.carriage.realmId).toBe('r2')
    expect(s.thief.order?.kind).toBe('drive')
    expect(s.world.crimes).toEqual([])
    expect(logged(s.world, 8, 'transportGone')).toEqual([])
    expect(checkInvariants(s.world, terrain)).toEqual([])
  })

  it('are not their owner’s to drive while handed over, and no theft from themselves', () => {
    const s = setup()
    const alliance = allied(s, 'r1')
    alliance.leaderId = 'r1'
    const own = s.person('o2', 'r2', 20, 20)
    expect(
      s.orders.receive(s.world, owner, 'q', {
        kind: 'drive',
        residentId: own.id,
        carriageId: 'k2',
        x: 25,
        y: 20,
      }),
    ).toMatchObject({ reason: 'not one of your carriages' })
  })

  it('can be stolen by a third realm, and leave the army then', () => {
    const s = setup()
    const alliance = allied(s, 'r2')
    alliance.members = [{ realmId: 'r2', joinedAt: 0 }]
    expect(s.driveOff()).toMatchObject({ type: 'ack' })
    s.orders.applyAll(s.world)
    expect(s.carriage.realmId).toBe('r1')
    expect(alliance.army).toEqual([])
    expect(checkInvariants(s.world, terrain)).toEqual([])
  })
})

describe('never by accident', () => {
  it('has no default script drive anything, so none can steal', () => {
    for (const script of Object.values(DEFAULT_SCRIPTS)) {
      expect(script.source).not.toMatch(/\bdrive\(/)
    }
  })

  it('keeps the Haul task to the realm’s own carriages', () => {
    const { world, carriage, thief } = setup()
    const scripts = defaultScripts(terrain, [mara])
    const orders = new OrderQueue(scripts.kinds, terrain)
    const haul: OrderRequest = {
      kind: 'task',
      task: 'haul',
      residentId: 't1',
      carriageId: 'k2',
      x: 25,
      y: 20,
      goods: ['food'],
      returnGoods: [],
      keepFood: 0,
    }
    expect(orders.receive(world, mara, 'q', haul)).toMatchObject({ type: 'rejected' })
    orders.applyAll(world)
    expect(thief.script).toBeUndefined()
    expect(carriage.realmId).toBe('r2')
  })

  it('never picks another realm’s carriage as the nearest to fetch from', () => {
    const { world, thief, carriage, orders } = setup()
    const reply = orders.receive(world, mara, 'q', {
      kind: 'fetch',
      residentId: 't1',
      goods: { food: 2 },
    })
    expect(reply).toMatchObject({ type: 'rejected' })
    orders.applyAll(world)
    expect(thief.order).toBeNull()
    expect(carriage.load).toEqual({ food: 5 })
  })

  it('keeps a haul to the realm’s own carriages', () => {
    const { world, carriage, orders } = setup()
    const haul: OrderRequest = {
      kind: 'haul',
      residentId: 't1',
      carriageId: 'k2',
      x: 25,
      y: 20,
      goods: ['food'],
      keepFood: 0,
    }
    expect(orders.receive(world, mara, 'q', haul)).toMatchObject({
      reason: 'not one of your carriages',
    })
    expect(carriage.realmId).toBe('r2')
  })

  it('keeps unhitching and boarding to the realm’s own', () => {
    const { world, orders } = setup()
    for (const kind of ['unhitch', 'board']) {
      expect(
        orders.receive(world, mara, 'q', { kind, residentId: 't1', carriageId: 'k2' }),
      ).toMatchObject({ reason: 'not a carriage of your realm' })
    }
  })

  it('refuses another realm’s carriage in a queue, and skips a step whose carriage was stolen', () => {
    const { world, thief, carriage, horse, orders } = setup()
    const step = { order: { kind: 'drive', carriageId: 'k2', x: 25, y: 20 } }
    const queue = { kind: 'queue', residentId: 't1', steps: [step] }
    expect(orders.receive(world, mara, 'q', queue)).toMatchObject({
      reason: 'step 1: not a carriage of your realm',
    })
    // Planned while it was the realm's, and stolen since: the step doesn't steal it back.
    carriage.realmId = 'r1'
    horse.realmId = 'r1'
    expect(orders.receive(world, mara, 'q', queue)).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    carriage.realmId = 'r2'
    horse.realmId = 'r2'
    const runner = new QueueRunner(
      { sender: (id) => (id === 7 ? mara : undefined) },
      orderKinds,
      terrain,
    )
    runner.runAll(world)
    expect(thief.order).toBeNull()
    expect(carriage.realmId).toBe('r2')
    expect(world.crimes).toEqual([])
    expect(logged(world, 7, 'queueStepSkipped')).toEqual([
      expect.objectContaining({ reason: 'not a carriage of your realm' }),
    ])
  })

  it('ends a fetch from or a store at a carriage stolen since', () => {
    const { world, person, carriage, horse } = setup()
    const own = person('o2', 'r2', 20, 20)
    own.order = {
      kind: 'fetch',
      from: { kind: 'carriage', carriageId: 'k2' },
      goods: { food: null },
      phase: 'taking',
      path: null,
      progress: 0,
    } as never
    carriage.realmId = 'r1'
    horse.realmId = 'r1'
    stepWorld(world, terrain, new Walking(terrain))
    expect(own.order).toBeNull()
    expect(own.orderEnded).toMatchObject({ kind: 'fetch', reason: 'the carriage is gone' })
    expect(carriage.load).toEqual({ food: 5 })
    expect(world.crimes).toEqual([])
  })
})

describe('a stolen carriage when a city joins a realm (`CONTEXT.md`: What joins with a city)', () => {
  /** The carriage stolen from NPC city n1 and driven off by a thief of r1's city c1. */
  const stolen = () => {
    const s = setup()
    const npc = addCity(s.world, { id: 'n1', realmId: null, x: 100, y: 100, name: 'Dunmere' })
    const home = addCity(s.world, { id: 'c1', realmId: 'r1', x: 150, y: 150, name: 'Hartwell' })
    s.carriage.realmId = null
    s.carriage.cityId = 'n1'
    s.horse.realmId = null
    s.horse.cityId = 'n1'
    // No Leader, who wouldn't join with a city.
    const thief = s.person('t2', 'r1', 20, 20)
    thief.cityId = 'c1'
    s.driveOff('t2')
    s.orders.applyAll(s.world)
    expect(thief.order?.kind).toBe('drive')
    return { ...s, npc, home, thief }
  }
  const sound = (world: ReturnType<typeof createWorld>) => {
    expect(carriagesInPlace.check(world, terrain)).toEqual([])
    expect(driversOnCarriages.check(world, terrain)).toEqual([])
  }

  it('stays the thief’s when the city it was stolen from joins another realm', () => {
    const { world, npc, thief, carriage, horse } = stolen()
    joinRealm(world, npc, 'r2', size)
    expect(carriage).toMatchObject({ realmId: 'r1', cityId: null })
    expect(horse).toMatchObject({ realmId: 'r1', cityId: null })
    expect(thief.order?.kind).toBe('drive')
    sound(world)
  })

  it('goes with the thief and its horse when the thief’s own city joins another realm', () => {
    const { world, home, thief, carriage, horse } = stolen()
    joinRealm(world, home, 'r2', size)
    expect(thief.owner).toBe('r2')
    expect(thief.order).toBeNull()
    expect(carriage.realmId).toBe('r2')
    expect(horse.realmId).toBe('r2')
    sound(world)
  })
})

describe('the invariants', () => {
  it('catch a hitched horse of another realm than its carriage', () => {
    const { world, horse } = setup()
    expect(carriagesInPlace.check(world, terrain)).toEqual([])
    horse.realmId = 'r1'
    expect(carriagesInPlace.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['k2', 'h2'] }),
    ])
  })

  it('catch someone driving another organization’s carriage they don’t command', () => {
    const { world, thief, horse, carriage } = setup()
    thief.order = {
      kind: 'drive',
      carriageId: 'k2',
      target: { x: 25, y: 20 },
      path: null,
      progress: 0,
    }
    expect(driversOnCarriages.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['t1', 'k2'] }),
    ])
    carriage.realmId = 'r1'
    horse.realmId = 'r1'
    expect(driversOnCarriages.check(world, terrain)).toEqual([])
  })
})
