import { describe, expect, it } from 'vitest'
import {
  ADMIN_VIEW_MAX_SIDE,
  OVERVIEW_SCALE,
  Terrain,
  chunksAcross,
  type AdminEntity,
  type AdminPlaces,
  type AdminWorldView,
} from '@csp/shared'
import {
  ADMIN_LINK_SCALE,
  ADMIN_VIEW_MARGIN,
  ADMIN_VIEWER,
  adminMapWorld,
  adminViewRequest,
  mapViewSearch,
  parseMapView,
} from './admin-map.js'
import { FAR_SCALE, MAX_SCALE } from './map/camera.js'
import { TOWN_HOUSES } from './map/far.js'
import { overviewPixels, overviewTerrainAt } from './map/overview.js'
import { TERRAIN_COLORS } from './map/palette.js'
import { regionColour } from './map/region.js'

const size = 640

describe('admin map view in the URL', () => {
  it('lands where a link says, and goes back into the URL the same', () => {
    const cam = parseMapView('?x=120&y=33&zoom=20', size)
    expect(cam).toEqual({ x: 120, y: 33, scale: 20 })
    expect(mapViewSearch(cam)).toBe('?x=120&y=33&zoom=20')
    expect(parseMapView(mapViewSearch({ x: 10.7, y: 3.2, scale: 9.876 }), size)).toEqual({
      x: 10,
      y: 3,
      scale: 9.88,
    })
  })

  it('opens the whole map zoomed out without a place, and keeps a place on the map', () => {
    // A zoom of 0: the map clamps it to its furthest, the whole map on screen.
    expect(parseMapView('', size)).toEqual({ x: size / 2, y: size / 2, scale: 0 })
    expect(parseMapView('?x=abc&y=1', size)).toEqual({ x: size / 2, y: size / 2, scale: 0 })
    expect(parseMapView('?x=-1&y=650', size)).toEqual({ x: 639, y: 10, scale: ADMIN_LINK_SCALE })
    expect(parseMapView('?x=1&y=1&zoom=999', size).scale).toBe(MAX_SCALE)
    expect(parseMapView('?x=1&y=1&zoom=-3', size).scale).toBe(ADMIN_LINK_SCALE)
  })
})

describe('what the admin map loads', () => {
  const screen = { width: 800, height: 600 }

  it('loads every city on the map when far out', () => {
    expect(adminViewRequest({ x: 5, y: 5, scale: FAR_SCALE - 1 }, screen, size)).toEqual({
      x: 0,
      y: 0,
      w: size,
      h: size,
      citiesOnly: true,
    })
  })

  it('loads what is on screen and a margin around it, wrapping round the edges', () => {
    const req = adminViewRequest({ x: 2, y: 300, scale: 10 }, screen, size)
    expect(req.citiesOnly).toBeUndefined()
    expect(req.w).toBe(81 + 2 * ADMIN_VIEW_MARGIN)
    expect(req.h).toBe(61 + 2 * ADMIN_VIEW_MARGIN)
    // Left of tile 0 is the far side of the map.
    expect(req.x).toBe(size + 2 - Math.ceil(req.w / 2))
    expect(req.y).toBe(300 - Math.ceil(req.h / 2))
  })

  it('never asks for more than the server gives, around the centre', () => {
    const req = adminViewRequest(
      { x: 320, y: 320, scale: FAR_SCALE },
      { width: 3000, height: 400 },
      size,
    )
    expect(req.w).toBe(ADMIN_VIEW_MAX_SIDE)
    expect(req.x).toBe(320 - ADMIN_VIEW_MAX_SIDE / 2)
  })
})

describe('admin map world', () => {
  const city = (
    id: string,
    realmId: string | null,
    org: string,
    houses: number,
    tradeOrg?: 'hq',
  ): AdminEntity => ({
    is: 'city',
    id,
    name: id,
    realmId,
    townHallId: `${id}-hall`,
    occupation: null,
    ...(tradeOrg ? { tradeOrg } : {}),
    x: 10,
    y: 20,
    houses,
    org,
  })
  const view: AdminWorldView = {
    tick: 5,
    orgs: [],
    entities: [
      city('Ashford', 'r1', 'r1', 2),
      city('Nook', null, 'Nook', TOWN_HOUSES),
      city('Exchange', null, 'tradeOrg', 9, 'hq'),
      {
        is: 'building',
        id: 'b1',
        kind: 'house',
        cityId: 'Ashford',
        x: 11,
        y: 20,
        org: 'r1',
      },
      {
        is: 'pile',
        id: 'p1',
        x: 1,
        y: 1,
        goods: { wood: 1 },
        org: null,
      },
    ],
  }
  const places: AdminPlaces = {
    tick: 5,
    realms: [
      {
        id: 'r1',
        account: 'Mara',
        name: 'Lea',
        alliance: null,
        leader: { id: 'lea', name: 'Lea', x: 3, y: 4 },
        cities: [],
      },
      { id: 'r2', account: null, name: 'Gone', alliance: null, leader: null, cities: [] },
    ],
    npcCities: [],
    tradeOrg: {
      hq: null,
      posts: [],
      caravans: [{ id: 'cv', name: 'Ferry', x: 7, y: 8, postId: 'p', heading: 'hq' }],
    },
    armies: [{ id: 'ar', name: 'Vanguard', x: 30, y: 31, realmId: 'r1', realm: 'Lea' }],
  }
  const world = adminMapWorld({
    map: { seed: 1, size },
    view,
    places,
    region: null,
    overview: null,
  })

  it('sorts every entity in view by kind and may load any chunk', () => {
    expect(world.cities.map((c) => c.id)).toEqual(['Ashford', 'Nook', 'Exchange'])
    expect(world.buildings.map((b) => b.id)).toEqual(['b1'])
    expect(world.piles.map((p) => p.id)).toEqual(['p1'])
    expect(world.exploredChunks.size).toBe(chunksAcross(size) ** 2)
    expect(world.exploredChunks.has(chunksAcross(size) ** 2 - 1)).toBe(true)
  })

  it('colours by Organization: each realm its own, NPC cities grey, the Trade Org teal', () => {
    const emblems = world.admin!.emblems
    expect(emblems.find((e) => e.id === 'Ashford')).toMatchObject({
      x: 10,
      y: 20,
      size: 'village',
      rel: regionColour('r1'),
    })
    expect(emblems.find((e) => e.id === 'Nook')).toMatchObject({ size: 'town', rel: 'npc' })
    expect(emblems.find((e) => e.id === 'Exchange')).toMatchObject({
      size: 'largeTown',
      rel: 'trade',
    })
    expect(world.admin!.realmColour('r1')).toBe(regionColour('r1'))
    expect(world.admin!.realmColour('r2')).not.toBe(regionColour('r1'))
  })

  it("crowns every realm's Leader and marks armies and caravans for the far tier", () => {
    expect([...world.admin!.leaders]).toEqual(['lea'])
    expect(world.admin!.markers).toEqual([
      { kind: 'army', x: 30, y: 31, rel: regionColour('r1') },
      { kind: 'caravan', x: 7, y: 8, rel: 'trade' },
    ])
  })

  it("is nobody's: no realm of the map is the viewer's own", () => {
    expect(world.home.realmId).toBe(ADMIN_VIEWER.realmId)
    expect(ADMIN_VIEWER.realmColour!('')).toBe(regionColour(''))
    expect(world.diplomacy.alliance).toBeNull()
  })

  it('shows nothing before the first load but the map and its terrain', () => {
    const empty = adminMapWorld({
      map: { seed: 1, size },
      view: null,
      places: null,
      region: null,
      overview: null,
    })
    expect(empty.residents).toEqual([])
    expect(empty.admin).toMatchObject({ emblems: [], markers: [], overview: null })
    expect(empty.admin!.leaders.size).toBe(0)
  })
})

describe('admin terrain overview', () => {
  // A 2 × 2 overview: sea, plains / forest, mountain.
  const overview = new Uint8Array([Terrain.Sea, Terrain.Plains, Terrain.Forest, Terrain.Mountain])

  it('paints each byte in its terrain colour', () => {
    const px = overviewPixels(overview)
    const at = (i: number) => (px[i * 4]! << 16) | (px[i * 4 + 1]! << 8) | px[i * 4 + 2]!
    expect([0, 1, 2, 3].map(at)).toEqual(
      [Terrain.Sea, Terrain.Plains, Terrain.Forest, Terrain.Mountain].map((t) => TERRAIN_COLORS[t]),
    )
    expect(px[3]).toBe(255)
  })

  it('tells the terrain of a tile from its block', () => {
    expect(overviewTerrainAt(overview, 0, 0)).toBe(Terrain.Sea)
    expect(overviewTerrainAt(overview, OVERVIEW_SCALE, OVERVIEW_SCALE - 1)).toBe(Terrain.Plains)
    expect(overviewTerrainAt(overview, 3, OVERVIEW_SCALE + 2)).toBe(Terrain.Forest)
    expect(overviewTerrainAt(overview, 2 * OVERVIEW_SCALE - 1, 2 * OVERVIEW_SCALE - 1)).toBe(
      Terrain.Mountain,
    )
  })
})
