import {
  HEAL_DAYS,
  HORSE_FOOD_PER_DAY,
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
  horseFood,
  horseFoodFactor,
  type Horse,
  type HorseStats,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'

/** How far one unit of food fills a horse's hunger meter: a full meter holds `HUNGER_DAYS` of food. */
const FILL_PER_FOOD = MAX_HUNGER / (HUNGER_DAYS * HORSE_FOOD_PER_DAY)

/** Whole stats for a new horse, each from `HORSE_STAT_MIN` to `HORSE_STAT_MAX` (`CONTEXT.md`: Horse stats). */
export function drawHorseStats(rand: () => number): HorseStats {
  const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
  return Object.fromEntries(
    HORSE_STAT_NAMES.map((s) => [s, between(HORSE_STAT_MIN, HORSE_STAT_MAX)]),
  ) as HorseStats
}

/**
 * A new grown horse (`CONTEXT.md`: Horse stats): drawn stats, a full hunger meter and full
 * health, aged between `HORSE_START_AGE_MIN` and `HORSE_START_AGE_MAX` game years at `tick`.
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
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats,
    bornAt: tick - Math.round(age * TICKS_PER_GAME_YEAR),
  }
}

/**
 * One tick of horses (`CONTEXT.md`: Horse, Horses have no inventory, Stable). Their hunger meter
 * runs down like a resident's; a horse eats a unit of food when there is room for it, from what is
 * in reach (`horseFood`). An empty meter costs health, a meter with anything in it slowly gives
 * health back, and a horse with no health left dies, which goes in its Player's realm log.
 * Foals come only from a resident breeding them (`resolveBreeding`). Returns the horses that died.
 */
export function stepHorses(world: WorldState, terrain: TerrainMap): Horse[] {
  const drain = MAX_HUNGER / (HUNGER_DAYS * TICKS_PER_GAME_DAY)
  const starve = MAX_HEALTH / (STARVE_DAYS * TICKS_PER_GAME_DAY)
  const heal = MAX_HEALTH / (HEAL_DAYS * TICKS_PER_GAME_DAY)
  const died: Horse[] = []
  let ate = false

  for (const h of world.horses) {
    // Endurance sets how fast the meter runs down, so how much Food the horse needs.
    h.hunger = Math.max(0, h.hunger - drain * horseFoodFactor(h))
    if (h.hunger <= MAX_HUNGER - FILL_PER_FOOD) {
      const food = horseFood(world, h, terrain.size)[0]
      if (food) {
        const left = food.food! - 1
        if (left > 0) food.food = left
        else delete food.food
        h.hunger = Math.min(MAX_HUNGER, h.hunger + FILL_PER_FOOD)
        ate = true
      }
    }
    if (h.hunger <= 0) h.health = Math.max(0, h.health - starve)
    else h.health = Math.min(MAX_HEALTH, h.health + heal)
    if (h.health <= 0) died.push(h)
  }
  if (ate) world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
  if (died.length > 0) {
    world.horses = world.horses.filter((h) => !died.includes(h))
    // A carriage whose horse died stands where it is, with nothing to pull it.
    for (const k of world.carriages) if (died.some((h) => h.id === k.horseId)) k.horseId = null
    for (const h of died) recordEvent(world, h.realmId, { kind: 'horseDied', horseId: h.id })
  }
  return died
}
