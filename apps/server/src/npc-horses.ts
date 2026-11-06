import {
  FOOTPRINT,
  HORSE_FOOD_PER_DAY,
  NPC_START_HORSES,
  NPC_START_HORSE_FOOD_DAYS,
  ownsHorse,
  wrap,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { newHorse } from './horses.js'
import { npcHome } from './npc-behaviour.js'
import { farStableSpot } from './npc-growth.js'
import { hash, mulberry32 } from './residents.js'
import { newId } from './starting-city.js'

/**
 * An NPC city's first horses (`CONTEXT.md`: NPC horses): `NPC_START_HORSES` new ones of the city and
 * their Food on the ground by them. They stand in its stable if it has one. With none they stand
 * where one fits, far from its home, and its stable goes up around them (`stableTile`), since nobody
 * leads a city's horses anywhere. With no room for a stable it gets none. A city's horses are drawn
 * from its own seed, so they leave the rest of the world as it was.
 */
export function giveNpcHorses(world: WorldState, terrain: TerrainMap, city: City): void {
  const home = npcHome(world, city)
  const stable = world.buildings.find((b) => b.kind === 'stable' && b.cityId === city.id)
  const spot = stable ?? (home && farStableSpot(world, city, home, terrain))
  if (!spot) return
  // The middle of the footprint.
  const middle = Math.floor(FOOTPRINT.stable / 2)
  const x = wrap(spot.x + middle, terrain.size)
  const y = wrap(spot.y + middle, terrain.size)
  const rand = mulberry32(hash(`${world.seed}:${city.id}:horses`))
  for (let i = 0; i < NPC_START_HORSES; i++) {
    const id = newId(world, 'horse')
    world.horses.push(
      newHorse(rand, { id, realmId: null, cityId: city.id, x, y, tick: world.tick }),
    )
  }
  const food = Math.ceil(NPC_START_HORSES * NPC_START_HORSE_FOOD_DAYS * HORSE_FOOD_PER_DAY)
  const pile = world.piles.find((p) => p.x === x && p.y === y)
  if (pile) pile.goods.food = (pile.goods.food ?? 0) + food
  else world.piles.push({ id: newId(world, 'pile'), x, y, goods: { food } })
}

/**
 * The migration of the NPC horses (`CONTEXT.md`: NPC horses): each NPC village, town and daughter
 * from before with no horse gets its two. Trading posts, the HQ and Players' cities get none.
 */
export function giveHorsesToNpcCities(world: WorldState, terrain: TerrainMap): void {
  for (const city of world.cities) {
    if (city.realmId !== null || city.tradeOrg) continue
    if (world.horses.some((h) => ownsHorse({ cityId: city.id }, h))) continue
    giveNpcHorses(world, terrain, city)
  }
}
