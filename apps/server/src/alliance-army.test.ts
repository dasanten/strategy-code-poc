import {
  ALLIANCE_LEAVE_DELAY,
  ALLIANCE_RECALL_DELAY,
  allianceOf,
  commanderOf,
  diplomacyFor,
  inCityArea,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepAlliances } from './alliances.js'
import { stepArmies } from './armies.js'
import { alliancesSound, checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { npcHome } from './npc-behaviour.js'
import { foundStartingCity } from './starting-city.js'
import { dieAll } from './survival.js'
import { cityTerrain } from './test-terrain.js'
import { createWorld } from './world.js'

const player = (userId: number) => ({ userId, account: { name: `p${userId}`, isAdmin: false } })
const [mara, tobin, ash] = [1, 2, 3].map(player) as [
  ReturnType<typeof player>,
  ReturnType<typeof player>,
  ReturnType<typeof player>,
]

/**
 * Mara leads the alliance "North" with Tobin in it; Ash is in none. Each has a starting city;
 * `soldier(p)` arms a resident of the Player's realm, not their Leader.
 */
function setup() {
  const terrain = cityTerrain()
  const world = createWorld(terrain)
  for (const p of [mara, tobin, ash]) foundStartingCity(world, terrain, p.userId)
  const realm = (p: { userId: number }) => world.realms.find((r) => r.userId === p.userId)!.id
  const queue = new OrderQueue(undefined, terrain)
  /** Sends an order and applies it as the next tick would; returns the answer. */
  const order = (sender: ReturnType<typeof player>, o: object) => {
    const answer = queue.receive(world, sender, 'q', o)
    queue.applyAll(world)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  order(mara, { kind: 'foundAlliance', name: 'North' })
  const id = allianceOf(world, realm(mara))!.id
  order(mara, { kind: 'inviteToAlliance', realmId: realm(tobin) })
  world.tick++
  order(tobin, { kind: 'acceptInvite', allianceId: id })
  const used = new Set<string>()
  const soldier = (p: { userId: number }): Resident => {
    const realmId = realm(p)
    const leader = world.realms.find((r) => r.id === realmId)!.leaderId
    const r = world.residents.find(
      (x) => x.owner === realmId && x.id !== leader && !used.has(x.id) && x.bornAt < -1e6,
    )!
    used.add(r.id)
    r.carried.sword = 1
    return r
  }
  const carriage = (p: { userId: number }) => world.carriages.find((k) => k.realmId === realm(p))!
  const walk = (r: Resident) => ({ kind: 'walkTo', residentId: r.id, x: r.x + 1, y: r.y })
  return { world, terrain, realm, order, id, soldier, carriage, walk }
}

/** Moves time on by `ticks`, running alliances and armies each tick as the world does. */
function pass(world: WorldState, ticks: number, size: number) {
  for (let i = 0; i < ticks; i++) {
    world.tick++
    stepAlliances(world)
    stepArmies(world, size)
  }
}

describe('alliance army', () => {
  it('hands over soldiers and carriages, who then take orders only from the alliance leader', () => {
    const { world, terrain, realm, order, id, soldier, carriage, walk } = setup()
    const s = soldier(tobin)
    const k = carriage(tobin)
    s.order = walk(s) as never
    expect(
      order(tobin, { kind: 'handOverToAlliance', residentIds: [s.id], carriageIds: [k.id] }),
    ).toBe('ok')
    // Handing over stops what they were doing; they stay in their own realm.
    expect(s.order).toBeNull()
    expect(s.owner).toBe(realm(tobin))
    expect(k.realmId).toBe(realm(tobin))
    expect(commanderOf(world, s)).toBe(realm(mara))
    expect(world.alliances[0]!.army).toEqual([
      { is: 'resident', id: s.id, recallAt: null },
      { is: 'carriage', id: k.id, recallAt: null },
    ])
    expect(order(tobin, walk(s))).toBe('not one of your residents')
    expect(order(mara, walk(s))).toBe('ok')
    const drive = (r: Resident) => ({
      kind: 'drive',
      residentId: r.id,
      carriageId: k.id,
      x: k.x + 1,
      y: k.y,
    })
    const driver = world.residents.find((x) => x.owner === realm(tobin) && x.id !== s.id)!
    expect(order(tobin, drive(driver))).toBe('not one of your carriages')
    // The alliance leader can put soldiers handed over into an army of theirs.
    expect(order(mara, { kind: 'formArmy', name: 'Guard', residentIds: [s.id] })).toBe('ok')
    expect(order(tobin, { kind: 'formArmy', name: 'Mine', residentIds: [s.id] })).toMatch(
      /not all of them/,
    )
    pass(world, 1, terrain.size)
    expect(world.armies.find((a) => a.realmId === realm(mara))?.memberIds).toEqual([s.id])
    expect(checkInvariants(world, terrain)).toEqual([])
    // Members see the alliance army in their alliance matters.
    expect(diplomacyFor(world, realm(tobin), []).alliance!.army).toEqual([
      expect.objectContaining({ is: 'resident', id: s.id, realmId: realm(tobin), recallAt: null }),
      expect.objectContaining({ is: 'carriage', id: k.id, realmId: realm(tobin), recallAt: null }),
    ])
    expect(allianceOf(world, realm(mara))!.id).toBe(id)
  })

  it('takes only soldiers and carriages of a member, each once', () => {
    const { world, order, soldier, carriage } = setup()
    const s = soldier(tobin)
    const hand = (p: typeof mara, o: object) => order(p, { kind: 'handOverToAlliance', ...o })
    expect(hand(ash, { residentIds: [soldier(ash).id] })).toBe('you are in no alliance')
    delete s.carried.sword
    expect(hand(tobin, { residentIds: [s.id] })).toMatch(/is not a soldier/)
    s.carried.sword = 1
    expect(hand(tobin, { residentIds: [soldier(mara).id] })).toMatch(/not all of them/)
    expect(hand(tobin, { carriageIds: [carriage(mara).id] })).toMatch(/not all of them/)
    expect(hand(tobin, { residentIds: [s.id, s.id] })).toMatch(/once/)
    expect(hand(tobin, {})).toBe('hand over at least one')
    expect(hand(tobin, { residentIds: [s.id] })).toBe('ok')
    expect(hand(tobin, { residentIds: [s.id] })).toMatch(/already in the alliance army/)
    order(tobin, { kind: 'leaveAlliance' })
    expect(hand(tobin, { carriageIds: [carriage(tobin).id] })).toBe('you are leaving the alliance')
    expect(world.alliances[0]!.army).toHaveLength(1)
  })

  it('gives a recalled soldier back after a game day, stopping the leader’s order', () => {
    const { world, terrain, realm, order, soldier, walk } = setup()
    const s = soldier(tobin)
    order(tobin, { kind: 'handOverToAlliance', residentIds: [s.id] })
    expect(order(mara, { kind: 'recallFromAlliance', ids: [s.id] })).toBe(
      'you did not hand that over',
    )
    expect(order(tobin, { kind: 'recallFromAlliance', ids: [s.id] })).toBe('ok')
    expect(order(tobin, { kind: 'recallFromAlliance', ids: [s.id] })).toBe('already recalled')
    expect(world.alliances[0]!.army[0]!.recallAt).toBe(world.tick + ALLIANCE_RECALL_DELAY)
    // Until the recall takes effect, the soldier still takes the alliance leader's orders.
    pass(world, ALLIANCE_RECALL_DELAY - 1, terrain.size)
    expect(order(mara, walk(s))).toBe('ok')
    expect(order(tobin, walk(s))).toBe('not one of your residents')
    expect(s.order).not.toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
    pass(world, 1, terrain.size)
    expect(world.alliances[0]!.army).toEqual([])
    expect(commanderOf(world, s)).toBe(realm(tobin))
    expect(s.order).toBeNull()
    expect(order(tobin, walk(s))).toBe('ok')
    expect(order(mara, walk(s))).toBe('not one of your residents')
  })

  it('recalls everything when a member leaves, and leaves armies it made', () => {
    const { world, terrain, realm, order, soldier, carriage } = setup()
    const s = soldier(tobin)
    const k = carriage(tobin)
    order(tobin, { kind: 'handOverToAlliance', residentIds: [s.id], carriageIds: [k.id] })
    order(mara, { kind: 'formArmy', name: 'Guard', residentIds: [s.id] })
    order(tobin, { kind: 'leaveAlliance' })
    pass(world, ALLIANCE_LEAVE_DELAY, terrain.size)
    expect(allianceOf(world, realm(tobin))).toBeUndefined()
    expect(world.alliances[0]!.army).toEqual([])
    expect(commanderOf(world, s)).toBe(realm(tobin))
    expect(world.armies).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('goes to the next alliance leader, and back home when its owner’s Leader dies', () => {
    const { world, terrain, realm, order, soldier } = setup()
    const s = soldier(tobin)
    const own = soldier(mara)
    order(tobin, { kind: 'handOverToAlliance', residentIds: [s.id] })
    order(mara, { kind: 'handOverToAlliance', residentIds: [own.id] })
    // Mara leaves: her soldier comes back to her, Tobin leads and commands his own again.
    order(mara, { kind: 'leaveAlliance' })
    pass(world, ALLIANCE_LEAVE_DELAY, terrain.size)
    expect(world.alliances[0]!.leaderId).toBe(realm(tobin))
    expect(world.alliances[0]!.army.map((p) => p.id)).toEqual([s.id])
    expect(commanderOf(world, own)).toBe(realm(mara))
    expect(commanderOf(world, s)).toBe(realm(tobin))
    const leader = world.residents.find((r) => r.id === world.realms[1]!.leaderId)!
    dieAll(world, [leader], 'killed', terrain.size)
    expect(world.alliances).toEqual([])
    expect(commanderOf(world, s)).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('sends a dead Leader’s alliance-army soldiers home, out of the alliance leader’s army', () => {
    const { world, terrain, realm, order, soldier, carriage } = setup()
    const s = soldier(tobin)
    const k = carriage(tobin)
    order(tobin, { kind: 'handOverToAlliance', residentIds: [s.id], carriageIds: [k.id] })
    expect(order(mara, { kind: 'formArmy', name: 'Guard', residentIds: [s.id] })).toBe('ok')
    // Far out on the alliance leader's errand.
    const city = world.cities.find((c) => c.id === s.cityId)!
    s.x = (s.x + 30) % terrain.size
    expect(inCityArea(world, city, s.x, s.y, terrain.size)).toBe(false)
    expect(order(mara, { kind: 'walkTo', residentId: s.id, x: s.x + 1, y: s.y })).toBe('ok')
    const leader = world.residents.find((r) => r.id === world.realms[1]!.leaderId)!
    dieAll(world, [leader], 'killed', terrain.size)
    // The realm left at once; Mara's alliance carries on without Tobin's soldier and carriage.
    expect(world.alliances[0]!.members.map((m) => m.realmId)).toEqual([realm(mara)])
    expect(world.alliances[0]!.army).toEqual([])
    expect(world.armies).toEqual([])
    expect(commanderOf(world, s)).toBeNull()
    expect(k.realmId).toBeNull()
    const home = npcHome(world, city)!
    expect(s.order).toMatchObject({ kind: 'walkTo', target: { x: home.x, y: home.y } })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('reports alliance armies that don’t hold together', () => {
    const { world, terrain, order, soldier } = setup()
    const s = soldier(tobin)
    order(tobin, { kind: 'handOverToAlliance', residentIds: [s.id] })
    const a = world.alliances[0]!
    a.army.push(
      { is: 'resident', id: s.id, recallAt: world.tick },
      { is: 'carriage', id: 'carriage999', recallAt: null },
      { is: 'resident', id: soldier(ash).id, recallAt: null },
    )
    const messages = alliancesSound.check(world, terrain).map((v) => v.message)
    expect(messages).toEqual([
      `alliance ${a.id} shares resident ${s.id} in its army`,
      `alliance ${a.id} shares resident ${s.id} in its army`,
      `alliance ${a.id} has resident ${s.id} in its army recalled at tick ${world.tick}`,
      `alliance ${a.id} has carriage carriage999 in its army, which is gone`,
      `alliance ${a.id} has resident ${a.army[3]!.id} in its army, which is no member's`,
    ])
  })
})
