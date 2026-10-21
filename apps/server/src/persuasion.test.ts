import {
  PERSUADE_ASK_AGAIN_DAYS,
  PERSUADE_CHECK_TICKS,
  PERSUADE_STANDING,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  Terrain,
  citySoldiers,
  diplomacyFor,
  persuadedBy,
  respectSeenBy,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { joinRequestsSound, stepPersuasion } from './persuasion.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding, stepStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { createWorld } from './world.js'

const size = 128
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7, Leader a1 at home in c1, far away) and realm r2 (Player 8), and the NPC
 * city n1 at (40, 40), where n1a lives, armed, and n1b, unarmed. r1's `armed` residents stand
 * just outside n1, in its sight; r1 has `walls` wall tiles of c1 near n1 too.
 */
function setup({ armed = 2, walls = 0 } = {}) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 5, y: 5 })
  const n1 = addCity(world, { id: 'n1', realmId: null, x: 40, y: 40, name: 'Oakford' })
  resident(world, 'a1', 'r1', 5, 5, 'c1')
  resident(world, 'b1', 'r2', 100, 100)
  resident(world, 'n1a', null, 40, 40, 'n1').carried.spear = 1
  resident(world, 'n1b', null, 41, 40, 'n1')
  for (let i = 0; i < armed; i++) resident(world, `s${i}`, 'r1', 45, 40 + i, 'c1').carried.sword = 1
  for (let i = 0; i < walls; i++) {
    world.buildings.push({ id: `w${i}`, kind: 'wall', cityId: 'c1', x: 36, y: 40 + i })
  }
  return { world, n1, queue: new OrderQueue(undefined, terrain) }
}

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
  world.residents.push(r)
  return r
}

/** Steps persuasion at the next check and checks its invariant. */
function check(world: WorldState) {
  world.tick = Math.ceil((world.tick + 1) / PERSUADE_CHECK_TICKS) * PERSUADE_CHECK_TICKS
  stepPersuasion(world, size)
  expect(checkInvariants(world, terrain, [joinRequestsSound])).toEqual([])
}

/** Sends an order from Mara (r1), applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, mara, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

const asks = (world: WorldState) => world.events.filter((e) => e.kind === 'joinAsked')

describe('respect', () => {
  it('counts the armed residents and walls a city sees', () => {
    const { world, n1 } = setup({ armed: 2, walls: 3 })
    expect(respectSeenBy(world, n1, 'r1', size)).toBe(5)
    expect(respectSeenBy(world, n1, 'r2', size)).toBe(0)
  })

  it('leaves out unarmed residents, construction sites and what is out of sight', () => {
    const { world, n1 } = setup({ armed: 1, walls: 1 })
    resident(world, 'unarmed', 'r1', 44, 40, 'c1')
    world.buildings.push({
      id: 'site',
      kind: 'wall',
      cityId: 'c1',
      x: 37,
      y: 40,
      site: { delivered: {}, work: 0 },
    })
    resident(world, 'far', 'r1', 42 + SIGHT_RANGE, 40, 'c1').carried.spear = 1
    expect(respectSeenBy(world, n1, 'r1', size)).toBe(3 - 1)
    // A resident of the city who walks out sees further.
    world.residents.find((r) => r.id === 'n1b')!.x = 45
    expect(respectSeenBy(world, n1, 'r1', size)).toBe(3)
  })

  it('is nothing when nobody lives in the city to see it', () => {
    const { world, n1 } = setup({ armed: 3 })
    world.residents = world.residents.filter((r) => r.cityId !== 'n1')
    expect(respectSeenBy(world, n1, 'r1', size)).toBe(0)
  })
})

describe('persuading a city', () => {
  it('needs high standing and more respect than the city has soldiers', () => {
    const { world, n1 } = setup({ armed: 1 })
    expect(citySoldiers(world, n1)).toBe(1)
    changeStanding(world, 'n1', 'r1', PERSUADE_STANDING)
    expect(persuadedBy(world, n1, 'r1', size)).toBe(false)
    resident(world, 's9', 'r1', 46, 40, 'c1').carried.spear = 1
    expect(persuadedBy(world, n1, 'r1', size)).toBe(true)
    changeStanding(world, 'n1', 'r1', -1)
    expect(persuadedBy(world, n1, 'r1', size)).toBe(false)
  })

  it('makes the city ask to join, once, in the realm log and the diplomacy', () => {
    const { world } = setup()
    changeStanding(world, 'n1', 'r1', 60)
    check(world)
    expect(world.joinRequests).toEqual([
      { cityId: 'n1', realmId: 'r1', at: world.tick, declined: false },
    ])
    expect(asks(world)).toMatchObject([{ kind: 'joinAsked', city: 'Oakford', x: 40, y: 40 }])
    expect(diplomacyFor(world, 'r1', []).joinRequests).toEqual([
      { cityId: 'n1', city: 'Oakford', at: world.tick, x: 40, y: 40 },
    ])
    expect(diplomacyFor(world, 'r2', []).joinRequests).toEqual([])
    check(world)
    expect(asks(world)).toHaveLength(1)
  })

  it('asks only between checks, and not without high standing', () => {
    const { world } = setup()
    check(world)
    expect(world.joinRequests).toEqual([])
    changeStanding(world, 'n1', 'r1', 60)
    world.tick = PERSUADE_CHECK_TICKS + 1
    stepPersuasion(world, size)
    expect(world.joinRequests).toEqual([])
  })

  it('asks the realm it holds in the highest standing', () => {
    const { world } = setup()
    for (let i = 0; i < 2; i++) resident(world, `t${i}`, 'r2', 35, 40 + i).carried.sword = 1
    changeStanding(world, 'n1', 'r1', 60)
    changeStanding(world, 'n1', 'r2', 80)
    check(world)
    expect(world.joinRequests.map((q) => q.realmId)).toEqual(['r2'])
  })

  it('never makes a realm’s city or the Trade Organization ask', () => {
    const { world } = setup()
    addCity(world, { id: 'c2', realmId: 'r2', x: 42, y: 42 })
    resident(world, 'c2a', 'r2', 42, 42, 'c2')
    changeStanding(world, 'n1', 'r1', 60)
    check(world)
    expect(world.joinRequests.map((q) => q.cityId)).toEqual(['n1'])
  })

  it('integrates the city when accepted', () => {
    const { world, queue } = setup()
    changeStanding(world, 'n1', 'r1', 60)
    check(world)
    expect(order(world, queue, { kind: 'acceptJoin', cityId: 'n1' })).toBe('ack')
    const n1 = world.cities.find((c) => c.id === 'n1')!
    expect(n1.realmId).toBe('r1')
    expect(world.residents.filter((r) => r.cityId === 'n1').map((r) => r.owner)).toEqual([
      'r1',
      'r1',
    ])
    expect(world.joinRequests).toEqual([])
    expect(world.events.at(-1)).toMatchObject({
      kind: 'cityPersuaded',
      city: 'Oakford',
      residents: 2,
    })
    // Standing toward the city it was is dropped later in the same tick.
    stepStanding(world)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('only takes an answer from the realm asked, while the ask stands', () => {
    const { world, queue } = setup()
    expect(order(world, queue, { kind: 'acceptJoin', cityId: 'n1' })).toBe(
      'that city isn’t asking to join your realm',
    )
    world.joinRequests.push({ cityId: 'n1', realmId: 'r2', at: 0, declined: false })
    expect(order(world, queue, { kind: 'declineJoin', cityId: 'n1' })).toBe(
      'that city isn’t asking to join your realm',
    )
  })

  it('doesn’t ask a realm again for a while once declined', () => {
    const { world, queue } = setup()
    changeStanding(world, 'n1', 'r1', 100)
    check(world)
    expect(order(world, queue, { kind: 'declineJoin', cityId: 'n1' })).toBe('ack')
    expect(world.joinRequests).toMatchObject([{ declined: true }])
    expect(diplomacyFor(world, 'r1', []).joinRequests).toEqual([])
    expect(order(world, queue, { kind: 'acceptJoin', cityId: 'n1' })).not.toBe('ack')
    world.tick += (PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY) / 2
    check(world)
    expect(asks(world)).toHaveLength(1)
    world.tick += PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY
    check(world)
    expect(asks(world)).toHaveLength(2)
    expect(world.joinRequests).toMatchObject([{ declined: false }])
  })

  it('withdraws the ask once the city no longer holds the realm in high standing', () => {
    const { world } = setup()
    changeStanding(world, 'n1', 'r1', PERSUADE_STANDING)
    check(world)
    changeStanding(world, 'n1', 'r1', -10)
    world.tick++
    stepPersuasion(world, size)
    expect(world.joinRequests).toEqual([])
    expect(world.events.at(-1)).toMatchObject({ kind: 'joinWithdrawn', city: 'Oakford' })
  })

  it('drops the ask when the city joins a realm some other way', () => {
    const { world } = setup()
    changeStanding(world, 'n1', 'r1', 60)
    check(world)
    world.cities.find((c) => c.id === 'n1')!.realmId = 'r2'
    world.tick++
    stepPersuasion(world, size)
    expect(world.joinRequests).toEqual([])
  })

  it('is caught by its invariant when an ask goes wrong', () => {
    const { world } = setup()
    world.joinRequests.push(
      { cityId: 'n1', realmId: 'r1', at: 0, declined: false },
      { cityId: 'n1', realmId: 'r2', at: 0, declined: false },
      { cityId: 'c1', realmId: 'r2', at: 0, declined: true },
    )
    const messages = checkInvariants(world, terrain, [joinRequestsSound]).map((v) => v.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'n1 asks r1 to join without holding it in high standing',
        'n1 asks more than one realm to join',
        'c1 asks r2 to join but is no NPC city',
      ]),
    )
  })
})
