import { NPC_VILLAGE, TICKS_PER_GAME_DAY, storedFood, surplusFoodLine } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import {
  bigCity,
  bigCityReport,
  BIG_CITY_RESIDENTS,
  runBigCity,
  unhurriedWalking,
} from './npc-big-city.fixture.js'
import { foundingParty } from './npc-founding.js'
import { stepWorld } from './world.js'

/*
 * A staged city of about 110 run for 40 game days (ADR 0029): the baseline for Busy big cities. It
 * reports jobs and how many stand on the storage (`vitest run --silent=false` shows it), and asserts
 * nothing about idleness yet; T80.11 holds it to a share.
 */

describe('a big NPC city', () => {
  it(
    'runs for 40 game days, reporting its jobs and who stands on the storage',
    { tags: ['slow'], timeout: 1_800_000 },
    () => {
      const staged = bigCity()
      const { world, terrain } = staged
      const run = runBigCity(staged, 40, 5, () => {
        expect(checkInvariants(world, terrain)).toEqual([])
      })
      console.log(`Big city, ${BIG_CITY_RESIDENTS} residents staged:\n${bigCityReport(run)}`)
      expect(run.counts).toHaveLength(8)
    },
  )

  it(
    'on a map with room, founds a daughter unaided, and goes on feeding itself',
    { tags: ['slow'], timeout: 1_800_000 },
    () => {
      const staged = bigCity(1300)
      const { world, terrain, city } = staged
      const walking = unhurriedWalking(terrain)

      let setOut: number | undefined
      let party: string[] = []
      let keptFood = Infinity
      const daughter = () =>
        world.cities.find((c) => c.id !== city.id && c.realmId === null && !c.tradeOrg)
      const moved = () => world.residents.some((r) => r.cityId === daughter()?.id)
      // Nothing is held for it: its scouts and road crew go out with Food and its crew lays roads.
      const lastDay = 60 * TICKS_PER_GAME_DAY
      while (world.tick < lastDay && !moved()) {
        stepWorld(world, terrain, walking)
        const now = foundingParty(world.cityPlans[city.id])
        if (setOut === undefined && now.length > 0) {
          setOut = world.tick
          party = now
        }
        if (setOut !== undefined) keptFood = Math.min(keptFood, storedFood(world, city))
        if (world.tick % TICKS_PER_GAME_DAY === 0) {
          expect(checkInvariants(world, terrain)).toEqual([])
        }
      }
      console.log(
        `Big city unaided: party of ${party.length} set out on day ${(setOut ?? NaN) / TICKS_PER_GAME_DAY}, moved by day ${world.tick / TICKS_PER_GAME_DAY}`,
      )
      expect(setOut).toBeDefined()
      expect(party.length).toBeGreaterThan(NPC_VILLAGE.residents)
      expect(moved()).toBe(true)
      const people = world.residents.filter((r) => r.cityId === daughter()!.id)
      expect(people.length).toBe(party.length)
      // What it gave the party leaves it Food enough: never short of a surplus for those who stayed.
      expect(keptFood).toBeGreaterThan(surplusFoodLine(world, city))
    },
  )
})
