import { parse, run } from '@csp/lang'
import {
  SCRIPT_API,
  SCRIPT_MAX_CALL_DEPTH,
  allianceOf,
  canWork,
  townHallOf,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { leadersServeNoOne } from './leader.js'
import { OrderQueue } from './orders.js'
import { bindScript } from './script-bindings.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity } from './starting-city.js'
import { dieAll } from './survival.js'
import { cityTerrain } from './test-terrain.js'
import { createWorld } from './world.js'

const player = (userId: number) => ({ userId, account: { name: `p${userId}`, isAdmin: false } })
const mara = player(1)
const tobin = player(2)

/**
 * Mara's and Tobin's starting cities. Mara's Leader and `heir`, a grown resident of hers that
 * isn't the Leader, both stand on her town hall.
 */
function setup() {
  const terrain = cityTerrain()
  const world = createWorld(terrain)
  foundStartingCity(world, terrain, mara.userId)
  foundStartingCity(world, terrain, tobin.userId)
  const realmOf = (p: { userId: number }) => world.realms.find((r) => r.userId === p.userId)!
  const realm = realmOf(mara)
  const byId = (id: string) => world.residents.find((r) => r.id === id)!
  const leader = byId(realm.leaderId)
  const heir = world.residents.find(
    (r) => r.owner === realm.id && r.id !== leader.id && canWork(r, world.tick),
  )!
  const city = world.cities.find((c) => c.realmId === realm.id)!
  const hall = townHallOf(world, city)!
  for (const r of [leader, heir]) Object.assign(r, { x: hall.x, y: hall.y, order: null })
  const queue = new OrderQueue(undefined, terrain)
  /** Sends an order and applies it as the next tick would; returns the answer. */
  const order = (o: object, sender = mara) => {
    const answer = queue.receive(world, sender, 'q', o)
    queue.applyAll(world)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  const handOver = (to: Resident, from: Resident = leader, sender = mara) =>
    order({ kind: 'handOver', residentId: from.id, newLeaderId: to.id }, sender)
  return { world, terrain, realm, realmOf, leader, heir, city, hall, order, handOver }
}

/** A contract between Mara's realm and Tobin's naming `r`, offered or in force. */
function contract(
  world: WorldState,
  r: Resident,
  lenderId: string,
  hirerId: string,
  started = true,
) {
  world.contracts.push({
    id: `contract-${r.id}`,
    lenderId,
    hirerId,
    offeredBy: 'lender',
    residentIds: [r.id],
    days: 5,
    pricePerWeek: 3,
    storageId: world.buildings.find((b) => b.kind === 'storage')!.id,
    startedAt: started ? world.tick : null,
    paidWeeks: 0,
  })
}

describe('Leader handover', () => {
  it('makes a grown resident in the same city the Leader, and changes nothing else', () => {
    const { world, terrain, realm, leader, heir, city, handOver } = setup()
    leader.order = { kind: 'walkTo', target: { x: leader.x + 1, y: leader.y } } as never
    const cities = JSON.stringify(world.cities)
    const residents = world.residents.length
    expect(handOver(heir)).toBe('ok')
    expect(realm.leaderId).toBe(heir.id)
    // The old Leader stays on as an ordinary resident of the realm, doing what they did.
    expect(leader.owner).toBe(realm.id)
    expect(leader.order).toMatchObject({ kind: 'walkTo' })
    expect(JSON.stringify(world.cities)).toBe(cities)
    expect(world.residents).toHaveLength(residents)
    expect(world.events.at(-1)).toMatchObject({
      kind: 'leaderHandedOver',
      userId: mara.userId,
      fromId: leader.id,
      from: leader.name,
      toId: heir.id,
      to: heir.name,
      cityId: city.id,
      city: city.name,
      x: leader.x,
      y: leader.y,
    })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('keeps the realm’s alliance, its leader role and its contracts', () => {
    const { world, realm, realmOf, heir, order, handOver } = setup()
    expect(order({ kind: 'foundAlliance', name: 'North' })).toBe('ok')
    const lent = world.residents.find(
      (r) => r.owner === realm.id && r.id !== realm.leaderId && r.id !== heir.id,
    )!
    contract(world, lent, realm.id, realmOf(tobin).id)
    const contracts = JSON.stringify(world.contracts)
    expect(handOver(heir)).toBe('ok')
    expect(allianceOf(world, realm.id)?.leaderId).toBe(realm.id)
    expect(JSON.stringify(world.contracts)).toBe(contracts)
  })

  it('happens also while the Leader is in a fight', () => {
    const { world, realm, realmOf, leader, heir, handOver } = setup()
    const foe = world.residents.find((r) => r.owner === realmOf(tobin).id)!
    leader.order = { kind: 'attack', targetId: foe.id } as never
    expect(handOver(heir)).toBe('ok')
    expect(realm.leaderId).toBe(heir.id)
    expect(world.realms).toHaveLength(2)
  })

  it('refuses a child', () => {
    const { world, realm, heir, handOver } = setup()
    heir.bornAt = world.tick
    expect(handOver(heir)).toBe(`${heir.name} is a child`)
    expect(realm.leaderId).not.toBe(heir.id)
  })

  it('refuses a resident of another realm', () => {
    const { world, realmOf, hall, handOver } = setup()
    const other = world.residents.find(
      (r) => r.owner === realmOf(tobin).id && canWork(r, world.tick),
    )!
    Object.assign(other, { x: hall.x, y: hall.y })
    expect(handOver(other)).toBe('not one of your residents')
  })

  it('refuses one hired out, or named in an offer', () => {
    const { world, realm, realmOf, heir, handOver } = setup()
    contract(world, heir, realm.id, realmOf(tobin).id)
    expect(handOver(heir)).toBe(`${heir.name} is in a mercenary contract`)
    world.contracts[0]!.startedAt = null
    expect(handOver(heir)).toBe(`${heir.name} is named in a mercenary contract offer`)
    expect(realm.leaderId).not.toBe(heir.id)
  })

  it('refuses one in an alliance army', () => {
    const { realm, heir, order, handOver } = setup()
    expect(order({ kind: 'foundAlliance', name: 'North' })).toBe('ok')
    heir.carried.sword = 1
    expect(order({ kind: 'handOverToAlliance', residentIds: [heir.id], carriageIds: [] })).toBe(
      'ok',
    )
    expect(handOver(heir)).toBe(`${heir.name} is in the alliance army`)
    expect(realm.leaderId).not.toBe(heir.id)
  })

  it('refuses when the two don’t stand in the same city of the realm', () => {
    const { world, terrain, realm, leader, heir, handOver } = setup()
    // A member of the city, but out in the field.
    heir.x = (heir.x + 40) % terrain.size
    expect(handOver(heir)).toBe(`${heir.name} must stand in the same city as your Leader`)
    heir.x = leader.x
    leader.x = (leader.x + 40) % terrain.size
    expect(handOver(heir)).toBe(`${heir.name} must stand in the same city as your Leader`)
    expect(realm.leaderId).toBe(leader.id)
    // Standing in another realm's city doesn't do either.
    const other = world.cities.find((c) => c.realmId !== realm.id)!
    const hall = townHallOf(world, other)!
    for (const r of [leader, heir]) Object.assign(r, { x: hall.x, y: hall.y })
    expect(handOver(heir)).toBe(`${heir.name} must stand in the same city as your Leader`)
  })

  it('is the Leader’s to give: not another resident’s, not another Player’s, not twice', () => {
    const { world, realm, leader, heir, handOver } = setup()
    const third = world.residents.find(
      (r) => r.owner === realm.id && r.id !== leader.id && r.id !== heir.id,
    )!
    Object.assign(third, { x: leader.x, y: leader.y })
    expect(handOver(third, heir)).toBe('only your Leader can hand over the realm')
    expect(handOver(heir, leader, tobin)).toBe('only your Leader can hand over the realm')
    expect(handOver(leader)).toBe(`${leader.name} is your Leader already`)
    expect(realm.leaderId).toBe(leader.id)
    expect(world.events.some((e) => e.kind === 'leaderHandedOver')).toBe(false)
  })

  it('is checked again when it applies', () => {
    const { world, terrain, realm, heir } = setup()
    const queue = new OrderQueue(undefined, terrain)
    const ask = { kind: 'handOver', residentId: realm.leaderId, newLeaderId: heir.id }
    expect(queue.receive(world, mara, 'q', ask).type).toBe('ack')
    heir.x = (heir.x + 40) % terrain.size
    queue.applyAll(world)
    expect(realm.leaderId).not.toBe(heir.id)
  })
})

describe('Leader death after a handover', () => {
  it('the old Leader’s death breaks nothing up; the new Leader’s does', () => {
    const { world, terrain, realm, city, leader, heir, handOver } = setup()
    expect(handOver(heir)).toBe('ok')
    expect(dieAll(world, [leader], 'oldAge', terrain.size)).toEqual([])
    expect(world.realms).toContain(realm)
    expect(city.realmId).toBe(realm.id)
    expect(world.events.at(-1)).toMatchObject({ kind: 'died', leader: false })
    expect(checkInvariants(world, terrain)).toEqual([])

    expect(dieAll(world, [heir], 'oldAge', terrain.size)).toEqual([realm])
    expect(world.realms).not.toContain(realm)
    expect(city.realmId).toBeNull()
    expect(
      world.events.some((e) => e.kind === 'died' && e.leader && e.residentId === heir.id),
    ).toBe(true)
  })
})

describe('a Leader serves no one else', () => {
  it('can’t be hired out or handed to an alliance army', () => {
    const { world, realm, realmOf, leader, order } = setup()
    const storage = world.buildings.find((b) => b.kind === 'storage' && b.cityId !== null)!
    expect(
      order({
        kind: 'offerContract',
        residentIds: [leader.id],
        realmId: realmOf(tobin).id,
        days: 5,
        pricePerWeek: 3,
        storageId: storage.id,
      }),
    ).toBe('a Leader is never hired out')
    expect(order({ kind: 'foundAlliance', name: 'North' })).toBe('ok')
    leader.carried.sword = 1
    expect(order({ kind: 'handOverToAlliance', residentIds: [leader.id], carriageIds: [] })).toBe(
      `${leader.name} is your Leader`,
    )
    expect(allianceOf(world, realm.id)!.army).toEqual([])
  })

  it('invariant: every realm’s Leader is a living adult of that realm serving no one else', () => {
    const { world, terrain, realm, realmOf, leader } = setup()
    expect(leadersServeNoOne.check(world, terrain)).toEqual([])
    contract(world, leader, realm.id, realmOf(tobin).id)
    expect(leadersServeNoOne.check(world, terrain)).toHaveLength(1)
    world.contracts = []
    world.alliances.push({
      id: 'alliance1',
      name: 'North',
      leaderId: realm.id,
      members: [{ realmId: realm.id, joinedAt: 0, leaving: null }],
      invites: [],
      army: [{ is: 'resident', id: leader.id, recallAt: null }],
    })
    expect(leadersServeNoOne.check(world, terrain)).toHaveLength(1)
    world.alliances = []
    leader.bornAt = world.tick
    expect(leadersServeNoOne.check(world, terrain)).toHaveLength(1)
  })
})

describe('Leader handover from a script', () => {
  it('is in the script API and does what the order does', () => {
    expect(SCRIPT_API.some((b) => b.name === 'handOver' && b.is === 'action')).toBe(true)
    const { world, terrain, realm, leader, heir } = setup()
    const run1 = (source: string, residentId: string) => {
      const memory = {}
      const { globals, requests } = bindScript({
        world,
        terrain,
        sender: mara,
        residentId,
        memory,
        seen: () => entitiesInSight(world, terrain, realm.id),
        explored: () => true,
      })
      run(parse(source), { globals, steps: 10_000, maxCallDepth: SCRIPT_MAX_CALL_DEPTH })
      return { memory: memory as { answer?: unknown }, requests }
    }
    // Only the Leader's script can hand over.
    const notLeader = run1(`memory.answer = handOver("${leader.id}")`, heir.id)
    expect(notLeader.memory.answer).toBe('only your Leader can hand over the realm')
    expect(notLeader.requests).toEqual([])

    const { memory, requests } = run1(`memory.answer = handOver("${heir.id}")`, leader.id)
    expect(memory.answer).toBeNull()
    expect(requests).toEqual([{ kind: 'handOver', residentId: leader.id, newLeaderId: heir.id }])
    const queue = new OrderQueue(undefined, terrain)
    expect(queue.receive(world, mara, 'q', requests[0]).type).toBe('ack')
    queue.applyAll(world)
    expect(realm.leaderId).toBe(heir.id)
  })

  it('a UI handover leaves the Leader’s script running', () => {
    const { world, terrain, leader, heir, handOver } = setup()
    leader.script = { scriptId: 1, name: 'idle', memory: {} } as never
    expect(handOver(heir)).toBe('ok')
    expect(leader.script).toBeDefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})
