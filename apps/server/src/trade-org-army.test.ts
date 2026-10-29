import {
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  TRADE_ORG_HQ,
  Terrain,
  commanderOf,
  inInnerRing,
  isArmed,
  middleOf,
  townHallOf,
  wrapDistance,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { hqSoldiers, soldiersLacking, spareSoldiers, tradeOrgArmySound } from './trade-org-army.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 640, tiles: new Uint8Array(640 * 640).fill(Terrain.Plains) }
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** Where the HQ's town hall stands. */
const MID = 320

/**
 * The Trade Org HQ at (MID, MID) with a trading post p at (20, 20) and its warehouse w at
 * (23, 20); realm r1 (Player 7, Leader a1) with city c1 at (20, 140), its storage s1 at
 * (23, 140) and its resident b1 there.
 */
function setup() {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  const post = addCity(world, { id: 'p', realmId: null, x: 20, y: 20 })
  post.tradeOrg = 'post'
  world.buildings.push({ id: 'w', kind: 'warehouse', cityId: 'p', x: 23, y: 20, stock: {} })
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 20, y: 140 })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: 23, y: 140, stock: {} })
  resident(world, 'a1', 20, 141, 'c1')
  resident(world, 'b1', 23, 141, 'c1')
  return { world, hq, queue: new OrderQueue(undefined, terrain), walking: new Walking(terrain) }
}

/** A grown resident of realm r1. */
function resident(world: WorldState, id: string, x: number, y: number, cityId: string | null) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
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

/** The HQ's own residents. */
const hqPeople = (world: WorldState, hq: City) =>
  world.residents.filter((r) => r.owner === null && r.cityId === hq.id)

/** Arms the first `n` of the HQ's residents with a spear each. */
function arm(world: WorldState, hq: City, n: number): Resident[] {
  const armed = hqPeople(world, hq).slice(0, n)
  for (const r of armed) r.carried.spear = 1
  return armed
}

/** Sends an order from the Player, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, player, 'q', { kind: 'x', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world, keeping everyone fed, and checks every invariant now and then. */
function run(world: WorldState, walking: Walking, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    if (i % 200 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

const at = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

describe('the Trade Org army', () => {
  it(
    'is built by the HQ from its own adults and its goods warehouse',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, hq, walking } = setup()
      const goods = world.buildings.find((b) => b.cityId === hq.id && b.stock?.wood !== undefined)!
      goods.stock!.spear = 20
      run(
        world,
        walking,
        8 * TICKS_PER_GAME_DAY,
        () => hqSoldiers(world).length >= TRADE_ORG_ARMY.size,
      )
      expect(hqSoldiers(world)).toHaveLength(TRADE_ORG_ARMY.size)
      // It keeps enough at work: none of its soldiers works, and the rest still do.
      const unarmed = hqPeople(world, hq).filter((r) => !isArmed(r))
      expect(unarmed.length).toBeGreaterThanOrEqual(TRADE_ORG_ARMY.workers)
      for (const r of hqSoldiers(world)) expect(r.order?.kind).not.toBe('workAt')
    },
  )

  it('arms no more than it can while keeping its workers', () => {
    const { world, hq, walking } = setup()
    const goods = world.buildings.find((b) => b.cityId === hq.id && b.stock?.wood !== undefined)!
    goods.stock!.spear = 20
    // Only a few more adults than its workers are left.
    const keep = new Set(
      hqPeople(world, hq)
        .slice(0, TRADE_ORG_ARMY.workers + 3)
        .map((r) => r.id),
    )
    world.residents = world.residents.filter((r) => r.cityId !== hq.id || keep.has(r.id))
    run(world, walking, TICKS_PER_GAME_DAY)
    expect(hqSoldiers(world)).toHaveLength(3)
  }, 120_000)
})

describe('hiring the Trade Org army', () => {
  /** The HQ with 12 soldiers, 4 of them more than its guard, and b1 carrying coins at w. */
  function hireable() {
    const s = setup()
    arm(s.world, s.hq, TRADE_ORG_ARMY.guard + 4)
    const b1 = at(s.world, 'b1')
    b1.x = 23
    b1.y = 20
    b1.carried.coins = 200
    return s
  }

  const ask = (soldiers: number, pricePerWeek: number) => ({
    kind: 'offerContract',
    realmId: TRADE_ORG,
    soldiers,
    days: 7,
    pricePerWeek,
    storageId: 'w',
  })

  it('hires out its spare soldiers at its price, paid at a warehouse', () => {
    const { world, queue, walking } = hireable()
    expect(spareSoldiers(world)).toHaveLength(4)
    const price = 2 * TRADE_ORG_ARMY.pricePerSoldierWeek
    expect(order(world, queue, ask(2, price))).toBe('ack')
    run(world, walking, 1)
    const c = world.contracts[0]!
    expect(c).toMatchObject({ lenderId: TRADE_ORG, hirerId: 'r1', pricePerWeek: price })
    expect(c.startedAt).not.toBeNull()
    // The Player now gives its soldiers orders; the HQ leaves them be.
    for (const id of c.residentIds) expect(commanderOf(world, at(world, id))).toBe('r1')
    expect(
      order(world, queue, { kind: 'walkTo', residentId: c.residentIds[0], x: 40, y: 40 }),
    ).toBe('ack')
    // b1 pays the first week into the warehouse.
    expect(order(world, queue, { kind: 'pay', residentId: 'b1', contractId: c.id, weeks: 1 })).toBe(
      'ack',
    )
    run(world, walking, 1)
    expect(world.buildings.find((b) => b.id === 'w')!.stock!.coins).toBe(price)
    expect(c.paidWeeks).toBe(1)
    expect(at(world, c.residentIds[0]!).order?.kind).toBe('walkTo')
    const log = world.events.filter((e) => e.kind === 'contract').map((e) => e.what)
    expect(log).toEqual(['started', 'paid'])
  })

  it('declines a price below its own', () => {
    const { world, queue, walking } = hireable()
    expect(order(world, queue, ask(2, 2 * TRADE_ORG_ARMY.pricePerSoldierWeek - 1))).toBe('ack')
    run(world, walking, 1)
    expect(world.contracts).toEqual([])
    expect(world.events.at(-1)).toMatchObject({ kind: 'contract', what: 'declined', residents: 2 })
  })

  it('never hires out its guard', () => {
    const { world, queue } = hireable()
    expect(order(world, queue, ask(5, 5 * TRADE_ORG_ARMY.pricePerSoldierWeek))).toBe(
      'the Trade Organization can spare only 4 soldiers',
    )
    expect(order(world, queue, { ...ask(1, 100), storageId: 's1' })).toBe(
      'the coins go into a warehouse of the Trade Organization',
    )
  })

  it('takes no offer of residents from a Player', () => {
    const { world, queue } = hireable()
    expect(
      order(world, queue, {
        kind: 'offerContract',
        residentIds: ['b1'],
        realmId: TRADE_ORG,
        days: 7,
        pricePerWeek: 50,
        storageId: 's1',
      }),
    ).toBe('the Trade Organization hires only by its own offers')
  })
})

describe('guarding the inner ring', () => {
  it('keeps everyone out of the HQ’s inner ring, by force and without a crime', () => {
    const { world, hq, walking } = setup()
    arm(world, hq, 12)
    const hall = townHallOf(world, hq)!
    // An unarmed resident of the Player slipped in next to the town hall.
    const b1 = at(world, 'b1')
    b1.x = hall.x
    b1.y = hall.y + 2
    expect(inInnerRing(world, b1, terrain.size)).toBe(true)
    run(world, walking, TICKS_PER_GAME_DAY, () => !world.residents.some((r) => r.id === 'b1'))
    expect(world.residents.some((r) => r.id === 'b1')).toBe(false)
    expect(world.crimes.filter((c) => c.culprit.org === hq.id)).toEqual([])
    // Its inner gates stayed closed all along.
    const gates = world.buildings.filter(
      (b) =>
        b.kind === 'gate' &&
        b.cityId === hq.id &&
        wrapDistance(terrain.size, middleOf(hall), b) <= TRADE_ORG_HQ.innerRadius + 1,
    )
    expect(gates).toHaveLength(TRADE_ORG_HQ.gates)
    for (const g of gates) expect(g.closed).toBe(true)
  }, 120_000)
})

describe('the Trade Organization hiring mercenaries', () => {
  /** The HQ down to its workers and two adults to arm, and r1 with armed m1 and m2 near it. */
  function weakened() {
    const s = setup()
    const keep = new Set(
      hqPeople(s.world, s.hq)
        .slice(0, TRADE_ORG_ARMY.workers + 2)
        .map((r) => r.id),
    )
    s.world.residents = s.world.residents.filter((r) => r.cityId !== s.hq.id || keep.has(r.id))
    resident(s.world, 'm1', MID - 80, MID, null).carried.spear = 1
    resident(s.world, 'm2', MID - 84, MID, null).carried.spear = 1
    resident(s.world, 'm3', 20, 139, 'c1').carried.spear = 1
    at(s.world, 'a1').carried.spear = 1
    s.world.tick = TICKS_PER_GAME_DAY
    return s
  }

  it('hires mercenaries itself after heavy losses', () => {
    const { world, hq, queue, walking } = weakened()
    expect(soldiersLacking(world, hq)).toBe(TRADE_ORG_ARMY.size - 2)
    run(world, walking, 1)
    const c = world.contracts[0]!
    // It asks for the realm's armed residents nearest it, never its Leader.
    expect(c).toMatchObject({
      lenderId: 'r1',
      hirerId: TRADE_ORG,
      offeredBy: 'hirer',
      residentIds: ['m1', 'm2', 'm3'],
      days: TRADE_ORG_ARMY.hireDays,
      pricePerWeek: 3 * TRADE_ORG_ARMY.hirePricePerSoldierWeek,
      storageId: 's1',
    })
    expect(world.events.at(-1)).toMatchObject({ what: 'offered', lender: true })
    // Asked once: the next day it waits for the answer.
    run(world, walking, TICKS_PER_GAME_DAY)
    expect(world.contracts).toHaveLength(1)

    expect(order(world, queue, { kind: 'acceptContract', contractId: c.id })).toBe('ack')
    const bank = world.buildings.find((b) => b.cityId === hq.id && b.stock?.coins !== undefined)!
    const before = bank.stock!.coins!
    run(world, walking, 1)
    // It pays the first week from its coin warehouse straight into the storage.
    expect(c.paidWeeks).toBe(1)
    expect(world.buildings.find((b) => b.id === 's1')!.stock!.coins).toBe(c.pricePerWeek)
    expect(bank.stock!.coins).toBe(before - c.pricePerWeek)
    for (const id of c.residentIds) expect(commanderOf(world, at(world, id))).toBe(TRADE_ORG)
    // Its mercenaries walk to the HQ and stand guard outside the inner ring.
    run(world, walking, (3 * TICKS_PER_GAME_DAY) / 2, () =>
      ['m1', 'm2'].every((id) => at(world, id).order === null),
    )
    const hall = townHallOf(world, hq)!
    for (const id of ['m1', 'm2']) {
      const m = at(world, id)
      expect(m.order).toBeNull()
      expect(inInnerRing(world, m, terrain.size)).toBe(false)
      expect(wrapDistance(terrain.size, middleOf(hall), m)).toBeLessThanOrEqual(
        TRADE_ORG_HQ.innerRadius + 2,
      )
    }
  }, 120_000)

  it('hires nobody while it is strong enough', () => {
    const { world, hq, walking } = setup()
    expect(soldiersLacking(world, hq)).toBe(0)
    world.tick = TICKS_PER_GAME_DAY
    at(world, 'b1').carried.spear = 1
    run(world, walking, 1)
    expect(world.contracts).toEqual([])
  })
})

describe('trade-org-army-sound', () => {
  it('reports an open inner gate and a hired Leader', () => {
    const { world, hq } = setup()
    expect(tradeOrgArmySound.check(world, terrain)).toEqual([])
    const hall = townHallOf(world, hq)!
    const gate = world.buildings.find(
      (b) =>
        b.kind === 'gate' &&
        wrapDistance(terrain.size, middleOf(hall), b) <= TRADE_ORG_HQ.innerRadius + 1,
    )!
    delete gate.closed
    world.contracts.push({
      id: 'k',
      lenderId: 'r1',
      hirerId: TRADE_ORG,
      offeredBy: 'hirer',
      residentIds: ['a1'],
      days: 7,
      pricePerWeek: 5,
      storageId: 's1',
      startedAt: null,
      paidWeeks: 0,
    })
    expect(tradeOrgArmySound.check(world, terrain).map((v) => v.message)).toEqual([
      `inner gate ${gate.id} of the Trade Org HQ is open`,
      'the Trade Organization hires Leader a1',
    ])
  })
})
