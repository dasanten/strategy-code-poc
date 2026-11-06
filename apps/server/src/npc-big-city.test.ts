import {
  NPC_FULL_DAYS,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  npcFoundingPartySize,
  npcFullDays,
  storedFood,
  surplusFoodLine,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import {
  bigCity,
  bigCityReport,
  BIG_CITY_RESIDENTS,
  runBigCity,
  unhurriedWalking,
} from './npc-big-city.fixture.js'
import { foundingMaterials, foundingParty } from './npc-founding.js'
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
    'founds sooner than a week with a larger party, and goes on feeding itself',
    { tags: ['slow'], timeout: 1_800_000 },
    () => {
      const staged = bigCity(1300)
      const { world, terrain, city, home } = staged
      const stoneFor = foundingMaterials(npcFoundingPartySize(BIG_CITY_RESIDENTS)).stone ?? 0
      const walking = unhurriedWalking(terrain)
      const wait = npcFullDays(BIG_CITY_RESIDENTS)
      expect(wait).toBeLessThan(NPC_FULL_DAYS)

      let setOut: number | undefined
      let party: string[] = []
      let keptFood = Infinity
      const daughter = () =>
        world.cities.find((c) => c.id !== city.id && c.realmId === null && !c.tradeOrg)
      const moved = () => world.residents.some((r) => r.cityId === daughter()?.id)
      const lastDay = 30 * TICKS_PER_GAME_DAY
      while (world.tick < lastDay && !moved()) {
        // Its road crew spends every Stone above the reserve until the roads are done; here, what
        // the party wants stays, so this is about the waiting.
        home.stock!.stone = Math.max(home.stock!.stone ?? 0, stoneFor)
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
      expect(setOut).toBeDefined()
      // The first pass counts it as full; it searches once a game day from when it may found.
      expect(setOut!).toBeLessThan((wait + 2) * TICKS_PER_GAME_DAY)
      expect(party.length).toBe(npcFoundingPartySize(BIG_CITY_RESIDENTS))
      expect(party.length).toBeGreaterThan(NPC_VILLAGE.residents)
      expect(moved()).toBe(true)
      const people = world.residents.filter((r) => r.cityId === daughter()!.id)
      expect(people.length).toBe(party.length)
      // What it gave the party leaves it Food enough: never short of a surplus for those who stayed.
      expect(keptFood).toBeGreaterThan(surplusFoodLine(world, city))
    },
  )
})
