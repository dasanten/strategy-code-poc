import {
  HEAL_DAYS,
  HORSE_FOOD_PER_DAY,
  HUNGER_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  STABLE_BREED_TICKS,
  STARVE_DAYS,
  TICKS_PER_GAME_DAY,
  breedingPair,
  horseFood,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { newId } from './starting-city.js'

/** How far one unit of food fills a horse's hunger meter: a full meter holds `HUNGER_DAYS` of food. */
const FILL_PER_FOOD = MAX_HUNGER / (HUNGER_DAYS * HORSE_FOOD_PER_DAY)

/**
 * One tick of horses (`CONTEXT.md`: Horse, Horses have no inventory, Stable). Their hunger meter
 * runs down like a resident's; a horse eats a unit of food when there is room for it, from what is
 * in reach (`horseFood`). An empty meter costs health, a meter with anything in it slowly gives
 * health back, and a horse with no health left dies, which goes in its Player's realm log. Then
 * every stable with two fed horses of one realm and room for another breeds toward a foal; after
 * `STABLE_BREED_DAYS` of that a foal of their realm is born in the stable. Returns the horses
 * that died.
 */
export function stepHorses(world: WorldState, terrain: TerrainMap): Horse[] {
  const drain = MAX_HUNGER / (HUNGER_DAYS * TICKS_PER_GAME_DAY)
  const starve = MAX_HEALTH / (STARVE_DAYS * TICKS_PER_GAME_DAY)
  const heal = MAX_HEALTH / (HEAL_DAYS * TICKS_PER_GAME_DAY)
  const died: Horse[] = []
  let ate = false

  for (const h of world.horses) {
    h.hunger = Math.max(0, h.hunger - drain)
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

  for (const stable of world.buildings) {
    const pair = stable.kind === 'stable' ? breedingPair(world, stable) : undefined
    if (!pair) continue
    stable.breeding = (stable.breeding ?? 0) + 1
    if (stable.breeding < STABLE_BREED_TICKS) continue
    stable.breeding = 0
    const foal: Horse = {
      id: newId(world, 'horse'),
      realmId: pair[0].realmId,
      cityId: pair[0].cityId,
      x: stable.x,
      y: stable.y,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
    }
    world.horses.push(foal)
    recordEvent(world, foal.realmId, { kind: 'foaled', horseId: foal.id, stableId: stable.id })
  }
  return died
}
