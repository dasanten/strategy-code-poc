import {
  CRIME_MEMORY_DAYS,
  CRIME_STANDING_LOSS,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  Terrain,
  standingOf,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { resolveCarrying } from './carrying.js'
import { attackOrder, resolveStrikes } from './combat.js'
import { commitCrime } from './crimes.js'
import { eventsFor } from './events.js'
import { checkInvariants, crimesSound } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { resolveTearingDown } from './teardown.js'
import { addCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const size = 256
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }

/**
 * A world with realm r1 (Player 7, Leader a1, city c1 at (5, 5)) and realm r2 (Player 8, Leader
 * b1, city c2 at (40, 40)). Both Leaders stand far from home.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 5, y: 5 })
  addCity(world, { id: 'c2', realmId: 'r2', x: 40, y: 40, name: 'Brook' })
  const a = resident(world, 'a1', 'r1', 'c1', 20, 20)
  const b = resident(world, 'b1', 'r2', 'c2', 21, 20)
  return { world, a, b }
}

function resident(
  world: WorldState,
  id: string,
  owner: string | null,
  cityId: string | null,
  x: number,
  y: number,
) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.cityId = cityId
  for (const s of ['strength', 'endurance', 'intellect'] as const)
    r.stats[s] = { base: 10, trained: 0 }
  r.stats.agility = { base: 0, trained: 0 }
  r.bornAt = -20 * TICKS_PER_GAME_YEAR
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** Steps the world, keeping residents fed, and checks the crime invariant every tick. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
    expect(checkInvariants(world, terrain, [crimesSound])).toEqual([])
  }
}

const crimeLog = (world: WorldState, userId: number) =>
  eventsFor(world, userId).filter((e) => e.kind === 'crimeKnown')

describe('crimes and witnesses', () => {
  it('an attack with no witness getting home has no consequence', () => {
    const { world, a, b } = setup()
    a.order = attackOrder(b.id)
    a.order.strike = 0.99
    resolveStrikes(world, [{ attackerId: a.id, targetId: b.id }], size)
    expect(world.crimes).toHaveLength(1)
    expect(world.crimes[0]).toMatchObject({
      kind: 'attack',
      victimOrg: 'r2',
      culprit: { residentId: 'a1', org: 'r1', name: a.name },
      witnesses: ['b1'],
    })
    // The victim dies before getting home: the news dies with them.
    world.residents = world.residents.filter((r) => r !== b)
    a.order = null
    run(world)
    expect(world.crimes).toEqual([])
    expect(crimeLog(world, 8)).toEqual([])
  })

  it('a surviving victim who gets home makes the attack known, logged with who did it', () => {
    const { world, a, b } = setup()
    a.order = attackOrder(b.id)
    resolveStrikes(world, [{ attackerId: a.id, targetId: b.id }], size)
    a.order = null
    b.order = null
    run(world)
    expect(world.crimes[0]!.knownBy).toEqual([])
    expect(crimeLog(world, 8)).toEqual([])
    // Home, in their city's area.
    b.x = 40
    b.y = 41
    run(world)
    expect(world.crimes[0]!.knownBy).toEqual(['r2'])
    expect(world.crimes[0]!.witnesses).toEqual([])
    const [e] = crimeLog(world, 8)
    expect(e).toMatchObject({
      kind: 'crimeKnown',
      crime: 'attack',
      culpritId: 'a1',
      culprit: a.name,
      culpritOrg: `the realm of ${a.name}`,
      victim: b.name,
    })
    // The culprit's Player hears nothing of it.
    expect(crimeLog(world, 7)).toEqual([])
    // The victim's realm now regards the culprit's worse; not the other way round.
    expect(standingOf(world, 'r2', 'r1')).toBeCloseTo(-CRIME_STANDING_LOSS.attack, 2)
    expect(standingOf(world, 'r1', 'r2')).toBe(0)
    // Known once: staying home logs nothing more, and costs no more standing.
    run(world, 3)
    expect(crimeLog(world, 8)).toHaveLength(1)
    expect(standingOf(world, 'r2', 'r1')).toBeCloseTo(-CRIME_STANDING_LOSS.attack, 2)
  })

  it('a known crime is forgotten after the crime memory runs out', () => {
    const { world, a, b } = setup()
    commitCrime(world, size, 'attack', a, { victimOrg: 'r2', victim: b })
    b.x = 40
    b.y = 40
    run(world)
    expect(world.crimes).toHaveLength(1)
    world.tick = CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY + 1
    run(world)
    expect(world.crimes).toEqual([])
  })

  it('a bystander of a third Organization makes it known to their own', () => {
    const { world, a } = setup()
    world.realms.push({ id: 'r3', userId: 9, leaderId: 'c' })
    addCity(world, { id: 'c3', realmId: 'r3', x: 30, y: 5 })
    const victim = resident(world, 'v', 'r2', 'c2', 21, 20)
    const bystander = resident(world, 'w', 'r3', 'c3', 20 + SIGHT_RANGE, 20)
    resident(world, 'far', 'r2', 'c2', 21 + SIGHT_RANGE, 20)
    commitCrime(world, size, 'killing', a, { victimOrg: 'r2', victim })
    expect(world.crimes.at(-1)!.witnesses).toEqual(expect.arrayContaining(['b1', 'v', 'w']))
    expect(world.crimes.at(-1)!.witnesses).not.toContain('far')
    bystander.x = 30
    bystander.y = 6
    run(world)
    expect(world.crimes.at(-1)!.knownBy).toEqual(['r3'])
    // Only the victim's realm logs it, and it does not know yet.
    expect(crimeLog(world, 8)).toEqual([])
    expect(crimeLog(world, 9)).toEqual([])
    // Standing is the victim's affair: the bystander's realm thinks no worse of the culprit.
    expect(world.standings).toEqual([])
  })

  it('fighting back is no crime', () => {
    const { world, a, b } = setup()
    b.carried.spear = 1
    a.order = attackOrder(b.id)
    resolveStrikes(world, [{ attackerId: a.id, targetId: b.id }], size)
    expect(b.order).toMatchObject({ kind: 'attack', targetId: a.id, defending: true })
    resolveStrikes(world, [{ attackerId: b.id, targetId: a.id }], size)
    expect(world.crimes.map((c) => c.culprit.residentId)).toEqual(['a1'])
  })

  it('a killing is a crime, the dead victim no witness', () => {
    const { world, a, b } = setup()
    b.health = 1
    a.order = attackOrder(b.id)
    resolveStrikes(world, [{ attackerId: a.id, targetId: b.id }], size)
    expect(world.crimes.map((c) => c.kind)).toEqual(['attack', 'killing'])
    expect(world.crimes[1]!.witnesses).toEqual([])
    run(world)
    // Nobody saw it and lived: it is gone without consequence.
    expect(world.crimes).toEqual([])
  })

  it('taking from another Organization’s storage is theft; thefts add up until known', () => {
    const { world, a, b } = setup()
    world.buildings.push({
      id: 's',
      kind: 'storage',
      cityId: 'c2',
      x: 20,
      y: 20,
      stock: { food: 9 },
    })
    const take = {
      kind: 'take' as const,
      residentId: a.id,
      spot: { kind: 'storage' as const, storageId: 's' },
    }
    resolveCarrying(world, [{ ...take, goods: { food: 2 } }], size)
    resolveCarrying(world, [{ ...take, goods: { food: 3 } }], size)
    expect(world.crimes).toHaveLength(1)
    expect(world.crimes[0]).toMatchObject({ kind: 'theft', goods: { food: 5 }, witnesses: ['b1'] })
    b.x = 40
    b.y = 40
    run(world)
    expect(crimeLog(world, 8)[0]).toMatchObject({ crime: 'theft', goods: { food: 5 } })
  })

  it('taking from a pile or one’s own storage is no crime', () => {
    const { world, a } = setup()
    world.buildings.push({
      id: 's',
      kind: 'storage',
      cityId: 'c1',
      x: 20,
      y: 20,
      stock: { food: 9 },
    })
    world.piles.push({ id: 'p', x: 20, y: 20, goods: { wood: 2 } })
    resolveCarrying(
      world,
      [
        {
          kind: 'take',
          residentId: a.id,
          spot: { kind: 'storage', storageId: 's' },
          goods: { food: 1 },
        },
        { kind: 'take', residentId: a.id, spot: { kind: 'ground' }, goods: { wood: 1 } },
      ],
      size,
    )
    expect(world.crimes).toEqual([])
  })

  it('tearing down another Organization’s building is a crime', () => {
    const { world, a, b } = setup()
    world.buildings.push({ id: 'h', kind: 'house', cityId: 'c2', x: 20, y: 20, teardown: 1e9 })
    a.order = { kind: 'tearDown', buildingId: 'h', at: { x: 20, y: 20 } }
    resolveTearingDown(world, [{ residentId: a.id }], terrain)
    expect(world.crimes[0]).toMatchObject({ kind: 'tearDown', building: 'house', victimOrg: 'r2' })
    b.x = 40
    b.y = 40
    run(world)
    expect(crimeLog(world, 8)[0]).toMatchObject({ crime: 'tearDown', building: 'house' })
  })

  it('NPC city residents witness for their city', () => {
    const { world, a } = setup()
    addCity(world, { id: 'n', realmId: null, x: 50, y: 10, name: 'Oakvale' })
    const npc = resident(world, 'n1', null, 'n', 22, 20)
    commitCrime(world, size, 'attack', a, { victimOrg: 'n', victim: npc })
    expect(world.crimes[0]!.victimOrg).toBe('n')
    npc.x = 50
    npc.y = 11
    run(world)
    expect(world.crimes[0]!.knownBy).toContain('n')
  })
})

describe('crimes-sound invariant', () => {
  it('flags a witness of the culprit’s own Organization and a forgotten crime', () => {
    const { world, a, b } = setup()
    commitCrime(world, size, 'attack', a, { victimOrg: 'r2', victim: b })
    world.crimes[0]!.witnesses.push('a1')
    world.crimes.push({ ...world.crimes[0]!, id: 'old', witnesses: [], knownBy: [] })
    const messages = checkInvariants(world, terrain, [crimesSound]).map((v) => v.message)
    expect(messages).toEqual([
      `crime ${world.crimes[0]!.id} has witness a1 of the culprit’s Organization`,
      'crime old is kept though forgotten',
    ])
  })
})
