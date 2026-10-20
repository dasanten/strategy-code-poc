import {
  ALLIANCE_LEAVE_DELAY,
  ALLIANCE_NAME_MAX_LENGTH,
  allianceOf,
  diplomacyFor,
  realmName,
  realmsStandingTogether,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepAlliances } from './alliances.js'
import { alliancesSound, checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { foundStartingCity } from './starting-city.js'
import { dieAll } from './survival.js'
import { cityTerrain } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const player = (userId: number) => ({ userId, account: { name: `p${userId}`, isAdmin: false } })
const [mara, tobin, wren, ash] = [1, 2, 3, 4].map(player) as [
  ReturnType<typeof player>,
  ReturnType<typeof player>,
  ReturnType<typeof player>,
  ReturnType<typeof player>,
]

/** A world where four Players have their starting cities; `realm(p)` is a Player's realm id. */
function setup() {
  const terrain = cityTerrain()
  const world = createWorld(terrain)
  for (const p of [mara, tobin, wren, ash]) foundStartingCity(world, terrain, p.userId)
  const realm = (p: { userId: number }) => world.realms.find((r) => r.userId === p.userId)!.id
  const queue = new OrderQueue()
  /** Sends an order and applies it as the next tick would; returns the answer. */
  const order = (sender: ReturnType<typeof player>, o: object) => {
    const answer = queue.receive(world, sender, 'q', o)
    queue.applyAll(world)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  return { world, terrain, realm, order }
}

/** Mara founds "North"; Tobin, then Wren, are invited and join. */
function alliedWorld() {
  const s = setup()
  const { realm, order } = s
  order(mara, { kind: 'foundAlliance', name: 'North' })
  const id = allianceOf(s.world, realm(mara))!.id
  for (const p of [tobin, wren]) {
    order(mara, { kind: 'inviteToAlliance', realmId: realm(p) })
    s.world.tick++
    order(p, { kind: 'acceptInvite', allianceId: id })
  }
  return { ...s, id }
}

const members = (world: WorldState, id: string) =>
  world.alliances.find((a) => a.id === id)?.members.map((m) => m.realmId)

/** Moves time on by `ticks`, running alliances each tick as the world does. */
function pass(world: WorldState, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    world.tick++
    stepAlliances(world)
  }
}

describe('alliances', () => {
  it('founds an alliance with the founder as its only member and its leader', () => {
    const { world, realm, order } = setup()
    expect(order(mara, { kind: 'foundAlliance', name: '  North  ' })).toBe('ok')
    const a = allianceOf(world, realm(mara))!
    expect(a).toMatchObject({ name: 'North', leaderId: realm(mara), invites: [] })
    expect(a.members).toEqual([{ realmId: realm(mara), joinedAt: world.tick, leaving: null }])
    expect(order(mara, { kind: 'foundAlliance', name: 'South' })).toBe(
      'you are already in an alliance',
    )
    expect(order(tobin, { kind: 'foundAlliance', name: ' ' })).toBe('the alliance needs a name')
    const long = 'x'.repeat(ALLIANCE_NAME_MAX_LENGTH + 1)
    expect(order(tobin, { kind: 'foundAlliance', name: long })).toMatch(/at most/)
    expect(world.alliances).toHaveLength(1)
    expect(checkInvariants(world, cityTerrain())).toEqual([])
  })

  it('lets only the alliance leader invite, and the invited realm join', () => {
    const { world, realm, order } = setup()
    order(mara, { kind: 'foundAlliance', name: 'North' })
    const id = allianceOf(world, realm(mara))!.id
    expect(order(tobin, { kind: 'inviteToAlliance', realmId: realm(wren) })).toBe(
      'you are in no alliance',
    )
    expect(order(mara, { kind: 'inviteToAlliance', realmId: 'realm999' })).toBe('no such realm')
    expect(order(mara, { kind: 'inviteToAlliance', realmId: realm(tobin) })).toBe('ok')
    expect(order(mara, { kind: 'inviteToAlliance', realmId: realm(tobin) })).toBe('already invited')
    expect(world.events.at(-1)).toMatchObject({ kind: 'allianceInvited', userId: tobin.userId })
    expect(order(wren, { kind: 'acceptInvite', allianceId: id })).toBe(
      'you hold no such invitation',
    )

    expect(order(tobin, { kind: 'acceptInvite', allianceId: id })).toBe('ok')
    expect(members(world, id)).toEqual([realm(mara), realm(tobin)])
    expect(world.alliances[0]!.invites).toEqual([])
    expect(order(tobin, { kind: 'inviteToAlliance', realmId: realm(wren) })).toBe(
      'only the alliance leader can do that',
    )
    const joined = world.events.filter((e) => e.kind === 'allianceJoined')
    expect(joined.map((e) => e.userId).sort()).toEqual([mara.userId, tobin.userId])
    expect(checkInvariants(world, cityTerrain())).toEqual([])
  })

  it('keeps a realm in at most one alliance', () => {
    const { world, realm, order } = setup()
    order(mara, { kind: 'foundAlliance', name: 'North' })
    order(tobin, { kind: 'foundAlliance', name: 'South' })
    const [north, south] = world.alliances.map((a) => a.id) as [string, string]
    expect(order(mara, { kind: 'inviteToAlliance', realmId: realm(tobin) })).toBe(
      'that realm is already in an alliance',
    )
    order(mara, { kind: 'inviteToAlliance', realmId: realm(wren) })
    order(tobin, { kind: 'inviteToAlliance', realmId: realm(wren) })
    // Two invitations: accepting one lets the other lapse.
    expect(diplomacyFor(world, realm(wren), []).invitations).toHaveLength(2)
    expect(order(wren, { kind: 'acceptInvite', allianceId: south })).toBe('ok')
    expect(order(wren, { kind: 'acceptInvite', allianceId: north })).toBe(
      'you hold no such invitation',
    )
    expect(members(world, north)).toEqual([realm(mara)])
    expect(members(world, south)).toEqual([realm(tobin), realm(wren)])
    // Founding an alliance lets invitations lapse too.
    order(mara, { kind: 'inviteToAlliance', realmId: realm(ash) })
    order(ash, { kind: 'foundAlliance', name: 'East' })
    expect(world.alliances.find((a) => a.id === north)!.invites).toEqual([])
    expect(checkInvariants(world, cityTerrain())).toEqual([])
  })

  it('lets the invited realm decline and the alliance leader withdraw an invitation', () => {
    const { world, realm, order } = setup()
    order(mara, { kind: 'foundAlliance', name: 'North' })
    const a = allianceOf(world, realm(mara))!
    order(mara, { kind: 'inviteToAlliance', realmId: realm(tobin) })
    order(mara, { kind: 'inviteToAlliance', realmId: realm(wren) })
    expect(order(tobin, { kind: 'declineInvite', allianceId: a.id })).toBe('ok')
    expect(order(mara, { kind: 'withdrawInvite', realmId: realm(wren) })).toBe('ok')
    expect(order(mara, { kind: 'withdrawInvite', realmId: realm(wren) })).toBe(
      'that realm is not invited',
    )
    expect(a.invites).toEqual([])
    expect(order(wren, { kind: 'acceptInvite', allianceId: a.id })).toBe(
      'you hold no such invitation',
    )
    expect(a.members).toHaveLength(1)
  })

  it('lets a member leave after the leave delay, a member like any other until then', () => {
    const { world, realm, order, id } = alliedWorld()
    expect(order(wren, { kind: 'leaveAlliance' })).toBe('ok')
    expect(order(wren, { kind: 'leaveAlliance' })).toBe('you are already leaving')
    expect(order(wren, { kind: 'foundAlliance', name: 'South' })).toBe(
      'you are already in an alliance',
    )
    pass(world, ALLIANCE_LEAVE_DELAY - 1)
    expect(members(world, id)).toContain(realm(wren))
    expect(checkInvariants(world, cityTerrain())).toEqual([])
    pass(world, 1)
    expect(members(world, id)).toEqual([realm(mara), realm(tobin)])
    expect(world.events.at(-1)).toMatchObject({ kind: 'allianceLeft', why: 'left' })
    expect(order(wren, { kind: 'foundAlliance', name: 'South' })).toBe('ok')
    expect(checkInvariants(world, cityTerrain())).toEqual([])
  })

  it('lets only the alliance leader remove a member, after the leave delay', () => {
    const { world, realm, order, id } = alliedWorld()
    expect(order(tobin, { kind: 'removeFromAlliance', realmId: realm(wren) })).toBe(
      'only the alliance leader can do that',
    )
    expect(order(mara, { kind: 'removeFromAlliance', realmId: realm(mara) })).toBe(
      'to go yourself, leave the alliance',
    )
    expect(order(mara, { kind: 'removeFromAlliance', realmId: realm(ash) })).toBe(
      'that realm is not a member',
    )
    expect(order(mara, { kind: 'removeFromAlliance', realmId: realm(wren) })).toBe('ok')
    expect(order(wren, { kind: 'leaveAlliance' })).toBe('you are already leaving')
    pass(world, ALLIANCE_LEAVE_DELAY - 1)
    expect(members(world, id)).toContain(realm(wren))
    pass(world, 1)
    expect(members(world, id)).toEqual([realm(mara), realm(tobin)])
    const left = world.events.filter((e) => e.kind === 'allianceLeft')
    expect(left.map((e) => e.userId).sort()).toEqual([mara, tobin, wren].map((p) => p.userId))
    for (const e of left) expect(e).toMatchObject({ realmId: realm(wren), why: 'removed' })
  })

  it('passes the role to the longest-standing member when the alliance leader leaves', () => {
    const { world, realm, order, id } = alliedWorld()
    order(mara, { kind: 'leaveAlliance' })
    pass(world, ALLIANCE_LEAVE_DELAY - 1)
    expect(world.alliances[0]!.leaderId).toBe(realm(mara))
    pass(world, 1)
    expect(world.alliances[0]!.leaderId).toBe(realm(tobin))
    expect(members(world, id)).toEqual([realm(tobin), realm(wren)])
    expect(world.events.at(-1)).toMatchObject({ kind: 'allianceLeader', realmId: realm(tobin) })
    expect(order(tobin, { kind: 'inviteToAlliance', realmId: realm(ash) })).toBe('ok')
    expect(checkInvariants(world, cityTerrain())).toEqual([])
  })

  it('ends an alliance when its last member has left', () => {
    const { world, order } = setup()
    order(mara, { kind: 'foundAlliance', name: 'North' })
    order(mara, { kind: 'leaveAlliance' })
    pass(world, ALLIANCE_LEAVE_DELAY)
    expect(world.alliances).toEqual([])
  })

  it('takes a realm whose Leader dies out at once, the role passing on', () => {
    const { world, realm, order, id } = alliedWorld()
    order(mara, { kind: 'inviteToAlliance', realmId: realm(ash) })
    const leaderOf = (p: { userId: number }) =>
      world.residents.find(
        (r) => r.id === world.realms.find((x) => x.userId === p.userId)!.leaderId,
      )!
    // Tobin was leaving; dying ends that at once too.
    order(tobin, { kind: 'leaveAlliance' })
    const maraRealm = realm(mara)
    const tobinRealm = realm(tobin)
    dieAll(world, [leaderOf(mara), leaderOf(tobin)], 'starved', cityTerrain().size)
    expect(members(world, id)).toEqual([realm(wren)])
    expect(world.alliances[0]!.leaderId).toBe(realm(wren))
    expect(world.alliances[0]!.invites).toEqual([realm(ash)])
    const left = world.events.filter((e) => e.kind === 'allianceLeft' && e.userId === wren.userId)
    expect(left.map((e) => e.kind === 'allianceLeft' && e.realmId)).toEqual([maraRealm, tobinRealm])
    for (const e of left) expect(e).toMatchObject({ why: 'leaderDied' })
    expect(checkInvariants(world, cityTerrain())).toEqual([])
  })

  it('lets the invitations of a realm whose Leader dies lapse', () => {
    const { world, realm, order } = setup()
    order(mara, { kind: 'foundAlliance', name: 'North' })
    order(mara, { kind: 'inviteToAlliance', realmId: realm(tobin) })
    const tobinRealm = world.realms.find((x) => x.id === realm(tobin))!
    dieAll(
      world,
      [world.residents.find((r) => r.id === tobinRealm.leaderId)!],
      'oldAge',
      cityTerrain().size,
    )
    expect(world.alliances[0]!.invites).toEqual([])
    expect(checkInvariants(world, cityTerrain())).toEqual([])
  })

  it('lets leaves take effect as the world steps', () => {
    const { world, terrain, realm, order, id } = alliedWorld()
    order(wren, { kind: 'leaveAlliance' })
    for (let i = 0; i < ALLIANCE_LEAVE_DELAY; i++) stepWorld(world, terrain)
    expect(members(world, id)).toEqual([realm(mara), realm(tobin)])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('groups realms standing together and tells each Player their alliance matters', () => {
    const { world, realm, order, id } = alliedWorld()
    order(mara, { kind: 'inviteToAlliance', realmId: realm(ash) })
    order(tobin, { kind: 'leaveAlliance' })
    expect(realmsStandingTogether(world)).toEqual([
      [realm(mara), realm(tobin), realm(wren)],
      [realm(ash)],
    ])
    const name = (p: { userId: number }) => realmName(world, realm(p))
    expect(name(mara)).toBe(world.residents.find((r) => r.id === world.realms[0]!.leaderId)!.name)
    expect(diplomacyFor(world, realm(tobin), [realm(ash), realm(tobin), realm(ash)])).toEqual({
      alliance: {
        id,
        name: 'North',
        leaderId: realm(mara),
        members: [
          { realmId: realm(mara), realm: name(mara), joinedAt: 0, leavesAt: null },
          {
            realmId: realm(tobin),
            realm: name(tobin),
            joinedAt: 1,
            leavesAt: world.tick + ALLIANCE_LEAVE_DELAY,
          },
          { realmId: realm(wren), realm: name(wren), joinedAt: 2, leavesAt: null },
        ],
        invites: [{ realmId: realm(ash), realm: name(ash) }],
        army: [],
      },
      invitations: [],
      realmsInSight: [{ realmId: realm(ash), realm: name(ash) }],
      contracts: [],
    })
    expect(diplomacyFor(world, realm(ash), [])).toEqual({
      alliance: null,
      invitations: [{ allianceId: id, name: 'North', leader: name(mara) }],
      realmsInSight: [],
      contracts: [],
    })
  })

  it('reports alliances that don’t hold together', () => {
    const { world, realm, order } = alliedWorld()
    const a = world.alliances[0]!
    a.leaderId = realm(ash)
    a.invites.push(realm(tobin), 'realm999')
    world.alliances.push({
      id: 'alliance999',
      name: '',
      leaderId: realm(wren),
      members: [{ realmId: realm(wren), joinedAt: 0, leaving: { at: 0, removed: false } }],
      invites: [],
      army: [],
    })
    order(mara, { kind: 'leaveAlliance' })
    const messages = alliancesSound.check(world, cityTerrain()).map((v) => v.message)
    expect(messages).toEqual([
      `alliance ${a.id} has leader ${realm(ash)}, who is not a member`,
      `alliance ${a.id} shares member ${realm(wren)}`,
      `alliance ${a.id} invites ${realm(tobin)}, which is in an alliance`,
      `alliance ${a.id} invites realm999, which has ended`,
      'alliance alliance999 has a bad name ""',
      `alliance alliance999 shares member ${realm(wren)}`,
      `alliance alliance999 has member ${realm(wren)} leaving at tick 0`,
    ])
  })
})
