import * as shared from '@csp/shared'
import type { Resident } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import * as formulas from './formulas.js'
import { Terrain } from './formulas.js'

/**
 * Each formula against its twin in `packages/shared`, for residents young and old, weak and strong,
 * with and without skills and weapons. Deleted with `packages/shared` at the cutover.
 */
const AT = 1_000_000

function resident(over: {
  strength?: number
  endurance?: number
  agility?: number
  intellect?: number
  trained?: number
  age?: number
  skills?: Resident['skills']
  carried?: Resident['carried']
}): Resident {
  const stat = (base: number) => ({ base, trained: over.trained ?? 0 })
  return {
    id: 'r',
    name: 'R',
    owner: null,
    cityId: null,
    x: 0,
    y: 0,
    stats: {
      strength: stat(over.strength ?? 10),
      endurance: stat(over.endurance ?? 10),
      agility: stat(over.agility ?? 10),
      intellect: stat(over.intellect ?? 10),
    },
    skills: over.skills ?? {},
    health: shared.MAX_HEALTH,
    hunger: shared.MAX_HUNGER,
    bornAt: AT - shared.ticksForAge(over.age ?? 30),
    carried: over.carried ?? {},
  } as Resident
}

const RESIDENTS: Resident[] = [
  resident({}),
  resident({ strength: 16, agility: 4, endurance: 3, intellect: 18, trained: 2 }),
  resident({ strength: 2, agility: 19, endurance: 19, intellect: 1 }),
  resident({ age: 70, strength: 14 }),
  resident({ age: 130, strength: 14 }),
  resident({ skills: { construction: 40, driving: 30, combat: 25, mining: 60, smelting: 10 } }),
  resident({ strength: 15, carried: { spear: 1, sword: 1, shield: 1 }, skills: { combat: 50 } }),
]

const HORSES = [
  { stats: { speed: 10, strength: 10, endurance: 10 } },
  { stats: { speed: 18, strength: 3, endurance: 20 } },
  { stats: { speed: 1, strength: 20, endurance: 1 } },
]

const TERRAINS = [0, 1, 2, 3, 4, 5, 6]

describe('the formulas the Wiki uses', () => {
  it('count ages and stats as the game does', () => {
    for (const age of [0, 3.5, shared.ADULT_AGE, 30, 90]) {
      expect(formulas.ticksForAge(age)).toBe(shared.ticksForAge(age))
    }
    for (const base of [1, 7, 8, 10, 15, 20]) {
      expect(formulas.trainedCap(base)).toBe(shared.trainedCap(base))
    }
    for (const r of RESIDENTS)
      for (const s of shared.STAT_NAMES)
        expect(formulas.statValue(r, s, AT)).toBe(shared.statValue(r, s, AT))
  })

  it('move, carry and eat as the game does', () => {
    for (const r of RESIDENTS) {
      expect(formulas.carryCapacity(r, AT)).toBe(shared.carryCapacity(r, AT))
      expect(formulas.hungerFactor(r, AT)).toBe(shared.hungerFactor(r, AT))
      for (const t of TERRAINS) {
        expect(formulas.walkSpeed(r, t, AT)).toBe(shared.walkSpeed(r, t, AT))
        for (const h of HORSES)
          expect(formulas.driveSpeed(r, h, t)).toBe(shared.driveSpeed(r, h, t))
      }
    }
    for (const h of HORSES) {
      expect(formulas.horseFoodFactor(h)).toBe(shared.horseFoodFactor(h))
      expect(formulas.carriageCapacityWith(h)).toBe(shared.carriageCapacityWith(h))
    }
    expect(formulas.carriageCapacityWith(undefined)).toBe(shared.carriageCapacityWith(undefined))
  })

  it('build, work, fight and train as the game does', () => {
    for (const r of RESIDENTS) {
      expect(formulas.buildWork(r, AT)).toBe(shared.buildWork(r, AT))
      expect(formulas.attackPower(r, AT)).toBe(shared.attackPower(r, AT))
      expect(formulas.workOutput(r, 'wood', 'woodcutting', AT)).toBe(
        shared.workOutput(r, 'wood', 'woodcutting', AT),
      )
      for (const kind of ['smelter', 'mint', 'smithy', 'mine', 'farm'] as const)
        expect(formulas.batchWork(r, kind, AT)).toBe(shared.batchWork(r, kind, AT))
      for (const teacher of RESIDENTS)
        for (const subject of [...shared.STAT_NAMES, ...shared.SKILL_NAMES])
          expect(formulas.trainingGain(r, teacher, subject, AT)).toBe(
            shared.trainingGain(r, teacher, subject, AT),
          )
    }
  })

  it('price, fee and reach as the game does', () => {
    for (const kind of shared.BUILDABLE) {
      for (const under of [undefined, Terrain.Plains, Terrain.Mountain])
        expect(formulas.workFactor(kind, under)).toBe(shared.workFactor(kind, under))
      const building = { kind, site: undefined } as unknown as Parameters<
        typeof shared.teardownReturns
      >[0]
      expect(formulas.teardownReturns(kind)).toEqual(shared.teardownReturns(building))
    }
    for (const strength of [0, 1, 25, 400, 1e6]) {
      expect(formulas.controlReach(strength)).toBe(shared.controlReach(strength))
    }
    for (const [kg, tiles] of [
      [1, 1],
      [50, 20],
      [328, 137],
    ] as const) {
      expect(formulas.deliveryFee(kg, tiles)).toBe(shared.deliveryFee(kg, tiles))
      expect(formulas.transferFee(kg, tiles)).toBe(shared.transferFee(kg, tiles))
    }
    for (const good of ['food', 'wood', 'stone', 'iron', 'spear'] as const)
      for (const [stock, floor] of [
        [0, 10],
        [10, 10],
        [500, 10],
        [3, 1],
      ] as const)
        expect(formulas.priceFor(good, stock, floor)).toEqual(shared.priceFor(good, stock, floor))
  })

  it('say how long something takes as the game does', () => {
    for (const ticks of [0, 30, 59, 60, 600, 3_000, 3_600, 7_200, 20_000, 100_000, 5_000_000])
      expect(formulas.aboutTime(ticks)).toBe(shared.aboutTime(ticks))
  })
})
