import {
  MAX_WORKERS,
  NPC_FOUND_PARTY_MOST,
  NPC_PLAN_TICKS,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  npcReserve,
  storedFood,
  surplusFoodLine,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import {
  bigCity,
  bigCityHoldReport,
  bigCityReport,
  BIG_CITY_RESIDENTS,
  countBigCity,
  runBigCity,
  watchBigCity,
  type BigCityHold,
} from './npc-big-city.fixture.js'
import { foundingParty } from './npc-founding.js'
import { farmersWanted } from './npc-plan.js'

/*
 * A staged city of about 110 run for 40 game days (ADR 0029): the baseline for Busy big cities, now
 * held to what it shows (T80.11). `vitest run --silent=false` shows its jobs and who stands on the
 * storage.
 *
 * On a map with room it holds its idle share, as it goes on founding. Alone on a map too small for a
 * daughter, with no warehouse for its traders, nothing ever uses its goods up: once its caps fill, its
 * spare hands have nothing left, and a third of its adults stand idle. That one is left to report and
 * doesn't hold to the share (`CONTEXT.md`: Spare hands' work).
 */

/** The first game day a city that started full of work has to show it has found its feet. */
const HOLDS_FROM_DAY = 30

/** The most of its adults idle from then on. */
const MOST_IDLE_SHARE = 0.15

/**
 * The most ticks anyone stands on the storage with nothing to do. Those who come to rest there between
 * passes are sent off by the next one (`standIdle`), so this is one pass and the ticks around it. Those
 * stowing, fetching and walking over it have an order; one waiting there for what their smelter or
 * smithy needs is fetching too (`watchBigCity`).
 */
const LONGEST_ON_STORAGE = NPC_PLAN_TICKS + 5

/**
 * The most its farmers may change from one game day to the next: what a founding party leaving takes
 * off those it keeps (one for about four residents), and the one more it keeps with no food surplus.
 */
const MOST_FARMER_SWING = Math.ceil(NPC_FOUND_PARTY_MOST / 4) + 1

/** How long the city with only the farms it would build is run (#995). */
const FARMS_RUN_DAYS = 40

/**
 * The last game day its Food may still be short of its reserve: well before day 30, where it stood
 * before #995. On 2026-11-07 it was last short on day 6.
 */
const FOOD_SHORT_UNTIL_DAY = 15

/** The first game day its farmers are held to `MOST_FARMER_SWING`, the shortage behind it. */
const FARMS_STEADY_FROM_DAY = 20

describe('a big NPC city', () => {
  it(
    'with no room and no warehouse, keeps its storage clear and reports its jobs',
    { tags: ['slow'], timeout: 1_800_000 },
    () => {
      const staged = bigCity()
      const { world, terrain } = staged
      const watch = watchBigCity(staged, HOLDS_FROM_DAY)
      const run = runBigCity(
        staged,
        40,
        5,
        () => {
          expect(checkInvariants(world, terrain)).toEqual([])
        },
        watch.tick,
      )
      const hold = watch.hold()
      console.log(`Big city, ${BIG_CITY_RESIDENTS} residents staged:\n${bigCityReport(run)}`)
      console.log(`From day ${HOLDS_FROM_DAY}, no room, no warehouse:\n${bigCityHoldReport(hold)}`)
      expect(run.counts).toHaveLength(8)
      expect(hold.longestOnStorage).toBeLessThanOrEqual(LONGEST_ON_STORAGE)
      // Needs grow with the city (`CONTEXT.md`: Spare hands' work): at most a second of each workplace
      // on a node, and no more farms than it was staged with, which is more than it needs.
      const { places } = run.counts.at(-1)!
      console.log(`Built by the end: ${JSON.stringify(places)}`)
      expect(places.farm).toBe(8)
      for (const kind of ['lumberCamp', 'quarry', 'mine']) {
        expect(places[kind]).toBe(2)
      }
    },
  )

  describe('on a map with room', () => {
    /** One run of 40 game days for all of these: it takes minutes. */
    let seen: ReturnType<typeof roomyRun> | undefined
    const run = () => (seen ??= roomyRun())

    it(
      'founds a daughter unaided, and goes on feeding itself',
      { tags: ['slow'], timeout: 1_800_000 },
      () => {
        const { setOut, party, moved, keptFood, keptFoodLine } = run()
        console.log(
          `Big city unaided: party of ${party.length} set out on day ${setOut}, moved by day ${moved?.day}`,
        )
        expect(setOut).toBeDefined()
        expect(party.length).toBeGreaterThan(NPC_VILLAGE.residents)
        expect(moved?.people).toBe(party.length)
        // What it gave the party leaves it Food enough: never short of a surplus for those who stayed.
        expect(keptFood).toBeGreaterThan(keptFoodLine)
      },
    )

    it(
      'holds its idle share, keeps its storage clear and its farmers steady',
      { tags: ['slow'], timeout: 1_800_000 },
      () => {
        const { hold, log } = run()
        console.log(`From day ${HOLDS_FROM_DAY}, on a map with room:\n${log}`)
        expect(hold.idleShare).toBeLessThanOrEqual(MOST_IDLE_SHARE)
        expect(hold.longestOnStorage).toBeLessThanOrEqual(LONGEST_ON_STORAGE)
        expect(hold.farmerSwing).toBeLessThanOrEqual(MOST_FARMER_SWING)
      },
    )
  })

  it(
    'with only the farms it would build, opens more until Food is no longer short (#995)',
    { tags: ['slow'], timeout: 1_800_000 },
    () => {
      const staged = bigCity(undefined, 1300)
      const { world, terrain, city, home } = staged
      const farms = world.buildings.filter((b) => b.kind === 'farm' && b.cityId === city.id)
      const kept = farmersWanted(world, city) / (MAX_WORKERS.farm ?? 1)
      world.buildings = world.buildings.filter((b) => !farms.slice(Math.ceil(kept)).includes(b))
      const watch = watchBigCity(staged, FARMS_STEADY_FROM_DAY)
      const days: string[] = []
      let shortUntil = 0
      runBigCity(
        staged,
        FARMS_RUN_DAYS,
        5,
        () => {
          expect(checkInvariants(world, terrain)).toEqual([])
          const day = world.tick / TICKS_PER_GAME_DAY
          const food = home.stock?.food ?? 0
          const reserve = npcReserve(world, city).food ?? 0
          if (food < reserve) shortUntil = day
          const c = countBigCity(world, terrain, city, home)
          days.push(
            `day ${day}: Food ${food} / ${reserve}, farms ${c.places.farm}, farm ${c.jobs.farm ?? 0}, idle ${c.jobs.idle ?? 0}, scout ${c.jobs.scout ?? 0}, work ${c.jobs.work ?? 0}, build ${c.jobs.build ?? 0}`,
          )
        },
        watch.tick,
      )
      const hold = watch.hold()
      console.log(`Big city with ${Math.ceil(kept)} farms:\n${days.join('\n')}`)
      console.log(`Food short until day ${shortUntil}\n${bigCityHoldReport(hold)}`)
      expect(shortUntil).toBeLessThanOrEqual(FOOD_SHORT_UNTIL_DAY)
      expect(hold.farmerSwing).toBeLessThanOrEqual(MOST_FARMER_SWING)
    },
  )
})

/** The big city on a map with room, run to game day 40, and what it did about its first daughter. */
function roomyRun(): {
  setOut: number | undefined
  party: string[]
  moved: { day: number; people: number } | undefined
  keptFood: number
  keptFoodLine: number
  hold: BigCityHold
  log: string
} {
  const staged = bigCity(undefined, 1300)
  const { world, terrain, city } = staged
  const watch = watchBigCity(staged, HOLDS_FROM_DAY)
  const day = () => world.tick / TICKS_PER_GAME_DAY
  const daughter = () =>
    world.cities.find((c) => c.id !== city.id && c.realmId === null && !c.tradeOrg)

  let setOut: number | undefined
  let party: string[] = []
  let moved: { day: number; people: number } | undefined
  let keptFood = Infinity
  let keptFoodLine = 0
  // Nothing is held for it: its scouts and road crew go out with Food and its crew lays roads.
  runBigCity(
    staged,
    40,
    5,
    () => {
      expect(checkInvariants(world, terrain)).toEqual([])
    },
    () => {
      watch.tick()
      if (moved) return
      const now = foundingParty(world.cityPlans[city.id])
      if (setOut === undefined && now.length > 0) {
        setOut = day()
        party = now
      }
      if (setOut !== undefined) {
        keptFood = Math.min(keptFood, storedFood(world, city))
        keptFoodLine = surplusFoodLine(world, city)
      }
      const people = world.residents.filter((r) => r.cityId === daughter()?.id).length
      if (people > 0) moved = { day: day(), people }
    },
  )
  const hold = watch.hold()
  return { setOut, party, moved, keptFood, keptFoodLine, hold, log: bigCityHoldReport(hold) }
}
