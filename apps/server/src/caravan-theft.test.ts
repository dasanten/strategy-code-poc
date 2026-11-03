// Stealing a caravan's carriage and a caravan losing its crew (`CONTEXT.md`: Guaranteed carriage,
// Caravan crew lost).

import {
  CARAVAN_GUARD_RANGE,
  CARRIAGE_STOLEN_WORTH,
  HORSE_STOLEN_WORTH,
  OWN_FOOD,
  crewIdsOf,
  inContact,
  type Building,
  type Caravan,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { caravansSound, routeEnd } from './caravans.js'
import { attackOrder } from './combat.js'
import { setup, order, runUntil, eventsOf } from './deliveries.fixture.js'
import { checkInvariants } from './invariants.js'
import { stepWorld } from './world.js'
import { die } from './survival.js'
import { tradeOrgHq } from './trade-org.js'
import { lossOf, worthOf } from './trade-org-punishment.js'
import { setup as transferSetup, order as transferOrder } from './transfers.fixture.js'

const carriageOf = (world: WorldState, caravan: Caravan) =>
  world.carriages.find((k) => k.id === caravan.carriageId)!

const crewOf = (world: WorldState, caravan: Caravan) =>
  crewIdsOf(caravan).map((id) => world.residents.find((r) => r.id === id)!)

/** Stands a caravan's carriage, its hitched horse and its crew on tile (x, y). */
function put(world: WorldState, caravan: Caravan, x: number, y: number) {
  const carriage = carriageOf(world, caravan)
  const horse = world.horses.find((h) => h.id === carriage.horseId)!
  for (const t of [carriage, horse, ...crewOf(world, caravan)]) {
    t.x = x
    t.y = y
  }
  // Whatever way they were on leads from where they stood.
  for (const r of crewOf(world, caravan)) r.order = null
}

/** The caravan standing at the post's warehouse, to take on what waits there. */
function atWarehouse(world: WorldState, caravan: Caravan, warehouse: Building) {
  put(world, caravan, warehouse.x, warehouse.y)
  caravan.heading = 'post'
  caravan.stop = 'warehouse'
  caravan.toLoad = null
}

/** The caravan out in the open with its crew around it, and Mara's p1 on its carriage. */
function outInTheOpen() {
  const fixture = setup()
  const { world, caravan, p1 } = fixture
  put(world, caravan, 220, 220)
  p1.x = 220
  p1.y = 220
  p1.carried = { food: OWN_FOOD }
  const hq = tradeOrgHq(world)!
  const driveOff = () =>
    order(world, fixture.queue, {
      kind: 'drive',
      carriageId: caravan.carriageId,
      x: 225,
      y: 220,
    })
  const beat = (...who: Resident[]) => {
    for (const r of who) die(world, r)
  }
  const killCrew = () => beat(...crewOf(world, caravan))
  return { ...fixture, hq, driveOff, beat, killCrew }
}

describe('stealing a caravan’s carriage', () => {
  it('is refused while its driver is with it, wherever they stand near it', () => {
    const { world, caravan, driveOff } = outInTheOpen()
    const driver = world.residents.find((r) => r.id === caravan.driverId)!
    expect(driveOff()).toBe('its driver is still with that caravan’s carriage')
    driver.x += CARAVAN_GUARD_RANGE
    expect(driveOff()).toBe('its driver is still with that caravan’s carriage')
    expect(carriageOf(world, caravan).realmId).toBe(null)
    expect(world.crimes).toEqual([])
  })

  it('is refused while an armed escort guards it, even with armed thieves there', () => {
    const { world, caravan, p1, driveOff } = outInTheOpen()
    const driver = world.residents.find((r) => r.id === caravan.driverId)!
    driver.x += CARAVAN_GUARD_RANGE + 1
    const [escort, ...others] = caravan.escortIds.map((id) =>
      world.residents.find((r) => r.id === id)!,
    )
    for (const r of others) r.x += CARAVAN_GUARD_RANGE + 1
    escort!.carried.sword = 1
    p1.carried = { sword: 1 }
    expect(driveOff()).toBe('its escort guards that caravan’s carriage')
    // An escort who has lost their weapon or lies Down guards nothing.
    delete escort!.carried.sword
    expect(driveOff()).toBe('ack')
  })

  it('is let through once the crew is Down', () => {
    const { world, caravan, driveOff } = outInTheOpen()
    for (const r of crewOf(world, caravan)) {
      r.downUntil = world.tick + 1_000
      r.carried.sword = 1
    }
    const held = carriageOf(world, caravan)
    expect(driveOff()).toBe('ack')
    expect(held.realmId).toBe(world.realms[0]!.id)
  })

  it('is one theft and one robbery, with a new carriage and horse at the HQ', () => {
    const { world, terrain, caravan, hq, killCrew, driveOff, realm } = outInTheOpen()
    const stolen = carriageOf(world, caravan)
    const horseId = stolen.horseId!
    stolen.load = { food: 8, iron: 4 }
    killCrew()
    expect(driveOff()).toBe('ack')
    // Stolen with its load and horse.
    expect(stolen).toMatchObject({ realmId: realm.id, cityId: null, load: { food: 8, iron: 4 } })
    expect(world.horses.find((h) => h.id === horseId)).toMatchObject({ realmId: realm.id })
    expect(world.crimes).toEqual([
      expect.objectContaining({
        kind: 'theft',
        victimOrg: hq.id,
        carriage: true,
        goods: { food: 8, iron: 4 },
      }),
    ])
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
    // The same caravan has a new one, of the HQ, at its goods warehouse.
    expect(world.caravans).toEqual([caravan])
    const fresh = carriageOf(world, caravan)
    const warehouse = routeEnd(world, caravan, 'hq').warehouse!
    expect(fresh).not.toBe(stolen)
    expect(fresh).toMatchObject({
      realmId: null,
      cityId: hq.id,
      x: warehouse.x,
      y: warehouse.y,
      load: {},
    })
    const horse = world.horses.find((h) => h.id === fresh.horseId)!
    expect(horse).toMatchObject({ realmId: null, cityId: hq.id, x: warehouse.x, y: warehouse.y })
    expect(horse.id).not.toBe(horseId)
    expect(caravan).toMatchObject({ heading: 'hq', stop: 'storage', toLoad: null })
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('counts the carriage, horse and load in what the Trade Organization lost', () => {
    const { world, caravan, killCrew, driveOff } = outInTheOpen()
    const load: Stock = { iron: 4 }
    carriageOf(world, caravan).load = { ...load }
    killCrew()
    driveOff()
    expect(lossOf(world.crimes[0]!)).toBe(
      worthOf(load) + CARRIAGE_STOLEN_WORTH + HORSE_STOLEN_WORTH,
    )
  })

  it('then lets the thief drive off in it, the caravan going on without it', () => {
    const { world, terrain, caravan, p1, killCrew, driveOff } = outInTheOpen()
    killCrew()
    const stolen = caravan.carriageId
    driveOff()
    runUntil(world, terrain, () => p1.x === 225, 300)
    expect(world.carriages.find((k) => k.id === stolen)).toMatchObject({ x: 225, y: 220 })
    expect(world.caravans).toEqual([caravan])
  })

  it('sends a delivery’s goods again, all of the load counted as taken', () => {
    const { world, terrain, caravan, city, queue, warehouse, p1, realm } = setup()
    expect(order(world, queue, { kind: 'buy', good: 'iron', units: 6, cityId: city.id })).toBe(
      'ack',
    )
    runUntil(world, terrain, () => world.deliveries.length > 0, 5)
    atWarehouse(world, caravan, warehouse)
    runUntil(world, terrain, () => caravan.job?.step === 'deliver', 200)
    expect(carriageOf(world, caravan).load.iron).toBe(6)
    const stolen = carriageOf(world, caravan)
    p1.x = stolen.x
    p1.y = stolen.y
    for (const r of crewOf(world, caravan)) die(world, r)
    const taken = { kind: 'drive', carriageId: stolen.id, x: stolen.x + 5, y: stolen.y }
    expect(order(world, queue, taken)).toBe('ack')
    expect(stolen).toMatchObject({ realmId: realm.id, load: { iron: 6 } })
    expect(caravan.job).toMatchObject({ units: 0, robbed: 6 })
    // Once the new driver reached the new carriage, the delivery waits for the caravan to fetch it.
    runUntil(world, terrain, () => eventsOf(world, 'deliveryRobbed').length > 0, 500)
    expect(eventsOf(world, 'deliveryRobbed')).toEqual([
      expect.objectContaining({ good: 'iron', units: 6, cityId: city.id }),
    ])
    expect(world.deliveries).toEqual([expect.objectContaining({ units: 6, caravanId: null })])
    expect(warehouse.id).toBe(world.deliveries[0]!.warehouseId)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('gets a delivery’s goods to the city after all', { tags: ['slow'], timeout: 240_000 }, () => {
    const { world, terrain, caravan, city, storage, queue, warehouse, p1 } = setup()
    expect(order(world, queue, { kind: 'buy', good: 'iron', units: 6, cityId: city.id })).toBe(
      'ack',
    )
    runUntil(world, terrain, () => world.deliveries.length > 0, 5)
    atWarehouse(world, caravan, warehouse)
    runUntil(world, terrain, () => caravan.job?.step === 'deliver', 200)
    const before = storage.stock!.iron ?? 0
    const stolen = carriageOf(world, caravan)
    p1.x = stolen.x
    p1.y = stolen.y
    for (const r of crewOf(world, caravan)) die(world, r)
    const taken = { kind: 'drive', carriageId: stolen.id, x: stolen.x + 5, y: stolen.y }
    expect(order(world, queue, taken)).toBe('ack')
    runUntil(world, terrain, () => world.deliveries.length === 0)
    expect(storage.stock!.iron).toBe(before + 6)
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
  })

  it('makes good a transfer’s goods the same way', () => {
    const { world, terrain, caravan, p1, queue, toCity, warehouse } = transferSetup()
    p1.carried = { iron: 5, coins: 1_000 }
    const sent = transferOrder(world, queue, {
      kind: 'handIn',
      good: 'iron',
      units: 5,
      toCityId: toCity.id,
    })
    expect(sent).toBe('ack')
    runUntil(world, terrain, () => world.transfers.length > 0, 5)
    atWarehouse(world, caravan, warehouse)
    runUntil(world, terrain, () => caravan.transfer?.step === 'deliver', 200)
    const stolen = carriageOf(world, caravan)
    p1.x = stolen.x
    p1.y = stolen.y
    for (const r of crewOf(world, caravan)) die(world, r)
    const taken = { kind: 'drive', carriageId: stolen.id, x: stolen.x + 5, y: stolen.y }
    expect(transferOrder(world, queue, taken)).toBe('ack')
    expect(caravan.transfer).toMatchObject({ units: 0, robbed: 5 })
    runUntil(world, terrain, () => world.transfers[0]?.caravanId === null, 500)
    expect(world.transfers).toEqual([expect.objectContaining({ units: 5, caravanId: null })])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves a surviving crew walking back to the new carriage, and on along their route', () => {
    const { world, terrain, caravan, driveOff, p1 } = outInTheOpen()
    const warehouse = routeEnd(world, caravan, 'hq').warehouse!
    // Lured away, close enough to the HQ for the walk back to be short.
    const crew = crewOf(world, caravan)
    for (const r of crew) {
      r.x = warehouse.x + 30
      r.y = warehouse.y
    }
    const stolen = carriageOf(world, caravan)
    expect(p1.x).toBe(stolen.x)
    expect(driveOff()).toBe('ack')
    const fresh = () => carriageOf(world, caravan)
    runUntil(world, terrain, () => crew.every((r) => inContact(terrain.size, r, fresh())), 500)
    expect(crewIdsOf(caravan)).toEqual(crew.map((r) => r.id))
    // They set off, none left standing.
    runUntil(world, terrain, () => fresh().x !== warehouse.x || fresh().y !== warehouse.y, 2_000)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('steals a stranger’s free horse with a horseless carriage: two thefts, one robbery', () => {
    const { world, caravan, hq, killCrew, driveOff, realm, p1 } = outInTheOpen()
    const stolen = carriageOf(world, caravan)
    const dead = world.horses.find((h) => h.id === stolen.horseId)!
    // The caravan's horse died; another Player's stands free on the tile.
    world.horses = world.horses.filter((h) => h !== dead)
    stolen.horseId = null
    const other = { ...dead, id: 'stranger-horse', name: 'Stray', realmId: 'r9', cityId: null }
    world.realms.push({ id: 'r9', userId: 99, leaderId: 'nobody' } as WorldState['realms'][0])
    world.horses.push(other)
    killCrew()
    expect(driveOff()).toBe('ack')
    expect(p1.order).toMatchObject({ kind: 'drive', carriageId: stolen.id })
    expect(stolen).toMatchObject({ realmId: realm.id, horseId: other.id })
    expect(other).toMatchObject({ realmId: realm.id, cityId: null })
    expect(world.crimes.map((c) => c.victimOrg).sort()).toEqual([hq.id, 'r9'].sort())
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
    // The new carriage has a horse of its own, not the stolen one.
    const fresh = carriageOf(world, caravan)
    expect(fresh.horseId).not.toBe(other.id)
    expect(world.horses.find((h) => h.id === fresh.horseId)).toMatchObject({ cityId: hq.id })
  })

  it('steals a horseless carriage with the Trade Org’s free horse as one theft', () => {
    const { world, caravan, hq, killCrew, driveOff, realm } = outInTheOpen()
    const stolen = carriageOf(world, caravan)
    const horse = world.horses.find((h) => h.id === stolen.horseId)!
    stolen.horseId = null
    killCrew()
    expect(driveOff()).toBe('ack')
    expect(stolen).toMatchObject({ realmId: realm.id, horseId: horse.id })
    expect(horse).toMatchObject({ realmId: realm.id })
    expect(world.crimes).toEqual([
      expect.objectContaining({ victimOrg: hq.id, carriage: true, horse: horse.name }),
    ])
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
  })

  it('gives the new carriage a horse that can’t be taken off it by mounting or hitching', () => {
    const { world, caravan, queue, killCrew, driveOff, p1 } = outInTheOpen()
    killCrew()
    const stolen = carriageOf(world, caravan)
    driveOff()
    const fresh = carriageOf(world, caravan)
    const horse = world.horses.find((h) => h.id === fresh.horseId)!
    p1.order = null
    p1.x = fresh.x
    p1.y = fresh.y
    expect(order(world, queue, { kind: 'mount', horseId: horse.id })).not.toBe('ack')
    // Her own carriage, with none hitched, brought beside it: its horse pulls another carriage.
    stolen.x = fresh.x
    stolen.y = fresh.y
    stolen.horseId = null
    const hitching = { kind: 'drive', carriageId: stolen.id, x: fresh.x + 3, y: fresh.y }
    expect(order(world, queue, { ...hitching, horseId: horse.id })).not.toBe('ack')
    expect(horse).toMatchObject({ realmId: null })
    expect(fresh.horseId).toBe(horse.id)
  })

  it('ends the caravan when there is no HQ left to replace it', () => {
    const { world, terrain, caravan, hq, killCrew, driveOff } = outInTheOpen()
    killCrew()
    world.buildings = world.buildings.filter((b) => b.id !== hq.townHallId)
    expect(driveOff()).toBe('ack')
    expect(world.caravans).toEqual([])
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
    expect(caravansSound.check(world, terrain)).toEqual([])
  })
})

describe('a caravan losing its crew', () => {
  it('has a surviving escort take over driving when its driver dies, and goes on', () => {
    const { world, terrain, caravan, beat } = outInTheOpen()
    const [driver, first, ...rest] = crewOf(world, caravan)
    first!.order = attackOrder('p1')
    beat(driver!)
    expect(caravan.driverId).toBe(first!.id)
    expect(caravan.escortIds).toEqual(rest.map((r) => r.id))
    expect(first!.order).toBe(null)
    expect(checkInvariants(world, terrain)).toEqual([])
    const { x, y } = carriageOf(world, caravan)
    runUntil(world, terrain, () => first!.x !== x || first!.y !== y, 500)
    expect(world.caravans).toEqual([caravan])
  })

  it('picks an escort who is up over one who is Down', () => {
    const { world, caravan, beat } = outInTheOpen()
    const crew = crewOf(world, caravan)
    expect(crew.length).toBeGreaterThanOrEqual(3)
    crew[1]!.downUntil = world.tick + 1_000
    beat(crew[0]!)
    expect(caravan.driverId).toBe(crew[2]!.id)
  })

  it('takes over too when the driver went missing without a death', () => {
    const { world, terrain, caravan } = outInTheOpen()
    const [driver, first] = crewOf(world, caravan)
    world.residents = world.residents.filter((r) => r !== driver)
    runUntil(world, terrain, () => caravan.driverId === first!.id, 1)
    expect(world.caravans).toEqual([caravan])
  })

  it('stands with no crew left until the HQ sends a new driver on foot, who can’t stop a theft', () => {
    const { world, terrain, caravan, hq, killCrew, driveOff } = outInTheOpen()
    killCrew()
    expect(caravan).toMatchObject({ driverId: null, escortIds: [] })
    expect(caravansSound.check(world, terrain)).toEqual([])
    const standing = { x: carriageOf(world, caravan).x, y: carriageOf(world, caravan).y }
    runUntil(world, terrain, () => caravan.driverId !== null, 1)
    const driver = world.residents.find((r) => r.id === caravan.driverId)!
    expect(driver).toMatchObject({ owner: null, cityId: hq.id })
    expect(driver.carried.sword ?? 0).toBe(0)
    expect(carriageOf(world, caravan)).toMatchObject(standing)
    expect(driver.order).toMatchObject({ kind: 'walkTo', target: standing })
    // Far off still: the carriage can be taken before they arrive.
    expect(driveOff()).toBe('ack')
    expect(world.routeRobberies).toEqual({ [caravan.postId]: 1 })
  })

  it('waits with no adult free at the HQ, and sends one when there is', () => {
    const { world, terrain, caravan, hq, killCrew } = outInTheOpen()
    killCrew()
    const adults = world.residents.filter((r) => r.owner === null && r.cityId === hq.id)
    const free = adults[0]!
    const armed = new Map(adults.map((r) => [r.id, { ...r.carried }]))
    for (const r of adults) r.carried.sword = 1
    runUntil(world, terrain, () => world.tick > 0, 1)
    expect(caravan.driverId).toBe(null)
    expect(world.caravans).toEqual([caravan])
    expect(checkInvariants(world, terrain)).toEqual([])
    free.carried = armed.get(free.id)!
    free.order = null
    runUntil(world, terrain, () => caravan.driverId === free.id, 1)
  })

  it('is caught by the invariants when it has lost its carriage or skips its escort', () => {
    const { world, terrain, caravan, realm } = outInTheOpen()
    const messages = () => caravansSound.check(world, terrain).map((v) => v.message)
    carriageOf(world, caravan).realmId = realm.id
    expect(messages()).toEqual([expect.stringContaining("isn't the Trade Org HQ's")])
    carriageOf(world, caravan).realmId = null
    caravan.driverId = null
    expect(messages()).toEqual([expect.stringContaining('has no driver')])
  })
})
