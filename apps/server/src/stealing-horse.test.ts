import {
  AVERAGE_HORSE_STATS,
  DEFAULT_SCRIPTS,
  HORSE_STOLEN_WORTH,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  breedingPair,
  ticksForAge,
  type Carriage,
  type Horse,
  type RealmEvent,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { eventsFor } from './events.js'
import { checkInvariants, ridersOnHorses } from './invariants.js'
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
 * (20, 20) r2's free horse h2.
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 't1' },
    { id: 'r2', userId: 8, leaderId: 'o1' },
  )
  const person = (id: string, realm: string | null, x = 20, y = 20) => {
    const r = newResident(mulberry32(id.length), { id, owner: realm, x, y, tick: 0 })
    r.carried = { food: OWN_FOOD }
    world.tick = Math.max(world.tick, ticksForAge(30))
    world.residents.push(r)
    return r
  }
  const thief = person('t1', 'r1')
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
  const carriageOf = (id: string, realmId: string | null): Carriage => {
    const carriage: Carriage = {
      id,
      realmId,
      cityId: null,
      x: 20,
      y: 20,
      horseId: null,
      load: {},
    }
    world.carriages.push(carriage)
    return carriage
  }
  const orders = new OrderQueue(undefined, terrain)
  const mount = (residentId = 't1', horseId = 'h2') =>
    orders.receive(world, mara, 'q', { kind: 'mount', residentId, horseId })
  const drive = (more: object = {}, carriageId = 'k1') =>
    orders.receive(world, mara, 'q', {
      kind: 'drive',
      residentId: 't1',
      carriageId,
      x: 25,
      y: 20,
      ...more,
    })
  return { world, thief, horse, person, horseOf, carriageOf, orders, mount, drive }
}

const logged = (world: ReturnType<typeof createWorld>, userId: number, kind: RealmEvent['kind']) =>
  eventsFor(world, userId).filter((e) => e.kind === kind)

describe('mounting another organization’s horse', () => {
  it('moves it to the thief’s realm and commits one theft, and they ride it', () => {
    const { world, thief, horse, orders, mount } = setup()
    expect(mount()).toEqual({ type: 'ack', requestId: 'q' })
    // Nothing changes hands before the order is applied.
    expect(horse.realmId).toBe('r2')
    orders.applyAll(world)
    expect(horse).toMatchObject({ realmId: 'r1', cityId: null })
    expect(thief.riding).toBe('h2')
    expect(world.crimes).toHaveLength(1)
    expect(world.crimes[0]).toMatchObject({
      kind: 'theft',
      victimOrg: 'r2',
      horse: 'Horse h2',
      culprit: { residentId: 't1', org: 'r1' },
    })
    expect(world.crimes[0]!.carriage).toBeUndefined()
    expect(lossOf(world.crimes[0]!)).toBe(HORSE_STOLEN_WORTH)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('rides on past the tick: stepRiders has nothing to drop', () => {
    const { world, thief, orders, mount } = setup()
    mount()
    orders.applyAll(world)
    stepWorld(world, terrain, new Walking(terrain))
    expect(thief.riding).toBe('h2')
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('tells the victim at once it is gone and where, without the thief', () => {
    const { world, orders, mount } = setup()
    mount()
    orders.applyAll(world)
    expect(logged(world, 8, 'transportGone')).toEqual([
      expect.objectContaining({ x: 20, y: 20, horse: 'Horse h2' }),
    ])
    expect(JSON.stringify(logged(world, 8, 'transportGone'))).not.toContain('t1')
    expect(logged(world, 7, 'transportTaken')).toEqual([
      expect.objectContaining({ residentId: 't1', horse: 'Horse h2', from: expect.any(String) }),
    ])
  })

  it('is refused while someone rides it, it is Down, or it is hitched', () => {
    const { world, horse, person, carriageOf, mount } = setup()
    const rider = person('o2', 'r2')
    rider.riding = 'h2'
    expect(mount()).toMatchObject({ reason: 'someone else rides that horse' })
    delete rider.riding
    horse.downUntil = world.tick + 100
    expect(mount()).toMatchObject({ reason: 'that horse is Down' })
    delete horse.downUntil
    carriageOf('k2', 'r2').horseId = 'h2'
    expect(mount()).toMatchObject({ reason: 'that horse is hitched to a carriage' })
    expect(world.crimes).toEqual([])
  })

  it('is refused while guarded, and allowed when an armed resident of the thief’s realm is there too', () => {
    const { thief, person, mount } = setup()
    const guard = person('o2', 'r2')
    expect(mount()).toMatchObject({ type: 'ack' })
    guard.carried.spear = 1
    const refused = 'an armed resident guards that horse'
    expect(mount()).toMatchObject({ reason: refused })
    const armed = person('t2', 'r1')
    armed.carried.sword = 1
    expect(mount()).toMatchObject({ type: 'ack' })
    armed.carried = {}
    thief.carried.spear = 1
    expect(mount()).toMatchObject({ type: 'ack' })
  })

  it('needs a grown resident on its tile, on foot', () => {
    const { world, thief, person, horseOf, mount } = setup()
    const kid = person('c1', 'r1')
    kid.bornAt = world.tick
    expect(mount('c1')).toMatchObject({ reason: 'children can’t steal' })
    thief.x = 21
    expect(mount()).toMatchObject({ reason: 'that horse is not on the resident’s tile' })
    thief.x = 20
    horseOf('h1', 'r1')
    thief.riding = 'h1'
    expect(mount()).toMatchObject({ reason: 'already riding another horse' })
  })

  it('lets the first of two thieves in a tick have it', () => {
    const { world, thief, person, orders, mount } = setup()
    person('t2', 'r1')
    mount()
    mount('t2')
    orders.applyAll(world)
    expect(thief.riding).toBe('h2')
    expect(world.residents.find((r) => r.id === 't2')!.riding).toBeUndefined()
    expect(world.crimes).toHaveLength(1)
  })

  it('takes a horse in its owner’s stable: a stable doesn’t protect it', () => {
    const { world, thief, horse, orders, mount } = setup()
    world.buildings.push({
      id: 'st',
      kind: 'stable',
      cityId: null,
      realmId: 'r2',
      x: 20,
      y: 20,
      stock: {},
    } as never)
    expect(mount()).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(horse.realmId).toBe('r1')
    expect(thief.riding).toBe('h2')
  })

  it('takes a horse of nobody with no crime and no one to tell', () => {
    const { world, horse, orders, mount } = setup()
    horse.realmId = null
    expect(mount()).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(horse.realmId).toBe('r1')
    expect(world.crimes).toEqual([])
    expect(logged(world, 8, 'transportGone')).toEqual([])
    expect(logged(world, 7, 'transportTaken')).toEqual([expect.objectContaining({ from: null })])
  })

  it('takes an NPC city’s horse from the city, and its armed residents guard it', () => {
    const { world, horse, person, orders, mount } = setup()
    horse.realmId = null
    horse.cityId = 'n1'
    const guard = person('n2', null)
    guard.cityId = 'n1'
    guard.carried.spear = 1
    expect(mount()).toMatchObject({ reason: 'an armed resident guards that horse' })
    guard.carried = {}
    expect(mount()).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(horse).toMatchObject({ realmId: 'r1', cityId: null })
    expect(world.crimes[0]).toMatchObject({ victimOrg: 'n1' })
  })

  it('lets nobody steal to ride for a realm they are only on loan to', () => {
    const { world, person, mount } = setup()
    const hired = person('m1', null)
    hired.cityId = 'n1'
    world.contracts.push({ residentIds: ['m1'], hirerId: 'r1', startedAt: 0 } as never)
    expect(mount('m1')).toMatchObject({ reason: 'not a horse of your realm' })
  })

  it('is no theft for the horse’s own realm', () => {
    const { world, horse, orders, person } = setup()
    person('o2', 'r2')
    // r2's own Player mounting their own horse is no theft.
    expect(
      orders.receive(world, owner, 'q', { kind: 'mount', residentId: 'o2', horseId: 'h2' }),
    ).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(horse.realmId).toBe('r2')
    expect(world.crimes).toEqual([])
  })
})

describe('hitching another organization’s horse to the realm’s own carriage', () => {
  it('steals the horse the order names, hitches it and commits one theft', () => {
    const { world, thief, horse, carriageOf, orders, drive } = setup()
    const carriage = carriageOf('k1', 'r1')
    expect(drive({ horseId: 'h2' })).toMatchObject({ type: 'ack' })
    expect(horse.realmId).toBe('r2')
    orders.applyAll(world)
    expect(horse.realmId).toBe('r1')
    expect(carriage.horseId).toBe('h2')
    expect(thief.order).toMatchObject({ kind: 'drive', carriageId: 'k1' })
    expect(world.crimes).toHaveLength(1)
    expect(world.crimes[0]).toMatchObject({ victimOrg: 'r2', horse: 'Horse h2' })
    expect(world.crimes[0]!.carriage).toBeUndefined()
    expect(logged(world, 8, 'transportGone')).toHaveLength(1)
    const walking = new Walking(terrain)
    while (thief.order) {
      stepWorld(world, terrain, walking)
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(carriage).toMatchObject({ x: 25, y: 20, horseId: 'h2' })
  })

  it('hitches a horse of the driver’s own first, stealing nothing', () => {
    const { world, horse, horseOf, carriageOf, thief, orders, drive } = setup()
    const carriage = carriageOf('k1', 'r1')
    const own = horseOf('h1', 'r1')
    expect(drive({ horseId: 'h2' })).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(horse.realmId).toBe('r2')
    expect(world.crimes).toEqual([])
    const walking = new Walking(terrain)
    while (thief.order) stepWorld(world, terrain, walking)
    expect(carriage.horseId).toBe(own.id)
  })

  it('never steals with a drive that names no horse', () => {
    const { world, horse, carriageOf, orders, drive } = setup()
    carriageOf('k1', 'r1')
    expect(drive()).toMatchObject({ reason: 'no horse here to pull that carriage' })
    orders.applyAll(world)
    expect(horse.realmId).toBe('r2')
    expect(world.crimes).toEqual([])
  })

  it('is refused while the horse is ridden, Down or guarded', () => {
    const { world, horse, person, carriageOf, drive } = setup()
    carriageOf('k1', 'r1')
    const named = { horseId: 'h2' }
    const noHorse = 'no horse here to pull that carriage'
    const rider = person('o2', 'r2')
    rider.riding = 'h2'
    expect(drive(named)).toMatchObject({ reason: noHorse })
    delete rider.riding
    horse.downUntil = world.tick + 100
    expect(drive(named)).toMatchObject({ reason: noHorse })
    delete horse.downUntil
    rider.carried.spear = 1
    expect(drive(named)).toMatchObject({ reason: 'an armed resident guards that horse' })
    rider.carried = {}
    expect(drive(named)).toMatchObject({ type: 'ack' })
    expect(world.crimes).toEqual([])
  })

  it('never takes a horse for a carriage the realm only commands', () => {
    const { world, horse, carriageOf, orders, drive } = setup()
    const k = carriageOf('k1', 'r3')
    world.alliances.push({
      id: 'a1',
      leaderId: 'r1',
      members: [],
      army: [{ is: 'carriage', id: k.id }],
    } as never)
    expect(drive({ horseId: 'h2' })).toMatchObject({
      reason: 'no horse here to pull that carriage',
    })
    orders.applyAll(world)
    expect(horse.realmId).toBe('r2')
  })
})

describe('driving off in another organization’s carriage with none hitched', () => {
  it('steals its owner’s free horse with it, as one theft', () => {
    const { world, horse, carriageOf, orders, drive } = setup()
    const carriage = carriageOf('k2', 'r2')
    expect(drive({}, 'k2')).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(carriage).toMatchObject({ realmId: 'r1', horseId: 'h2' })
    expect(horse.realmId).toBe('r1')
    expect(world.crimes).toHaveLength(1)
    expect(world.crimes[0]).toMatchObject({ carriage: true, horse: 'Horse h2', victimOrg: 'r2' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('makes a third organization’s horse a theft of its own', () => {
    const { world, horse, person, carriageOf, orders, drive } = setup()
    const carriage = carriageOf('k3', 'r3')
    world.realms.push({ id: 'r3', userId: 9, leaderId: 'o3' })
    person('o3', 'r3', 60, 60)
    expect(drive({}, 'k3')).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(carriage).toMatchObject({ realmId: 'r1', horseId: 'h2' })
    expect(horse.realmId).toBe('r1')
    expect(world.crimes).toHaveLength(2)
    expect(world.crimes.map((c) => c.victimOrg).sort()).toEqual(['r2', 'r3'])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('prefers a horse of the thief’s own, and one it can take over a guarded one', () => {
    const { world, horse, horseOf, person, carriageOf, orders, drive } = setup()
    const carriage = carriageOf('k3', 'r3')
    const guard = person('o2', 'r2')
    guard.carried.spear = 1
    const other = horseOf('h3', 'r3')
    expect(drive({}, 'k3')).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    expect(carriage.horseId).toBe(other.id)
    expect(horse.realmId).toBe('r2')
    const fresh = setup()
    const k = fresh.carriageOf('k2', 'r2')
    const own = fresh.horseOf('h1', 'r1')
    fresh.drive({}, 'k2')
    fresh.orders.applyAll(fresh.world)
    expect(fresh.horse.realmId).toBe('r2')
    expect(k.horseId).toBeNull()
    const walking = new Walking(terrain)
    while (fresh.thief.order) stepWorld(fresh.world, terrain, walking)
    expect(k.horseId).toBe(own.id)
  })
})

describe('never by accident', () => {
  it('has no default script mount or drive anything, so none can steal', () => {
    for (const script of Object.values(DEFAULT_SCRIPTS)) {
      expect(script.source).not.toMatch(/\bmount\(/)
      expect(script.source).not.toMatch(/\bdrive\(/)
    }
  })

  it('has Breed horses pick only the realm’s own in a stable', () => {
    const { world, horseOf } = setup()
    const stable = { id: 'st', kind: 'stable', x: 20, y: 20, cityId: null } as never
    horseOf('h3', 'r2')
    const owner = { realmId: 'r1' }
    expect(breedingPair(world, stable, owner)).toBeUndefined()
    const a = horseOf('h4', 'r1')
    expect(breedingPair(world, stable, owner)).toBeUndefined()
    const b = horseOf('h5', 'r1')
    expect(breedingPair(world, stable, owner)?.map((h) => h.id)).toEqual([a.id, b.id])
  })

  it('refuses another realm’s horse in a queue, for mounting or hitching', () => {
    const { world, carriageOf, orders } = setup()
    carriageOf('k1', 'r1')
    const queue = (order: object) => ({ kind: 'queue', residentId: 't1', steps: [{ order }] })
    expect(orders.receive(world, mara, 'q', queue({ kind: 'mount', horseId: 'h2' }))).toMatchObject(
      { reason: 'step 1: not a horse of your realm' },
    )
    expect(
      orders.receive(
        world,
        mara,
        'q',
        queue({ kind: 'drive', carriageId: 'k1', x: 25, y: 20, horseId: 'h2' }),
      ),
    ).toMatchObject({ reason: 'step 1: not a horse of your realm' })
  })

  it('skips a step whose horse was stolen since: it doesn’t steal it back', () => {
    const { world, thief, horse, orders } = setup()
    horse.realmId = 'r1'
    const queue = {
      kind: 'queue',
      residentId: 't1',
      steps: [{ order: { kind: 'mount', horseId: 'h2' } }],
    }
    expect(orders.receive(world, mara, 'q', queue)).toMatchObject({ type: 'ack' })
    orders.applyAll(world)
    horse.realmId = 'r2'
    new QueueRunner({ sender: (id) => (id === 7 ? mara : undefined) }, orderKinds, terrain).runAll(
      world,
    )
    expect(thief.riding).toBeUndefined()
    expect(horse.realmId).toBe('r2')
    expect(world.crimes).toEqual([])
  })

  it('has an NPC city’s resident ride only the city’s', () => {
    const { world, horse, person } = setup()
    const npc = person('n2', null)
    npc.cityId = 'n1'
    const orders = new OrderQueue(undefined, terrain)
    const sender = { userId: 0, account: { name: 'n1', isAdmin: false }, npcCityId: 'n1' }
    expect(
      orders.receive(world, sender, 'q', { kind: 'mount', residentId: 'n2', horseId: 'h2' }),
    ).toMatchObject({ reason: 'not a horse of your realm' })
    expect(horse.realmId).toBe('r2')
  })
})

describe('the invariants', () => {
  it('catch someone riding a horse of another organization', () => {
    const { world, thief, horse } = setup()
    thief.riding = horse.id
    expect(ridersOnHorses.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['t1', 'h2'] }),
    ])
    horse.realmId = 'r1'
    expect(ridersOnHorses.check(world, terrain)).toEqual([])
  })
})
