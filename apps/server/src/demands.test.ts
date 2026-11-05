import {
  AVERAGE_HORSE_STATS,
  DEMANDS_PER_GAME_DAY,
  DEMAND_MAX_DAYS,
  DEMAND_NOTE_MAX_LENGTH,
  OCCUPATION_GAME_DAYS,
  TICKS_PER_GAME_DAY,
  Terrain,
  diplomacyFor,
  realmsKnownTo,
  realmsToOfferTo,
  type RealmEvent,
  type Remembered,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { demandsSound, stepDemands } from './demands.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { dieAll } from './survival.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 256, tiles: new Uint8Array(256 * 256).fill(Terrain.Plains) }
const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const tobin = { userId: 8, account: { name: 'Tobin', isAdmin: false } }
const wren = { userId: 9, account: { name: 'Wren', isAdmin: false } }

function resident(world: WorldState, id: string, owner: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId: null,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** What Mara's Player remembers of Tobin's city c2. */
const c2Seen = (name = 'Ashford', realmId: string | null = 'r2') =>
  ({ is: 'city', id: 'c2', name, realmId, x: 160, y: 160, seenAt: 0 }) as unknown as Remembered

/**
 * Realm r1 (Player 7) with city c1 and realm r2 (Player 8) with city c2, far apart, and r1's Player
 * remembers c2; realm r3 (Player 9) that nobody knows of.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1', name: 'Mara' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1', name: 'Tobin' })
  world.realms.push({ id: 'r3', userId: 9, leaderId: 'w1', name: 'Wren' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
  addCity(world, { id: 'c2', name: 'Ashford', realmId: 'r2', x: 160, y: 160 })
  addCity(world, { id: 'c3', realmId: 'r3', x: 100, y: 220 })
  resident(world, 'a1', 'r1', 40, 44)
  resident(world, 'b1', 'r2', 160, 164)
  resident(world, 'w1', 'r3', 100, 224)
  world.lastSeen[7] = [c2Seen()]
  return { world, queue: new OrderQueue(undefined, terrain), walking: new Walking(terrain) }
}

const goodsDemand = {
  kind: 'sendDemand',
  realmId: 'r2',
  terms: { kind: 'goods', goods: { coins: 50, food: 5 } },
  note: 'Pay what you owe, or we come for it.',
  days: 3,
}
const cityDemand = {
  kind: 'sendDemand',
  realmId: 'r2',
  terms: { kind: 'city', cityId: 'c2' },
  note: 'Give up Ashford or we take it.',
  days: 3,
}

/** Sends an order from a Player and applies it; the reason it was refused, if it was. */
function order(
  world: WorldState,
  queue: OrderQueue,
  from: typeof mara,
  o: Record<string, unknown>,
): string | undefined {
  const answer = queue.receive(world, from, 'q', o)
  queue.applyAll(world)
  return answer.type === 'rejected' ? answer.reason : undefined
}

const eventsOf = (world: WorldState, userId: number) =>
  world.events.filter(
    (e): e is Extract<RealmEvent, { kind: 'demand' }> => e.userId === userId && e.kind === 'demand',
  )
const whats = (world: WorldState, userId: number) => eventsOf(world, userId).map((e) => e.what)

describe('sending a demand', () => {
  it('arrives at once, far away, in both lists and logs', () => {
    const { world, queue } = setup()
    expect(order(world, queue, mara, cityDemand)).toBeUndefined()
    expect(world.demands).toMatchObject([
      {
        fromId: 'r1',
        toId: 'r2',
        terms: { kind: 'city', cityId: 'c2', cityName: 'Ashford' },
        note: 'Give up Ashford or we take it.',
        sentAt: world.tick,
        deadline: world.tick + 3 * TICKS_PER_GAME_DAY,
      },
    ])
    for (const realm of ['r1', 'r2']) {
      expect(diplomacyFor(world, realm, []).demands).toMatchObject([
        {
          from: { realmId: 'r1', realm: 'Mara' },
          to: { realmId: 'r2', realm: 'Tobin' },
          note: 'Give up Ashford or we take it.',
        },
      ])
    }
    expect(diplomacyFor(world, 'r3', []).demands).toEqual([])
    expect(eventsOf(world, 7)).toMatchObject([{ what: 'sent', mine: true, other: 'Tobin' }])
    expect(eventsOf(world, 8)).toMatchObject([{ what: 'received', mine: false, other: 'Mara' }])
    // The note stays out of the log.
    expect(JSON.stringify(world.events)).not.toContain('Give up Ashford')
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
  })

  it('asks for goods and Coins, keeping only what the terms should hold', () => {
    const { world, queue } = setup()
    const terms = { kind: 'goods', goods: { coins: 50 }, stolen: 'everything' }
    expect(order(world, queue, mara, { ...goodsDemand, terms })).toBeUndefined()
    expect(world.demands[0]!.terms).toEqual({ kind: 'goods', goods: { coins: 50 } })
  })

  it.each([
    ['no terms', undefined, /city, or goods/],
    ['unknown terms', { kind: 'favour' }, /city, or goods/],
    ['no goods', { kind: 'goods', goods: {} }, /name the goods/],
    ['goods that are no list', { kind: 'goods', goods: ['food'] }, /name the goods/],
    ['no such good', { kind: 'goods', goods: { gold: 1 } }, /no such good/],
    ['an inherited name', { kind: 'goods', goods: JSON.parse('{"__proto__":1}') }, /no such good/],
    ['part of a unit', { kind: 'goods', goods: { food: 1.5 } }, /whole number/],
    ['nothing', { kind: 'goods', goods: { food: 0 } }, /whole number/],
    ['too much to count', { kind: 'goods', goods: { food: 2 ** 60 } }, /whole number/],
    ['a city they don’t know', { kind: 'city', cityId: 'c3' }, /know of that city/],
    ['their own city', { kind: 'city', cityId: 'c1' }, /isn’t theirs/],
  ])('refuses %s', (_name, terms, reason) => {
    const { world, queue } = setup()
    expect(order(world, queue, mara, { ...goodsDemand, terms })).toMatch(reason)
    expect(world.demands).toEqual([])
    expect(world.events).toEqual([])
  })

  it('refuses a city the sender last saw as someone else’s, and takes one they think is theirs', () => {
    const { world, queue } = setup()
    // Another city of r2 keeps r2 known.
    world.lastSeen[7] = [c2Seen('Ashford', 'r3'), { ...c2Seen(), id: 'c9' }]
    expect(order(world, queue, mara, cityDemand)).toMatch(/isn’t theirs/)
    // Only memory counts: c2 is r2's in truth, and the name is the one Mara knows.
    world.lastSeen[7] = [c2Seen('Old Ashford')]
    world.cities.find((c) => c.id === 'c2')!.name = 'New Ashford'
    expect(order(world, queue, mara, cityDemand)).toBeUndefined()
    expect(world.demands[0]!.terms).toMatchObject({ cityName: 'Old Ashford' })
  })

  it('goes only to another realm they know of', () => {
    const { world, queue } = setup()
    expect(order(world, queue, mara, { ...goodsDemand, realmId: 'r1' })).toMatch(/another realm/)
    expect(order(world, queue, mara, { ...goodsDemand, realmId: 'r9' })).toMatch(/to a realm/)
    expect(order(world, queue, mara, { ...goodsDemand, realmId: 'c2' })).toMatch(/to a realm/)
    expect(order(world, queue, mara, { ...goodsDemand, realmId: 7 })).toMatch(/to a realm/)
    expect(order(world, queue, mara, { ...goodsDemand, realmId: 'r3' })).toMatch(/know of/)
    expect(world.demands).toEqual([])
  })

  it('counts as known a realm with residents in sight, which the query needs told', () => {
    const { world, queue } = setup()
    resident(world, 'w2', 'r3', 42, 44)
    expect(realmsKnownTo(world, 'r1', [])).toEqual(['r2'])
    expect(realmsKnownTo(world, 'r1', ['r3'])).toEqual(['r2', 'r3'])
    expect(order(world, queue, mara, { ...goodsDemand, realmId: 'r3' })).toBeUndefined()
  })

  it('counts allies, standings and sides of contracts and demands as known', () => {
    const { world } = setup()
    expect(realmsKnownTo(world, 'r3', [])).toEqual([])
    world.standings.push({ of: 'r3', toward: 'r2', value: -5, knownBy: [] } as never)
    expect(realmsKnownTo(world, 'r3', [])).toEqual(['r2'])
    expect(realmsKnownTo(world, 'r2', [])).toEqual(['r3'])
    world.standings = []
    world.demands.push({
      id: 'd1',
      fromId: 'r1',
      toId: 'r3',
      terms: { kind: 'goods', goods: { food: 1 } },
      note: 'Food',
      sentAt: 0,
      deadline: 100,
    })
    // The one who got a demand knows who sent it, and can answer in kind.
    expect(realmsKnownTo(world, 'r3', [])).toEqual(['r1'])
    expect(diplomacyFor(world, 'r3', []).knownRealms).toEqual([{ realmId: 'r1', realm: 'Mara' }])
    expect(diplomacyFor(world, 'r3', []).directOfferRealms).toEqual([
      { realmId: 'r1', realm: 'Mara' },
    ])
    world.demands = []
    // A Direct offer's sides know of each other too, for a demand as for another offer.
    world.offers.push({ realmId: 'r2', direct: { toId: 'r3', lapsesAt: 100 } } as never)
    expect(realmsKnownTo(world, 'r3', [])).toEqual(['r2'])
    expect(realmsToOfferTo(world, 'r3', [])).toEqual(['r2'])
    expect(realmsKnownTo(world, 'r2', [])).toEqual(['r3'])
  })

  it('needs a deadline ahead and within the cap', () => {
    const { world, queue } = setup()
    for (const days of [0, -1, 1.5, DEMAND_MAX_DAYS + 1, '3', undefined]) {
      expect(order(world, queue, mara, { ...goodsDemand, days })).toMatch(/deadline/)
    }
    expect(order(world, queue, mara, { ...goodsDemand, days: DEMAND_MAX_DAYS })).toBeUndefined()
  })

  it('caps the note, trims it, and refuses control characters', () => {
    const { world, queue } = setup()
    const long = 'x'.repeat(DEMAND_NOTE_MAX_LENGTH + 1)
    expect(order(world, queue, mara, { ...goodsDemand, note: long })).toMatch(/at most/)
    expect(order(world, queue, mara, { ...goodsDemand, note: '   ' })).toMatch(/needs a note/)
    expect(order(world, queue, mara, { ...goodsDemand, note: undefined })).toMatch(/needs a note/)
    expect(order(world, queue, mara, { ...goodsDemand, note: 42 })).toMatch(/needs a note/)
    expect(order(world, queue, mara, { ...goodsDemand, note: 'a\u0000b' })).toMatch(/control/)
    expect(world.demands).toEqual([])
    const fits = 'y'.repeat(DEMAND_NOTE_MAX_LENGTH)
    expect(order(world, queue, mara, { ...goodsDemand, note: `  ${fits}\n` })).toBeUndefined()
    expect(world.demands[0]!.note).toBe(fits)
  })

  it('keeps a note with markup as the very words it is', () => {
    const { world, queue } = setup()
    const note = '<img src=x onerror=alert(1)> **bold**\nsecond line'
    expect(order(world, queue, mara, { ...goodsDemand, note })).toBeUndefined()
    expect(world.demands[0]!.note).toBe(note)
    expect(diplomacyFor(world, 'r2', []).demands[0]!.note).toBe(note)
  })

  it('is limited per realm over any one game day', () => {
    const { world, queue } = setup()
    world.lastSeen[9] = [{ ...c2Seen() }]
    for (let i = 0; i < DEMANDS_PER_GAME_DAY; i++) {
      expect(order(world, queue, mara, goodsDemand)).toBeUndefined()
    }
    expect(order(world, queue, mara, goodsDemand)).toMatch(/at most/)
    expect(world.demands).toHaveLength(DEMANDS_PER_GAME_DAY)
    // Another realm's limit is its own.
    expect(order(world, queue, wren, goodsDemand)).toBeUndefined()
    // A refused one doesn't count, and answered ones still do.
    world.demands = world.demands.filter((d) => d.fromId !== 'r1')
    expect(order(world, queue, mara, goodsDemand)).toMatch(/at most/)
    world.tick += TICKS_PER_GAME_DAY - 1
    expect(order(world, queue, mara, goodsDemand)).toMatch(/at most/)
    world.tick += 1
    expect(order(world, queue, mara, goodsDemand)).toBeUndefined()
    // Only what still counts is kept.
    expect(world.realms[0]!.demandsSentAt).toEqual([world.tick])
  })

  it('holds the limit for orders that all came in during one tick', () => {
    const { world, queue } = setup()
    for (let i = 0; i < DEMANDS_PER_GAME_DAY + 2; i++) {
      expect(queue.receive(world, mara, `q${i}`, goodsDemand).type).toBe('ack')
    }
    queue.applyAll(world)
    expect(world.demands).toHaveLength(DEMANDS_PER_GAME_DAY)
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
  })

  it('needs a realm', () => {
    const { world, queue } = setup()
    const nobody = { userId: 99, account: { name: 'Nobody', isAdmin: false } }
    expect(order(world, queue, nobody, goodsDemand)).toMatch(/no realm/)
  })
})

describe('answering a demand', () => {
  function sent() {
    const s = setup()
    order(s.world, s.queue, mara, cityDemand)
    return { ...s, id: s.world.demands[0]!.id }
  }

  it.each([
    ['acceptDemand', 'accepted'],
    ['declineDemand', 'declined'],
  ])('%s records the answer in both logs, at once', (kind, what) => {
    const { world, queue, id } = sent()
    expect(order(world, queue, tobin, { kind, demandId: id })).toBeUndefined()
    expect(world.demands).toEqual([])
    expect(whats(world, 7)).toEqual(['sent', what])
    expect(whats(world, 8)).toEqual(['received', what])
    expect(eventsOf(world, 7).at(-1)).toMatchObject({
      mine: true,
      other: 'Tobin',
      terms: { kind: 'city', cityName: 'Ashford' },
    })
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
  })

  it('needs to know how goods and Coins go, which `demand-goods.test.ts` goes into', () => {
    const s = setup()
    order(s.world, s.queue, mara, goodsDemand)
    const id = s.world.demands[0]!.id
    expect(order(s.world, s.queue, tobin, { kind: 'acceptDemand', demandId: id })).toMatch(
      /set the goods aside/,
    )
    expect(s.world.demands).toHaveLength(1)
  })

  it('is only for the realm it was sent to, and only once', () => {
    const { world, queue, id } = sent()
    for (const kind of ['acceptDemand', 'declineDemand']) {
      expect(order(world, queue, mara, { kind, demandId: id })).toMatch(/only the realm/)
      expect(order(world, queue, wren, { kind, demandId: id })).toMatch(/no such demand/)
    }
    expect(world.demands).toHaveLength(1)
    expect(order(world, queue, tobin, { kind: 'declineDemand', demandId: id })).toBeUndefined()
    expect(order(world, queue, tobin, { kind: 'acceptDemand', demandId: id })).toMatch(/no such/)
  })

  it('takes one answer when two come in during one tick', () => {
    const { world, queue, id } = sent()
    queue.receive(world, tobin, 'a', { kind: 'acceptDemand', demandId: id })
    queue.receive(world, tobin, 'b', { kind: 'declineDemand', demandId: id })
    queue.applyAll(world)
    expect(whats(world, 8)).toEqual(['received', 'accepted'])
  })
})

describe('accepting a demand for a city', () => {
  /** `setup` with Mara's demand for c2 sent, where b2 lives; Tobin's Leader b1 lives far away. */
  function demanded() {
    const s = setup()
    order(s.world, s.queue, mara, cityDemand)
    const c2 = s.world.cities.find((c) => c.id === 'c2')!
    const b2 = resident(s.world, 'b2', 'r2', 160, 165)
    b2.cityId = 'c2'
    return { ...s, c2, b2, id: s.world.demands[0]!.id }
  }
  const accept = { kind: 'acceptDemand' }

  /** A horse of the realm at (x, y), to see who it goes to. */
  function horse(world: WorldState, id: string, realmId: string, x: number, y: number) {
    const h = {
      id,
      name: 'Rowan',
      realmId,
      cityId: null,
      x,
      y,
      hunger: 100,
      health: 100,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    }
    world.horses.push(h)
    return h
  }

  it('joins the city at once, with its people, horses and carriages, as capture takes them', () => {
    const { world, queue, c2, b2, id } = demanded()
    b2.order = { kind: 'walkTo', target: { x: 170, y: 170 }, path: null, progress: 0 }
    const near = horse(world, 'near', 'r2', 161, 165)
    const pulling = horse(world, 'pulling', 'r2', 162, 165)
    const far = horse(world, 'far', 'r2', 5, 5)
    const carriage = {
      id: 'k',
      realmId: 'r2',
      cityId: null,
      x: 162,
      y: 165,
      horseId: 'pulling',
      load: {},
    }
    world.carriages.push(carriage)

    expect(order(world, queue, tobin, { ...accept, demandId: id })).toBeUndefined()

    expect(c2.realmId).toBe('r1')
    expect(b2).toMatchObject({ owner: 'r1', cityId: 'c2', order: null })
    for (const t of [near, pulling, carriage]) expect(t.realmId, t.id).toBe('r1')
    expect(far.realmId).toBe('r2')
    expect(world.demands).toEqual([])
    expect(whats(world, 7)).toEqual(['sent', 'accepted'])
    expect(whats(world, 8)).toEqual(['received', 'accepted'])
    expect(world.events.filter((e) => e.kind === 'cityCaptured')).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('costs no standing and is no crime', () => {
    const { world, queue, id } = demanded()
    order(world, queue, tobin, { ...accept, demandId: id })
    for (let i = 0; i < 3; i++) stepWorld(world, terrain)
    expect(world.crimes).toEqual([])
    expect(world.standings).toEqual([])
  })

  it('is refused for a city already gone, and the demand stays to decline', () => {
    const { world, queue, c2, id } = demanded()
    c2.realmId = 'r3'
    expect(order(world, queue, tobin, { ...accept, demandId: id })).toMatch(
      /Ashford is no longer yours/,
    )
    expect(c2.realmId).toBe('r3')
    expect(world.demands).toHaveLength(1)
    world.cities = world.cities.filter((c) => c !== c2)
    expect(order(world, queue, tobin, { ...accept, demandId: id })).toMatch(/no longer yours/)
    expect(order(world, queue, tobin, { kind: 'declineDemand', demandId: id })).toBeUndefined()
    expect(world.demands).toEqual([])
  })

  it('hands it to the first of two demands accepted in one tick, and leaves the other open', () => {
    const { world, queue, c2, id } = demanded()
    world.lastSeen[9] = [c2Seen()]
    expect(order(world, queue, wren, cityDemand)).toBeUndefined()
    const other = world.demands.find((d) => d.id !== id)!.id
    queue.receive(world, tobin, 'a', { ...accept, demandId: id })
    queue.receive(world, tobin, 'b', { ...accept, demandId: other })
    queue.applyAll(world)
    expect(c2.realmId).toBe('r1')
    expect(world.demands.map((d) => d.id)).toEqual([other])
    expect(whats(world, 9)).toEqual(['sent'])
  })

  it('is their choice for their last city too: the Leader stays in the realm, homeless', () => {
    const { world, queue, c2, id } = demanded()
    const leader = world.residents.find((r) => r.id === 'b1')!
    leader.cityId = 'c2'
    expect(order(world, queue, tobin, { ...accept, demandId: id })).toBeUndefined()
    expect(c2.realmId).toBe('r1')
    expect(world.cities.filter((c) => c.realmId === 'r2')).toEqual([])
    expect(leader).toMatchObject({ owner: 'r2', cityId: null })
    expect(world.realms.some((r) => r.id === 'r2')).toBe(true)
    for (let i = 0; i < 3; i++) stepWorld(world, terrain)
    expect(world.realms.some((r) => r.id === 'r2')).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('takes those in an army of the giver out of it as the world ticks on', () => {
    const { world, queue, b2, id } = demanded()
    world.armies.push({ id: 'army', realmId: 'r2', name: 'Guard', memberIds: ['b2'], order: null })
    order(world, queue, tobin, { ...accept, demandId: id })
    stepWorld(world, terrain)
    expect(b2.owner).toBe('r1')
    expect(world.armies.flatMap((a) => a.memberIds)).not.toContain('b2')
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('tells the new owner of an occupation by a third realm, which goes on', () => {
    const { world, queue, c2, id } = demanded()
    const since = world.tick - TICKS_PER_GAME_DAY
    c2.occupation = { realmId: 'r3', since }
    order(world, queue, tobin, { ...accept, demandId: id })
    expect(c2.occupation).toEqual({ realmId: 'r3', since })
    expect(world.events.filter((e) => e.kind === 'hallOccupied')).toEqual([
      expect.objectContaining({
        userId: 7,
        cityId: 'c2',
        other: 'Wren',
        occupier: false,
        days: OCCUPATION_GAME_DAYS - 1,
      }),
    ])
  })

  it('ends the sender’s own occupation, unlogged', () => {
    const { world, queue, c2, id } = demanded()
    c2.occupation = { realmId: 'r1', since: world.tick }
    order(world, queue, tobin, { ...accept, demandId: id })
    stepWorld(world, terrain)
    expect(c2.occupation).toBeNull()
    const logged = world.events.filter(
      (e) => e.kind === 'hallOccupied' || e.kind === 'occupationBroken',
    )
    expect(logged).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('a demand left alone', () => {
  it('lapses at its deadline and says so to both, and that is all that happens', () => {
    const { world, queue } = setup()
    order(world, queue, mara, { ...cityDemand, days: 1 })
    const deadline = world.demands[0]!.deadline
    const before = structuredClone(world)
    world.tick = deadline - 1
    stepDemands(world)
    expect(world.demands).toHaveLength(1)
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
    world.tick = deadline
    stepDemands(world)
    expect(world.demands).toEqual([])
    expect(whats(world, 7)).toEqual(['sent', 'lapsed'])
    expect(whats(world, 8)).toEqual(['received', 'lapsed'])
    // Nothing else moved: not a city, a resident, a good or a standing.
    const rest = (w: WorldState) => ({ ...w, demands: [], events: [], tick: 0, nextId: 0 })
    expect(rest(world)).toEqual(rest(before))
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
  })

  it('lapses as the world ticks on, with its invariants holding', () => {
    const { world, queue, walking } = setup()
    order(world, queue, mara, { ...goodsDemand, days: 1 })
    world.tick = world.demands[0]!.deadline - 2
    stepWorld(world, terrain, walking)
    expect(world.demands).toHaveLength(1)
    stepWorld(world, terrain, walking)
    expect(world.demands).toEqual([])
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
  })

  it('can no longer be answered once it lapsed', () => {
    const { world, queue } = setup()
    order(world, queue, mara, { ...goodsDemand, days: 1 })
    const { id, deadline } = world.demands[0]!
    world.tick = deadline
    stepDemands(world)
    expect(order(world, queue, tobin, { kind: 'acceptDemand', demandId: id })).toMatch(/no such/)
  })

  it('lapses when a side’s Leader dies, telling both which side, before the name is gone', () => {
    const { world, queue, walking } = setup()
    order(world, queue, mara, goodsDemand)
    dieAll(
      world,
      world.residents.filter((r) => r.id === 'b1'),
      'killed',
      terrain.size,
    )
    expect(world.realms.map((r) => r.id)).toEqual(['r1', 'r3'])
    expect(world.demands).toEqual([])
    expect(eventsOf(world, 7).at(-1)).toMatchObject({
      what: 'lapsed',
      mine: true,
      other: 'Tobin',
      leaderDied: 'receiver',
    })
    expect(eventsOf(world, 8).at(-1)).toMatchObject({ what: 'lapsed', leaderDied: 'receiver' })
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
  })
})

describe('the demands-sound invariant', () => {
  const messages = (world: WorldState) =>
    checkInvariants(world, terrain, [demandsSound]).map((v) => v.message)
  const demand = (world: WorldState) => ({
    id: 'd1',
    fromId: 'r1',
    toId: 'r2',
    terms: { kind: 'goods' as const, goods: { food: 1 } },
    note: 'Food',
    sentAt: world.tick,
    deadline: world.tick + 10,
  })

  it('passes a sound demand', () => {
    const { world } = setup()
    world.demands.push(demand(world))
    expect(messages(world)).toEqual([])
  })

  it('catches parties that are gone or the same', () => {
    const { world } = setup()
    world.demands.push({ ...demand(world), fromId: 'gone' })
    world.demands.push({ ...demand(world), id: 'd2', toId: 'r1' })
    expect(messages(world).join()).toMatch(/realm gone, which does not exist/)
    expect(messages(world).join()).toMatch(/d2 is sent to its own sender/)
  })

  it('catches an open demand whose deadline doesn’t lie ahead', () => {
    const { world } = setup()
    world.tick = 50
    world.demands.push({ ...demand(world), deadline: 50 })
    expect(messages(world).join()).toMatch(/not ahead of 50/)
  })

  it('catches a note and terms the order wouldn’t take, and a broken limit', () => {
    const { world } = setup()
    world.demands.push({ ...demand(world), note: 'x'.repeat(DEMAND_NOTE_MAX_LENGTH + 1) })
    world.demands.push({ ...demand(world), id: 'd2', terms: { kind: 'goods', goods: {} } })
    world.realms[0]!.demandsSentAt = Array(DEMANDS_PER_GAME_DAY + 1).fill(world.tick)
    const all = messages(world).join()
    expect(all).toMatch(/d1 has a note/)
    expect(all).toMatch(/d2 asks for no goods/)
    expect(all).toMatch(/realm r1 sent more/)
  })
})
