import { describe, expect, it } from 'vitest'
import { buildProblem, buildingAt, buildingPile, cornersCovering, pileTile } from './building.js'
import {
  FOOTPRINT,
  covers,
  footprintKeys,
  footprintTiles,
  footprintsNear,
  gapTo,
  isAt,
  middleOf,
  nearFootprint,
} from './footprint.js'
import { Terrain, type TerrainMap } from './terrain.js'
import type { Building, WorldState } from './world.js'

const SIZE = 32

/** Plains, with Forest at (10, 10) and Mountain at (20, 20). */
function map(): TerrainMap {
  const tiles = new Uint8Array(SIZE * SIZE).fill(Terrain.Plains)
  tiles[10 * SIZE + 10] = Terrain.Forest
  tiles[20 * SIZE + 20] = Terrain.Mountain
  return { size: SIZE, tiles }
}

/** A world with only what placement looks at: a forest node at (10, 10) and `buildings`. */
function world(buildings: Building[] = []): WorldState {
  return {
    nodes: [{ id: 'n1', kind: 'forest', x: 10, y: 10 }],
    buildings,
    cities: [],
    piles: [],
  } as unknown as WorldState
}

const storage: Building = { id: 's', kind: 'storage', cityId: null, x: 4, y: 4 }

describe('footprints (`CONTEXT.md`: Footprint)', () => {
  it('give each kind its square', () => {
    expect([FOOTPRINT.wall, FOOTPRINT.gate, FOOTPRINT.road]).toEqual([1, 1, 1])
    expect([FOOTPRINT.house, FOOTPRINT.storage, FOOTPRINT.mine]).toEqual([2, 2, 2])
    expect([FOOTPRINT.townHall, FOOTPRINT.warehouse, FOOTPRINT.stable]).toEqual([3, 3, 3])
    expect(FOOTPRINT.farm).toBe(4)
  })

  it('run east and south from the north-west tile, row by row', () => {
    expect(footprintTiles(storage, SIZE)).toEqual([
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ])
    expect(footprintKeys({ kind: 'wall', x: 7, y: 2 }, SIZE)).toEqual(['7,2'])
    expect(footprintTiles({ kind: 'farm', x: 0, y: 0 }, SIZE)).toHaveLength(16)
  })

  it('cover their tiles, also across the map’s joins', () => {
    expect(covers(storage, 4, 4, SIZE)).toBe(true)
    expect(covers(storage, 5, 5, SIZE)).toBe(true)
    expect(covers(storage, 6, 5, SIZE)).toBe(false)
    expect(covers(storage, 3, 4, SIZE)).toBe(false)
    const corner = { kind: 'townHall' as const, x: SIZE - 1, y: SIZE - 1 }
    expect(footprintKeys(corner, SIZE)).toContain('1,1')
    expect(covers(corner, 0, 1, SIZE)).toBe(true)
    expect(covers(corner, 2, 0, SIZE)).toBe(false)
  })

  it('make "at a building" any tile of them (`CONTEXT.md`: At a building)', () => {
    const farm = { kind: 'farm' as const, x: 8, y: 8 }
    expect(isAt({ x: 8, y: 8 }, farm, SIZE)).toBe(true)
    expect(isAt({ x: 11, y: 11 }, farm, SIZE)).toBe(true)
    expect(isAt({ x: 12, y: 11 }, farm, SIZE)).toBe(false)
  })

  it('measure gaps from their edges, the short way round', () => {
    expect(gapTo(storage, { x: 5, y: 4 }, SIZE)).toEqual([0, 0])
    expect(gapTo(storage, { x: 6, y: 4 }, SIZE)).toEqual([1, 0])
    expect(gapTo(storage, { x: 2, y: 9 }, SIZE)).toEqual([2, 4])
    expect(gapTo({ kind: 'wall', x: 0, y: 0 }, { x: SIZE - 2, y: 0 }, SIZE)).toEqual([2, 0])
    expect(nearFootprint(storage, { x: 7, y: 7 }, 2, SIZE)).toBe(true)
    expect(nearFootprint(storage, { x: 8, y: 7 }, 2, SIZE)).toBe(false)
  })

  it('come near each other by the steps between their edges', () => {
    const hall = { kind: 'townHall' as const, x: 10, y: 10 }
    // The hall covers 10–12: a storage over it is 0 steps off, one at 13 touches it (1 step), one
    // at 15 leaves a gap of two tiles (3 steps).
    expect(footprintsNear(hall, { kind: 'storage', x: 12, y: 10 }, 0, SIZE)).toBe(true)
    expect(footprintsNear(hall, { kind: 'storage', x: 13, y: 10 }, 0, SIZE)).toBe(false)
    expect(footprintsNear(hall, { kind: 'storage', x: 13, y: 10 }, 1, SIZE)).toBe(true)
    expect(footprintsNear(hall, { kind: 'storage', x: 15, y: 10 }, 2, SIZE)).toBe(false)
    expect(footprintsNear(hall, { kind: 'storage', x: 15, y: 10 }, 3, SIZE)).toBe(true)
    // West of it the storage's own width counts: at 7 it covers 7–8, a tile off the hall.
    expect(footprintsNear(hall, { kind: 'storage', x: 7, y: 10 }, 2, SIZE)).toBe(true)
    expect(footprintsNear(hall, { kind: 'storage', x: 6, y: 10 }, 2, SIZE)).toBe(false)
  })

  it('have a middle tile, rounded to the north-west', () => {
    expect(middleOf({ kind: 'townHall', x: 10, y: 10 }, SIZE)).toEqual({ x: 11, y: 11 })
    expect(middleOf({ kind: 'farm', x: 10, y: 10 }, SIZE)).toEqual({ x: 11, y: 11 })
    expect(middleOf({ kind: 'wall', x: 10, y: 10 }, SIZE)).toEqual({ x: 10, y: 10 })
  })
})

describe('where buildings go (`CONTEXT.md`: Where buildings go)', () => {
  const terrain = map()

  it('needs every tile of the footprint free', () => {
    const w = world([{ id: 'w', kind: 'wall', cityId: null, x: 15, y: 16 }])
    expect(buildProblem(w, 14, 15, 'smelter', terrain)).toBe('there is already a building there')
    expect(buildProblem(w, 13, 15, 'smelter', terrain)).toBeUndefined()
    // A road may share a tile with a building.
    w.buildings = [{ id: 'r', kind: 'road', cityId: null, x: 15, y: 16 }]
    expect(buildProblem(w, 14, 15, 'smelter', terrain)).toBeUndefined()
  })

  it('needs every tile passable and, for farms and stables, Plains; nothing but a workplace on a node', () => {
    const w = world()
    expect(buildProblem(w, 19, 19, 'smelter', terrain)).toBe(
      'a smelter goes off any resource node, and not on Mountain',
    )
    expect(buildProblem(w, 7, 7, 'farm', terrain)).toBe(
      'a farm goes wholly on Plains, off any resource node',
    )
    expect(buildProblem(w, 6, 6, 'farm', terrain)).toBeUndefined()
    expect(buildProblem(w, 9, 9, 'smithy', terrain)).toBe(
      'a smithy goes off any resource node, and not on Mountain',
    )
  })

  it('takes a node’s workplace with the node on any tile of its footprint', () => {
    const w = world()
    expect(cornersCovering('lumberCamp', 10, 10, SIZE)).toEqual([
      [10, 10],
      [9, 10],
      [10, 9],
      [9, 9],
    ])
    for (const [x, y] of cornersCovering('lumberCamp', 10, 10, SIZE)) {
      expect(buildProblem(w, x, y, 'lumberCamp', terrain)).toBeUndefined()
    }
    expect(buildProblem(w, 11, 10, 'lumberCamp', terrain)).toBe(
      'a lumberCamp goes with one tile on a fitting resource node',
    )
    expect(buildProblem(w, 9, 9, 'quarry', terrain)).toBe(
      'a quarry goes with one tile on a fitting resource node',
    )
  })
})

describe('a building’s pile (`CONTEXT.md`: A building’s pile)', () => {
  it('is kept on the north-west tile of the footprint; elsewhere a pile is its own tile’s', () => {
    const w = world([storage])
    expect(buildingAt(w, 5, 5, SIZE)).toBe(storage)
    expect(buildingAt(w, 6, 5, SIZE)).toBeUndefined()
    expect(pileTile(w, 5, 5, SIZE)).toEqual({ x: 4, y: 4 })
    expect(pileTile(w, 6, 5, SIZE)).toEqual({ x: 6, y: 5 })
    w.piles = [{ id: 'p', x: 4, y: 4, goods: { wood: 3 } }]
    expect(buildingPile(w, storage)?.goods).toEqual({ wood: 3 })
  })
})
