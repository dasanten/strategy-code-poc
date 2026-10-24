import { CHUNK_SIZE, chunksAcross, wrap, wrapDelta } from '@csp/shared'

/**
 * Where the map view looks: the tile at the centre of the screen and the pixels per tile. The
 * map's opposite sides join, so the centre always lies on the map (`0 ≤ x, y < size`).
 */
export interface Camera {
  x: number
  y: number
  scale: number
}

export interface Size {
  width: number
  height: number
}

/** Closest zoom, in screen pixels per tile. */
export const MAX_SCALE = 48
/**
 * Below this many pixels per tile, the map is in its far tier (ADR 0008): terrain, territory and
 * one emblem per city, with armies and caravans as small markers.
 */
export const FAR_SCALE = 8
/** From this many pixels per tile up, the tile grid is drawn. */
export const CLOSE_SCALE = 14

/** The map's zoom tiers (ADR 0008): what it shows depends on how far out it is. */
export type ZoomTier = 'far' | 'middle' | 'close'

export const zoomTier = (scale: number): ZoomTier =>
  scale < FAR_SCALE ? 'far' : scale < CLOSE_SCALE ? 'middle' : 'close'

/**
 * The furthest zoom: the map just fills the screen's longer side. Never further, so the screen
 * holds at most one copy of each tile and every tile has one place on it.
 */
export function minScale(size: number, view: Size): number {
  return Math.max(view.width, view.height) / size
}

export function clampScale(scale: number, size: number, view: Size): number {
  return Math.min(MAX_SCALE, Math.max(minScale(size, view), scale))
}

/** The tile position (fractional, on the map) under a point on screen. */
export function screenToTile(
  cam: Camera,
  view: Size,
  size: number,
  sx: number,
  sy: number,
): [number, number] {
  return [
    wrap(cam.x + (sx - view.width / 2) / cam.scale, size),
    wrap(cam.y + (sy - view.height / 2) / cam.scale, size),
  ]
}

/** Where a tile position appears on screen: its copy nearest the centre of the view. */
export function tileToScreen(
  cam: Camera,
  view: Size,
  size: number,
  tx: number,
  ty: number,
): [number, number] {
  return [
    wrapDelta(cam.x, tx, size) * cam.scale + view.width / 2,
    wrapDelta(cam.y, ty, size) * cam.scale + view.height / 2,
  ]
}

/** Zooms by `factor` keeping the tile under the screen point (sx, sy) where it is. */
export function zoomAt(
  cam: Camera,
  view: Size,
  size: number,
  factor: number,
  sx: number,
  sy: number,
): Camera {
  const scale = clampScale(cam.scale * factor, size, view)
  const ox = (sx - view.width / 2) / cam.scale
  const oy = (sy - view.height / 2) / cam.scale
  return {
    x: wrap(cam.x + ox - (ox * cam.scale) / scale, size),
    y: wrap(cam.y + oy - (oy * cam.scale) / scale, size),
    scale,
  }
}

/**
 * The camera that shows a tile in the middle of what is left of the screen when pixels on its
 * left (an open drawer) and right (the selection card) are covered, at the given zoom.
 */
export function centreBeside(
  tx: number,
  ty: number,
  cover: Covered,
  scale: number,
  size: number,
): Camera {
  const offset = (cover.left - cover.right) / 2
  return { x: wrap(tx + 0.5 - offset / scale, size), y: wrap(ty + 0.5, size), scale }
}

/** Screen pixels covered from the left and from the right of the map. */
export interface Covered {
  left: number
  right: number
}

/** Moves the view by a screen distance, as dragging the map does; it never stops at a side. */
export function panBy(cam: Camera, size: number, dx: number, dy: number): Camera {
  return { ...cam, x: wrap(cam.x - dx / cam.scale, size), y: wrap(cam.y - dy / cam.scale, size) }
}

/**
 * The tiles on screen as a rectangle in unwrapped coordinates: they may run below 0 or past
 * `size`, and `wrap` brings each back onto the map.
 */
export function visibleTiles(cam: Camera, view: Size) {
  return {
    x0: Math.floor(cam.x - view.width / 2 / cam.scale),
    y0: Math.floor(cam.y - view.height / 2 / cam.scale),
    x1: Math.floor(cam.x + view.width / 2 / cam.scale),
    y1: Math.floor(cam.y + view.height / 2 / cam.scale),
  }
}

/** The chunks on screen, as chunk indices (`i = cy * n + cx`, see `chunksAcross`). */
export function visibleChunks(cam: Camera, view: Size, size: number): number[] {
  const n = chunksAcross(size)
  const { x0, y0, x1, y1 } = visibleTiles(cam, view)
  const out = new Set<number>()
  for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
      out.add(wrap(cy, n) * n + wrap(cx, n))
    }
  }
  return [...out]
}

/** Where a chunk's top-left tile appears on screen: the copy nearest the centre of the view. */
export function chunkToScreen(
  cam: Camera,
  view: Size,
  size: number,
  cx: number,
  cy: number,
): [number, number] {
  const half = CHUNK_SIZE / 2
  const [mx, my] = tileToScreen(cam, view, size, cx * CHUNK_SIZE + half, cy * CHUNK_SIZE + half)
  return [mx - half * cam.scale, my - half * cam.scale]
}
