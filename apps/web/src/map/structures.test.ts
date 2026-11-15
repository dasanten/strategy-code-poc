import { describe, expect, it } from 'vitest'
import type { Building, BuildingKind, City } from '@csp/shared-types'
import { cityAreaTiles } from '../shared/city.js'
import { footprintKeys } from '../shared/footprint.js'
import { structuresOf } from './structures.js'

const size = 100

const building = (
  id: string,
  kind: BuildingKind,
  x: number,
  y: number,
  cityId: string | null = 'c1',
): Building => ({ id, kind, cityId, x, y })

const city = (id: string): City => ({
  id,
  name: id,
  realmId: null,
  townHallId: `${id}-hall`,
  occupation: null,
})

/** Two cities, one across the map's side, with roads, walls, a gate and a site. */
const buildings: Building[] = [
  building('c1-hall', 'townHall', 10, 10),
  building('h1', 'house', 13, 10),
  building('r1', 'road', 12, 12),
  building('r2', 'road', 13, 12),
  building('w1', 'wall', 8, 8),
  building('g1', 'gate', 9, 8),
  { ...building('s1', 'house', 16, 16), site: { delivered: {}, work: 0 } },
  building('c2-hall', 'townHall', 98, 50, 'c2'),
  building('h2', 'house', 0, 51, 'c2'),
  building('m1', 'mine', 40, 40, null),
]

const pairs = (tiles: Int32Array) =>
  Array.from({ length: tiles.length / 2 }, (_, i) => `${tiles[2 * i]},${tiles[2 * i + 1]}`)

describe('structuresOf', () => {
  it("holds each city's area as cityAreaTiles works it out", () => {
    const { areas } = structuresOf(buildings, size)
    for (const id of ['c1', 'c2']) {
      const area = areas.get(id)!
      expect(new Set(pairs(area.tiles))).toEqual(cityAreaTiles({ buildings }, city(id), size))
    }
    expect(areas.has('c3')).toBe(false)
  })

  it("reaches every tile of a city's area from its anchor, across the map's side", () => {
    const area = structuresOf(buildings, size).areas.get('c2')!
    for (const key of pairs(area.tiles)) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      const d = (a: number, b: number) => Math.min(Math.abs(a - b), size - Math.abs(a - b))
      expect(Math.max(d(area.x, x), d(area.y, y))).toBeLessThanOrEqual(area.reach)
    }
    // Not the whole map's width, though the city lies on both sides of its edge.
    expect(area.reach).toBeLessThan(20)
  })

  it('holds roads, walls and gates by tile, and every footprint but a road', () => {
    const s = structuresOf(buildings, size)
    expect([...s.roads.keys()].sort()).toEqual(['12,12', '13,12'])
    expect([...s.walls].sort()).toEqual(['8,8', '9,8'])
    const built = buildings
      .filter((b) => b.kind !== 'road')
      .flatMap((b) => footprintKeys(b, size))
    expect(s.built).toEqual(new Set(built))
  })

  it('works a list out once, and again for a new list', () => {
    const first = structuresOf(buildings, size)
    expect(structuresOf(buildings, size)).toBe(first)
    const next = [...buildings, building('h3', 'house', 20, 20)]
    expect(structuresOf(next, size)).not.toBe(first)
    expect(structuresOf(next, size).built.has('20,20')).toBe(true)
  })
})
