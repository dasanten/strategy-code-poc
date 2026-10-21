import {
  STANDING_DRIFT_PER_DAY,
  STANDING_RANGE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_NAME,
  Terrain,
  diplomacyFor,
  standingOf,
  standingsFor,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32 } from './residents.js'
import { changeStanding, standingsSound, stepStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { createWorld } from './world.js'

const size = 128
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }

/** Realms r1 and r2 with a city each, an NPC city n1, and the Trade Org HQ. */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 5, y: 5 })
  addCity(world, { id: 'c2', realmId: 'r2', x: 110, y: 110 })
  addCity(world, { id: 'n1', realmId: null, x: 20, y: 110, name: 'Oakford' })
  const hq = foundTradeOrgHq(world, terrain, 64, 64, mulberry32(1))
  return { world, hq }
}

const sound = (world: ReturnType<typeof setup>['world']) =>
  checkInvariants(world, terrain, [standingsSound])

describe('standing', () => {
  it('is neutral until something happens, and one-sided', () => {
    const { world } = setup()
    expect(standingOf(world, 'r1', 'r2')).toBe(0)
    changeStanding(world, 'n1', 'r1', -12)
    expect(standingOf(world, 'n1', 'r1')).toBe(-12)
    expect(standingOf(world, 'r1', 'n1')).toBe(0)
    expect(sound(world)).toEqual([])
  })

  it('stays within its range', () => {
    const { world } = setup()
    changeStanding(world, 'n1', 'r1', -500)
    expect(standingOf(world, 'n1', 'r1')).toBe(-STANDING_RANGE)
    changeStanding(world, 'r1', 'r2', 80)
    changeStanding(world, 'r1', 'r2', 80)
    expect(standingOf(world, 'r1', 'r2')).toBe(STANDING_RANGE)
    expect(sound(world)).toEqual([])
  })

  it('is never held toward oneself, and names the Trade Organization as one', () => {
    const { world, hq } = setup()
    changeStanding(world, 'r1', 'r1', 10)
    expect(world.standings).toEqual([])
    changeStanding(world, hq.id, 'r1', -5)
    expect(world.standings).toEqual([{ of: TRADE_ORG, toward: 'r1', value: -5 }])
    expect(standingOf(world, TRADE_ORG, 'r1')).toBe(-5)
  })

  it('drifts back to neutral, and is dropped once there', () => {
    const { world } = setup()
    changeStanding(world, 'n1', 'r1', -2 * STANDING_DRIFT_PER_DAY)
    changeStanding(world, 'r2', 'r1', STANDING_DRIFT_PER_DAY)
    for (let i = 0; i < TICKS_PER_GAME_DAY; i++) stepStanding(world)
    expect(standingOf(world, 'n1', 'r1')).toBeCloseTo(-STANDING_DRIFT_PER_DAY, 6)
    expect(standingOf(world, 'r2', 'r1')).toBeCloseTo(0, 6)
    for (let i = 0; i < TICKS_PER_GAME_DAY + 1; i++) stepStanding(world)
    expect(world.standings).toEqual([])
    expect(sound(world)).toEqual([])
  })

  it('is forgotten with an Organization that is gone', () => {
    const { world } = setup()
    changeStanding(world, 'n1', 'r2', -30)
    changeStanding(world, 'r1', 'r2', 30)
    changeStanding(world, 'r1', 'n1', 5)
    // The realm of r2 ended; n1 joined r1's realm and is part of its Organization now.
    world.realms = world.realms.filter((r) => r.id !== 'r2')
    world.cities.find((c) => c.id === 'n1')!.realmId = 'r1'
    expect(sound(world).map((v) => v.message)).toEqual([
      'standing n1 → r2 names n1, which is gone',
      'standing n1 → r2 names r2, which is gone',
      'standing r1 → r2 names r2, which is gone',
      'standing r1 → n1 names n1, which is gone',
    ])
    stepStanding(world)
    expect(world.standings).toEqual([])
  })

  it('has an invariant that catches standing out of range, neutral, twice or toward itself', () => {
    const { world, hq } = setup()
    world.standings = [
      { of: 'r1', toward: 'r2', value: 101 },
      { of: 'r1', toward: 'r2', value: 5 },
      { of: 'r2', toward: 'r1', value: 0 },
      { of: 'r1', toward: 'r1', value: 3 },
      { of: hq.id, toward: 'r1', value: 3 },
    ]
    expect(sound(world).map((v) => v.message)).toEqual([
      'standing r1 → r2 is 101, out of its range',
      'standing r1 → r2 is kept twice',
      'standing r2 → r1 is neutral but kept',
      'r1 has a standing toward itself',
      `standing ${hq.id} → r1 names a Trade Org city instead of the Trade Organization`,
    ])
  })

  it('shows a Player how others regard their realm and how it regards them, worst first', () => {
    const { world } = setup()
    changeStanding(world, TRADE_ORG, 'r1', 20.4)
    changeStanding(world, 'r1', TRADE_ORG, 3)
    changeStanding(world, 'n1', 'r1', -40)
    changeStanding(world, 'r1', 'r2', -7)
    changeStanding(world, 'r2', 'n1', -90)
    const leader = (id: string) => world.residents.find((r) => r.id === id)
    expect(leader('b1')).toBeUndefined()
    expect(standingsFor(world, 'r1')).toEqual([
      { org: 'n1', name: 'Oakford', is: 'city', theirs: -40, yours: 0 },
      { org: 'r2', name: 'a fallen realm', is: 'realm', theirs: 0, yours: -7 },
      { org: TRADE_ORG, name: TRADE_ORG_NAME, is: 'tradeOrg', theirs: 20, yours: 3 },
    ])
    expect(diplomacyFor(world, 'r1', []).standings).toEqual(standingsFor(world, 'r1'))
    expect(standingsFor(world, 'r2')).toEqual([
      { org: 'r1', name: 'a fallen realm', is: 'realm', theirs: -7, yours: 0 },
      { org: 'n1', name: 'Oakford', is: 'city', theirs: 0, yours: -90 },
    ])
  })
})
