// Setup shared by `npc-growth.test.ts` and `npc-growth-village.test.ts`; left out of the build.

import {
  NPC_VILLAGE,
  NPC_WALL_STEP,
  TICKS_PER_GAME_DAY,
  Terrain,
  buildingAt,
  footprintTiles,
  freeHousing,
  tileIndex,
  wrapDelta,
  type Building,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { expect } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { newWall, wallRings } from './npc-growth.js'
import { foundNpcCity } from './npc-cities.js'
import { mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

export const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** How far the village's wall stands from its home, along each direction. */
export const WALL = Math.floor(NPC_VILLAGE.size / 2)

/** Where the forest node lies: east of the village, beyond where its next wall would stand. */
export const FOREST = { x: 34 + 40, y: 34 }

/**
 * A village alone on a Plains map, its top-left wall tile at (20, 20) and its home (the storage)
 * at (34, 34), `WALL` tiles from its wall, with a forest node east of it.
 */
export function village(): { world: WorldState; terrain: TerrainMap; city: City; home: Building } {
  const terrain = plains(200)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  world.nodes.push({ id: 'forest', kind: 'forest', ...FOREST })
  terrain.tiles[tileIndex(terrain.size, FOREST.x, FOREST.y)] = Terrain.Forest
  return { world, terrain, city, home: npcHome(world, city)! }
}

/** The ring round the home that the nearest tile of a footprint lies on. */
export const nearRing = (home: Building, b: Pick<Building, 'kind' | 'x' | 'y'>) =>
  Math.min(
    ...footprintTiles(b).map(([x, y]) => Math.max(Math.abs(x - home.x), Math.abs(y - home.y))),
  )

/** Rock fills the rest of the inside of the village's wall, so it has no room left there. */
export function fillInside(world: WorldState, terrain: TerrainMap, home: Building): void {
  for (let dy = -(WALL - 1); dy <= WALL - 1; dy++) {
    for (let dx = -(WALL - 1); dx <= WALL - 1; dx++) {
      const x = home.x + dx
      const y = home.y + dy
      if (buildingAt(world, x, y)) continue
      world.nodes.push({ id: `rock${x},${y}`, kind: 'stone', x, y })
      terrain.tiles[tileIndex(terrain.size, x, y)] = Terrain.Hills
    }
  }
}

/** Adds adults to the city until its houses are full. */
export function fillHouses(world: WorldState, city: City, home: Building): void {
  const rand = mulberry32(3)
  while (freeHousing(world, city) > 0) {
    const r = newResident(rand, {
      id: newId(world, 'r'),
      owner: null,
      cityId: city.id,
      x: home.x,
      y: home.y,
      tick: world.tick,
    })
    world.residents.push(r)
  }
}

export const storageOf = (world: WorldState, city: City): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage')!

/** The city's finished walls and gates `d` tiles out from its home. */
export const ring = (world: WorldState, city: City, home: Building, size: number, d: number) =>
  world.buildings.filter(
    (b) =>
      b.cityId === city.id &&
      (b.kind === 'wall' || b.kind === 'gate') &&
      !b.site &&
      Math.max(Math.abs(wrapDelta(home.x, b.x, size)), Math.abs(wrapDelta(home.y, b.y, size))) ===
        d,
  )

/**
 * Runs the world for up to `ticks`, or until `done`, checking the invariants every game day and,
 * every tick until it happens, that the old wall (`oldIds`) stands whole while any tile of the new
 * wall is unfinished.
 */
export function run(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  home: Building,
  oldIds: Set<string>,
  ticks: number,
  done: () => boolean = () => false,
): void {
  const walking = new Walking(terrain)
  let comingDown = false
  for (let t = 0; t < ticks && !done(); t++) {
    stepWorld(world, terrain, walking)
    if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (comingDown) continue
    const old = world.buildings.filter((b) => oldIds.has(b.id))
    if (old.length === oldIds.size && old.every((b) => !b.teardown)) continue
    // The first stretch of the old wall is coming down: the new one is finished.
    const rings = wallRings(world, city, home, terrain.size)!
    expect(rings.outer).toBe(rings.inner + NPC_WALL_STEP)
    expect(newWall(world, home, terrain, rings).every((w) => w.done)).toBe(true)
    comingDown = true
  }
}
