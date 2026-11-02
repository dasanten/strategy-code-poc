import {
  CHUNK_SIZE,
  UNEXPLORED,
  cityAreaTiles,
  wrap,
  wrapDelta,
  type Building,
  type City,
} from '@csp/shared'
import type { Camera, Size } from './camera.js'
import { cityEmblems } from './far.js'
import type { MapWorld } from './map-world.js'
import { TERRAIN_COLORS } from './palette.js'
import type { Tone, Viewer } from './tokens.js'

/*
 * The minimap (`CONTEXT.md`: Minimap, ADR 0008): the Player's explored terrain at a glance, bottom
 * right of the screen, with dots for their cities, their residents and carriages away from home
 * and the cities they know, and the current view as a rectangle. A click centres the map there.
 */

/** The minimap's side on screen, in CSS pixels. */
export const MINIMAP_SIDE = 168
/** The fewest tiles the minimap spans, so a fresh realm's small circle isn't blown up. */
export const MINIMAP_MIN_SPAN = 96
/** Tiles of margin around the explored terrain. */
const MINIMAP_MARGIN = 8

/** The square of the map the minimap shows: its centre tile and how many tiles it spans. */
export interface MinimapFrame {
  x: number
  y: number
  span: number
}

/**
 * The square around the Player's explored terrain, centred on it; the map's sides join, so the
 * chunks are measured from the home city. Never more than the whole map.
 */
export function minimapFrame(
  explored: Iterable<number>,
  home: { x: number; y: number },
  mapSize: number,
): MinimapFrame {
  const across = Math.ceil(mapSize / CHUNK_SIZE)
  let [x0, y0, x1, y1] = [0, 0, 0, 0]
  for (const i of explored) {
    const dx = wrapDelta(home.x, ((i % across) + 0.5) * CHUNK_SIZE, mapSize)
    const dy = wrapDelta(home.y, (Math.floor(i / across) + 0.5) * CHUNK_SIZE, mapSize)
    x0 = Math.min(x0, dx - CHUNK_SIZE / 2)
    x1 = Math.max(x1, dx + CHUNK_SIZE / 2)
    y0 = Math.min(y0, dy - CHUNK_SIZE / 2)
    y1 = Math.max(y1, dy + CHUNK_SIZE / 2)
  }
  const span = Math.min(
    mapSize,
    Math.max(MINIMAP_MIN_SPAN, x1 - x0 + 2 * MINIMAP_MARGIN, y1 - y0 + 2 * MINIMAP_MARGIN),
  )
  return {
    x: wrap(home.x + (x0 + x1) / 2, mapSize),
    y: wrap(home.y + (y0 + y1) / 2, mapSize),
    span,
  }
}

/** Where a tile position shows on a minimap `side` pixels across (it may fall outside). */
export function tileToMinimap(
  frame: MinimapFrame,
  mapSize: number,
  side: number,
  tx: number,
  ty: number,
): [number, number] {
  const k = side / frame.span
  return [
    (wrapDelta(frame.x, tx, mapSize) + frame.span / 2) * k,
    (wrapDelta(frame.y, ty, mapSize) + frame.span / 2) * k,
  ]
}

/** The tile under a point on the minimap, as whole tile coordinates on the map. */
export function minimapToTile(
  frame: MinimapFrame,
  mapSize: number,
  side: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const k = frame.span / side
  return {
    x: Math.floor(wrap(frame.x - frame.span / 2 + px * k, mapSize)),
    y: Math.floor(wrap(frame.y - frame.span / 2 + py * k, mapSize)),
  }
}

/** The current view as a rectangle on the minimap, in its pixels. */
export function minimapView(
  frame: MinimapFrame,
  mapSize: number,
  side: number,
  cam: Camera,
  view: Size,
): { x: number; y: number; width: number; height: number } {
  const [cx, cy] = tileToMinimap(frame, mapSize, side, cam.x, cam.y)
  const k = side / frame.span
  const [width, height] = [(view.width / cam.scale) * k, (view.height / cam.scale) * k]
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}

/**
 * The minimap's terrain as RGBA pixels, `res` across, row-major: each the colour of the tile at
 * its middle, clear where nothing is explored or loaded.
 */
export function minimapPixels(
  frame: MinimapFrame,
  mapSize: number,
  res: number,
  terrainAt: (x: number, y: number) => number | undefined,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(res * res * 4)
  for (let py = 0; py < res; py++) {
    for (let px = 0; px < res; px++) {
      const { x, y } = minimapToTile(frame, mapSize, res, px + 0.5, py + 0.5)
      const t = terrainAt(x, y)
      const c = t === undefined ? undefined : TERRAIN_COLORS[t]
      // Unexplored tiles inside a loaded chunk stay clear too.
      if (c === undefined || t === UNEXPLORED) continue
      const i = (py * res + px) * 4
      out[i] = c >> 16
      out[i + 1] = (c >> 8) & 0xff
      out[i + 2] = c & 0xff
      out[i + 3] = 255
    }
  }
  return out
}

/** What a dot on the minimap stands for; drawn in this order, the home city on top. */
export type MinimapDotKind = 'resident' | 'carriage' | 'city' | 'home'

export interface MinimapDot {
  kind: MinimapDotKind
  x: number
  y: number
  rel: Tone
  /** A city the Player only remembers (`CONTEXT.md`: Last seen). */
  remembered?: boolean
}

const DOT_ORDER: Record<MinimapDotKind, number> = { resident: 0, carriage: 1, city: 2, home: 3 }

/**
 * The minimap's dots (`CONTEXT.md`: Minimap): every city the Player knows, in sight or last seen,
 * in its relationship colour with their home city marked, and their residents and carriages
 * outside the areas of their cities.
 */
export function minimapDots(world: MapWorld, viewer: Viewer): MinimapDot[] {
  const size = world.map.size
  const home = world.home.cityId ?? undefined
  const out: MinimapDot[] = []
  const cityDots = (
    w: { cities: readonly City[]; buildings: readonly Building[] },
    remembered: boolean,
  ) => {
    for (const e of cityEmblems(w, viewer, size)) {
      out.push({
        kind: e.id === home ? 'home' : 'city',
        x: e.x,
        y: e.y,
        rel: e.rel,
        ...(remembered ? { remembered } : {}),
      })
    }
  }
  if (world.lastSeen) cityDots(world.lastSeen, true)
  cityDots(world, false)

  const ownArea = new Set<string>()
  for (const c of world.cities) {
    if (c.realmId === viewer.realmId) for (const t of cityAreaTiles(world, c, size)) ownArea.add(t)
  }
  const away = (p: { x: number; y: number }) => !ownArea.has(`${p.x},${p.y}`)
  for (const r of world.residents) {
    if (r.owner === viewer.realmId && away(r))
      out.push({ kind: 'resident', x: r.x, y: r.y, rel: 'own' })
  }
  for (const k of world.carriages) {
    if (k.realmId === viewer.realmId && away(k))
      out.push({ kind: 'carriage', x: k.x, y: k.y, rel: 'own' })
  }
  return out.sort((a, b) => DOT_ORDER[a.kind] - DOT_ORDER[b.kind])
}

/** Where the browser remembers whether the Player folded the minimap. */
const MINIMAP_KEY = 'csp.minimapOpen'

/** Whether the minimap starts open: as the Player left it in this browser, else not on a phone. */
export function minimapOpenAtStart(
  phone: boolean,
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): boolean {
  try {
    const v = storage().getItem(MINIMAP_KEY)
    if (v === '1' || v === '0') return v === '1'
  } catch {
    // Storage can be off (a private window); then it starts as a fresh browser would.
  }
  return !phone
}

export function rememberMinimapOpen(
  open: boolean,
  storage: () => Pick<Storage, 'setItem'> = () => localStorage,
): void {
  try {
    storage().setItem(MINIMAP_KEY, open ? '1' : '0')
  } catch {
    // Not remembered, which only costs a click next time.
  }
}
