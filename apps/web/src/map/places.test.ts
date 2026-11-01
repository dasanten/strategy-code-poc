import { describe, expect, it } from 'vitest'
import type { Building, ResidentOrder, SeenResident } from '@csp/shared'
import { pickedPlaces } from './places.js'

const size = 1440
const building = (id: string, kind: Building['kind'], x: number, y: number, site = false) =>
  ({ id, kind, x, y, ...(site ? { site: { needs: {} } } : {}) }) as unknown as Building
const farm = building('b-farm', 'farm', 10, 10)
const storage = building('b-store', 'storage', 20, 10)
const far = building('b-far', 'storage', 40, 40)
const world = {
  residents: [] as Pick<SeenResident, 'id' | 'order' | 'script'>[],
  buildings: [farm, storage],
  lastSeen: { buildings: [far] },
  carriages: [{ id: 'k1' }],
  map: { size },
}
const resident = (
  id: string,
  order: ResidentOrder | null,
  params?: Record<string, string | number>,
) => ({ id, order, script: { scriptId: 1, ...(params ? { params } : {}) } })
const keys = (w: typeof world, picked: string[]) =>
  pickedPlaces(w, picked).map((p) => (p.kind === 'carriage' ? `carriage ${p.id}` : p.key))

describe('the places of the picked', () => {
  it('are the workplace of Work and the storage its script picked, each footprint whole', () => {
    const work: ResidentOrder = {
      kind: 'workAt',
      buildingId: 'b-farm',
      at: { x: 10, y: 10 },
      progress: 0,
    }
    const w = { ...world, residents: [resident('r1', work, { storage: 'b-store', foodAt: 3 })] }
    expect(pickedPlaces(w, ['r1'])).toEqual([
      { kind: 'footprint', key: 'b-store', x: 20, y: 10, side: 2 },
      { kind: 'footprint', key: 'b-farm', x: 10, y: 10, side: 4 },
    ])
    // Not picked: nothing.
    expect(pickedPlaces(w, [])).toEqual([])
  })

  it('are the site of Build and its source, a remembered one too', () => {
    const site = building('b-site', 'house', 30, 30, true)
    const on: ResidentOrder = {
      kind: 'build',
      building: 'house',
      at: { x: 30, y: 30 },
      siteId: 'b-site',
    }
    const w = {
      ...world,
      buildings: [...world.buildings, site],
      residents: [resident('r1', on, { site: 'b-site', source: 'b-far' })],
    }
    expect(keys(w, ['r1']).sort()).toEqual(['b-far', 'b-site'])
    // On the way there the site is the one of its kind covering the order's tile.
    const going: ResidentOrder = { ...on, at: { x: 31, y: 31 }, siteId: null }
    expect(keys({ ...w, residents: [resident('r1', going)] }, ['r1'])).toEqual(['b-site'])
    // With no site laid out yet, there is none to outline.
    const fresh: ResidentOrder = { ...on, at: { x: 60, y: 60 }, siteId: null }
    expect(keys({ ...w, residents: [resident('r1', fresh)] }, ['r1'])).toEqual([])
  })

  it('are the storage or carriage a Fetch or Store goes to', () => {
    const fetch: ResidentOrder = {
      kind: 'fetch',
      goods: { food: null },
      from: { kind: 'storage', storageId: 'b-store' },
      phase: 'walking',
      path: null,
      progress: 0,
    }
    const store: ResidentOrder = {
      kind: 'store',
      goods: {},
      to: { kind: 'carriage', carriageId: 'k1' },
      phase: 'putting',
      path: null,
      progress: 0,
    }
    const w = { ...world, residents: [resident('r1', fetch), resident('r2', store)] }
    expect(keys(w, ['r1'])).toEqual(['b-store'])
    expect(keys(w, ['r2'])).toEqual(['carriage k1'])
  })

  it('are both stops of a haul: the building at each, or the bare tile', () => {
    const haul: Extract<ResidentOrder, { kind: 'haul' }> = {
      kind: 'haul',
      carriageId: 'k1',
      from: { x: 21, y: 11 },
      to: { x: 50, y: 50 },
      goods: ['wood'],
      returnGoods: [],
      keepFood: 0,
      stop: 'to',
      phase: 'driving',
      path: null,
      progress: 0,
      moving: null,
    }
    const w = { ...world, residents: [resident('r1', haul)] }
    expect(pickedPlaces(w, ['r1'])).toEqual([
      { kind: 'footprint', key: 'b-store', x: 20, y: 10, side: 2 },
      { kind: 'footprint', key: '50,50', x: 50, y: 50, side: 1 },
    ])
    // Supplying an army, the second stop moves with it and is not outlined.
    const supply = { ...w, residents: [resident('r1', { ...haul, toArmy: 'a1' })] }
    expect(keys(supply, ['r1'])).toEqual(['b-store'])
  })

  it('are each outlined once for a group, and only those the Player knows', () => {
    const work = (buildingId: string): ResidentOrder => ({
      kind: 'workAt',
      buildingId,
      at: { x: 0, y: 0 },
      progress: 0,
    })
    const w = {
      ...world,
      residents: [
        resident('r1', work('b-farm'), { storage: 'b-store' }),
        resident('r2', work('b-farm'), { storage: 'b-store' }),
        // Out of sight and never seen, or a carriage gone from sight.
        resident('r3', work('b-gone'), { storage: 'k-gone' }),
      ],
    }
    expect(keys(w, ['r1', 'r2', 'r3']).sort()).toEqual(['b-farm', 'b-store'])
  })
})
