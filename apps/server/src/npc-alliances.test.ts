import {
  ALLIANCE_LEAVE_DELAY,
  CRIME_MEMORY_DAYS,
  NPC_ALLIANCE_JOIN_STANDING,
  NPC_ALLIANCE_LEAVE_STANDING,
  TICKS_PER_GAME_DAY,
  Terrain,
  allianceOf,
  diplomacyFor,
  wallMap,
  type Crime,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepAlliances } from './alliances.js'
import { alliancesSound, checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { createWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const player = (userId: number) => ({ userId, account: { name: `p${userId}`, isAdmin: false } })
const [mara, tobin] = [player(1), player(2)]

function resident(world: WorldState, id: string, owner: string | null, x: number, y: number) {
  const cityId = owner === null ? 'npc' : null
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x,
    y,
    tick: world.tick,
  })
  world.residents.push(r)
  return r
}

/**
 * Realms r1 (Mara, leading the alliance "North") and r2 (Tobin, its other member), the NPC city
 * npc (Dunmere) with its resident n1, and the Trade Org post. `order` sends an order and applies
 * it as the next tick would; `pass` moves time on, running alliances each tick.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push(
    { id: 'r1', userId: 1, leaderId: 'a1' },
    { id: 'r2', userId: 2, leaderId: 'b1' },
  )
  resident(world, 'a1', 'r1', 5, 5)
  resident(world, 'b1', 'r2', 40, 5)
  addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  resident(world, 'n1', null, 21, 20)
  addCity(world, { id: 'post', realmId: null, x: 50, y: 50, name: 'Post' }).tradeOrg = 'post'
  const queue = new OrderQueue()
  const order = (sender: ReturnType<typeof player>, o: object) => {
    const answer = queue.receive(world, sender, 'q', o)
    queue.applyAll(world)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  const pass = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      world.tick++
      stepAlliances(world)
    }
  }
  order(mara, { kind: 'foundAlliance', name: 'North' })
  const alliance = allianceOf(world, 'r1')!
  order(mara, { kind: 'inviteToAlliance', realmId: 'r2' })
  order(tobin, { kind: 'acceptInvite', allianceId: alliance.id })
  return { world, alliance, order, pass }
}

/** Dunmere holds both realms in high standing. */
function wellRegarded() {
  const s = setup()
  for (const r of ['r1', 'r2']) changeStanding(s.world, 'npc', r, NPC_ALLIANCE_JOIN_STANDING)
  return s
}

/** A crime by Tobin's Leader against Dunmere at `tick`, known to Dunmere when `known`. */
function crimeAgainstCity(world: WorldState, tick: number, known: boolean): Crime {
  const crime: Crime = {
    id: 'x1',
    kind: 'theft',
    tick,
    x: 20,
    y: 20,
    culprit: { residentId: 'b1', name: 'Tobin', org: 'r2', orgName: 'the realm of Tobin' },
    victimOrg: 'npc',
    goods: { food: 1 },
    witnesses: [],
    knownBy: known ? ['npc'] : [],
  }
  world.crimes.push(crime)
  return crime
}

const members = (world: WorldState) => world.alliances[0]?.members.map((m) => m.realmId)
const lastEvent = (world: WorldState, userId: number) =>
  world.events.filter((e) => e.userId === userId).at(-1)

describe('NPC cities in alliances', () => {
  it('joins at once when it holds every member in high standing', () => {
    const { world, order } = wellRegarded()
    expect(order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })).toBe('ok')
    expect(members(world)).toEqual(['r1', 'r2', 'npc'])
    expect(world.alliances[0]!.invites).toEqual([])
    for (const p of [mara, tobin]) {
      expect(lastEvent(world, p.userId)).toMatchObject({
        kind: 'allianceJoined',
        realmId: 'npc',
        realm: 'Dunmere',
        city: true,
      })
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('declines when it holds one member short of high standing', () => {
    const { world, order } = setup()
    changeStanding(world, 'npc', 'r1', NPC_ALLIANCE_JOIN_STANDING)
    changeStanding(world, 'npc', 'r2', NPC_ALLIANCE_JOIN_STANDING - 1)
    expect(order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })).toBe('ok')
    expect(members(world)).toEqual(['r1', 'r2'])
    expect(world.alliances[0]!.invites).toEqual([])
    expect(lastEvent(world, mara.userId)).toMatchObject({
      kind: 'allianceDeclined',
      realmId: 'npc',
      realm: 'Dunmere',
    })
    expect(lastEvent(world, tobin.userId)?.kind).toBe('allianceJoined')
  })

  it('declines while it knows of a recent crime by a member, but not one it never learnt of', () => {
    const { world, order } = wellRegarded()
    world.tick = 10 * TICKS_PER_GAME_DAY
    const crime = crimeAgainstCity(world, world.tick - 1, false)
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    expect(members(world)).toContain('npc')
    order(mara, { kind: 'removeFromAlliance', realmId: 'npc' })
    world.tick += ALLIANCE_LEAVE_DELAY
    stepAlliances(world)
    expect(members(world)).toEqual(['r1', 'r2'])
    crime.knownBy.push('npc')
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    expect(members(world)).toEqual(['r1', 'r2'])
    expect(lastEvent(world, mara.userId)?.kind).toBe('allianceDeclined')
    // Once the crime is older than CRIME_MEMORY_DAYS it is no longer recent.
    world.tick = crime.tick + CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    expect(members(world)).toContain('npc')
  })

  it('leaves on its own when its standing toward a member falls too low', () => {
    const { world, order, pass } = wellRegarded()
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    // Standing fading toward neutral is no reason to go.
    changeStanding(world, 'npc', 'r2', -NPC_ALLIANCE_JOIN_STANDING)
    pass(1)
    expect(world.alliances[0]!.members.find((m) => m.realmId === 'npc')!.leaving).toBeNull()
    changeStanding(world, 'npc', 'r2', NPC_ALLIANCE_LEAVE_STANDING - 1)
    pass(1)
    const leaving = world.alliances[0]!.members.find((m) => m.realmId === 'npc')!.leaving
    expect(leaving).toEqual({ at: world.tick + ALLIANCE_LEAVE_DELAY, removed: false })
    expect(checkInvariants(world, terrain)).toEqual([])
    pass(ALLIANCE_LEAVE_DELAY)
    expect(members(world)).toEqual(['r1', 'r2'])
    expect(lastEvent(world, mara.userId)).toMatchObject({
      kind: 'allianceLeft',
      realmId: 'npc',
      realm: 'Dunmere',
      why: 'left',
      city: true,
    })
  })

  it('leaves at once when it joins a realm', () => {
    const { world, order, pass } = wellRegarded()
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    world.cities.find((c) => c.id === 'npc')!.realmId = 'r1'
    pass(1)
    expect(members(world)).toEqual(['r1', 'r2'])
  })

  it('never leads: the role passes to a realm, and an alliance with no realm left ends', () => {
    const { world, alliance, order, pass } = wellRegarded()
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    // Dunmere joined after Tobin; make it the longest-standing member.
    alliance.members.sort((a, b) => (a.realmId === 'npc' ? -1 : b.realmId === 'npc' ? 1 : 0))
    alliance.members.forEach((m) => (m.joinedAt = 0))
    order(mara, { kind: 'leaveAlliance' })
    pass(ALLIANCE_LEAVE_DELAY)
    expect(alliance.leaderId).toBe('r2')
    order(tobin, { kind: 'leaveAlliance' })
    pass(ALLIANCE_LEAVE_DELAY)
    expect(world.alliances).toEqual([])
  })

  it('can’t be the Trade Organization, nor a city already in an alliance', () => {
    const { world, order } = wellRegarded()
    expect(order(mara, { kind: 'inviteToAlliance', realmId: 'post' })).toBe(
      'no such realm or NPC city',
    )
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    expect(order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })).toBe(
      'they are already in an alliance',
    )
    expect(members(world)).toEqual(['r1', 'r2', 'npc'])
  })

  it('shares walls and shows as an NPC city in alliance matters', () => {
    const { world, order } = wellRegarded()
    world.buildings.push({ id: 'w', kind: 'wall', cityId: 'npc', x: 22, y: 22 })
    expect(diplomacyFor(world, 'r1', ['npc', 'post']).realmsInSight).toEqual([
      { realmId: 'npc', realm: 'Dunmere', city: true },
    ])
    const wallSides = () => wallMap(world, terrain).tiles.get(22 * terrain.size + 22)!.realms
    expect(wallSides()).toEqual(['npc'])
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    expect(wallSides()).toEqual(['r1', 'r2', 'npc'])
    const view = diplomacyFor(world, 'r2', [])
    expect(view.alliance!.members.at(-1)).toMatchObject({
      realmId: 'npc',
      realm: 'Dunmere',
      city: true,
    })
    expect(view.realmsInSight).toEqual([])
  })

  it('shares sight: members see through its residents', () => {
    const { world, order } = wellRegarded()
    resident(world, 'stranger', null, 24, 24)
    world.residents.find((r) => r.id === 'stranger')!.cityId = null
    const seen = () => entitiesInSight(world, terrain, 'r1').some((e) => e.id === 'stranger')
    expect(seen()).toBe(false)
    order(mara, { kind: 'inviteToAlliance', realmId: 'npc' })
    expect(seen()).toBe(true)
  })

  it('reports a Trade Org city member and an NPC city leader', () => {
    const { world, alliance } = wellRegarded()
    alliance.members.push({ realmId: 'post', joinedAt: world.tick, leaving: null })
    alliance.members.push({ realmId: 'npc', joinedAt: world.tick, leaving: null })
    alliance.leaderId = 'npc'
    expect(alliancesSound.check(world, terrain).map((v) => v.message)).toEqual([
      `alliance ${alliance.id} has leader npc, which is no realm`,
      `alliance ${alliance.id} has member post, which is no realm or NPC city`,
    ])
  })
})
