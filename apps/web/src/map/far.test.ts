import { describe, expect, it } from 'vitest'
import type { Building, BuildingKind, City, Resident } from '@csp/shared'
import { CLOSE_SCALE, FAR_SCALE, tileToScreen, zoomTier } from './camera.js'
import {
  EMBLEM_RADIUS,
  LARGE_TOWN_HOUSES,
  TOWN_HOUSES,
  cityEmblems,
  citySize,
  emblemAt,
  farMarkers,
} from './far.js'

const size = 200
const viewer = { realmId: 'r1', allies: new Set(['r2']) }

const building = (id: string, kind: BuildingKind, x: number, y: number): Building => ({
  id,
  kind,
  cityId: null,
  x,
  y,
})
const city = (id: string, realmId: string | null, hall: string): City => ({
  id,
  name: `City ${id}`,
  realmId,
  townHallId: hall,
  occupation: null,
})
/** A town hall at (x, 10) with `houses` houses next to it, in a row. */
const withHouses = (prefix: string, x: number, houses: number) => [
  building(`${prefix}-hall`, 'townHall', x, 10),
  ...Array.from({ length: houses }, (_, i) => building(`${prefix}-h${i}`, 'house', x + 1 + i, 11)),
]

describe('zoom tiers', () => {
  it('is far below FAR_SCALE, close from CLOSE_SCALE, middle between', () => {
    expect(zoomTier(1)).toBe('far')
    expect(zoomTier(FAR_SCALE - 0.01)).toBe('far')
    expect(zoomTier(FAR_SCALE)).toBe('middle')
    expect(zoomTier(CLOSE_SCALE - 0.01)).toBe('middle')
    expect(zoomTier(CLOSE_SCALE)).toBe('close')
    expect(FAR_SCALE).toBeLessThan(CLOSE_SCALE)
  })
})

describe('city size', () => {
  it('steps from village to town to large town by houses', () => {
    expect(citySize(0)).toBe('village')
    expect(citySize(TOWN_HOUSES - 1)).toBe('village')
    expect(citySize(TOWN_HOUSES)).toBe('town')
    expect(citySize(LARGE_TOWN_HOUSES - 1)).toBe('town')
    expect(citySize(LARGE_TOWN_HOUSES)).toBe('largeTown')
  })

  it('draws a larger city with a larger emblem', () => {
    expect(EMBLEM_RADIUS.village).toBeLessThan(EMBLEM_RADIUS.town)
    expect(EMBLEM_RADIUS.town).toBeLessThan(EMBLEM_RADIUS.largeTown)
  })
})

describe('city emblems', () => {
  it('puts one emblem per city on its town hall, sized by its houses', () => {
    const buildings = [
      ...withHouses('a', 10, 3),
      ...withHouses('b', 60, TOWN_HOUSES),
      ...withHouses('c', 120, LARGE_TOWN_HOUSES),
    ]
    const cities = [city('a', 'r1', 'a-hall'), city('b', 'r2', 'b-hall'), city('c', null, 'c-hall')]
    expect(cityEmblems({ cities, buildings }, viewer, size)).toEqual([
      { id: 'a', name: 'City a', x: 10, y: 10, size: 'village', rel: 'own' },
      { id: 'b', name: 'City b', x: 60, y: 10, size: 'town', rel: 'alliance' },
      { id: 'c', name: 'City c', x: 120, y: 10, size: 'largeTown', rel: 'npc' },
    ])
  })

  it('counts only houses that belong to the city, and skips a city whose town hall is unseen', () => {
    const buildings = [
      ...withHouses('a', 10, 2),
      // Too far from the town hall to be part of the city.
      ...Array.from({ length: 6 }, (_, i) => building(`far-${i}`, 'house', 40 + i, 40)),
      // A house still being built is not part of it yet.
      { ...building('site', 'house', 10, 12), site: {} as Building['site'] },
    ]
    const cities = [city('a', 'r3', 'a-hall'), city('gone', 'r1', 'unseen-hall')]
    expect(cityEmblems({ cities, buildings }, viewer, size)).toEqual([
      { id: 'a', name: 'City a', x: 10, y: 10, size: 'village', rel: 'other' },
    ])
  })
})

describe('far markers', () => {
  it('shows an army at its first member in sight and a caravan at its carriage', () => {
    const resident = (id: string, x: number, y: number) => ({ id, x, y }) as Resident
    expect(
      farMarkers({
        armies: [{ memberIds: ['unseen', 'm1', 'm2'] }, { memberIds: ['unseen'] }],
        caravans: [{ carriageId: 'k1' }],
        residents: [resident('m1', 5, 6), resident('m2', 7, 8)],
        carriages: [{ id: 'k1', x: 30, y: 31 } as never],
      }),
    ).toEqual([
      { kind: 'army', x: 5, y: 6, rel: 'own' },
      { kind: 'caravan', x: 30, y: 31, rel: 'trade' },
    ])
  })
})

describe('emblemAt', () => {
  const view = { width: 800, height: 600 }
  const cam = { x: 50, y: 50, scale: 4 }
  const emblems = cityEmblems(
    {
      cities: [city('a', 'r1', 'a-hall'), city('b', 'r1', 'b-hall')],
      buildings: [...withHouses('a', 50, 0), ...withHouses('b', 60, LARGE_TOWN_HOUSES)],
    },
    viewer,
    size,
  )

  it('picks the city whose emblem a click falls on', () => {
    const [ax, ay] = tileToScreen(cam, view, size, 50.5, 10.5)
    expect(emblemAt(emblems, cam, view, size, ax + 3, ay - 3)?.id).toBe('a')
    const [bx, by] = tileToScreen(cam, view, size, 60.5, 10.5)
    expect(emblemAt(emblems, cam, view, size, bx, by + EMBLEM_RADIUS.largeTown)?.id).toBe('b')
  })

  it('picks nothing on empty ground', () => {
    const [ax, ay] = tileToScreen(cam, view, size, 50.5, 10.5)
    expect(emblemAt(emblems, cam, view, size, ax, ay + 40)).toBeUndefined()
  })
})
