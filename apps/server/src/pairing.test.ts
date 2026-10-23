import {
  CARRYING_A_CHILD,
  CARRYING_TICKS,
  CHILD_STAT_SPREAD,
  HOUSING_ROOM,
  STAT_NAMES,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  buildProblem,
  canWork,
  cityAreaTiles,
  cityResidents,
  freeHousing,
  hasFoodSurplus,
  housingRoom,
  surplusFoodLine,
  ticksForAge,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { requestBirths, resolveBirths } from './pairing.js'
import { newResident, mulberry32 } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { die } from './survival.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
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

/** Runs only pairing for `days` game days, a day at a time; returns who was born, in order. */
function days(world: WorldState, n: number): Resident[] {
  const born: Resident[] = []
  for (let d = 0; d < n; d++) {
    world.tick += TICKS_PER_GAME_DAY
    born.push(...resolveBirths(world, requestBirths(world)))
  }
  return born
}

const DAYS_PER_YEAR = TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY
const CARRYING_DAYS_ = CARRYING_TICKS / TICKS_PER_GAME_DAY

/** Runs only pairing for `n` game years. */
const years = (world: WorldState, n: number) => days(world, n * DAYS_PER_YEAR)

/** Whichever of the pair carries, if one does. */
const carrierOf = (a: Resident, b: Resident) => (a.carrying ? a : b.carrying ? b : undefined)

/** Adds a finished house to the city, where one fits in its area (`CONTEXT.md`: City area). */
function addHouse(world: WorldState) {
  const city = world.cities[0]!
  for (const key of cityAreaTiles(world, city, cityTerrain().size)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    if (buildProblem(world, x, y, 'house', cityTerrain())) continue
    world.buildings.push({ id: `h${x},${y}`, kind: 'house', cityId: city.id, x, y })
    return
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
  it('pairs two adults of the same city, leaving what both of them do alone', () => {
    const { world, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    const [orderA, orderB, scriptA] = [a.order, b.order, a.script]
    expect(orderA).toMatchObject({ kind: 'workAt' })
    expect(pairUp(world, queue, a, b)).toEqual({ type: 'ack', requestId: 'q' })
    expect(a.pair).toEqual({ partnerId: b.id, since: world.tick })
    expect(b.pair).toEqual({ partnerId: a.id, since: world.tick })
    expect([a.order, b.order, a.script]).toEqual([orderA, orderB, scriptA])
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
    b.bornAt = world.tick - ticksForAge(5)
    expect(reason(pairOf(a, b))).toMatch(/children/)
    b.bornAt = world.tick - ticksForAge(30)
    b.cityId = null
    expect(reason(pairOf(a, b))).toMatch(/same city/)
    // A resident of the same realm but another city.
    foundStartingCity(world, terrain, 2)
    const other = world.cities[1]!
    b.cityId = other.id
    expect(reason(pairOf(a, b))).toMatch(/same city/)
    expect(queue.size).toBe(0)
  })

  it('ends for the one left when a partner dies, or pairs with someone else', () => {
    const { world, queue, residents } = setup()
    const [a, b, c, d] = residents as [Resident, Resident, Resident, Resident]
    pairUp(world, queue, a, b)
    // Another order changes nothing about the pair.
    order(world, queue, { kind: 'walkTo', residentId: a.id, x: a.x, y: a.y })
    requestBirths(world)
    expect(b.pair).toEqual({ partnerId: a.id, since: world.tick })

    pairUp(world, queue, c, d)
    die(world, c)
    expect(d.pair).toBeUndefined()
    expect(checkInvariants(world, worldWithCity().terrain)).toEqual([])
  })

  it('moves a resident to a new partner, ending the old pair', () => {
    const { world, queue, residents } = setup()
    const [a, b, c] = residents as [Resident, Resident, Resident]
    pairUp(world, queue, a, b)
    pairUp(world, queue, a, c)
    requestBirths(world)
    expect(b.pair).toBeUndefined()
    expect(a.pair).toMatchObject({ partnerId: c.id })
    expect(c.pair).toMatchObject({ partnerId: a.id })
  })

  it('keeps a pair’s time when it is ordered again, so re-pairing never hurries a child', () => {
    const { world, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    const since = world.tick
    world.tick += TICKS_PER_GAME_DAY
    pairUp(world, queue, b, a)
    expect(a.pair).toMatchObject({ since })
    expect(b.pair).toMatchObject({ since })
  })
})

describe('carrying', () => {
  it('starts a game year after pairing: one partner carries and stops, the other works on', () => {
    const { world, terrain, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    expect(days(world, DAYS_PER_YEAR - 1)).toEqual([])
    expect(carrierOf(a, b)).toBeUndefined()
    days(world, 1)
    const carrier = carrierOf(a, b)!
    const other = carrier === a ? b : a
    expect(carrier.carrying).toMatchObject({
      since: world.tick,
      partnerId: other.id,
      partnerName: other.name,
    })
    expect(other.carrying).toBeUndefined()
    // The carrier's work ends; the other partner's order is untouched.
    expect(carrier.order).toBeNull()
    expect(carrier.script).toBeUndefined()
    expect(other.order).toMatchObject({ kind: 'workAt' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('has the child CARRYING_DAYS after carrying starts, and ends the pair', () => {
    const { world, terrain, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    days(world, DAYS_PER_YEAR)
    const carrier = carrierOf(a, b)!
    const start = world.tick
    expect(days(world, CARRYING_DAYS_ - 1)).toEqual([])
    const [child] = days(world, 1)
    expect(child!.bornAt - start).toBe(CARRYING_TICKS)
    expect(child).toMatchObject({ x: carrier.x, y: carrier.y, cityId: carrier.cityId })
    expect([a.pair, b.pair, a.carrying, b.carrying]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    // Without pairing again, no other child comes.
    expect(years(world, 2)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('picks the partner who carries at random', () => {
    const carriers = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { world, queue, residents } = setup()
      world.seed = seed
      const [a, b] = residents as [Resident, Resident]
      pairUp(world, queue, a, b)
      days(world, DAYS_PER_YEAR)
      carriers.add(carrierOf(a, b) === a ? 'a' : 'b')
    }
    expect(carriers).toEqual(new Set(['a', 'b']))
  })

  it('never brings two children in one game year, however soon the pair is paired again', () => {
    const { world, terrain, queue, residents } = setup()
    for (let i = 0; i < 3; i++) addHouse(world)
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    const born: Resident[] = []
    for (let d = 0; d < 5 * DAYS_PER_YEAR; d++) {
      const today = days(world, 1)
      born.push(...today)
      // Paired again the day the child is born.
      if (today.length > 0) pairUp(world, queue, a, b)
    }
    expect(born.length).toBeGreaterThanOrEqual(3)
    const ticks = born.map((c) => c.bornAt)
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBe(TICKS_PER_GAME_YEAR + CARRYING_TICKS)
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('turns down work, building, tearing down, hauling and pairing for a resident carrying', () => {
    const { world, queue, residents } = setup()
    const [a, b, c] = residents as [Resident, Resident, Resident]
    pairUp(world, queue, a, b)
    days(world, DAYS_PER_YEAR)
    const carrier = carrierOf(a, b)!
    const reason = (o: object) => {
      const answer = queue.receive(world, me, 'q', { residentId: carrier.id, ...o })
      return answer.type === 'rejected' ? answer.reason : undefined
    }
    expect(reason({ kind: 'workAt' })).toBe(CARRYING_A_CHILD)
    expect(reason({ kind: 'build', building: 'house' })).toBe(CARRYING_A_CHILD)
    const farm = world.buildings.find((x) => x.kind === 'farm')!
    expect(reason({ kind: 'tearDown', buildingId: farm.id })).toBe(CARRYING_A_CHILD)
    expect(
      reason({ kind: 'haul', carriageId: 'k', x: 0, y: 0, goods: ['food'], keepFood: 0 }),
    ).toBe(CARRYING_A_CHILD)
    expect(reason({ kind: 'roadLine', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } })).toBe(
      CARRYING_A_CHILD,
    )
    expect(reason({ kind: 'pair', partnerId: c.id })).toBe(CARRYING_A_CHILD)
    // Walking stays theirs.
    expect(reason({ kind: 'walkTo', x: carrier.x, y: carrier.y })).toBeUndefined()
  })

  it('stops the houses filling up: children on the way count against free housing', () => {
    const { world, terrain, city, queue, residents } = setup()
    const [a, b, c, d] = residents as [Resident, Resident, Resident, Resident]
    const free = freeHousing(world, city)
    expect(free).toBeGreaterThan(0)
    for (let i = 0; i < free + 1; i++) {
      pairUp(world, queue, a, b)
      pairUp(world, queue, c, d)
      days(world, DAYS_PER_YEAR + CARRYING_DAYS_)
      expect(cityResidents(world, city).length).toBeLessThanOrEqual(housingRoom(world, city))
    }
    expect(world.residents.length - residents.length).toBe(free)
    expect(freeHousing(world, city)).toBe(0)

    addHouse(world)
    pairUp(world, queue, a, b)
    pairUp(world, queue, c, d)
    expect(days(world, DAYS_PER_YEAR + CARRYING_DAYS_)).toHaveLength(
      Math.min(2, HOUSING_ROOM.house!),
    )
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('waits for a food surplus in storage; food the pair carries doesn’t help', () => {
    const { world, city, queue, residents } = setup(0)
    const [a, b] = residents as [Resident, Resident]
    a.carried = { food: 30 }
    b.carried = { food: 30 }
    pairUp(world, queue, a, b)
    years(world, 2)
    expect(carrierOf(a, b)).toBeUndefined()
    storageOf(world).stock = { food: Math.ceil(surplusFoodLine(world, city)) + 1 }
    days(world, 1)
    expect(carrierOf(a, b)).toBeDefined()
  })

  it('makes a child of the carrier’s city and realm on their tile, inheriting base stats only', () => {
    const { world, city, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    a.stats.strength = { base: 14, trained: 7 }
    b.stats.strength = { base: 6, trained: 3 }
    a.skills = { construction: 5 }
    pairUp(world, queue, a, b)
    days(world, DAYS_PER_YEAR)
    const carrier = carrierOf(a, b)!
    const [child] = days(world, CARRYING_DAYS_)
    expect(child).toMatchObject({
      owner: a.owner,
      cityId: city.id,
      x: carrier.x,
      y: carrier.y,
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
      parents: expect.arrayContaining([a.name, b.name]),
      userId: me.userId,
    })
  })

  it('still has the child when the other parent dies while it is carried', () => {
    const { world, terrain, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    pairUp(world, queue, a, b)
    days(world, DAYS_PER_YEAR)
    const carrier = carrierOf(a, b)!
    const other = carrier === a ? b : a
    die(world, other)
    expect(checkInvariants(world, terrain)).toEqual([])
    const [child] = days(world, CARRYING_DAYS_)
    expect(child).toBeDefined()
    expect(world.events.at(-1)).toMatchObject({ parents: [carrier.name, other.name] })
  })

  it('never makes a base stat below 1', () => {
    const { world, queue, residents } = setup()
    const [a, b] = residents as [Resident, Resident]
    for (const s of STAT_NAMES) {
      a.stats[s] = { base: 1, trained: 0 }
      b.stats[s] = { base: 1, trained: 0 }
    }
    pairUp(world, queue, a, b)
    for (const child of days(world, DAYS_PER_YEAR + CARRYING_DAYS_)) {
      for (const s of STAT_NAMES) expect(child.stats[s].base).toBeGreaterThanOrEqual(1)
    }
  })

  it('happens in the running world: the partner keeps farming while the other carries', () => {
    const { world, terrain, queue, residents } = setup(3000)
    const [a, b] = residents as [Resident, Resident]
    const farm = world.buildings.find((x) => x.kind === 'farm')!
    pairUp(world, queue, a, b)
    // They paired a game year ago: carrying starts in the world's next tick.
    for (const r of [a, b]) r.pair!.since -= TICKS_PER_GAME_YEAR
    stepWorld(world, terrain)
    const carrier = carrierOf(a, b)!
    const other = carrier === a ? b : a
    expect(carrier.order).toBeNull()
    expect(other.order).toMatchObject({ kind: 'workAt', buildingId: farm.id })
    // Skip to the last day of carrying; the world runs it, the other partner working throughout.
    carrier.carrying!.since -= CARRYING_TICKS - TICKS_PER_GAME_DAY
    const before = world.residents.length
    for (let t = 0; t < TICKS_PER_GAME_DAY + 1; t++) {
      stepWorld(world, terrain)
      expect(other.order).toMatchObject({ kind: 'workAt', buildingId: farm.id })
    }
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
