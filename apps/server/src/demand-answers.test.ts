import {
  DEMAND_DECLINED_STANDING_LOSS,
  DEMAND_TRADE_ORG_STANDING_LOSS,
  DEMAND_YIELD_RESPECT_MIN,
  DEMAND_YIELD_RESPECT_TIMES,
  DIRECT_OFFER_DAYS,
  NPC_PLAN_TICKS,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  Terrain,
  citySoldiers,
  diplomacyFor,
  freeStock,
  npcOrgsKnownTo,
  respectSeenBy,
  standingOf,
  yieldsToDemand,
  type RealmEvent,
  type Remembered,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { answerDemands, demandsSound } from './demands.js'
import { checkInvariants } from './invariants.js'
import { planDue } from './npc-plan.js'
import { offersSound, stepOffers } from './offers.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'
import { Walking } from './walking.js'

const size = 128
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }

function resident(
  world: WorldState,
  id: string,
  owner: string | null,
  x: number,
  y: number,
  cityId: string | null = null,
) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** Places `n` armed residents of a realm in a line, starting at (x, y). */
function army(world: WorldState, n: number, x: number, y: number, owner = 'r1') {
  for (let i = 0; i < n; i++) {
    resident(world, `${owner}s${i}`, owner, x, y + i).carried.sword = 1
  }
}

/**
 * Realm r1 (Player 7) with Leader a1 at home in c1, far away, and realm r2 (Player 8). The NPC city
 * n1, Oakford, at (40, 40), where n1a lives, armed, and n1b, unarmed: in r1's memory, with a storage
 * holding goods. `armed` of r1's residents stand just outside it, in its sight.
 */
function setup({ armed = 0 } = {}) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1', name: 'Mara' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1', name: 'Tobin' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 5, y: 5 })
  const n1 = addCity(world, { id: 'n1', realmId: null, x: 40, y: 40, name: 'Oakford' })
  addCity(world, { id: 'post', realmId: null, x: 90, y: 90, name: 'Saltmarsh', tradeOrg: 'post' })
  resident(world, 'a1', 'r1', 5, 5, 'c1')
  resident(world, 'b1', 'r2', 100, 40)
  resident(world, 'n1a', null, 40, 40, 'n1').carried.spear = 1
  resident(world, 'n1b', null, 41, 40, 'n1')
  army(world, armed, 45, 40)
  world.buildings.push({
    id: 'n1s',
    kind: 'storage',
    cityId: 'n1',
    x: 48,
    y: 34,
    stock: { food: 40, iron: 3 },
  })
  world.lastSeen[7] = [
    { is: 'city', ...n1, x: 40, y: 40, seenAt: 0 } as unknown as Remembered,
    {
      is: 'city',
      id: 'post',
      name: 'Saltmarsh',
      realmId: null,
      tradeOrg: 'post',
      x: 90,
      y: 90,
      seenAt: 0,
    } as unknown as Remembered,
  ]
  return { world, n1, queue: new OrderQueue(undefined, terrain) }
}

const cityDemand = {
  kind: 'sendDemand',
  realmId: 'n1',
  terms: { kind: 'city', cityId: 'n1' },
  note: 'Open your gates.',
  days: 3,
}
const goodsDemand = { ...cityDemand, terms: { kind: 'goods', goods: { food: 5, stone: 2 } } }

/** Sends an order from Mara and applies it; the reason it was refused, if it was. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, mara, 'q', o)
  queue.applyAll(world)
  return answer.type === 'rejected' ? answer.reason : undefined
}

/** Steps demands until `who` answers, at its next planning pass. */
function untilAnswered(world: WorldState, who: string) {
  stepDemandsUntil(world, () => !world.demands.some((d) => d.toId === who))
}

function stepDemandsUntil(world: WorldState, done: () => boolean) {
  for (let i = 0; i <= NPC_PLAN_TICKS && !done(); i++) {
    answerDemands(world, size)
    expect(checkInvariants(world, terrain, [demandsSound])).toEqual([])
    if (!done()) world.tick++
  }
  expect(done()).toBe(true)
}

const logOf = (world: WorldState) =>
  world.events.filter(
    (e): e is Extract<RealmEvent, { kind: 'demand' }> => e.userId === 7 && e.kind === 'demand',
  )

describe('how much respect an NPC city yields to', () => {
  const needed = Math.max(DEMAND_YIELD_RESPECT_MIN, DEMAND_YIELD_RESPECT_TIMES)

  it('takes far more than its soldiers: more than persuading a city does', () => {
    const { world, n1 } = setup({ armed: needed - 1 })
    expect(citySoldiers(world, n1)).toBe(1)
    expect(yieldsToDemand(world, n1, 'r1', size)).toBe(false)
    resident(world, 'one-more', 'r1', 44, 40).carried.spear = 1
    expect(yieldsToDemand(world, n1, 'r1', size)).toBe(true)
  })

  it('grows with its soldiers', () => {
    const { world, n1 } = setup({ armed: DEMAND_YIELD_RESPECT_MIN })
    const soldiers = DEMAND_YIELD_RESPECT_MIN
    for (let i = 0; i < soldiers; i++) {
      resident(world, `guard${i}`, null, 39, 40 + i, 'n1').carried.spear = 1
    }
    expect(citySoldiers(world, n1)).toBe(soldiers + 1)
    expect(yieldsToDemand(world, n1, 'r1', size)).toBe(false)
  })

  it('is not one person with a spear, even where it has no soldiers', () => {
    const { world, n1 } = setup({ armed: 1 })
    world.residents.find((r) => r.id === 'n1a')!.carried = {}
    expect(citySoldiers(world, n1)).toBe(0)
    expect(yieldsToDemand(world, n1, 'r1', size)).toBe(false)
  })

  it('counts the sender’s walls in its sight too', () => {
    const { world, n1 } = setup({ armed: 1 })
    for (let i = 0; i < needed - 1; i++) {
      world.buildings.push({ id: `w${i}`, kind: 'wall', cityId: 'c1', x: 36, y: 40 + i })
    }
    expect(yieldsToDemand(world, n1, 'r1', size)).toBe(true)
  })
})

describe('a demand for an NPC city', () => {
  it('waits for the city’s planning pass, then an army in sight wins it', () => {
    const { world, n1, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    expect(order(world, queue, cityDemand)).toBeUndefined()
    expect(world.demands).toMatchObject([
      { fromId: 'r1', toId: 'n1', terms: { kind: 'city', cityId: 'n1', cityName: 'Oakford' } },
    ])
    expect(diplomacyFor(world, 'r1', []).demands[0]?.to).toEqual({
      realmId: 'n1',
      realm: 'Oakford',
      city: true,
    })
    // Not at once, unless it happens to plan this very tick.
    world.tick = 1
    while (planDue(world, n1)) world.tick++
    world.demands[0]!.sentAt = world.tick
    answerDemands(world, size)
    expect(world.demands).toHaveLength(1)
    expect(n1.realmId).toBeNull()

    untilAnswered(world, 'n1')
    expect(planDue(world, n1)).toBe(true)
    expect(n1.realmId).toBe('r1')
    expect(world.residents.filter((r) => r.cityId === 'n1').map((r) => r.owner)).toEqual([
      'r1',
      'r1',
    ])
    expect(logOf(world).at(-1)).toMatchObject({
      what: 'accepted',
      mine: true,
      other: 'Oakford',
      otherIs: 'city',
      terms: { kind: 'city', cityName: 'Oakford' },
    })
    expect(standingOf(world, 'n1', 'r1')).toBe(0)
  })

  it('forgets any ask of it to join when it joins', () => {
    const { world, n1, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    world.joinRequests.push({ cityId: 'n1', realmId: 'r1', at: 0, declined: false })
    order(world, queue, cityDemand)
    untilAnswered(world, 'n1')
    expect(n1.realmId).toBe('r1')
    expect(world.joinRequests).toEqual([])
  })

  it('is declined with too few in sight, and its standing drops', () => {
    const { world, n1, queue } = setup({ armed: 2 })
    order(world, queue, cityDemand)
    untilAnswered(world, 'n1')
    expect(n1.realmId).toBeNull()
    expect(standingOf(world, 'n1', 'r1')).toBe(-DEMAND_DECLINED_STANDING_LOSS)
    expect(logOf(world).at(-1)).toMatchObject({ what: 'declined', otherIs: 'city' })
  })

  it('doesn’t count armed residents out of its sight', () => {
    const { world, n1, queue } = setup()
    army(world, DEMAND_YIELD_RESPECT_MIN + 5, 42 + SIGHT_RANGE, 40)
    expect(respectSeenBy(world, n1, 'r1', size)).toBe(0)
    order(world, queue, cityDemand)
    untilAnswered(world, 'n1')
    expect(n1.realmId).toBeNull()
    expect(standingOf(world, 'n1', 'r1')).toBe(-DEMAND_DECLINED_STANDING_LOSS)
  })

  it('lapses, with no standing lost, when the city joins a realm before it answers', () => {
    const { world, n1, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    order(world, queue, cityDemand)
    n1.realmId = 'r2'
    answerDemands(world, size)
    expect(world.demands).toEqual([])
    expect(n1.realmId).toBe('r2')
    expect(logOf(world).at(-1)).toMatchObject({ what: 'lapsed', otherIs: 'city' })
    expect(standingOf(world, 'n1', 'r1')).toBe(0)
  })

  it('names only the city itself', () => {
    const { world, queue } = setup()
    const terms = { kind: 'city', cityId: 'c1' }
    expect(order(world, queue, { ...cityDemand, terms })).toBe(
      'an NPC city can only hand over itself',
    )
  })

  it('can’t be answered by a Player', () => {
    const { world, queue } = setup({ armed: 2 })
    order(world, queue, cityDemand)
    const demandId = world.demands[0]!.id
    expect(order(world, queue, { kind: 'declineDemand', demandId })).toBe(
      'only the realm it was sent to can answer it',
    )
  })
})

describe('a demand for goods of an NPC city', () => {
  it('sets them aside at its storage for the sender alone, as far as it holds them', () => {
    const { world, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    order(world, queue, goodsDemand)
    untilAnswered(world, 'n1')
    expect(world.offers).toMatchObject([
      {
        realmId: 'n1',
        storageId: 'n1s',
        gives: 'food',
        givesUnits: 1,
        wantsUnits: 0,
        times: 5,
        direct: {
          toId: 'r1',
          lapsesAt: world.tick + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY,
        },
      },
    ])
    const storage = world.buildings.find((b) => b.id === 'n1s')!
    expect(freeStock(world, storage).food).toBe(35)
    expect(logOf(world).at(-1)).toMatchObject({
      what: 'accepted',
      otherIs: 'city',
      handedOver: { way: 'setAside', goods: { food: 5 }, x: 48, y: 34 },
    })
    expect(checkInvariants(world, terrain, [offersSound])).toEqual([])
    // It stands through the world's step that looks after offers.
    stepOffers(world)
    expect(world.offers).toHaveLength(1)
    expect(diplomacyFor(world, 'r1', []).directOffers[0]).toMatchObject({
      from: { realmId: 'n1', realm: 'Oakford', city: true },
      to: { realmId: 'r1' },
    })
    expect(checkInvariants(world, terrain, [offersSound, demandsSound])).toEqual([])
  })

  it('declines with none of them there, and its standing drops', () => {
    const { world, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    const terms = { kind: 'goods', goods: { stone: 2 } }
    order(world, queue, { ...goodsDemand, terms })
    untilAnswered(world, 'n1')
    expect(world.offers).toEqual([])
    expect(standingOf(world, 'n1', 'r1')).toBe(-DEMAND_DECLINED_STANDING_LOSS)
    expect(logOf(world).at(-1)).toMatchObject({ what: 'declined' })
  })

  it('is declined with too few in sight, and nothing is set aside', () => {
    const { world, queue } = setup({ armed: 1 })
    order(world, queue, goodsDemand)
    untilAnswered(world, 'n1')
    expect(world.offers).toEqual([])
    expect(standingOf(world, 'n1', 'r1')).toBe(-DEMAND_DECLINED_STANDING_LOSS)
  })

  it('ends what was set aside when the city joins a realm', () => {
    const { world, n1, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    order(world, queue, goodsDemand)
    untilAnswered(world, 'n1')
    n1.realmId = 'r2'
    stepOffers(world)
    expect(world.offers).toEqual([])
    expect(world.events.at(-1)).toMatchObject({
      kind: 'directOffer',
      what: 'storageLost',
      from: 'Oakford',
      fromCity: true,
    })
  })

})

describe('over ticks of the whole world', () => {
  const run = (world: WorldState) => {
    const walking = new Walking(terrain)
    for (let i = 0; i <= NPC_PLAN_TICKS; i++) {
      stepWorld(world, terrain, walking)
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(world.demands).toEqual([])
  }

  it('hands over a city and holds together', () => {
    const { world, n1, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    order(world, queue, cityDemand)
    run(world)
    expect(n1.realmId).toBe('r1')
  })

  it('sets goods aside and holds together', () => {
    const { world, n1, queue } = setup({ armed: DEMAND_YIELD_RESPECT_MIN + 5 })
    order(world, queue, goodsDemand)
    run(world)
    expect(n1.realmId).toBeNull()
    expect(world.offers).toMatchObject([{ realmId: 'n1', gives: 'food', times: 5 }])
  })

  it('declines and holds together', () => {
    const { world, n1, queue } = setup({ armed: 1 })
    order(world, queue, { ...goodsDemand, realmId: TRADE_ORG })
    order(world, queue, cityDemand)
    run(world)
    expect(n1.realmId).toBeNull()
    expect(standingOf(world, 'n1', 'r1')).toBeLessThan(0)
    expect(standingOf(world, TRADE_ORG, 'r1')).toBeLessThan(0)
  })
})

describe('a demand to the Trade Organization', () => {
  const goods = { ...goodsDemand, realmId: TRADE_ORG }

  it('is always declined, however big the army, and being asked costs standing', () => {
    const { world, queue } = setup()
    army(world, 30, 92, 88)
    expect(order(world, queue, goods)).toBeUndefined()
    expect(world.demands[0]).toMatchObject({ toId: TRADE_ORG })
    untilAnswered(world, TRADE_ORG)
    expect(standingOf(world, TRADE_ORG, 'r1')).toBe(-DEMAND_TRADE_ORG_STANDING_LOSS)
    expect(logOf(world).at(-1)).toMatchObject({
      what: 'declined',
      other: 'the Trade Organization',
      otherIs: 'tradeOrg',
    })
    expect(world.offers).toEqual([])
  })

  it('takes a trading post’s id for the Trade Organization, and can name a post', () => {
    const { world, queue } = setup()
    const terms = { kind: 'city', cityId: 'post' }
    expect(order(world, queue, { ...goods, realmId: 'post', terms })).toBeUndefined()
    expect(world.demands[0]).toMatchObject({
      toId: TRADE_ORG,
      terms: { cityId: 'post', cityName: 'Saltmarsh' },
    })
    untilAnswered(world, TRADE_ORG)
    expect(world.cities.find((c) => c.id === 'post')).toMatchObject({ tradeOrg: 'post' })
  })

  it('names only its own cities', () => {
    const { world, queue } = setup()
    const terms = { kind: 'city', cityId: 'n1' }
    expect(order(world, queue, { ...goods, terms })).toBe(
      'as far as you know, that city isn’t theirs',
    )
  })
})

describe('whom a Player can send one to', () => {
  it('knows of the Trade Organization always, and an NPC city as of a realm', () => {
    const { world } = setup()
    expect(npcOrgsKnownTo(world, 'r2', [])).toEqual([TRADE_ORG])
    // Seen now, last seen, or by a standing either way.
    expect(npcOrgsKnownTo(world, 'r2', ['n1', 'r1', 'c1', 'post'])).toEqual([TRADE_ORG, 'n1'])
    expect(npcOrgsKnownTo(world, 'r1', [])).toEqual([TRADE_ORG, 'n1'])
    world.standings.push({ of: 'n1', toward: 'r2', value: -3 })
    expect(npcOrgsKnownTo(world, 'r2', [])).toEqual([TRADE_ORG, 'n1'])
    expect(diplomacyFor(world, 'r2', []).knownNpcOrgs).toEqual([
      { realmId: TRADE_ORG, realm: 'the Trade Organization' },
      { realmId: 'n1', realm: 'Oakford', city: true },
    ])
    // NPC cities aren't realms to send a Direct offer.
    expect(diplomacyFor(world, 'r2', []).directOfferRealms).toEqual([])
  })

  it('refuses an NPC city they don’t know of', () => {
    const { world, queue } = setup()
    addCity(world, { id: 'n2', realmId: null, x: 70, y: 70, name: 'Elsewhere' })
    expect(order(world, queue, { ...cityDemand, realmId: 'n2' })).toBe(
      'you don’t know of that realm',
    )
    expect(world.demands).toEqual([])
  })

  it('counts against what a realm can send, as any demand does', () => {
    const { world, queue } = setup()
    const r1 = world.realms.find((r) => r.id === 'r1')!
    r1.demandsSentAt = [world.tick, world.tick, world.tick]
    expect(order(world, queue, cityDemand)).toMatch(/at most/)
  })
})

describe('its invariant', () => {
  it('catches a demand the game has left unanswered too long', () => {
    const { world, queue } = setup({ armed: 1 })
    order(world, queue, goodsDemand)
    world.tick += NPC_PLAN_TICKS + 1
    expect(checkInvariants(world, terrain, [demandsSound])[0]?.message).toMatch(
      /waited longer than a planning pass/,
    )
  })

  it('still catches a demand to a realm that is gone', () => {
    const { world } = setup()
    world.demands.push({
      id: 'd1',
      fromId: 'r1',
      toId: 'nobody',
      terms: { kind: 'goods', goods: { food: 1 } },
      note: 'Food',
      sentAt: 0,
      deadline: 100,
    })
    expect(checkInvariants(world, terrain, [demandsSound])[0]?.message).toMatch(/does not exist/)
  })
})
