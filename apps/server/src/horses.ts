import {
  DOWN_DAYS,
  HEAL_DAYS,
  HORSE_FOOD_PER_DAY,
  HORSE_HUNGRY_SHARE,
  HORSE_WAKE_HEALTH,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  HORSE_STAT_MAX,
  HORSE_STAT_MIN,
  HORSE_STAT_NAMES,
  HUNGER_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  STARVE_DAYS,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  carriagePulledBy,
  driverOf,
  horseFood,
  horseFoodFactor,
  riderOf,
  type Horse,
  type HorseStats,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant } from './invariants.js'

/** How far one unit of food fills a horse's hunger meter: a full meter holds `HUNGER_DAYS` of food. */
const FILL_PER_FOOD = MAX_HUNGER / (HUNGER_DAYS * HORSE_FOOD_PER_DAY)

/**
 * Given names for new horses (`CONTEXT.md`: Horse name), a pool apart from the residents'
 * (`residentName`). Only flavour: a name means nothing to the rules.
 */
export const HORSE_NAMES: readonly string[] = [
  'Brisk',
  'Chestnut',
  'Dapple',
  'Ember',
  'Flint',
  'Gale',
  'Hazel',
  'Juniper',
  'Kestrel',
  'Lark',
  'Maple',
  'Nimbus',
  'Onyx',
  'Pepper',
  'Quill',
  'Rowan',
  'Sorrel',
  'Thistle',
  'Umber',
  'Velvet',
  'Willow',
  'Zephyr',
  'Ash',
  'Bramble',
  'Cinder',
  'Dusk',
  'Fable',
  'Heather',
  'Ivory',
  'Jet',
  'Moss',
  'Nutmeg',
  'Pebble',
  'Rusty',
  'Storm',
  'Tansy',
]

/** A name from the game for a horse. */
export function horseName(rand: () => number): string {
  return HORSE_NAMES[Math.floor(rand() * HORSE_NAMES.length)]!
}

/** Whole stats for a new horse, each from `HORSE_STAT_MIN` to `HORSE_STAT_MAX` (`CONTEXT.md`: Horse stats). */
export function drawHorseStats(rand: () => number): HorseStats {
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
  return Object.fromEntries(
    HORSE_STAT_NAMES.map((s) => [s, between(HORSE_STAT_MIN, HORSE_STAT_MAX)]),
  ) as HorseStats
}

/**
 * A new grown horse (`CONTEXT.md`: Horse stats, Horse name): drawn stats, a name from the pool, a
 * full hunger meter and full health, aged between `HORSE_START_AGE_MIN` and `HORSE_START_AGE_MAX`
 * game years at `tick`.
 */
export function newHorse(
  rand: () => number,
  fields: {
    id: string
    realmId: string | null
    cityId: string | null
    x: number
    y: number
    tick: number
  },
): Horse {
  const { tick, ...place } = fields
  const stats = drawHorseStats(rand)
  const age = HORSE_START_AGE_MIN + rand() * (HORSE_START_AGE_MAX - HORSE_START_AGE_MIN)
  return {
    ...place,
    name: horseName(rand),
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats,
    bornAt: tick - Math.round(age * TICKS_PER_GAME_YEAR),
  }
}

/** Ticks a horse lies Down before it dies of hunger (`DOWN_DAYS`), as long as a resident. */
export const HORSE_DOWN_TICKS = DOWN_DAYS * TICKS_PER_GAME_DAY

/**
 * One tick of horses (`CONTEXT.md`: Horse, Horses have no inventory, Stable, Down, Reviving).
 * Their hunger meter runs down like a resident's; a horse eats a unit of food when there is room
 * for it, from what is in reach (`horseFood`), for a ridden horse also its rider's spare Food. A
 * ridden horse going hungry, its rider with none to spare, goes in its Player's realm log once.
 * An empty meter costs health, a meter with anything in it slowly gives health back, and a horse
 * whose health hunger used up goes Down (`goDown`). Down, its meter and health stay as they are
 * until it eats Food in reach, when it wakes at `HORSE_WAKE_HEALTH`; when its time is up first it
 * dies, which goes in its Player's realm log.
 * Foals come only from a resident breeding them (`resolveBreeding`). Returns the horses that died.
 */
export function stepHorses(world: WorldState, terrain: TerrainMap): Horse[] {
  const drain = MAX_HUNGER / (HUNGER_DAYS * TICKS_PER_GAME_DAY)
  const starve = MAX_HEALTH / (STARVE_DAYS * TICKS_PER_GAME_DAY)
  const heal = MAX_HEALTH / (HEAL_DAYS * TICKS_PER_GAME_DAY)
  const died: Horse[] = []
  let ate = false
  const hungry = HORSE_HUNGRY_SHARE * MAX_HUNGER
  // Who rides which horse, looked up once a tick rather than for every horse that eats.
  const riders = new Map<string, Resident>()
  for (const r of world.residents) if (r.riding !== undefined) riders.set(r.riding, r)
  const eat = (h: Horse): boolean => {
    const food = horseFood(world, h, terrain.size, riders.get(h.id))[0]
    if (!food) return false
    const left = food.food! - 1
    if (left > 0) food.food = left
    else delete food.food
    h.hunger = Math.min(MAX_HUNGER, h.hunger + FILL_PER_FOOD)
    ate = true
    return true
  }

  for (const h of world.horses) {
    if (h.downUntil !== undefined) {
      if (eat(h)) {
        delete h.downUntil
        h.health = HORSE_WAKE_HEALTH
      } else if (world.tick >= h.downUntil) died.push(h)
      continue
    }
    const wasFed = h.hunger >= hungry
    // Endurance sets how fast the meter runs down, so how much Food the horse needs.
    h.hunger = Math.max(0, h.hunger - drain * horseFoodFactor(h))
    if (h.hunger <= MAX_HUNGER - FILL_PER_FOOD) eat(h)
    // Going hungry with nothing in reach: a rider has no Food to spare for it (`CONTEXT.md`: Riding).
    const rider = wasFed && h.hunger < hungry ? riders.get(h.id) : undefined
    if (rider) {
      recordEvent(world, h.realmId, {
        kind: 'horseHungry',
        horseId: h.id,
        horseName: h.name,
        residentId: rider.id,
        name: rider.name,
      })
    }
    if (h.hunger <= 0) h.health = Math.max(0, h.health - starve)
    else h.health = Math.min(MAX_HEALTH, h.health + heal)
    if (h.health <= 0) goDown(world, h, riders.get(h.id))
  }
  if (ate) world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
  if (died.length > 0) {
    world.horses = world.horses.filter((h) => !died.includes(h))
    // A carriage whose horse died stands where it is, with nothing to pull it.
    for (const k of world.carriages) if (died.some((h) => h.id === k.horseId)) k.horseId = null
    for (const h of died)
      recordEvent(world, h.realmId, { kind: 'horseDied', horseId: h.id, name: h.name })
  }
  return died
}

/**
 * Puts a horse whose health hunger used up Down (`CONTEXT.md`: Down) until `HORSE_DOWN_TICKS`
 * from now: it lies where it is, so its rider is on foot again and the carriage it pulls stands,
 * its driver's drive order or haul route ending as when its horse is unhitched. It stays hitched.
 * Its Player's realm log says so, with when it dies.
 */
function goDown(world: WorldState, h: Horse, rider: Resident | undefined): void {
  h.health = 0
  h.downUntil = world.tick + HORSE_DOWN_TICKS
  if (rider) delete rider.riding
  const carriage = carriagePulledBy(world, h)
  const driver = carriage && driverOf(world, carriage)
  if (driver) driver.order = null
  recordEvent(world, h.realmId, {
    kind: 'horseDown',
    horseId: h.id,
    name: h.name,
    until: h.downUntil,
  })
}

/**
 * A Down horse lies still (`CONTEXT.md`: Down): nobody rides it, nobody drives the carriage it
 * pulls, its hunger and health stay at 0, and it dies within `HORSE_DOWN_TICKS` of going Down,
 * not before the tick it is due.
 */
export const horsesDownLieStill: Invariant = {
  name: 'horses-down-lie-still',
  check(world) {
    return world.horses.flatMap((h) => {
      const until = h.downUntil
      if (until === undefined) return []
      const carriage = carriagePulledBy(world, h)
      const problems = [
        riderOf(world, h) && 'is ridden',
        carriage && driverOf(world, carriage) && `pulls carriage ${carriage.id}, which is driven`,
        h.health !== 0 && `has health ${h.health}`,
        h.hunger !== 0 && `has hunger ${h.hunger}`,
        !(until >= world.tick && until <= world.tick + HORSE_DOWN_TICKS) &&
          `is due to die at ${until}`,
      ].filter((p): p is string => typeof p === 'string')
      return problems.map((p) => ({
        invariant: this.name,
        message: `horse ${h.id} is Down but ${p}`,
        entityIds: [h.id],
      }))
    })
  },
}
