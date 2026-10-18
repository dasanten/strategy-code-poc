import {
  REALM_LOG_LENGTH,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepAging } from './aging.js'
import { eventsFor, recordEvent } from './events.js'
import { checkInvariants } from './invariants.js'
import { foundStartingCity } from './starting-city.js'
import { stepSpoilage } from './spoilage.js'
import { stepSurvival } from './survival.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'

const terrain = cityTerrain()

const storageOf = (world: WorldState) => world.buildings.find((b) => b.kind === 'storage')!

describe('realm events', () => {
  it('logs each resident going hungry once, then deaths until the Leader’s ends the realm', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    const people = world.residents.map((r) => r.id)
    storageOf(world).stock = {}
    const deaths: { id: string; tick: number }[] = []
    for (let t = 0; t < 3 * TICKS_PER_GAME_DAY; t++) {
      for (const r of stepSurvival(world, terrain).died) deaths.push({ id: r.id, tick: world.tick })
      world.tick++
    }
    const log = eventsFor(world, realm.userId)
    const hungry = log.filter((e) => e.kind === 'hungry')
    expect(hungry.map((e) => e.kind === 'hungry' && e.residentId).sort()).toEqual(people.sort())
    // Deaths reach the Player until their Leader's, those on the same tick included; after it
    // the residents belong to nobody.
    const leaderDied = deaths.find((d) => d.id === realm.leaderId)!.tick
    const theirs = deaths.filter((d) => d.tick <= leaderDied).map((d) => d.id)
    const died = log.filter((e) => e.kind === 'died')
    expect(died.map((e) => e.kind === 'died' && e.residentId).sort()).toEqual(theirs.sort())
    expect(died.every((e) => e.kind === 'died' && e.cause === 'starved')).toBe(true)
    expect(died.filter((e) => e.kind === 'died' && e.leader)).toEqual([
      expect.objectContaining({ residentId: realm.leaderId, tick: leaderDied }),
    ])
    expect(world.realms).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('logs a death of old age', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    const r = world.residents.find((x) => x.id !== realm.leaderId)!
    r.bornAt = world.tick - r.lifespan * TICKS_PER_GAME_YEAR
    stepAging(world)
    expect(eventsFor(world, realm.userId)).toEqual([
      {
        kind: 'died',
        residentId: r.id,
        name: r.name,
        cause: 'oldAge',
        leader: false,
        seq: expect.any(Number),
        tick: world.tick,
        userId: realm.userId,
      },
    ])
  })

  it('logs what food a realm lost to spoilage each game day, and not what lay in piles', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    storageOf(world).stock = { food: 1000 }
    world.carriages[0]!.load = { food: 100 }
    world.piles.push({ id: 'p1', x: world.residents[0]!.x, y: 0, goods: { food: 500 } })
    for (let t = 0; t < TICKS_PER_GAME_DAY; t++) {
      stepSpoilage(world)
      world.tick++
    }
    const lost = 1100 - storageOf(world).stock!.food! - world.carriages[0]!.load.food!
    expect(lost).toBeGreaterThan(0)
    expect(eventsFor(world, realm.userId)).toEqual([
      expect.objectContaining({ kind: 'foodSpoiled', units: lost }),
    ])
  })

  it('keeps each Player’s own events, the latest REALM_LOG_LENGTH of them', () => {
    const { world } = worldWithCity()
    const mine = world.realms[0]!
    const theirs = foundStartingCity(world, terrain, 2)
    recordEvent(world, theirs.id, { kind: 'foodSpoiled', units: 1 })
    for (let i = 0; i < REALM_LOG_LENGTH + 5; i++) {
      recordEvent(world, mine.id, { kind: 'foodSpoiled', units: i })
    }
    const log = eventsFor(world, mine.userId)
    expect(log).toHaveLength(REALM_LOG_LENGTH)
    expect(log[0]).toMatchObject({ units: 5 })
    expect(eventsFor(world, 2)).toEqual([expect.objectContaining({ units: 1 })])
    expect(eventsFor(world, mine.userId, log[1]!.seq)).toEqual(log.slice(2))
    // Nobody's events are kept for nobody.
    recordEvent(world, null, { kind: 'foodSpoiled', units: 9 })
    expect(world.events).toHaveLength(REALM_LOG_LENGTH + 1)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('are watched by an invariant: in order, numbered below the next id, within the cap', () => {
    const { world } = worldWithCity()
    const realm = world.realms[0]!
    recordEvent(world, realm.id, { kind: 'foodSpoiled', units: 1 })
    recordEvent(world, realm.id, { kind: 'foodSpoiled', units: 2 })
    world.events.reverse()
    world.events.push({ ...world.events[0]!, seq: world.nextId + 1, tick: world.tick + 1 })
    for (let i = 0; i < REALM_LOG_LENGTH; i++) world.events.push({ ...world.events[0]! })
    const messages = checkInvariants(world, terrain)
      .filter((v) => v.invariant === 'realm-logs-in-order')
      .map((v) => v.message)
    expect(messages.some((m) => /logged after/.test(m))).toBe(true)
    expect(messages.some((m) => /past next id/.test(m))).toBe(true)
    expect(messages.some((m) => /after now/.test(m))).toBe(true)
    expect(messages.some((m) => m.endsWith(`over ${REALM_LOG_LENGTH}`))).toBe(true)
  })
})
