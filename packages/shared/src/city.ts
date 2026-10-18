import { FOOD_PER_DAY, FOOD_SURPLUS_DAYS, HOUSING_ROOM, hungerFactor } from './balance.js'
import type { City, Resident, WorldState } from './world.js'

/** World queries about cities (ADR 0002: the game API orders and scripts share). */

/** The residents who live in a city, wherever they are standing. */
export function cityResidents(world: WorldState, city: City): Resident[] {
  return world.residents.filter((r) => r.cityId === city.id)
}

/** How many residents a city's finished buildings house (`HOUSING_ROOM`); sites house nobody. */
export function housingRoom(world: WorldState, city: City): number {
  return world.buildings
    .filter((b) => b.cityId === city.id && !b.site)
    .reduce((room, b) => room + (HOUSING_ROOM[b.kind] ?? 0), 0)
}

/** A city's free housing (`CONTEXT.md`: House): its room minus its residents. Can be below 0. */
export function freeHousing(world: WorldState, city: City): number {
  return housingRoom(world, city) - cityResidents(world, city).length
}

/** Food in a city's storages. Food its residents carry is not counted. */
export function storedFood(world: WorldState, city: City): number {
  return world.buildings
    .filter((b) => b.cityId === city.id && b.kind === 'storage' && !b.site)
    .reduce((food, b) => food + (b.stock?.food ?? 0), 0)
}

/** Food all of a city's residents eat in `FOOD_SURPLUS_DAYS` game days, by their Endurance. */
export function surplusFoodLine(world: WorldState, city: City): number {
  return cityResidents(world, city).reduce(
    (food, r) => food + FOOD_PER_DAY * hungerFactor(r, world.tick) * FOOD_SURPLUS_DAYS,
    0,
  )
}

/**
 * Whether a city has a food surplus (`CONTEXT.md`: Food surplus): its storages hold more Food
 * than all its residents eat in `FOOD_SURPLUS_DAYS` game days.
 */
export function hasFoodSurplus(world: WorldState, city: City): boolean {
  return storedFood(world, city) > surplusFoodLine(world, city)
}
