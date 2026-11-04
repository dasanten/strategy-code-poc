import {
  DIRECT_OFFERS_TO_ONE_REALM,
  DIRECT_OFFER_DAYS,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  Terrain,
  diplomacyFor,
  freeStock,
  offerOpenTo,
  realmsToOfferTo,
  type Building,
  type Offer,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { eventsFor } from './events.js'
import { checkInvariants } from './invariants.js'
import { offersSound, resolveOffers, stepOffers } from './offers.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const size = 128
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }

const sender = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const named = { userId: 8, account: { name: 'Bo', isAdmin: false } }
const other = { userId: 9, account: { name: 'Wren', isAdmin: false } }

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
  r.carried = { food: OWN_FOOD, stone: 20 }
  world.residents.push(r)
  return r
}

/**
 * Realm r1 with storage s1 at (6, 6) holding 100 Wood. Realm r2, which r1 has a standing with, has
 * resident t2 on the storage and its city far off. Realm r3 has t3 on the storage too, and r1 sees
 * it there. An NPC city n1 lies far off.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  world.realms.push({ id: 'r3', userId: 9, leaderId: 'c1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10, name: 'Oakford' })
  addCity(world, { id: 'c2', realmId: 'r2', x: 90, y: 90, name: 'Brook' })
  const storage: Building = {
    id: 's1',
    kind: 'storage',
    cityId: 'c1',
    x: 6,
    y: 6,
    stock: { wood: 100 },
  }
  world.buildings.push(storage)
  world.standings.push({ of: 'r1', toward: 'r2', value: 1 })
  resident(world, 'a1', 'r1', 'c1', 8, 8)
  resident(world, 'b1', 'r2', 'c2', 100, 100)
  resident(world, 'c1', 'r3', null, 110, 110)
  const t2 = resident(world, 't2', 'r2', 'c2', 6, 6)
  resident(world, 't3', 'r3', null, 6, 6)
  return { world, storage, t2, queue: new OrderQueue(undefined, terrain) }
}

const offerTerms = {
  storageId: 's1',
  gives: 'wood',
  givesUnits: 10,
  wants: 'stone',
  wantsUnits: 5,
  times: 2,
}

/** The answer to sending `toId` a Direct offer, unless the terms say otherwise. */
const send = (world: WorldState, queue: OrderQueue, terms: object = {}, from = sender) =>
  queue.receive(world, from, 'q', { kind: 'sendDirectOffer', toId: 'r2', ...offerTerms, ...terms })

/** The offer once sent to r2. */
function sent(world: WorldState, queue: OrderQueue): Offer {
  expect(send(world, queue)).toEqual({ type: 'ack', requestId: 'q' })
  queue.applyAll(world)
  return world.offers.at(-1)!
}

const reason = (answer: unknown) => (answer as { reason?: string }).reason

const last = (world: WorldState, userId: number) => eventsFor(world, userId).at(-1)

/** Steps the world, every invariant holding after each tick. */
function tick(world: WorldState, queue: OrderQueue, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    queue.applyAll(world)
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain)).toEqual([])
  }
}

describe('sending a direct offer', () => {
  it('sets the goods aside at the named storage, and the other side sees it at once', () => {
    const { world, storage, queue } = setup()
    const offer = sent(world, queue)
    expect(offer).toMatchObject({
      realmId: 'r1',
      storageId: 's1',
      times: 2,
      direct: { toId: 'r2', lapsesAt: world.tick + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY },
    })
    expect(freeStock(world, storage)).toEqual({ wood: 80 })
    expect(last(world, 8)).toMatchObject({ kind: 'directOffer', what: 'received', times: 2 })
    expect(diplomacyFor(world, 'r2', []).directOffers).toEqual([
      expect.objectContaining({
        id: offer.id,
        x: 6,
        y: 6,
        city: 'Oakford',
        rate: 0.5,
        from: { realmId: 'r1', realm: expect.any(String) },
        to: { realmId: 'r2', realm: expect.any(String) },
      }),
    ])
    expect(diplomacyFor(world, 'r1', []).directOffers.map((o) => o.id)).toEqual([offer.id])
    expect(diplomacyFor(world, 'r3', []).directOffers).toEqual([])
    tick(world, queue)
    expect(world.offers).toHaveLength(1)
  })

  it('goes only to another realm its sender knows of', () => {
    const { world, queue } = setup()
    expect(reason(send(world, queue, { toId: 'r1' }))).toMatch(/another realm/)
    expect(reason(send(world, queue, { toId: 'nobody' }))).toMatch(/to a realm/)
    expect(reason(send(world, queue, { toId: 'n1' }))).toMatch(/to a realm/)
    // r3's t3 stands on r1's storage, in r1's sight, though r1 knows of it no other way.
    expect(realmsToOfferTo(world, 'r1', [])).toEqual(['r2'])
    expect(send(world, queue, { toId: 'r3' })).toMatchObject({ type: 'ack' })
    world.residents = world.residents.filter((r) => r.owner !== 'r3')
    expect(reason(send(world, queue, { toId: 'r3' }))).toBe('you don’t know of that realm')
  })

  it('needs an offer that could be posted, at a storage of the sender', () => {
    const { world, queue } = setup()
    expect(reason(send(world, queue, { storageId: 'c1-hall' }))).toMatch(/storage of yours/)
    expect(reason(send(world, queue, { gives: 'stone' }))).toMatch(/different good/)
    expect(reason(send(world, queue, { times: 0 }))).toMatch(/whole numbers/)
    expect(reason(send(world, queue, { givesUnits: 500 }))).toMatch(/not enough/)
    expect(reason(send(world, queue, {}, named))).toMatch(/another realm|storage of yours/)
  })

  it('can stand only so many times to one realm', () => {
    const { world, queue } = setup()
    for (let i = 0; i < DIRECT_OFFERS_TO_ONE_REALM; i++) {
      expect(send(world, queue, { givesUnits: 1, times: 1 })).toMatchObject({ type: 'ack' })
      queue.applyAll(world)
    }
    expect(reason(send(world, queue, { givesUnits: 1, times: 1 }))).toMatch(/at most/)
  })
})

describe('accepting a direct offer', () => {
  const accept = (world: WorldState, queue: OrderQueue, residentId: string, offerId: string) =>
    queue.receive(world, residentId === 't2' ? named : other, 'q', {
      kind: 'acceptOffer',
      residentId,
      offerId,
      times: 1,
    })

  it('takes the named realm’s resident on the storage, and the sender hears', () => {
    const { world, storage, t2, queue } = setup()
    const offer = sent(world, queue)
    expect(accept(world, queue, 't2', offer.id)).toMatchObject({ type: 'ack' })
    tick(world, queue)
    expect(t2.carried).toMatchObject({ wood: 10, stone: 15 })
    expect(storage.stock).toEqual({ wood: 90, stone: 5 })
    expect(offer.times).toBe(1)
    expect(eventsFor(world, 7).map((e) => e.kind)).toContain('offerTaken')
  })

  it('tells only the sender once it is used up', () => {
    const { world, queue } = setup()
    const offer = sent(world, queue)
    offer.times = 1
    accept(world, queue, 't2', offer.id)
    tick(world, queue)
    expect(world.offers).toEqual([])
    expect(last(world, 7)).toMatchObject({
      kind: 'offerEnded',
      why: 'usedUp',
      to: expect.any(String),
    })
    expect(eventsFor(world, 8).filter((e) => e.kind === 'directOffer')).toHaveLength(1)
  })

  it('refuses anyone else, even standing on the storage with the goods to pay', () => {
    const { world, storage, queue } = setup()
    const offer = sent(world, queue)
    expect(reason(accept(world, queue, 't3', offer.id))).toBe('that offer is for another realm')
    expect(offerOpenTo(offer, 'r3')).toBe(false)
    expect(offerOpenTo(offer, 'r2')).toBe(true)
    const t3 = world.residents.find((r) => r.id === 't3')!
    // An order given before the check can't get round it either.
    t3.order = { kind: 'acceptOffer', offerId: offer.id, times: 1, carriageId: null }
    expect(resolveOffers(world)).toBe(0)
    expect(storage.stock).toEqual({ wood: 100 })
    expect(offer.times).toBe(2)
  })
})

describe('a direct offer ends', () => {
  it('when declined by the realm it was sent to, and the sender hears', () => {
    const { world, storage, queue } = setup()
    const offer = sent(world, queue)
    const decline = { kind: 'declineOffer', offerId: offer.id }
    expect(reason(queue.receive(world, other, 'q', decline))).toMatch(/wasn’t sent to you/)
    expect(reason(queue.receive(world, sender, 'q', decline))).toMatch(/wasn’t sent to you/)
    expect(queue.receive(world, named, 'q', decline)).toMatchObject({ type: 'ack' })
    tick(world, queue)
    expect(world.offers).toEqual([])
    expect(freeStock(world, storage)).toEqual({ wood: 100 })
    expect(last(world, 7)).toMatchObject({
      kind: 'offerEnded',
      why: 'declined',
      to: expect.any(String),
    })
    expect(last(world, 8)).toMatchObject({ kind: 'directOffer', what: 'declined' })
    expect(reason(queue.receive(world, named, 'q', decline))).toBe('that offer is gone')
  })

  it('an offer to anyone can’t be declined', () => {
    const { world, queue } = setup()
    queue.receive(world, sender, 'q', { kind: 'postOffer', ...offerTerms })
    queue.applyAll(world)
    const decline = { kind: 'declineOffer', offerId: world.offers[0]!.id }
    expect(reason(queue.receive(world, named, 'q', decline))).toMatch(/wasn’t sent to you/)
  })

  it('when it lapses, its goods ordinary again and both sides told', () => {
    const { world, storage, queue } = setup()
    const offer = sent(world, queue)
    offer.direct!.lapsesAt = world.tick + 2
    tick(world, queue)
    expect(world.offers).toHaveLength(1)
    tick(world, queue)
    expect(world.offers).toEqual([])
    expect(freeStock(world, storage)).toEqual({ wood: 100 })
    expect(last(world, 7)).toMatchObject({ kind: 'offerEnded', why: 'lapsed' })
    expect(last(world, 8)).toMatchObject({ kind: 'directOffer', what: 'lapsed' })
  })

  it('when the sender takes it down, and the other side hears', () => {
    const { world, queue } = setup()
    const offer = sent(world, queue)
    queue.receive(world, sender, 'q', { kind: 'takeDownOffer', offerId: offer.id })
    tick(world, queue)
    expect(world.offers).toEqual([])
    expect(last(world, 8)).toMatchObject({ kind: 'directOffer', what: 'takenDown' })
  })

  it('when the storage is lost or the goods gone, and the other side hears', () => {
    const { world, storage, queue } = setup()
    sent(world, queue)
    delete storage.stock
    stepOffers(world)
    expect(world.offers).toEqual([])
    expect(last(world, 8)).toMatchObject({ kind: 'directOffer', what: 'goodsGone' })
    storage.stock = { wood: 100 }
    sent(world, queue)
    world.buildings = world.buildings.filter((b) => b !== storage)
    stepOffers(world)
    expect(world.offers).toEqual([])
    expect(last(world, 8)).toMatchObject({ kind: 'directOffer', what: 'storageLost' })
  })

  it('when the realm it was sent to is gone, for nobody else can accept it', () => {
    const { world, queue } = setup()
    sent(world, queue)
    world.realms = world.realms.filter((r) => r.id !== 'r2')
    stepOffers(world)
    expect(world.offers).toEqual([])
    expect(last(world, 7)).toMatchObject({ kind: 'offerEnded', why: 'lapsed' })
  })
})

describe('offers-sound on direct offers', () => {
  it('flags one sent to its own realm, or outliving its time', () => {
    const { world, queue } = setup()
    const offer = sent(world, queue)
    expect(offersSound.check(world, terrain)).toEqual([])
    offer.direct!.toId = 'r1'
    expect(offersSound.check(world, terrain)).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/own realm/) }),
    ])
    offer.direct = { toId: 'r2', lapsesAt: world.tick }
    expect(offersSound.check(world, terrain)).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/outlived/) }),
    ])
  })
})
