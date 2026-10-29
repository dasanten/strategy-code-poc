// The longest run of `npc-growth.test.ts`, apart so that the two run side by side.

import {
  NPC_WALL_STEP,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  cityAreaTiles,
  cityResidents,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { WALL, village, fillInside, fillHouses, ring, run } from './npc-growth.fixture.js'

describe('NPC cities grow', () => {
  it(
    'a village grows in residents and area over game weeks',
    { tags: ['slow'], timeout: 300_000 },
    () => {
      const { world, terrain, city, home } = village()
      const size = terrain.size
      fillInside(world, terrain, home)
      fillHouses(world, city, home)
      const people = cityResidents(world, city).length
      const area = cityAreaTiles(world, city, size).size
      const oldIds = new Set(ring(world, city, home, size, WALL).map((b) => b.id))
      // Each resident's first pair counts as paired a game year ago, so its first child comes as soon
      // as the city has room and Food for it, not a year into the run (the year's wait is the pairing
      // tests' business). It runs until its wall has moved out, for at most as many ticks as four
      // old game years.
      const movedOut = () =>
        ring(world, city, home, size, WALL).length === 0 &&
        ring(world, city, home, size, WALL + NPC_WALL_STEP).length > 120
      const paired = new Set<string>()
      for (let day = 0; day < 240 && !movedOut(); day++) {
        run(world, terrain, city, home, oldIds, TICKS_PER_GAME_DAY)
        for (const r of world.residents) {
          if (!r.pair || paired.has(r.id)) continue
          r.pair.since -= TICKS_PER_GAME_YEAR
          paired.add(r.id)
        }
      }
      expect(cityResidents(world, city).length).toBeGreaterThan(people)
      expect(cityAreaTiles(world, city, size).size).toBeGreaterThan(area)
      // It built its own lumber camp for the wood, and moved its wall out.
      expect(world.buildings.some((b) => b.kind === 'lumberCamp' && !b.site)).toBe(true)
      expect(ring(world, city, home, size, WALL)).toEqual([])
      expect(ring(world, city, home, size, WALL + NPC_WALL_STEP).length).toBeGreaterThan(120)
    },
  )
})
