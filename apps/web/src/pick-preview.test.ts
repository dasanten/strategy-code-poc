import { describe, expect, it } from 'vitest'
import { FOOTPRINT } from './shared/footprint.js'
import { ROAD_LINE_MAX_TILES } from '@csp/balance'
import { Terrain } from './shared/terrain.js'
import type { Building } from '@csp/shared-types'
import {
  pickPreview,
  previewPickOf,
  whatIsAt,
  type PreviewPick,
  type PreviewWorld,
} from './pick-preview.js'

const SIZE = 512

const building = (b: Partial<Building> & Pick<Building, 'kind'>): Building => ({
  id: `b-${b.kind}`,
  cityId: null,
  x: 10,
  y: 10,
  ...b,
})

/** Open plains, with a lake at (5, 5), Ashford's storage at (10, 10) and a stone node at (20, 20). */
const world = (more: Partial<PreviewWorld> = {}): PreviewWorld => ({
  buildings: [building({ kind: 'storage', cityId: 'c1', realmId: undefined })],
  lastSeen: [],
  carriages: [],
  horses: [],
  cities: [{ id: 'c1', realmId: 'me' }],
  realmId: 'me',
  size: SIZE,
  cityNames: [{ id: 'c1', name: 'Ashford' }],
  ground: (x, y) => (x === 5 && y === 5 ? Terrain.Lake : x > 40 ? undefined : Terrain.Plains),
  nodeAt: (x, y) => (x === 20 && y === 20 ? { kind: 'stone', x, y } : undefined),
  buildProblem: (_kind, x) => (x === 20 ? undefined : 'it overlaps a building'),
  ...more,
})
const from = { x: 0, y: 0 }

describe('what a pick previews', () => {
  it('previews a walk, drive or haul as a way, and a line from where it starts', () => {
    expect(previewPickOf({ kind: 'resident', mode: 'walk' }, {})).toEqual({
      kind: 'way',
      goer: 'foot',
    })
    expect(previewPickOf({ kind: 'resident', mode: 'drive' }, {})).toEqual({
      kind: 'way',
      goer: 'carriage',
    })
    expect(previewPickOf({ kind: 'group', mode: 'haul' }, {})).toEqual({
      kind: 'way',
      goer: 'carriage',
    })
    expect(previewPickOf({ kind: 'resident', mode: 'roadFrom' }, {})).toEqual({
      kind: 'lineStart',
      building: 'road',
    })
    expect(previewPickOf({ kind: 'group', mode: 'wallTo' }, { lineFrom: from })).toEqual({
      kind: 'line',
      building: 'wall',
      from,
    })
  })

  it('previews the place a group’s Work, Tear down, Store at or Fetch from would use', () => {
    const place = (mode: 'work' | 'tearDown' | 'storeAt' | 'fetchFrom') =>
      previewPickOf({ kind: 'group', mode }, {})
    expect(place('work')).toEqual({ kind: 'place', pick: 'workplace' })
    expect(place('tearDown')).toEqual({ kind: 'place', pick: 'building' })
    expect(place('storeAt')).toEqual({ kind: 'place', pick: 'storage' })
    expect(place('fetchFrom')).toEqual({ kind: 'place', pick: 'storage' })
    expect(previewPickOf({ kind: 'group', mode: 'build' }, {})).toEqual({ kind: 'build' })
    expect(previewPickOf({ kind: 'group', mode: 'attack' }, {})).toEqual({ kind: 'tile' })
  })

  it('previews a planned step’s next pick, and a param’s building', () => {
    const plan = { kind: 'road' as const, picked: [] }
    const target = { kind: 'plan' as const, prompt: '' }
    expect(previewPickOf(target, { plan })).toEqual({ kind: 'lineStart', building: 'road' })
    const started = { ...plan, picked: [{ x: 1, y: 2 }] }
    expect(previewPickOf(target, { plan: started })).toEqual({
      kind: 'line',
      building: 'road',
      from: { x: 1, y: 2 },
    })
    expect(previewPickOf(target, { plan: { kind: 'store', picked: [] } })).toEqual({
      kind: 'place',
      pick: 'storage',
    })
    expect(previewPickOf(target, { plan: { kind: 'walk', picked: [] } })).toEqual({
      kind: 'way',
      goer: 'foot',
    })
    const param = { name: 'home', type: 'storage' as const }
    expect(previewPickOf({ kind: 'param', param }, {})).toEqual({ kind: 'param', type: 'storage' })
  })
})

describe('the preview under the pointer', () => {
  const at = (pick: PreviewPick, x: number, y: number, goers = [{ from }]) =>
    pickPreview(pick, { x, y }, world(), goers)

  it('draws each one’s way there, with the tiles and the arrival estimate', () => {
    const p = pickPreview({ kind: 'way', goer: 'foot' }, { x: 8, y: 0 }, world(), [
      { from, ticks: (path) => path.length * 60 },
      { from: { x: 0, y: 2 } },
    ])
    expect(p.ways).toHaveLength(2)
    expect(p.ways[0]!.path.at(-1)).toEqual([8, 0])
    expect(p.label).toBe('Plains, 8 tiles · about 8 min (8 game hours)')
  })

  it('goes round a lake on the way', () => {
    const p = at({ kind: 'way', goer: 'foot' }, 10, 10, [{ from: { x: 0, y: 0 } }])
    expect(p.ways[0]!.path).not.toContainEqual([5, 5])
    expect(p.label).toMatch(/^Ashford storage, \d+ tiles$/)
  })

  it('draws a line from where it starts with its tile count, red when too long', () => {
    const p = at({ kind: 'line', building: 'road', from }, 13, 0)
    expect(p.line).toMatchObject({ building: 'road', tooLong: false })
    expect(p.line!.tiles).toHaveLength(14)
    expect(p.label).toBe('Plains · a road line of 14 tiles')
    const far = at({ kind: 'line', building: 'wall', from }, ROAD_LINE_MAX_TILES, 0)
    expect(far.line!.tooLong).toBe(true)
    expect(far.label).toBe(
      `Too long: a wall line of ${ROAD_LINE_MAX_TILES + 1} tiles, at most ${ROAD_LINE_MAX_TILES}`,
    )
  })

  it('shows a node’s workplace footprint where to build, marked where it doesn’t fit', () => {
    const fits = at({ kind: 'build' }, 20, 20)
    expect(fits.footprint).toEqual({ kind: 'quarry', x: 20, y: 20 })
    expect(fits.label).toBe('Quarry here')
    const p = pickPreview(
      { kind: 'build' },
      { x: 20, y: 20 },
      world({ buildProblem: () => 'not all of it is explored' }),
      [],
    )
    expect(p.footprint?.problem).toBe('not all of it is explored')
    expect(p.label).toBe('No room for a quarry: not all of it is explored')
  })

  it('outlines a site to join where to build', () => {
    const site = building({ kind: 'house', x: 30, y: 30, site: { work: 0, delivered: {} } })
    const p = pickPreview({ kind: 'build' }, { x: 31, y: 31 }, world({ buildings: [site] }), [])
    expect(p.place).toEqual({ x: 30, y: 30, side: FOOTPRINT.house })
    expect(p.label).toBe('House site · they join it')
  })

  it('outlines the building a Store or a param would use, or says why nothing there', () => {
    const storage = at({ kind: 'place', pick: 'storage' }, 11, 11)
    expect(storage.place).toEqual({ x: 10, y: 10, side: FOOTPRINT.storage })
    expect(storage.label).toBe('Ashford storage')
    const none = at({ kind: 'place', pick: 'storage' }, 2, 2)
    expect(none.place).toBeUndefined()
    expect(none.label).toBe('Plains · no storage, stable or carriage there')
    expect(at({ kind: 'param', type: 'storage' }, 10, 10).place).toBeDefined()
  })

  it('names what is under the pointer', () => {
    expect(whatIsAt({ x: 10, y: 10 }, world())).toBe('Ashford storage')
    expect(whatIsAt({ x: 5, y: 5 }, world())).toBe('Lake')
    expect(whatIsAt({ x: 50, y: 5 }, world())).toBe('Unexplored ground')
    const carriages = [{ id: 'k', x: 3, y: 3, realmId: 'me' }]
    expect(whatIsAt({ x: 3, y: 3 }, world({ carriages }))).toBe('Carriage')
  })
})
