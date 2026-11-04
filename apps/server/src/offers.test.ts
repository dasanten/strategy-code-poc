import { parse, run as runScript } from '@csp/lang'
import {
  DEFAULT_SCRIPTS,
  GOOD_WEIGHT,
  HOME_FOOD_LOW,
  OWN_FOOD,
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_VALUE_LIMITS,
  STANDING_TRADE_COINS_PER_POINT,
  TICKS_PER_GAME_YEAR,
  Terrain,
  WAREHOUSE_BASE_PRICE,
  freeStock,
  quoteOffer,
  setAsideAt,
  standingOf,
  type Building,
  type Offer,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity } from './capture.js'
import { order, setup as deliveries } from './deliveries.fixture.js'
import { eventsFor } from './events.js'
import { tallyGoods, takeMade } from './goods-made.js'
import { checkInvariants, goodsOnlyFromNothingAtTheFloor } from './invariants.js'
import { offersAcceptedIn, offersKeepGoods, offersSound, stepOffers } from './offers.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { bindScript } from './script-bindings.js'
import { ScriptRunner, type ScriptHost } from './script-runner.js'
import { entitiesInSight } from './sight.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const size = 128
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }

const poster = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const taker = { userId: 8, account: { name: 'Bo', isAdmin: false } }

/**
 * Realm r1 (Player 7) with city c1 and its storage s1 at (6, 6) holding 100 Wood and 50 Stone, and
 * realm r2 (Player 8) with resident t1 standing on it and city c2 far off.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
  addCity(world, { id: 'c2', realmId: 'r2', x: 90, y: 90, name: 'Brook' })
  const storage: Building = {
    id: 's1',
    kind: 'storage',
    cityId: 'c1',
    x: 6,
    y: 6,
    stock: { wood: 100, stone: 50 },
  }
  world.buildings.push(storage)
  resident(world, 'a1', 'r1', 'c1', 60, 10)
  resident(world, 'b1', 'r2', 'c2', 100, 100)
  const t = resident(world, 't1', 'r2', 'c2', 6, 6)
  return { world, storage, t, queue: new OrderQueue(undefined, terrain) }
}

function resident(
  world: WorldState,
  id: string,
  owner: string | null,
  cityId: string | null,
  x: number,
  y: number,
): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.cityId = cityId
  for (const s of ['strength', 'endurance', 'intellect', 'agility'] as const) {
    r.stats[s] = { base: 10, trained: 0 }
  }
  r.bornAt = -20 * TICKS_PER_GAME_YEAR
  r.lifespan = 60
  r.carried = { food: OWN_FOOD }
  world.residents.push(r)
  return r
}

/** Applies the waiting orders and steps the world, checking every invariant after each tick. */
function tick(world: WorldState, queue?: OrderQueue, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    queue?.applyAll(world)
    for (const r of world.residents) r.hunger = 100
    const before = tallyGoods(world)
    takeMade(world)
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
    expect(goodsOnlyFromNothingAtTheFloor(before, world, takeMade(world))).toEqual([])
  }
}

const receive = (world: WorldState, queue: OrderQueue, sender: typeof poster, order: object) =>
  queue.receive(world, sender, 'q', order)

/** "gives 10 Wood, wants 5 Stone", twice over, unless the terms say otherwise. */
const post = (world: WorldState, queue: OrderQueue, terms: object = {}) =>
  receive(world, queue, poster, {
    kind: 'postOffer',
    storageId: 's1',
    gives: 'wood',
    givesUnits: 10,
    wants: 'stone',
    wantsUnits: 5,
    times: 2,
    ...terms,
  })

/** The one offer of a world with one. */
function posted(world: WorldState, queue: OrderQueue, terms: object = {}): Offer {
  expect(post(world, queue, terms)).toEqual({ type: 'ack', requestId: 'q' })
  queue.applyAll(world)
  return world.offers.at(-1)!
}

const accept = (world: WorldState, queue: OrderQueue, order: object, sender = taker) =>
  receive(world, queue, sender, { kind: 'acceptOffer', residentId: 't1', times: 1, ...order })

const kinds = (world: WorldState, userId: number) => eventsFor(world, userId).map((e) => e.kind)

describe('posting an offer', () => {
  it('sets the goods aside, which stay in the storage, and leaves the rest free', () => {
    const { world, storage, queue } = setup()
    const offer = posted(world, queue)
    expect(offer).toMatchObject({ realmId: 'r1', storageId: 's1', gives: 'wood', times: 2 })
    expect(storage.stock).toEqual({ wood: 100, stone: 50 })
    expect(setAsideAt(world, 's1')).toEqual({ wood: 20 })
    expect(freeStock(world, storage)).toEqual({ wood: 80, stone: 50 })
    tick(world)
    expect(world.offers).toHaveLength(1)
  })

  it('is posted as many times over as the goods not yet set aside allow', () => {
    const { world, queue } = setup()
    expect(posted(world, queue, { times: 99 }).times).toBe(10)
    const reject = post(world, queue)
    expect(reject).toMatchObject({ type: 'rejected' })
    expect(posted(world, queue, { gives: 'stone', wants: 'wood', times: 1 }).times).toBe(1)
  })

  it('needs a storage of the realm, a different good, and whole units', () => {
    const { world, queue } = setup()
    const reason = (terms: object) => (post(world, queue, terms) as { reason?: string }).reason
    expect(reason({ storageId: 'c1-hall' })).toBe('not a finished storage of yours')
    expect(reason({ gives: 'stone', wants: 'stone' })).toMatch(/different good/)
    expect(reason({ gives: 'gold-ish' })).toBe('gives and wants must be goods')
    expect(reason({ wantsUnits: 0 })).toBe('units and times must be whole numbers')
    expect(reason({ givesUnits: 1.5 })).toBe('units and times must be whole numbers')
    expect(reason({ times: -1 })).toBe('units and times must be whole numbers')
    world.buildings.find((b) => b.id === 's1')!.cityId = 'c2'
    expect(reason({})).toBe('not a finished storage of yours')
  })

  it('sets Coins aside just the same', () => {
    const { world, storage, queue } = setup()
    storage.stock!.coins = 30
    const offer = posted(world, queue, { gives: 'coins', givesUnits: 15, wants: 'wood' })
    expect(offer.times).toBe(2)
    expect(freeStock(world, storage).coins).toBeUndefined()
  })
})

describe('set-aside goods', () => {
  /** r1's resident w1 on the storage. */
  function own(world: WorldState) {
    const w = resident(world, 'w1', 'r1', 'c1', 6, 6)
    w.carried = {}
    return w
  }

  it('a pick-up of the storage’s own side leaves them alone', () => {
    const { world, storage, queue } = setup()
    const w = own(world)
    posted(world, queue, { times: 10 })
    expect(
      receive(world, queue, poster, {
        kind: 'pickUp',
        residentId: w.id,
        spot: { kind: 'storage', storageId: 's1' },
        goods: { wood: 5 },
      }),
    ).toMatchObject({ reason: 'those goods are set aside for an offer' })
    expect(storage.stock!.wood).toBe(100)
  })

  it('a Fetch gets only what is free', () => {
    const { world, storage, queue } = setup()
    const w = own(world)
    posted(world, queue, { times: 9 })
    receive(world, queue, poster, {
      kind: 'fetch',
      residentId: w.id,
      goods: { wood: 40 },
      from: 's1',
    })
    tick(world, queue, 2)
    expect(w.carried.wood).toBe(10)
    expect(storage.stock!.wood).toBe(90)
  })

  it('a Fetch by default skips a storage with nothing free of the goods', () => {
    const { world, queue } = setup()
    const w = own(world)
    world.buildings.push({
      id: 's2',
      kind: 'storage',
      cityId: 'c1',
      x: 30,
      y: 30,
      stock: { wood: 5 },
    })
    posted(world, queue, { times: 10 })
    receive(world, queue, poster, { kind: 'fetch', residentId: w.id, goods: { wood: 5 } })
    queue.applyAll(world)
    expect(w.order).toMatchObject({ kind: 'fetch', from: { storageId: 's2' } })
  })

  it('refills leave set-aside Food alone', () => {
    const { world, storage, queue } = setup()
    storage.stock = { food: 40, stone: 50 }
    const w = own(world)
    w.x = w.y = 7
    w.hunger = 100
    posted(world, queue, { gives: 'food', givesUnits: 40, times: 1 })
    tick(world)
    expect(w.carried.food ?? 0).toBe(0)
    expect(storage.stock.food).toBeGreaterThan(30)
    // Taken down, the Food is ordinary again and they refill from it.
    receive(world, queue, poster, { kind: 'takeDownOffer', offerId: world.offers[0]!.id })
    tick(world, queue)
    expect(w.carried.food).toBeGreaterThanOrEqual(HOME_FOOD_LOW)
  })

  it('a haul route loads only what is free', () => {
    const { world, storage, queue } = setup()
    posted(world, queue, { times: 9 })
    const h = own(world)
    const load: Stock = {}
    world.carriages.push({ id: 'k1', realmId: 'r1', cityId: null, x: 6, y: 6, load, horseId: null })
    h.order = {
      kind: 'haul',
      carriageId: 'k1',
      from: { x: 6, y: 6 },
      to: { x: 50, y: 50 },
      goods: ['wood'],
      returnGoods: [],
      keepFood: 0,
      stop: 'from',
      phase: 'loading',
      path: null,
      progress: 0,
    }
    tick(world, undefined, 30)
    expect(load.wood ?? 0).toBeLessThanOrEqual(10)
    expect(storage.stock!.wood! + (load.wood ?? 0) + (h.carried.wood ?? 0)).toBe(100)
    expect(storage.stock!.wood).toBeGreaterThanOrEqual(90)
  })

  it('a pick-up can’t be ordered of goods all set aside', () => {
    const { world, storage, city, realm, queue } = deliveries()
    const times = 4
    storage.stock = { stone: 40 }
    world.offers.push({
      id: 'o1',
      realmId: realm.id,
      storageId: storage.id,
      x: storage.x,
      y: storage.y,
      gives: 'stone',
      givesUnits: 10,
      wants: 'coins',
      wantsUnits: 1,
      times,
    })
    const sale = { kind: 'sell', good: 'stone', units: 30, cityId: city.id }
    expect(order(world, queue, sale)).toBe('none of that good to sell')
    world.offers = []
    expect(order(world, queue, sale)).toBe('ack')
  })

  it(
    'a caravan collecting a pick-up leaves them alone, and no theft comes of it',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, terrain: land, storage, city, realm, queue } = deliveries()
      const times = 1
      storage.stock = { stone: 40 }
      world.offers.push({
        id: 'o1',
        realmId: realm.id,
        storageId: storage.id,
        x: storage.x,
        y: storage.y,
        gives: 'stone',
        givesUnits: 10,
        wants: 'coins',
        wantsUnits: 1,
        times,
      })
      expect(order(world, queue, { kind: 'sell', good: 'stone', units: 40, cityId: city.id })).toBe(
        'ack',
      )
      const walking = new Walking(land)
      // The first tick orders the pick-up; then the caravan comes for it.
      for (let i = 0; i < 20_000 && (i === 0 || world.deliveries.length > 0); i++) {
        for (const r of world.residents) r.hunger = 100
        stepWorld(world, land, walking)
      }
      expect(world.deliveries).toEqual([])
      expect(eventsFor(world, 7).filter((e) => e.kind === 'delivered')).toHaveLength(1)
      expect(storage.stock.stone).toBe(10)
      expect(world.offers[0]?.times).toBe(1)
      expect(world.crimes).toEqual([])
      expect(checkInvariants(world, land)).toEqual([])
    },
  )

  it('a thief takes them like any others, cutting the offer down', () => {
    const { world, storage, t, queue } = setup()
    // Someone of the storage's realm sees it, so it is a known crime.
    Object.assign(
      world.residents.find((r) => r.id === 'a1')!,
      { x: 10, y: 6 },
    )
    const offer = posted(world, queue, { times: 5 })
    t.order = { kind: 'pickUp', from: { kind: 'storage', storageId: 's1' }, goods: { wood: 70 } }
    t.stats.strength = { base: 1000, trained: 0 }
    tick(world)
    expect(t.carried.wood).toBe(70)
    expect(storage.stock!.wood).toBe(30)
    expect(offer.times).toBe(3)
    expect(world.crimes).toHaveLength(1)
    expect(kinds(world, 7)).toContain('offerCutDown')
  })

  it('stolen below one time over, the offer ends and what is left is ordinary', () => {
    const { world, storage, t, queue } = setup()
    posted(world, queue, { times: 10 })
    t.order = { kind: 'pickUp', from: { kind: 'storage', storageId: 's1' }, goods: { wood: 95 } }
    t.stats.strength = { base: 1000, trained: 0 }
    tick(world)
    expect(world.offers).toEqual([])
    expect(freeStock(world, storage)).toEqual(storage.stock)
    expect(eventsFor(world, 7).find((e) => e.kind === 'offerEnded')).toMatchObject({
      why: 'goodsGone',
    })
  })

  it('goods gone cut the newest offer first', () => {
    const { world, storage, queue } = setup()
    const oldest = posted(world, queue, { times: 4 })
    const newest = posted(world, queue, { times: 4, wants: 'coins' })
    storage.stock!.wood = 50
    stepOffers(world)
    expect(oldest.times).toBe(4)
    expect(newest.times).toBe(1)
  })
})

describe('accepting an offer', () => {
  it('swaps the goods at the offer’s rate, in person, and raises standing both ways', () => {
    const { world, storage, t, queue } = setup()
    t.carried = { stone: 10 }
    const offer = posted(world, queue)
    expect(accept(world, queue, { offerId: offer.id })).toEqual({ type: 'ack', requestId: 'q' })
    tick(world, queue)
    expect(t.order).toBeNull()
    expect(t.carried).toEqual({ stone: 5, wood: 10 })
    expect(storage.stock).toEqual({ wood: 90, stone: 55 })
    expect(offer.times).toBe(1)
    // Goods for goods is a sale and a purchase at once, as a swap is: both goods count.
    const worth =
      (10 * WAREHOUSE_BASE_PRICE.wood + 5 * WAREHOUSE_BASE_PRICE.stone) /
      STANDING_TRADE_COINS_PER_POINT
    expect(standingOf(world, 'r1', 'r2')).toBeCloseTo(worth, 2)
    expect(standingOf(world, 'r2', 'r1')).toBeCloseTo(worth, 2)
    expect(eventsFor(world, 8).at(-1)).toMatchObject({ kind: 'offerAccepted', times: 1 })
    expect(kinds(world, 7)).toContain('offerTaken')
  })

  it('goes on being accepted, down to none, when the offer ends', () => {
    const { world, storage, t, queue } = setup()
    t.carried = { stone: 30 }
    t.stats.strength = { base: 1000, trained: 0 }
    const offer = posted(world, queue, { times: 3 })
    accept(world, queue, { offerId: offer.id, times: 2 })
    tick(world, queue)
    expect(offer.times).toBe(1)
    expect(setAsideAt(world, 's1')).toEqual({ wood: 10 })
    accept(world, queue, { offerId: offer.id })
    tick(world, queue)
    expect(world.offers).toEqual([])
    expect(t.carried).toEqual({ stone: 15, wood: 30 })
    expect(storage.stock).toEqual({ wood: 70, stone: 65 })
    expect(eventsFor(world, 7).find((e) => e.kind === 'offerEnded')).toMatchObject({
      why: 'usedUp',
    })
    expect(accept(world, queue, { offerId: offer.id })).toMatchObject({
      reason: 'that offer is gone',
    })
  })

  it('is cut down to what they can pay and what fits', () => {
    const { world, t, queue } = setup()
    t.carried = { stone: 15 }
    const offer = posted(world, queue, { times: 10 })
    accept(world, queue, { offerId: offer.id, times: 8 })
    tick(world, queue)
    expect(offer.times).toBe(7)
    expect(t.carried).toEqual({ wood: 30 })
    expect(eventsFor(world, 8).at(-1)).toMatchObject({ times: 3, wanted: 8 })
    const hands = { stock: { stone: 100 }, room: 25 * GOOD_WEIGHT.wood }
    const terms = {
      gives: 'wood',
      givesUnits: 10,
      wants: 'stone',
      wantsUnits: 1,
      times: 9,
    } as const
    expect(quoteOffer(terms, hands, 9).times).toBeLessThan(9)
    expect(quoteOffer(terms, hands, 9).limit).toBe('room')
    expect(quoteOffer(terms, { stock: {}, room: 100 }, 1)).toMatchObject({
      times: 0,
      limit: 'held',
    })
    expect(quoteOffer({ ...terms, wants: 'coins' }, { stock: {}, room: 100 }, 1).limit).toBe(
      'coins',
    )
    expect(quoteOffer(terms, hands, 1, 5)).toMatchObject({ times: 0, limit: 'stock' })
  })

  it('what they hand over makes room for what they take', () => {
    const terms = {
      gives: 'wood',
      givesUnits: 5,
      wants: 'stone',
      wantsUnits: 10,
      times: 4,
    } as const
    const quote = quoteOffer(terms, { stock: { stone: 40 }, room: 0 }, 4)
    expect(quote.times).toBe(GOOD_WEIGHT.wood * 5 <= GOOD_WEIGHT.stone * 10 ? 4 : 0)
  })

  it('takes Coins for goods, from a carriage on the tile', () => {
    const { world, storage, t, queue } = setup()
    t.carried = {}
    const load: Stock = { coins: 100 }
    world.carriages.push({ id: 'k1', realmId: 'r2', cityId: null, x: 6, y: 6, load, horseId: null })
    const offer = posted(world, queue, { wants: 'coins', wantsUnits: 25, times: 2 })
    accept(world, queue, { offerId: offer.id, times: 3, carriageId: 'k1' })
    tick(world, queue)
    expect(load).toEqual({ coins: 50, wood: 20 })
    expect(t.carried).toEqual({})
    expect(storage.stock!.coins).toBe(50)
    expect(world.offers).toEqual([])
    expect(standingOf(world, 'r1', 'r2')).toBeCloseTo(50 / STANDING_TRADE_COINS_PER_POINT, 2)
  })

  it('happens whether or not the Player is online: nothing of theirs takes part', () => {
    const { world, t, queue } = setup()
    t.carried = { stone: 5 }
    const offer = posted(world, queue, { times: 1 })
    // The poster is not in the tick at all: only the taker's order came.
    accept(world, queue, { offerId: offer.id })
    tick(world, queue)
    expect(t.carried.wood).toBe(10)
  })

  it('needs someone of another realm, there, with something to pay', () => {
    const { world, t, queue } = setup()
    const offer = posted(world, queue)
    const w = resident(world, 'w1', 'r1', 'c1', 6, 6)
    w.carried = { stone: 5 }
    const reason = (order: object, sender = taker) =>
      (accept(world, queue, { offerId: offer.id, ...order }, sender) as { reason?: string }).reason
    expect(reason({ residentId: 'w1' }, poster)).toBe('that offer is your own')
    expect(reason({ residentId: 'w1' })).toBe('not one of your residents')
    expect(reason({ offerId: 'o9' })).toBe('that offer is gone')
    t.carried = {}
    expect(reason({})).toBe('not enough to pay for it even once')
    t.carried = { stone: 5 }
    expect(reason({ times: 0 })).toBe('times must be a whole number')
    expect(reason({ carriageId: 'k9' })).toBe('not one of your carriages')
    t.x = 40
    expect(reason({})).toBe('not at that offer’s storage')
    t.x = 6
    t.bornAt = world.tick
    expect(reason({})).toBe('children can’t trade')
  })

  it('does nothing once they left the tile since the order came', () => {
    const { world, storage, t, queue } = setup()
    t.carried = { stone: 5 }
    const offer = posted(world, queue, { times: 1 })
    accept(world, queue, { offerId: offer.id })
    queue.applyAll(world)
    t.x = 40
    tick(world)
    expect(storage.stock!.wood).toBe(100)
    expect(t.order).toBeNull()
    expect(world.offers).toHaveLength(1)
  })

  it('two takers at one offer don’t lose or make goods', () => {
    const { world, storage, t, queue } = setup()
    t.carried = { stone: 10 }
    const u = resident(world, 'u1', 'r2', 'c2', 6, 6)
    u.carried = { stone: 10 }
    const offer = posted(world, queue, { times: 1 })
    accept(world, queue, { offerId: offer.id })
    accept(world, queue, { offerId: offer.id, residentId: 'u1' })
    tick(world, queue)
    expect((t.carried.wood ?? 0) + (u.carried.wood ?? 0)).toBe(10)
    expect((t.carried.stone ?? 0) + (u.carried.stone ?? 0)).toBe(15)
    expect(storage.stock).toEqual({ wood: 90, stone: 55 })
  })
})

describe('an offer ends', () => {
  it('when its Player takes it down, and the goods are ordinary again', () => {
    const { world, storage, queue } = setup()
    const offer = posted(world, queue)
    expect(
      receive(world, queue, taker, { kind: 'takeDownOffer', offerId: offer.id }),
    ).toMatchObject({ reason: 'not an offer of yours' })
    receive(world, queue, poster, { kind: 'takeDownOffer', offerId: offer.id })
    tick(world, queue)
    expect(world.offers).toEqual([])
    expect(freeStock(world, storage)).toEqual({ wood: 100, stone: 50 })
  })

  it('when its storage is torn down', () => {
    const { world, queue } = setup()
    posted(world, queue)
    world.buildings = world.buildings.filter((b) => b.id !== 's1')
    tick(world)
    expect(world.offers).toEqual([])
    expect(eventsFor(world, 7).find((e) => e.kind === 'offerEnded')).toMatchObject({
      why: 'storageLost',
    })
  })

  it('when its storage’s city is captured, its goods ordinary goods of the storage', () => {
    const { world, storage, queue } = setup()
    posted(world, queue)
    captureCity(
      world,
      world.cities.find((c) => c.id === 'c1')!,
      'r2',
      size,
    )
    tick(world)
    expect(world.offers).toEqual([])
    expect(storage.stock).toEqual({ wood: 100, stone: 50 })
    expect(freeStock(world, storage)).toEqual({ wood: 100, stone: 50 })
  })
})

describe('what can be seen of an offer', () => {
  it('anyone in sight sees it and its rate, not what the storage holds', () => {
    const { world, t, queue } = setup()
    const offer = posted(world, queue)
    t.x = 12
    t.y = 6
    const seen = entitiesInSight(world, terrain, 'r2').find((e) => e.id === 's1')
    expect(seen).toMatchObject({ is: 'building', offers: [{ id: offer.id, rate: 0.5, times: 2 }] })
    expect(seen).not.toHaveProperty('stock')
  })

  it('out of sight, nothing of it', () => {
    const { world, t, queue } = setup()
    posted(world, queue)
    t.x = 100
    t.y = 100
    expect(entitiesInSight(world, terrain, 'r2').find((e) => e.id === 's1')).toBeUndefined()
  })
})

describe('scripts and offers', () => {
  const script = (world: WorldState, source: string, sender: typeof poster, id: string) => {
    const memory: { answer?: unknown } = {}
    const realmId = world.realms.find((x) => x.userId === sender.userId)!.id
    const { globals, requests } = bindScript({
      world,
      terrain,
      sender,
      residentId: id,
      memory,
      seen: () => entitiesInSight(world, terrain, realmId),
      explored: () => true,
    })
    runScript(parse(source), {
      globals,
      steps: 10_000,
      maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
      limits: SCRIPT_VALUE_LIMITS,
    })
    return { memory, requests }
  }

  it('a script posts, and another realm’s script sees and accepts', () => {
    const { world, t, queue } = setup()
    t.carried = { stone: 5 }
    const w = resident(world, 'w1', 'r1', 'c1', 8, 6)
    const posting = script(
      world,
      'memory.answer = postOffer("s1", "wood", 10, "stone", 5, 1)',
      poster,
      w.id,
    )
    expect(posting.memory.answer).toBeNull()
    for (const request of posting.requests) queue.receive(world, poster, 'q', request)
    tick(world, queue)
    expect(world.offers).toHaveLength(1)
    const accepting = script(
      world,
      `let o = offers()[0]
       memory.answer = {rate: o.rate, gives: o.gives, onStorage: building(o.storageId).offers.length}
       acceptOffer(o.id, 1)`,
      taker,
      t.id,
    )
    expect(accepting.memory.answer).toEqual({ rate: 0.5, gives: 'wood', onStorage: 1 })
    for (const request of accepting.requests) queue.receive(world, taker, 'q', request)
    tick(world, queue)
    expect(t.carried).toEqual({ wood: 10 })
    expect(world.offers).toEqual([])
  })

  it('a script of its own realm sees only what isn’t set aside', () => {
    const { world, queue } = setup()
    const w = resident(world, 'w1', 'r1', 'c1', 8, 6)
    posted(world, queue, { times: 10 })
    const { memory } = script(
      world,
      `let s = building("s1")
       memory.answer = {
         wood: s.stock.wood,
         stone: s.stock.stone,
         offers: s.offers.length,
         woodIn: storages(me, ["wood"]).length,
         stoneIn: storages(me, ["stone"]).length,
       }`,
      poster,
      w.id,
    )
    expect(memory.answer).toEqual({ wood: null, stone: 50, offers: 1, woodIn: 0, stoneIn: 1 })
  })

  it('a script takes an offer down', () => {
    const { world, queue } = setup()
    const w = resident(world, 'w1', 'r1', 'c1', 8, 6)
    const offer = posted(world, queue)
    const { requests } = script(world, `takeDownOffer("${offer.id}")`, poster, w.id)
    for (const request of requests) queue.receive(world, poster, 'q', request)
    tick(world, queue)
    expect(world.offers).toEqual([])
  })

  it('the Build default leaves set-aside materials alone', () => {
    const { world, storage, queue } = setup()
    storage.stock = { wood: 1000, stone: 1000 }
    posted(world, queue, { times: 100 })
    posted(world, queue, { gives: 'stone', wants: 'wood', times: 200 })
    const b = resident(world, 'w1', 'r1', 'c1', 7, 7)
    b.script = { scriptId: 1, memory: { building: 'house', at: { x: 14, y: 14 } } }
    const host: ScriptHost = {
      script: () => ({
        userId: 7,
        name: DEFAULT_SCRIPTS.build.name,
        version: 1,
        source: DEFAULT_SCRIPTS.build.source,
        followsDefault: true,
      }),
      sender: () => poster,
      explored: () => true,
      defaultScript: () => undefined,
    }
    const runner = new ScriptRunner(terrain, host)
    const walking = new Walking(terrain)
    for (let i = 0; i < 40; i++) {
      for (const r of world.residents) r.hunger = 100
      runner.runAll(world)
      stepWorld(world, terrain, walking)
    }
    expect(storage.stock).toEqual({ wood: 1000, stone: 1000 })
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('offer invariants', () => {
  const broken = (world: WorldState) => offersSound.check(world, terrain).map((v) => v.message)

  it('set aside never exceeds what the storage holds', () => {
    const { world, storage, queue } = setup()
    posted(world, queue)
    expect(broken(world)).toEqual([])
    storage.stock!.wood = 15
    expect(broken(world)[0]).toMatch(/20 wood set aside where 15 are held/)
  })

  it('an offer’s storage exists and is its realm’s', () => {
    const { world, storage, queue } = setup()
    const offer = posted(world, queue)
    offer.realmId = 'r2'
    expect(broken(world)[0]).toMatch(/no finished storage of r2/)
    offer.realmId = 'r1'
    storage.site = { delivered: {}, work: 0 }
    expect(broken(world)[0]).toMatch(/no finished storage of r1/)
    delete storage.site
    world.buildings = world.buildings.filter((b) => b !== storage)
    expect(broken(world)[0]).toMatch(/no finished storage of r1/)
  })

  it('terms are whole and positive', () => {
    const { world, queue } = setup()
    const offer = posted(world, queue)
    offer.times = 0
    expect(broken(world)[0]).toMatch(/whole and positive/)
  })

  it('accepting an offer moves goods and makes none', () => {
    const { world, t, queue } = setup()
    t.carried = { stone: 5 }
    const offer = posted(world, queue, { times: 1 })
    accept(world, queue, { offerId: offer.id })
    tick(world, queue)
    expect(offersKeepGoods.check(world, terrain)).toEqual([])
    offersAcceptedIn(world)[0]!.after.wood = 1
    expect(offersKeepGoods.check(world, terrain)).toHaveLength(1)
  })
})
