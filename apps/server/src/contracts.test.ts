import {
  MAX_HEALTH,
  STANDING_CONTRACT_BROKEN_LOSS,
  STANDING_PER_PAID_WEEK,
  standingOf,
  MAX_HUNGER,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_WEEK,
  Terrain,
  commanderOf,
  contractPayBy,
  diplomacyFor,
  type MercenaryContract,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { contractsSound } from './contracts.js'
import { dieAll } from './survival.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 256, tiles: new Uint8Array(256 * 256).fill(Terrain.Plains) }
const lenderPlayer = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const hirerPlayer = { userId: 8, account: { name: 'Tobin', isAdmin: false } }

/**
 * Realm r1 (Player 7, Leader a1) with city c1 at (40, 40) and its storage s1 at (44, 40), where
 * soldiers m1 and m2 live; realm r2 (Player 8, Leader b1) far away at (160, 160), whose b2 carries
 * coins.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: 44, y: 40, stock: {} })
  resident(world, 'a1', 'r1', 40, 44, 'c1')
  resident(world, 'm1', 'r1', 48, 40, 'c1')
  resident(world, 'm2', 'r1', 48, 44, 'c1')
  resident(world, 'b1', 'r2', 160, 160)
  resident(world, 'b2', 'r2', 160, 164).carried.coins = 30
  return { world, queue: new OrderQueue(undefined, terrain), walking: new Walking(terrain) }
}

function resident(
  world: WorldState,
  id: string,
  owner: string,
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

/** Sends an order from a Player, applies it and answers whether it was taken. */
function order(
  world: WorldState,
  queue: OrderQueue,
  from: typeof lenderPlayer,
  o: Record<string, unknown>,
) {
  const answer = queue.receive(world, from, 'q', { kind: 'x', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world, keeping residents fed, and checks every invariant each tick. */
function run(world: WorldState, walking: Walking, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain)).toEqual([])
  }
}

const at = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

/** The offer r1 makes r2: m1 and m2 for 10 days at 5 coins a week, paid into s1. */
const offer = {
  kind: 'offerContract',
  residentIds: ['m1', 'm2'],
  realmId: 'r2',
  days: 10,
  pricePerWeek: 5,
  storageId: 's1',
}

/** r1 offers m1 and m2 to r2, and r2 accepts; returns the contract. */
function hire(world: WorldState, queue: OrderQueue): MercenaryContract {
  expect(order(world, queue, lenderPlayer, offer)).toBe('ack')
  const c = world.contracts[0]!
  expect(order(world, queue, hirerPlayer, { kind: 'acceptContract', contractId: c.id })).toBe('ack')
  return c
}

/** b2 walks onto the storage and pays `weeks` weeks. */
function payWeeks(
  world: WorldState,
  queue: OrderQueue,
  walking: Walking,
  c: MercenaryContract,
  weeks = 1,
) {
  Object.assign(at(world, 'b2'), { x: 44, y: 40 })
  const answer = order(world, queue, hirerPlayer, {
    kind: 'pay',
    residentId: 'b2',
    contractId: c.id,
    weeks,
  })
  run(world, walking)
  return answer
}

describe('mercenary contracts', () => {
  it('starts once the other side accepts the offer', () => {
    const { world, queue, walking } = setup()
    expect(order(world, queue, lenderPlayer, offer)).toBe('ack')
    const c = world.contracts[0]!
    expect(c).toMatchObject({ lenderId: 'r1', hirerId: 'r2', offeredBy: 'lender', startedAt: null })
    expect(world.events.at(-1)).toMatchObject({ kind: 'contract', what: 'offered', userId: 8 })
    // The one who offered can't accept their own offer.
    expect(order(world, queue, lenderPlayer, { kind: 'acceptContract', contractId: c.id })).toBe(
      'the other side has to accept your offer',
    )
    // Before it is accepted the residents still take the lender's orders.
    expect(commanderOf(world, at(world, 'm1'))).toBe('r1')
    run(world, walking)
    world.tick += 100
    expect(order(world, queue, hirerPlayer, { kind: 'acceptContract', contractId: c.id })).toBe(
      'ack',
    )
    expect(c.startedAt).toBe(world.tick)
    expect(commanderOf(world, at(world, 'm1'))).toBe('r2')
    run(world, walking)
  })

  it('can be asked for by the hirer and accepted by the lender', () => {
    const { world, queue, walking } = setup()
    // r2 sees m1 through b1 standing nearby.
    Object.assign(at(world, 'b1'), { x: 56, y: 40 })
    const ask = { ...offer, realmId: undefined }
    expect(order(world, queue, hirerPlayer, ask)).toBe('ack')
    const c = world.contracts[0]!
    expect(c).toMatchObject({ lenderId: 'r1', hirerId: 'r2', offeredBy: 'hirer' })
    expect(order(world, queue, lenderPlayer, { kind: 'acceptContract', contractId: c.id })).toBe(
      'ack',
    )
    expect(commanderOf(world, at(world, 'm2'))).toBe('r2')
    run(world, walking)
  })

  it('rejects offers that are not sound', () => {
    const { world, queue } = setup()
    const bad = (o: Record<string, unknown>, from = lenderPlayer) =>
      order(world, queue, from, { ...offer, ...o })
    expect(bad({ residentIds: ['m1', 'b1'] })).toBe('the residents must all be of one realm')
    expect(bad({ realmId: 'r1' })).toBe('offer them to another realm')
    expect(bad({ days: 0 })).toBe('a contract runs 1 to 120 game days')
    expect(bad({ pricePerWeek: 0 })).toBe('the price is a whole number of coins a week, at least 1')
    expect(bad({ storageId: 'c1-hall' })).toBe(
      'the coins go into a storage of the realm renting them out',
    )
    // The hirer has to see the residents it asks for.
    expect(bad({ realmId: undefined }, hirerPlayer)).toBe('those residents are out of sight')
    expect(bad({})).toBe('ack')
    expect(bad({ residentIds: ['m1'] })).toBe('a resident is already in a contract')
  })

  it('can be declined or withdrawn while only offered', () => {
    const { world, queue } = setup()
    order(world, queue, lenderPlayer, offer)
    const id = world.contracts[0]!.id
    expect(order(world, queue, hirerPlayer, { kind: 'cancelContract', contractId: id })).toBe('ack')
    expect(world.contracts).toEqual([])
    const c = hire(world, queue)
    expect(order(world, queue, lenderPlayer, { kind: 'cancelContract', contractId: c.id })).toBe(
      'that contract is already in force',
    )
  })

  it('makes the mercenaries take only the hirer’s orders, while the lender still sees them', () => {
    const { world, queue, walking } = setup()
    hire(world, queue)
    const walk = { kind: 'walkTo', residentId: 'm1', x: 80, y: 40 }
    expect(order(world, queue, lenderPlayer, walk)).toBe('not one of your residents')
    expect(order(world, queue, hirerPlayer, walk)).toBe('ack')
    expect(at(world, 'm1').order).toMatchObject({ kind: 'walkTo' })
    run(world, walking, 300)
    // m1 walked away from the lender's city, yet the lender still sees them; so does the hirer.
    expect(at(world, 'm1').x).toBeGreaterThan(14)
    for (const realm of ['r1', 'r2']) {
      const seen = entitiesInSight(world, terrain, realm).map((e) => e.id)
      expect(seen).toContain('m1')
    }
    // The hirer sees through them: s1 is out of r2's own residents' sight.
    expect(entitiesInSight(world, terrain, 'r2').map((e) => e.id)).toContain('s1')
    // They stay the lender's.
    expect(at(world, 'm1').owner).toBe('r1')
  })

  it('lets the hirer put the mercenaries in an army, which they leave when it ends', () => {
    const { world, queue, walking } = setup()
    const c = hire(world, queue)
    expect(
      order(world, queue, hirerPlayer, {
        kind: 'formArmy',
        name: 'Hired',
        residentIds: ['m1', 'm2'],
      }),
    ).toBe('ack')
    expect(
      order(world, queue, lenderPlayer, { kind: 'formArmy', name: 'Mine', residentIds: ['m1'] }),
    ).toBe('not all of them are your residents')
    payWeeks(world, queue, walking, c, 2)
    world.tick = c.startedAt! + 10 * TICKS_PER_GAME_DAY - 1
    run(world, walking)
    expect(world.contracts).toEqual([])
    expect(world.armies).toEqual([])
  })

  it('takes a week’s coins into the lender’s storage with a pay order', () => {
    const { world, queue, walking } = setup()
    const c = hire(world, queue)
    expect(
      order(world, queue, hirerPlayer, {
        kind: 'pay',
        residentId: 'b2',
        contractId: c.id,
        weeks: 1,
      }),
    ).toBe('the resident must stand at the contract’s storage')
    expect(payWeeks(world, queue, walking, c, 3)).toBe('that is more weeks than are left')
    expect(payWeeks(world, queue, walking, c)).toBe('ack')
    expect(c.paidWeeks).toBe(1)
    expect(world.buildings.find((b) => b.id === 's1')!.stock!.coins).toBe(5)
    expect(at(world, 'b2').carried.coins).toBe(25)
    expect(at(world, 'b2').order).toBeNull()
    const paid = world.events.filter((e) => e.kind === 'contract' && e.what === 'paid')
    expect(paid.map((e) => e.userId).sort()).toEqual([7, 8])
    // A paid week raises standing both ways.
    expect(standingOf(world, 'r1', 'r2')).toBeCloseTo(STANDING_PER_PAID_WEEK, 2)
    expect(standingOf(world, 'r2', 'r1')).toBeCloseTo(STANDING_PER_PAID_WEEK, 2)
    // Only the hirer pays, and only with coins in hand.
    at(world, 'a1').carried.coins = 50
    Object.assign(at(world, 'a1'), { x: 44, y: 40 })
    expect(
      order(world, queue, lenderPlayer, {
        kind: 'pay',
        residentId: 'a1',
        contractId: c.id,
        weeks: 1,
      }),
    ).toBe('you are not the hirer of that contract')
    at(world, 'b2').carried.coins = 4
    expect(payWeeks(world, queue, walking, c)).toBe('the resident doesn’t carry enough coins')
  })

  it('breaks when a week ends unpaid, and the mercenaries walk home', () => {
    const { world, queue, walking } = setup()
    const c = hire(world, queue)
    payWeeks(world, queue, walking, c)
    order(world, queue, hirerPlayer, { kind: 'walkTo', residentId: 'm1', x: 120, y: 40 })
    run(world, walking, 200)
    // The first week is paid; the second is due when it ends.
    expect(contractPayBy(c)).toBe(c.startedAt! + 10 * TICKS_PER_GAME_DAY)
    world.tick = c.startedAt! + TICKS_PER_GAME_WEEK + 5
    run(world, walking)
    expect(world.contracts).toHaveLength(1)
    world.tick = contractPayBy(c)! - 1
    run(world, walking)
    expect(world.contracts).toEqual([])
    const broken = world.events.filter((e) => e.kind === 'contract' && e.what === 'broken')
    expect(broken.map((e) => e.userId).sort()).toEqual([7, 8])
    // Breaking it costs the hirer standing with the lender; the paid week still counts.
    const left = STANDING_PER_PAID_WEEK - STANDING_CONTRACT_BROKEN_LOSS
    expect(standingOf(world, 'r1', 'r2')).toBeCloseTo(left, 0)
    expect(standingOf(world, 'r2', 'r1')).toBeCloseTo(STANDING_PER_PAID_WEEK, 0)
    expect(commanderOf(world, at(world, 'm1'))).toBe('r1')
    expect(at(world, 'm1').order).toMatchObject({ kind: 'walkTo', target: { x: 40, y: 40 } })
    run(world, walking, 600)
    expect(at(world, 'm1')).toMatchObject({ x: 40, y: 40 })
  })

  it('breaks at once when the first week is never paid', () => {
    const { world, queue, walking } = setup()
    const c = hire(world, queue)
    world.tick = c.startedAt! + TICKS_PER_GAME_WEEK - 1
    run(world, walking)
    expect(world.contracts).toEqual([])
  })

  it('ends when its time is up with every week paid', () => {
    const { world, queue, walking } = setup()
    const c = hire(world, queue)
    payWeeks(world, queue, walking, c, 2)
    expect(contractPayBy(c)).toBeNull()
    world.tick = c.startedAt! + 10 * TICKS_PER_GAME_DAY - 2
    run(world, walking)
    expect(world.contracts).toHaveLength(1)
    run(world, walking)
    expect(world.contracts).toEqual([])
    const ended = world.events.filter((e) => e.kind === 'contract' && e.what === 'ended')
    expect(ended).toHaveLength(2)
  })

  it('shows both sides the contract in their diplomacy', () => {
    const { world, queue } = setup()
    const c = hire(world, queue)
    for (const realm of ['r1', 'r2']) {
      expect(diplomacyFor(world, realm, []).contracts).toEqual([
        expect.objectContaining({
          id: c.id,
          lender: { realmId: 'r1', realm: at(world, 'a1').name },
          hirer: { realmId: 'r2', realm: at(world, 'b1').name },
          residents: [
            { id: 'm1', name: at(world, 'm1').name },
            { id: 'm2', name: at(world, 'm2').name },
          ],
          storage: { id: 's1', x: 44, y: 40 },
          weeks: 2,
          paidWeeks: 0,
          payBy: c.startedAt! + TICKS_PER_GAME_WEEK,
        }),
      ])
    }
  })
})

describe('mercenaries and the alliance army', () => {
  it('keeps a resident out of both a contract and an alliance army', () => {
    const { world, queue } = setup()
    world.alliances.push({
      id: 'alliance1',
      name: 'North',
      leaderId: 'r1',
      members: [{ realmId: 'r1', joinedAt: 0, leaving: null }],
      invites: [],
      army: [{ is: 'resident', id: 'm2', recallAt: null }],
    })
    expect(order(world, queue, lenderPlayer, offer)).toBe('a resident is in an alliance army')
    expect(order(world, queue, lenderPlayer, { ...offer, residentIds: ['m1'] })).toBe('ack')
    at(world, 'm1').carried.spear = 1
    expect(
      order(world, queue, lenderPlayer, {
        kind: 'handOverToAlliance',
        residentIds: ['m1'],
        carriageIds: [],
      }),
    ).toBe(`${at(world, 'm1').name} is in a mercenary contract`)
  })
})

describe('contracts-sound', () => {
  it('catches a resident in two contracts and a week left unpaid', () => {
    const { world, queue } = setup()
    const c = hire(world, queue)
    world.contracts.push({ ...c, id: 'contract2', startedAt: null })
    world.tick = c.startedAt! + TICKS_PER_GAME_WEEK
    const found = contractsSound.check(world, terrain).map((v) => v.message)
    expect(found).toEqual([
      `contract ${c.id} has a week that ended unpaid`,
      'resident m1 is in two contracts',
      'resident m2 is in two contracts',
    ])
  })
})

describe('contracts when a Leader dies', () => {
  /** The contract events of each side, by Player. */
  const contractEvents = (world: WorldState) =>
    world.events.filter(
      (e) => e.kind === 'contract' && e.what !== 'offered' && e.what !== 'started',
    )

  /** Gives r2 a carriage with a horse on m1's tile and has m1 haul with it to (120, 40). */
  function haulForHirer(world: WorldState, queue: OrderQueue) {
    world.horses.push({
      id: 'h2',
      realmId: 'r2',
      cityId: null,
      x: 48,
      y: 40,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
    })
    world.carriages.push({
      id: 'k2',
      realmId: 'r2',
      cityId: null,
      x: 48,
      y: 40,
      horseId: null,
      load: {},
    })
    at(world, 'm1').carried.wood = 2
    const haul = {
      kind: 'haul',
      residentId: 'm1',
      carriageId: 'k2',
      x: 120,
      y: 40,
      goods: ['wood'],
    }
    expect(order(world, queue, hirerPlayer, { ...haul, keepFood: 0 })).toBe('ack')
    expect(at(world, 'm1').order).toMatchObject({ kind: 'haul' })
  }

  it('ends at once when the hirer’s Leader dies: the mercenaries stop hauling and walk home', () => {
    const { world, queue, walking } = setup()
    const c = hire(world, queue)
    haulForHirer(world, queue)
    expect(
      order(world, queue, hirerPlayer, { kind: 'formArmy', name: 'Hired', residentIds: ['m2'] }),
    ).toBe('ack')
    dieAll(world, [at(world, 'b1')], 'killed', terrain.size)
    expect(world.contracts).toEqual([])
    expect(world.armies).toEqual([])
    // Ended, not broken, though no week was paid: no standing lost.
    expect(contractEvents(world)).toEqual([
      expect.objectContaining({ userId: 7, contractId: c.id, what: 'ended', leaderDied: 'hirer' }),
      expect.objectContaining({ userId: 8, contractId: c.id, what: 'ended', leaderDied: 'hirer' }),
    ])
    for (const id of ['m1', 'm2']) {
      expect(commanderOf(world, at(world, id))).toBe('r1')
      expect(at(world, id).order).toMatchObject({ kind: 'walkTo', target: { x: 40, y: 40 } })
    }
    run(world, walking, 100)
    expect(at(world, 'm1')).toMatchObject({ x: 40, y: 40 })
    expect(contractEvents(world).filter((e) => e.what === 'broken')).toEqual([])
    expect(world.standings).toEqual([])
  })

  it('ends at once when the lender’s Leader dies: the mercenaries walk home to their own city', () => {
    const { world, queue, walking } = setup()
    const c = hire(world, queue)
    haulForHirer(world, queue)
    dieAll(world, [at(world, 'a1')], 'killed', terrain.size)
    expect(world.contracts).toEqual([])
    expect(contractEvents(world)).toEqual([
      expect.objectContaining({ userId: 7, contractId: c.id, what: 'ended', leaderDied: 'lender' }),
      expect.objectContaining({ userId: 8, contractId: c.id, what: 'ended', leaderDied: 'lender' }),
    ])
    // They live in what is now a self-managed city, and take no realm's orders.
    const m1 = at(world, 'm1')
    expect(m1).toMatchObject({ owner: null, cityId: 'c1' })
    expect(commanderOf(world, m1)).toBeNull()
    expect(m1.order?.kind).not.toBe('haul')
    run(world, walking, 50)
    expect(at(world, 'm1').order?.kind).not.toBe('haul')
  })

  it('lets an offer lapse without a word when a side’s Leader dies', () => {
    const { world, queue } = setup()
    expect(order(world, queue, lenderPlayer, offer)).toBe('ack')
    dieAll(world, [at(world, 'b1')], 'killed', terrain.size)
    expect(world.contracts).toEqual([])
    expect(contractEvents(world)).toEqual([])
  })
})
