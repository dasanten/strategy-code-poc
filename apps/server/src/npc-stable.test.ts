import {
  HORSE_FOOD_PER_DAY,
  HORSE_HUNGRY_SHARE,
  HORSE_WAKE_HEALTH,
  MAX_HEALTH,
  MAX_HUNGER,
  NPC_PLAN_TICKS,
  NPC_STABLE_HUNGRY_DAYS,
  NPC_STABLE_REFILL_DAYS,
  NPC_TRADE,
  OWN_FOOD,
  STABLE_FEED_DAYS,
  TICKS_PER_GAME_DAY,
  buildingAt,
  cityFoodUse,
  footprintTiles,
  npcCityPrices,
  npcReserve,
  type Building,
  type City,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { HORSE_DOWN_TICKS, newHorse } from './horses.js'
import { checkInvariants } from './invariants.js'
import { npcOneFeeder } from './npc-stable.js'
import { planCity } from './npc-plan.js'
import { storageOf, village } from './npc-growth.fixture.js'
import { mulberry32 } from './residents.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'

/**
 * An NPC city feeds its stable (`CONTEXT.md`: NPC horses, NPC reserve, Feeding the stable): one
 * resident at a time runs the game's default, from what is above the reserve for its people, or
 * below that a little while its horses are hungry.
 */

/** Two horses' Food for `STABLE_FEED_DAYS`. */
const KEEP = 2 * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY
/** What the city lets go below its people's reserve for two hungry horses. */
const MEALS = Math.ceil(2 * NPC_STABLE_HUNGRY_DAYS * HORSE_FOOD_PER_DAY)

/** A village with a finished stable holding `food` on free ground by its home, and two horses in it. */
function setup(food: number, storageFood = 1000) {
  const { world, terrain, city, home } = village()
  const stable: Building = {
    id: 'stable1',
    kind: 'stable',
    cityId: city.id,
    ...freeSpot(world, home),
    stock: { food },
  }
  world.buildings.push(stable)
  const rand = mulberry32(5)
  const horses = ['h1', 'h2'].map((id) =>
    newHorse(rand, {
      id,
      realmId: null,
      cityId: city.id,
      x: stable.x,
      y: stable.y,
      tick: world.tick,
    }),
  )
  for (const h of horses) h.stats.endurance = 10 // the average horse's appetite
  world.horses.push(...horses)
  storageOf(world, city).stock = { food: storageFood }
  for (const r of world.residents) r.carried.food = OWN_FOOD
  return { world, terrain, city, home, stable, horses }
}

/** A spot for a stable by the home, with nothing on its footprint. */
function freeSpot(world: WorldState, home: Building): { x: number; y: number } {
  for (let y = home.y - 8; y <= home.y + 8; y++) {
    for (let x = home.x - 8; x <= home.x + 8; x++) {
      const tiles = footprintTiles({ kind: 'stable', x, y })
      const free = tiles.every(
        ([tx, ty]) =>
          !buildingAt(world, tx, ty) && !world.nodes.some((n) => n.x === tx && n.y === ty),
      )
      if (free) return { x, y }
    }
  }
  throw new Error('no room for a stable')
}

const feeders = (world: WorldState) =>
  world.residents.filter((r) => r.script?.scriptId === 0 && r.script.task === 'feedStable')

const peopleReserve = (world: WorldState, city: City) =>
  cityFoodUse(world, city, NPC_TRADE.reserveFoodDays)

/** Runs the world, with `each` seeing every tick and the invariants checked every game day. */
function run(world: WorldState, terrain: TerrainMap, ticks: number, each: () => void = () => {}) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, terrain, walking)
    each()
    if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

const hungry = (h: Horse) => h.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER

describe('an NPC city feeding its stable', () => {
  it('keeps what the stable lacks in its reserve, and the stable’s Food counts', () => {
    const { world, city, stable } = setup(0)
    const people = peopleReserve(world, city)
    expect(npcReserve(world, city).food).toBe(Math.ceil(people + KEEP - 1e-9))
    stable.stock!.food = KEEP / 2
    expect(npcReserve(world, city).food).toBe(Math.ceil(people + KEEP / 2 - 1e-9))
    stable.stock!.food = KEEP * 2
    expect(npcReserve(world, city).food).toBe(Math.ceil(people - 1e-9))
    // A stable still being built holds none and keeps none.
    stable.stock!.food = 0
    stable.site = { materials: {}, progress: 0 } as Building['site']
    expect(npcReserve(world, city).food).toBe(Math.ceil(people - 1e-9))
  })

  it('sells none of what the stable lacks', () => {
    const { world, city, stable } = setup(0)
    const line = () => npcCityPrices(world, city).find((p) => p.good === 'food')!
    const before = line().forSale
    stable.stock!.food = KEEP
    expect(line().forSale).toBe(before + Math.ceil(KEEP))
  })

  it('keeps the stable fed for weeks, with one feeder at a time', () => {
    const { world, terrain, stable } = setup(0)
    let most = 0
    let lowest = Infinity
    let feederTicks = 0
    let wentHungry = false
    const ticks = 14 * TICKS_PER_GAME_DAY
    run(world, terrain, ticks, () => {
      const out = feeders(world).length
      most = Math.max(most, out)
      if (out > 0) feederTicks++
      if (world.tick > TICKS_PER_GAME_DAY) {
        lowest = Math.min(lowest, stable.stock?.food ?? 0)
        // Foals the city breeds meanwhile eat from the same stable.
        wentHungry ||= world.horses.some(hungry)
      }
    })
    expect(most).toBe(1)
    expect(wentHungry).toBe(false)
    expect(world.horses.length).toBeGreaterThanOrEqual(2)
    expect(lowest).toBeGreaterThan(0)
    // They go when it runs low: most of the time they work for the city.
    expect(feederTicks).toBeLessThan(ticks / 2)
  }, 300_000)

  it('sends one resident, and lets them go once it is full', () => {
    const { world, terrain, city, stable } = setup(0)
    const plan = planCity(world, city, terrain)
    const job = Object.entries(plan.jobs).find(([, j]) => j.kind === 'feed')!
    expect(job[1]).toEqual({ kind: 'feed', stableId: stable.id })
    const ranks = Object.values(plan.jobs).map((j) => j.kind)
    expect(ranks.filter((k) => k === 'feed')).toHaveLength(1)
    // Filled, the next pass lets them go.
    run(world, terrain, TICKS_PER_GAME_DAY / 2)
    expect(stable.stock!.food!).toBeGreaterThan(NPC_STABLE_REFILL_DAYS * 2 * HORSE_FOOD_PER_DAY)
    expect(feeders(world)).toEqual([])
  })

  it('sends a farmer when all it has is farmers', () => {
    const { world, terrain, city } = setup(0)
    const plan = planCity(world, city, terrain)
    for (const [id, job] of Object.entries(plan.jobs)) {
      if (job.kind === 'idle') {
        world.residents = world.residents.filter((r) => r.id !== id)
      }
    }
    expect(Object.values(planCity(world, city, terrain).jobs).map((j) => j.kind)).toContain('feed')
  })

  it('doesn’t send one while the stable holds enough for now', () => {
    const { world, terrain, city } = setup(NPC_STABLE_REFILL_DAYS * 2 * HORSE_FOOD_PER_DAY)
    const kinds = Object.values(planCity(world, city, terrain).jobs).map((j) => j.kind)
    expect(kinds).not.toContain('feed')
  })

  it('a short city feeds its people first: nothing goes to fed horses from below its reserve', () => {
    const { world, terrain, city, stable } = setup(0, 10)
    expect(10).toBeLessThan(peopleReserve(world, city))
    const kinds = Object.values(planCity(world, city, terrain).jobs).map((j) => j.kind)
    expect(kinds).not.toContain('feed')
    run(world, terrain, NPC_PLAN_TICKS * 2)
    expect(feeders(world)).toEqual([])
    expect(stable.stock?.food ?? 0).toBe(0)
  })

  it('takes a little from below its reserve while the horses are hungry', () => {
    const { world, terrain, city, stable, horses } = setup(0, 20)
    expect(20).toBeLessThan(peopleReserve(world, city))
    for (const h of horses) h.hunger = HORSE_HUNGRY_SHARE * MAX_HUNGER - 1
    const stored: number[] = []
    let fetched = 0
    run(world, terrain, TICKS_PER_GAME_DAY / 2, () => {
      const f = feeders(world)[0]
      if (f?.order?.kind === 'fetch') fetched = Math.max(fetched, f.order.goods.food ?? 0)
      stored.push(stable.stock?.food ?? 0)
    })
    expect(fetched).toBe(MEALS)
    expect(horses.some(hungry)).toBe(false)
    expect(Math.max(...stored)).toBeLessThanOrEqual(MEALS)
  })

  it('takes only what is above its people’s reserve for fed horses', () => {
    const { world, terrain, city } = setup(0, 0)
    const spare = 3
    storageOf(world, city).stock = { food: Math.ceil(peopleReserve(world, city)) + spare }
    let fetched = 0
    run(world, terrain, NPC_PLAN_TICKS * 2, () => {
      const f = feeders(world)[0]
      if (f?.order?.kind === 'fetch') fetched = Math.max(fetched, f.order.goods.food ?? 0)
    })
    expect(fetched).toBeGreaterThan(0)
    expect(fetched).toBeLessThanOrEqual(spare)
  })

  it('wakes a horse that went Down in the stable', () => {
    const { world, terrain, horses, stable } = setup(0)
    const down = horses[0]!
    down.hunger = 0
    down.health = 0
    down.downUntil = world.tick + HORSE_DOWN_TICKS
    run(world, terrain, TICKS_PER_GAME_DAY)
    expect(down.downUntil).toBeUndefined()
    expect(down.health).toBeGreaterThanOrEqual(HORSE_WAKE_HEALTH)
    expect(world.horses).toHaveLength(2)
    expect(stable.stock!.food!).toBeGreaterThan(0)
  })

  it('stands by a Down horse it has no Food for, which dies, and stops keeping Food for it', () => {
    const { world, terrain, city, horses, stable } = setup(0, 0)
    const down = horses[0]!
    down.hunger = 0
    down.health = 0
    down.downUntil = world.tick + NPC_PLAN_TICKS
    horses[1]!.health = MAX_HEALTH
    run(world, terrain, NPC_PLAN_TICKS * 3)
    expect(world.horses.map((h) => h.id)).not.toContain(down.id)
    expect(feeders(world)).toEqual([])
    expect(stable.stock?.food ?? 0).toBe(0)
    expect(npcReserve(world, city).food).toBe(
      Math.ceil(peopleReserve(world, city) + KEEP / 2 - 1e-9),
    )
  })

  it('the feeder goes on with the Food they fetched when the city has none left to spare', () => {
    const { world, terrain, city, stable } = setup(0)
    const walking = new Walking(terrain)
    while (feeders(world)[0]?.order?.kind !== 'store') stepWorld(world, terrain, walking)
    const feeder = feeders(world)[0]!
    // On their way with it, the city runs short: no reason to carry it back.
    storageOf(world, city).stock = {}
    expect(planCity(world, city, terrain).jobs[feeder.id]?.kind).toBe('feed')
    run(world, terrain, TICKS_PER_GAME_DAY / 4)
    expect(stable.stock?.food ?? 0).toBeGreaterThan(0)
  })

  it('the Trade Organization’s cities don’t take part', () => {
    const { world, terrain, city } = setup(0)
    const people = Math.ceil(peopleReserve(world, city) - 1e-9)
    city.tradeOrg = 'post'
    expect(npcReserve(world, city).food).toBe(people)
    const kinds = Object.values(planCity(world, city, terrain).jobs).map((j) => j.kind)
    expect(kinds).not.toContain('feed')
  })

  it('leaves another realm’s horses standing in it out of what it keeps', () => {
    const { world, city, horses } = setup(0)
    horses[1]!.realmId = 'r1'
    horses[1]!.cityId = null
    expect(npcReserve(world, city).food).toBe(
      Math.ceil(peopleReserve(world, city) + KEEP / 2 - 1e-9),
    )
  })

  it('the invariant catches two feeders, and a Trade Org city’s', () => {
    const { world, terrain, city } = setup(0)
    const [a, b] = world.residents
    expect(npcOneFeeder.check(world, terrain)).toEqual([])
    a!.script = { scriptId: 0, task: 'feedStable', memory: { stableId: 'stable1' } }
    expect(npcOneFeeder.check(world, terrain)).toEqual([])
    b!.script = { scriptId: 0, task: 'feedStable', memory: { stableId: 'stable1' } }
    expect(npcOneFeeder.check(world, terrain)).toHaveLength(1)
    delete b!.script
    city.tradeOrg = 'post'
    expect(npcOneFeeder.check(world, terrain)).toHaveLength(1)
  })
})
