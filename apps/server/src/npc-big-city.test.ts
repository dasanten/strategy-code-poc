import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { bigCity, bigCityReport, BIG_CITY_RESIDENTS, runBigCity } from './npc-big-city.fixture.js'

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
})
