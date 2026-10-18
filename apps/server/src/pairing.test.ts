import {
  CHILD_STAT_SPREAD,
  HOUSING_ROOM,
  STAT_NAMES,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  canWork,
  cityResidents,
  freeHousing,
  hasFoodSurplus,
  housingRoom,
  surplusFoodLine,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { requestBirths, resolveBirths } from './pairing.js'
import { newResident, mulberry32 } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { worldWithCity } from './test-terrain.js'
import { stepWorld } from './world.js'

const me = { userId: 1, account: { name: 'Mara', isAdmin: false } }
const stranger = { userId: 2, account: { name: 'Tobin', isAdmin: false } }

/** Player 1's starting city with plenty of food in storage, and its residents. */
function setup(food = 100_000) {
  const { world, terrain } = worldWithCity()
  const city = world.cities[0]!
  storageOf(world).stock = { food }
  return { world, terrain, city, queue: new OrderQueue(), residents: [...world.residents] }
}

const storageOf = (world: WorldState) => world.buildings.find((b) => b.kind === 'storage')!

/** Sends an order from `sender` and applies it as the next tick would; returns the answer. */
function order(world: WorldState, queue: OrderQueue, o: object, sender = me) {
  const answer = queue.receive(world, sender, 'q', o)
  queue.applyAll(world)
  return answer
}

const pairUp = (world: WorldState, queue: OrderQueue, a: Resident, b: Resident) =>
  order(world, queue, { kind: 'pair', residentId: a.id, partnerId: b.id })

/**
 * Runs only pairing, a game day at a time, for some game years; returns who was born, in
 * order. Births come at most once a year, so a day's steps miss nothing that matters here.
 */
function years(world: WorldState, n: number): Resident[] {
  const born: Resident[] = []
  for (let d = 0; d < n * (TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY); d++) {
    world.tick += TICKS_PER_GAME_DAY
    born.push(...resolveBirths(world, requestBirths(world)))
  }
  return born
}

/** Adds a finished house to the city, on a free tile inside the walls. */
function addHouse(world: WorldState) {
  const city = world.cities[0]!
  for (let y = city.y + 1; y < city.y + city.size - 1; y++) {
    for (let x = city.x + 1; x < city.x + city.size - 1; x++) {
      if (world.buildings.some((b) => b.x === x && b.y === y)) continue
      world.buildings.push({ id: `h${x},${y}`, kind: 'house', cityId: city.id, x, y })
      return
    }
  }
  throw new Error('no free tile in the city')
}

describe('city housing and food surplus', () => {
  it('counts houses’ room against the residents, and only finished houses', () => {
    const { world, city } = setup()
    const houses = world.buildings.filter((b) => b.kind === 'house').length
    expect(housingRoom(world, city)).toBe(houses * HOUSING_ROOM.house!)
    expect(freeHousing(world, city)).toBe(houses * HOUSING_ROOM.house! - world.residents.length)
    world.buildings.find((b) => b.kind === 'house')!.site = { delivered: {}, work: 0 }
    expect(housingRoom(world, city)).toBe((houses - 1) * HOUSING_ROOM.house!)
  })

  it('counts residents of the city wherever they stand', () => {
    const { world, city } = setup()
    world.residents[0]!.x = 0
    world.residents[0]!.y = 0
    expect(cityResidents(world, city)).toHaveLength(world.residents.length)
  })

  it('has a surplus only with more stored food than its residents eat in the surplus days', () => {
    const { world, city } = setup()
    const line = surplusFoodLine(world, city)
    storageOf(world).stock = { food: Math.floor(line) }
    expect(hasFoodSurplus(world, city)).toBe(false)
    // Food the residents carry doesn't count.
    for (const r of world.residents) r.carried = { food: 10 }
    expect(hasFoodSurplus(world, city)).toBe(false)
    storageOf(world).stock = { food: Math.floor(line) + 1 }
    expect(hasFoodSurplus(world, city)).toBe(true)
  })
})

describe('pairing order', () => {
  it('pairs two adults of the same city, both holding the order', () => {
    const { world, queue, residents } = setup()
    const [a, b] = residents
    expect(pairUp(world, queue, a!, b!)).toEqual({ type: 'ack', requestId: 'q' })
    expect(a!.order).toEqual({ kind: 'pair', partnerId: b!.id, since: world.tick })
    expect(b!.order).toEqual({ kind: 'pair', partnerId: a!.id, since: world.tick })
    expect(checkInvariants(world, worldWithCity().terrain)).toEqual([])
  })

  it('turns down children, a resident on their own, other cities and other Players’ residents', () => {
    const { world, terrain, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    const reason = (o: object, sender = me) => {
      const answer = queue.receive(world, sender, 'q', o)
      return answer.type === 'rejected' ? answer.reason : undefined
    }
    const pairOf = (x: Resident, y: Resident) => ({
      kind: 'pair',
      residentId: x.id,
      partnerId: y.id,
    })
    expect(reason(pairOf(a, a))).toMatch(/themselves/)
    expect(reason(pairOf(a, b), stranger)).toMatch(/not one of your residents/)
    expect(reason({ kind: 'pair', residentId: a.id, partnerId: 'nobody' })).toMatch(/not one/)
    b.bornAt = world.tick - 5 * TICKS_PER_GAME_YEAR
    expect(reason(pairOf(a, b))).toMatch(/children/)
    b.bornAt = world.tick - 30 * TICKS_PER_GAME_YEAR
    b.cityId = null
    expect(reason(pairOf(a, b))).toMatch(/same city/)
    // A resident of the same realm but another city.
    foundStartingCity(world, terrain, 2)
    const other = world.cities[1]!
    b.cityId = other.id
    expect(reason(pairOf(a, b))).toMatch(/same city/)
    expect(queue.size).toBe(0)
  })

  it('ends for both when either gets another order, and for the one left when a partner dies', () => {
    const { world, queue, residents } = setup()
    const [a, b, c, d] = residents as [Resident, Resident, Resident, Resident]
    pairUp(world, queue, a, b)
    order(world, queue, { kind: 'walkTo', residentId: a.id, x: a.x, y: a.y })
    requestBirths(world)
    expect(b.order).toBeNull()

    pairUp(world, queue, c, d)
    world.residents = world.residents.filter((r) => r !== c)
    requestBirths(world)
    expect(d.order).toBeNull()
  })

  it('moves a resident to a new partner, ending the old pair', () => {
    const { world, queue, residents } = setup()
    const [a, b, c] = residents as [Resident, Resident, Resident]
    pairUp(world, queue, a, b)
    pairUp(world, queue, a, c)
    requestBirths(world)
    expect(b.order).toBeNull()
    expect(a.order).toMatchObject({ kind: 'pair', partnerId: c.id })
    expect(c.order).toMatchObject({ kind: 'pair', partnerId: a.id })
  })

  it('keeps a pair’s time when it is ordered again, so re-pairing never hurries a child', () => {
    const { world, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    const since = world.tick
    world.tick += TICKS_PER_GAME_DAY
    pairUp(world, queue, b, a)
    expect(a.order).toMatchObject({ since })
    expect(b.order).toMatchObject({ since })
  })
})

describe('births', () => {
  it('gives a pair one child per game year over the years while there is room and food', () => {
    const { world, terrain, queue, residents } = setup()
    for (let i = 0; i < 3; i++) addHouse(world)
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    const start = world.tick
    const born = years(world, 6)
    expect(born).toHaveLength(6)
    const ticks = born.map((c) => c.bornAt)
    ticks.forEach((t, i) => expect(t - (i === 0 ? start : ticks[i - 1]!)).toBe(TICKS_PER_GAME_YEAR))
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('has no child before the pair’s first game year is over', () => {
    const { world, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    world.tick += TICKS_PER_GAME_YEAR - 1
    expect(resolveBirths(world, requestBirths(world))).toEqual([])
    world.tick++
    expect(resolveBirths(world, requestBirths(world))).toHaveLength(1)
  })

  it('stops when the houses are full and goes on once a new house has room', () => {
    const { world, terrain, city, queue, residents } = setup()
    const [a, b, c, d] = residents as [Resident, Resident, Resident, Resident]
    pairUp(world, queue, a, b)
    pairUp(world, queue, c, d)
    const free = freeHousing(world, city)
    expect(free).toBeGreaterThan(0)
    for (let y = 0; y < 5; y++) {
      years(world, 1)
      expect(cityResidents(world, city).length).toBeLessThanOrEqual(housingRoom(world, city))
    }
    expect(world.residents.length - residents.length).toBe(free)
    expect(freeHousing(world, city)).toBe(0)

    addHouse(world)
    expect(years(world, 1)).toHaveLength(2)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('waits for a food surplus in storage; food the pair carries doesn’t help', () => {
    const { world, city, queue, residents } = setup(0)
    const [a, b] = residents as [Resident, Resident]
    a.carried = { food: 30 }
    b.carried = { food: 30 }
    pairUp(world, queue, a, b)
    expect(years(world, 2)).toEqual([])
    storageOf(world).stock = { food: Math.ceil(surplusFoodLine(world, city)) + 1 }
    world.tick += TICKS_PER_GAME_DAY
    expect(resolveBirths(world, requestBirths(world))).toHaveLength(1)
  })

  it('makes a child of the pair’s city and realm on a parent’s tile, inheriting base stats only', () => {
    const { world, city, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    a.stats.strength = { base: 14, trained: 7 }
    b.stats.strength = { base: 6, trained: 3 }
    a.skills = { construction: 5 }
    pairUp(world, queue, a, b)
    world.tick += TICKS_PER_GAME_YEAR
    const [child] = resolveBirths(world, requestBirths(world))
    expect(child).toMatchObject({
      owner: a.owner,
      cityId: city.id,
      x: a.x,
      y: a.y,
      bornAt: world.tick,
      skills: {},
      carried: {},
      order: null,
    })
    for (const s of STAT_NAMES) {
      const average = Math.round((a.stats[s].base + b.stats[s].base) / 2)
      expect(Math.abs(child!.stats[s].base - average)).toBeLessThanOrEqual(CHILD_STAT_SPREAD)
      expect(child!.stats[s].trained).toBe(0)
    }
    expect(canWork(child!, world.tick)).toBe(false)
    expect(world.events.at(-1)).toMatchObject({
      kind: 'born',
      residentId: child!.id,
      name: child!.name,
      parents: [a.name, b.name],
      userId: me.userId,
    })
  })

  it('never makes a base stat below 1', () => {
    const { world, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    for (const s of STAT_NAMES) {
      a.stats[s] = { base: 1, trained: 0 }
      b.stats[s] = { base: 1, trained: 0 }
    }
    pairUp(world, queue, a, b)
    for (let i = 0; i < 3; i++) addHouse(world)
    for (const child of years(world, 8)) {
      for (const s of STAT_NAMES) expect(child.stats[s].base).toBeGreaterThanOrEqual(1)
    }
  })

  it('happens in the running world: a fed pair at home has a child after a game year', () => {
    const { world, terrain, queue, residents } = setup(3000)
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    const before = world.residents.length
    for (let t = 0; t < TICKS_PER_GAME_YEAR + 1; t++) stepWorld(world, terrain)
    expect(world.residents.length).toBe(before + 1)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('a resident of no city', () => {
  it('can’t pair', () => {
    const { world, queue, residents } = setup()
    const loner = newResident(mulberry32(5), {
      id: 'loner',
      owner: residents[0]!.owner!,
      x: 0,
      y: 0,
      tick: world.tick,
    })
    world.residents.push(loner)
    expect(pairUp(world, queue, loner, residents[0]!)).toMatchObject({ type: 'rejected' })
  })
})
