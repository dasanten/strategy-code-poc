import {
  ADMIN_VIEW_MAX_SIDE,
  chunksAcross,
  wrap,
  type AdminPlaces,
  type AdminViewRequest,
  type AdminWorldView,
  type MapInfo,
} from '@csp/shared'
import { MAX_SCALE, visibleTiles, zoomTier, type Camera, type Size } from './map/camera.js'
import { citySize, type CityEmblem, type FarMarker } from './map/far.js'
import type { MapWorld } from './map/map-world.js'
import { regionColour, type RegionState } from './map/region.js'
import { cityRelationship, realmRelationship, type Viewer } from './map/tokens.js'

/*
 * The admin map's data (`CONTEXT.md`: admin map): what the admin routes give, turned into what
 * `MapView` draws, and the view kept in the URL. The knowledge is the admin's: nothing here
 * reaches the game screen, and nothing on the admin map acts in the world.
 */

/** How often the part of the world in view loads again, in milliseconds (tuning). */
export const ADMIN_MAP_REFRESH_MS = 3000
/** How long the view rests after moving before it loads and goes into the URL, in milliseconds. */
export const ADMIN_MAP_SETTLE_MS = 300
/** How often the territory layer loads again, in milliseconds; territory moves once a game hour. */
export const ADMIN_TERRITORY_REFRESH_MS = 60_000
/** Tiles loaded around the screen's edges, so a short pan shows entities right away. */
export const ADMIN_VIEW_MARGIN = 4
/** The zoom a link with a place but no zoom opens at, in pixels per tile: the middle tier. */
export const ADMIN_LINK_SCALE = 12

/**
 * Where the admin map opens (`/admin/map?x=…&y=…&zoom=…`): x and y the tile at the centre, zoom in
 * pixels per tile. Without a place, the whole map zoomed out (the map clamps the zoom to fit).
 */
export function parseMapView(search: string, size: number): Camera {
  const q = new URLSearchParams(search)
  const num = (k: string) => {
    const v = q.get(k)
    const n = v === null || v.trim() === '' ? NaN : Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const [x, y, zoom] = [num('x'), num('y'), num('zoom')]
  if (x === undefined || y === undefined) return { x: size / 2, y: size / 2, scale: 0 }
  const scale = zoom !== undefined && zoom > 0 ? Math.min(MAX_SCALE, zoom) : ADMIN_LINK_SCALE
  return { x: wrap(x, size), y: wrap(y, size), scale }
}

/** The view as the URL keeps it, for `parseMapView`. */
export function mapViewSearch(cam: Camera): string {
  return `?x=${Math.floor(cam.x)}&y=${Math.floor(cam.y)}&zoom=${Number(cam.scale.toFixed(2))}`
}

/**
 * What to load for the view: far out every city on the map (the far tier shows nothing else),
 * closer in everything on screen and a margin around it, at most `ADMIN_VIEW_MAX_SIDE` a side
 * around the centre.
 */
export function adminViewRequest(cam: Camera, view: Size, size: number): AdminViewRequest {
  if (zoomTier(cam.scale) === 'far') return { x: 0, y: 0, w: size, h: size, citiesOnly: true }
  const { x0, y0, x1, y1 } = visibleTiles(cam, view)
  const side = (from: number, to: number, centre: number) => {
    const n = Math.min(to - from + 1 + 2 * ADMIN_VIEW_MARGIN, ADMIN_VIEW_MAX_SIDE, size)
    return { at: wrap(Math.floor(centre - n / 2), size), n }
  }
  const across = side(x0, x1, cam.x)
  const down = side(y0, y1, cam.y)
  return { x: across.at, y: down.at, w: across.n, h: down.n }
}

/** The admin map looks at the world as nobody's: each realm in its own colour. */
export const ADMIN_VIEWER: Viewer = {
  realmId: '',
  allies: new Set(),
  realmColour: (realmId) => regionColour(realmId),
}

/** What the admin map has loaded so far; anything not loaded yet is null. */
export interface AdminMapData {
  map: MapInfo
  view: AdminWorldView | null
  places: AdminPlaces | null
  region: RegionState | null
  overview: Uint8Array | null
}

/**
 * The admin map's world for `MapView`: every entity in the last view loaded, coloured by
 * Organization; every Leader crowned; the far tier from every city and the places' armies and
 * caravans; all terrain there to load.
 */
export function adminMapWorld(data: AdminMapData): MapWorld {
  const world: MapWorld = {
    map: { size: data.map.size },
    exploredChunks: allChunks(data.map.size),
    grownChunks: [],
    home: { realmId: ADMIN_VIEWER.realmId, leaderId: null, x: 0, y: 0 },
    residents: [],
    cities: [],
    buildings: [],
    horses: [],
    carriages: [],
    piles: [],
    armies: [],
    caravans: [],
    diplomacy: { alliance: null },
    region: data.region,
  }
  const emblems: CityEmblem[] = []
  // Each entity keeps its tag and Organization; the map reads only what it knows of them.
  for (const e of data.view?.entities ?? []) {
    if (e.is === 'resident') world.residents.push(e)
    else if (e.is === 'building') world.buildings.push(e)
    else if (e.is === 'horse') world.horses.push(e)
    else if (e.is === 'carriage') world.carriages.push(e)
    else if (e.is === 'pile') world.piles.push(e)
    else if (e.is === 'army') world.armies.push(e)
    else if (e.is === 'caravan') world.caravans.push(e)
    else {
      world.cities.push(e)
      const rel = cityRelationship(e, ADMIN_VIEWER)!
      emblems.push({ id: e.id, name: e.name, x: e.x, y: e.y, size: citySize(e.houses), rel })
    }
  }
  const places = data.places
  const markers: FarMarker[] = [
    ...(places?.armies ?? []).map((a): FarMarker => ({
      kind: 'army',
      x: a.x,
      y: a.y,
      rel: realmRelationship(a.realmId, ADMIN_VIEWER),
    })),
    ...(places?.tradeOrg.caravans ?? []).map((c): FarMarker => ({
      kind: 'caravan',
      x: c.x,
      y: c.y,
      rel: 'trade',
    })),
  ]
  const leaders = new Set((places?.realms ?? []).flatMap((r) => (r.leader ? [r.leader.id] : [])))
  world.admin = {
    realmColour: ADMIN_VIEWER.realmColour!,
    leaders,
    emblems,
    markers,
    overview: data.overview,
  }
  return world
}

/** Every chunk of the map: the admin map may load any of them. */
const allChunks = (() => {
  let last: { size: number; chunks: ReadonlySet<number> } | undefined
  return (size: number): ReadonlySet<number> => {
    if (last?.size !== size) {
      const n = chunksAcross(size)
      last = { size, chunks: new Set(Array.from({ length: n * n }, (_, i) => i)) }
    }
    return last.chunks
  }
})()
