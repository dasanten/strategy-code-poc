import { describe, expect, it } from 'vitest'
import {
  CARRIAGE_SPEED,
  HORSE_STAT_AVERAGE,
  HUNGRY_HORSE_PACE,
  MAX_HUNGER,
  TERRAIN_SPEED,
  WALK_TICKS_PER_TILE,
  ADULT_AGE,
  BUILD_WORK,
  CARRYING_TICKS,
  CHILD_YEAR_DAYS,
  CONSTRUCTION_SKILL_EFFECT,
  PAIRING_WAIT_TICKS,
  ticksForAge,
  walkSpeed,
} from './balance.js'
import {
  aboutTime,
  arrivalTicks,
  bornIn,
  foalLeft,
  grownIn,
  pairingTicksLeft,
  timeLeft,
  wayTicks,
  workLeft,
  type ArrivalWorld,
} from './estimates.js'
import { STABLE_BREED_TICKS } from './horses.js'
import { DIAGONAL_STEP, Terrain } from './terrain.js'
import { TICKS_PER_GAME_HOUR } from './time.js'
import {
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  type Building,
  type Horse,
  type Resident,
  type ResidentOrder,
} from './world.js'

const stat = { base: 10, trained: 0 }
const resident = (order: ResidentOrder | null, more: Partial<Resident> = {}): Resident => ({
  id: 'r1',
  name: 'Ada',
  owner: 'me',
  cityId: null,
  x: 0,
  y: 0,
  stats: { strength: stat, endurance: stat, agility: stat, intellect: stat },
  skills: {},
  health: 100,
  hunger: 100,
  bornAt: -30 * TICKS_PER_GAME_YEAR,
  lifespan: 60,
  carried: {},
  order,
  ...more,
})
const average = {
  speed: HORSE_STAT_AVERAGE,
  strength: HORSE_STAT_AVERAGE,
  endurance: HORSE_STAT_AVERAGE,
}
const horse = (more: Partial<Horse> = {}): Horse => ({
  id: 'h1',
  realmId: 'me',
  cityId: null,
  x: 0,
  y: 0,
  hunger: MAX_HUNGER,
  health: 100,
  stats: average,
  bornAt: -5 * TICKS_PER_GAME_YEAR,
  ...more,
})
/** Four tiles east along row 0: Plains, then Forest, then a road over Mountain. */
const path: [number, number][] = [
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 0],
]
const ground = (x: number): Terrain =>
  x <= 2 ? Terrain.Plains : x === 3 ? Terrain.Forest : Terrain.Road
const world = (more: Partial<ArrivalWorld> = {}): ArrivalWorld => ({
  size: 64,
  tick: 0,
  horses: [],
  carriages: [],
  ground,
  ...more,
})
const walk: ResidentOrder = { kind: 'walkTo', target: { x: 4, y: 0 }, path, progress: 0 }

describe('arrival estimates (CONTEXT.md: Doing, Estimates)', () => {
  it('adds up each step at the walking pace of the ground it goes onto', () => {
    const forest = WALK_TICKS_PER_TILE / TERRAIN_SPEED[Terrain.Forest]
    const road = WALK_TICKS_PER_TILE / TERRAIN_SPEED[Terrain.Road]
    expect(arrivalTicks(world(), resident(walk))).toBeCloseTo(
      2 * WALK_TICKS_PER_TILE + forest + road,
    )
  })

  it('counts what is already walked of the next step, and a diagonal step as further', () => {
    const halfway = resident({ ...walk, path: [[1, 1]], progress: 0.5 })
    expect(arrivalTicks(world(), halfway)).toBeCloseTo(
      ((DIAGONAL_STEP - 0.5) * WALK_TICKS_PER_TILE) / TERRAIN_SPEED[Terrain.Plains],
    )
  })

  it('goes at the horse’s pace on a horse, half that while it is hungry', () => {
    const rider = resident(walk, { riding: 'h1' })
    const plains = WALK_TICKS_PER_TILE / CARRIAGE_SPEED[Terrain.Plains]
    const forest = WALK_TICKS_PER_TILE / CARRIAGE_SPEED[Terrain.Forest]
    const road = WALK_TICKS_PER_TILE / CARRIAGE_SPEED[Terrain.Road]
    const fed = arrivalTicks(world({ horses: [horse()] }), rider)!
    expect(fed).toBeCloseTo(2 * plains + forest + road)
    const hungry = arrivalTicks(world({ horses: [horse({ hunger: 0 })] }), rider)!
    expect(hungry).toBeCloseTo(fed / HUNGRY_HORSE_PACE)
    // A faster horse gets there sooner.
    const fast = horse({ stats: { ...average, speed: HORSE_STAT_AVERAGE + 10 } })
    expect(arrivalTicks(world({ horses: [fast] }), rider)!).toBeLessThan(fed)
  })

  it('drives at the pace of the carriage’s horse, sooner with Driving skill', () => {
    const drive: ResidentOrder = {
      kind: 'drive',
      carriageId: 'k1',
      target: { x: 4, y: 0 },
      path,
      progress: 0,
    }
    const carriage = { id: 'k1', horseId: 'h1', x: 0, y: 0, realmId: 'me', cityId: null }
    const w = world({ horses: [horse()], carriages: [carriage] })
    const driven = arrivalTicks(w, resident(drive))!
    expect(driven).toBeCloseTo(
      WALK_TICKS_PER_TILE *
        (2 / CARRIAGE_SPEED[Terrain.Plains] +
          1 / CARRIAGE_SPEED[Terrain.Forest] +
          1 / CARRIAGE_SPEED[Terrain.Road]),
    )
    expect(arrivalTicks(w, resident(drive, { skills: { driving: 20 } }))!).toBeLessThan(driven)
  })

  it('says nothing while the way is still being found or they go nowhere', () => {
    expect(arrivalTicks(world(), resident({ ...walk, path: null }))).toBeUndefined()
    expect(arrivalTicks(world(), resident(null))).toBeUndefined()
  })

  it('counts a step at no pace as one at the slowest', () => {
    const r = resident(walk)
    const slowest = walkSpeed(r, Terrain.Mountain, 0)
    expect(wayTicks(64, r, [[1, 0]], 0, () => 0, slowest)).toBeCloseTo(1 / slowest)
  })
})

describe('aboutTime', () => {
  const min = 60

  it('says real time first and game time in brackets, one coarse unit each', () => {
    expect(aboutTime(3 * min)).toBe('about 3 min (3 game hours)')
    expect(aboutTime(TICKS_PER_GAME_HOUR)).toBe('about 1 min (a game hour)')
    expect(aboutTime(12 * min + 20)).toBe('about 12 min (half a game day)')
    expect(aboutTime(20 * min)).toBe('about 20 min (a game day)')
    expect(aboutTime(TICKS_PER_GAME_DAY)).toBe('about 24 min (a game day)')
    expect(aboutTime(5 * TICKS_PER_GAME_DAY)).toBe('about 2 h (5 game days)')
  })

  it('says under a minute below one', () => {
    expect(aboutTime(0)).toBe('under a minute')
    expect(aboutTime(59)).toBe('under a minute')
  })
})

describe('meters and countdowns', () => {
  it('say how long is left as aboutTime does', () => {
    expect(timeLeft(5 * TICKS_PER_GAME_DAY)).toBe('about 2 h (5 game days) left')
  })

  it('breeding: what is left of STABLE_BREED_TICKS at one tick a tick', () => {
    expect(foalLeft(0)).toBe(timeLeft(STABLE_BREED_TICKS))
    expect(foalLeft(STABLE_BREED_TICKS / 2)).toBe(timeLeft(STABLE_BREED_TICKS / 2))
  })

  it('carrying: CARRYING_TICKS counted down from when it started', () => {
    expect(bornIn(100, 100)).toBe(`born in ${aboutTime(CARRYING_TICKS)}`)
    expect(bornIn(100, 100 + TICKS_PER_GAME_DAY)).toBe(
      `born in ${aboutTime(CARRYING_TICKS - TICKS_PER_GAME_DAY)}`,
    )
  })

  it('pairing: the wait counted down, never below 0', () => {
    expect(pairingTicksLeft(100, 100)).toBe(PAIRING_WAIT_TICKS)
    expect(pairingTicksLeft(100, 100 + 10 * PAIRING_WAIT_TICKS)).toBe(0)
  })

  it('growing up: a childhood of ADULT_AGE years of CHILD_YEAR_DAYS counted down', () => {
    const childhood = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY
    expect(grownIn({ bornAt: 0 }, 0)).toBe(`grown in ${aboutTime(childhood)}`)
    expect(grownIn({ bornAt: 0 }, childhood - TICKS_PER_GAME_DAY)).toBe(
      `grown in ${aboutTime(TICKS_PER_GAME_DAY)}`,
    )
    expect(grownIn({ bornAt: -ticksForAge(ADULT_AGE) }, 0)).toBeUndefined()
  })

  describe('building and tearing down', () => {
    /** A grown builder of Strength `strength` standing on (5, 5), with an order on it or not. */
    const builder = (id: string, order: Resident['order'], strength = 10, skill = 0) =>
      ({
        id,
        x: 5,
        y: 5,
        bornAt: -ticksForAge(30),
        stats: {
          strength: { base: strength, trained: 0 },
          intellect: { base: 10, trained: 0 },
          stamina: { base: 10, trained: 0 },
          agility: { base: 10, trained: 0 },
        },
        skills: { construction: skill },
        order,
      }) as unknown as Resident
    const work = BUILD_WORK.lumberCamp!
    const site = (done: number): Building => ({
      id: 's1',
      kind: 'lumberCamp',
      cityId: null,
      x: 5,
      y: 5,
      site: { delivered: {}, work: done },
    })
    const building = {
      kind: 'build',
      building: 'lumberCamp',
      at: { x: 5, y: 5 },
      siteId: 's1',
    } as Resident['order']

    it('say nobody is building with nobody on the site', () => {
      expect(workLeft(site(0), [], 0, {})).toBe('nobody is building')
      // One whose order is on another site doesn't count.
      const elsewhere = builder('w1', { ...building!, siteId: 's2' } as Resident['order'])
      expect(workLeft(site(0), [elsewhere], 0, {})).toBe('nobody is building')
    })

    it('divide the work left by the builders on it now, by Strength and Construction', () => {
      const avg = builder('w1', building)
      // An average unskilled builder puts in 1 work a tick.
      expect(workLeft(site(0), [avg], 0, {})).toBe(timeLeft(work))
      expect(workLeft(site(work / 2), [avg], 0, {})).toBe(timeLeft(work / 2))
      // Two of them take half as long.
      expect(workLeft(site(0), [avg, builder('w2', building)], 0, {})).toBe(timeLeft(work / 2))
      // A strong, skilled one goes faster.
      const strong = builder('w3', building, 15, 10)
      const pace = 1.5 * (1 + 10 * CONSTRUCTION_SKILL_EFFECT)
      expect(workLeft(site(0), [strong], 0, {})).toBe(timeLeft(Math.ceil(work / pace)))
    })

    it('tear down at the same pace, from the tear-down work left', () => {
      const b: Building = { id: 'b1', kind: 'lumberCamp', cityId: null, x: 5, y: 5, teardown: 0 }
      const tearing = builder('w1', { kind: 'tearDown', buildingId: 'b1', at: { x: 5, y: 5 } })
      expect(workLeft(b, [], 0, { tearingDown: true })).toBe('nobody is tearing it down')
      expect(workLeft(b, [tearing], 0, { tearingDown: true })).toMatch(/ left$/)
    })
  })
})
