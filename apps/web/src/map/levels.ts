import {
  CHUNK_SIZE,
  TERRAIN_LEVEL_MAX,
  UNEXPLORED,
  chunksAcross,
  levelChunksAcross,
  wrap,
} from '../shared/terrain.js'
import { tileToScreen, visibleTiles, type Camera, type Size } from './camera.js'
import { TERRAIN_COLORS } from './palette.js'

/*
 * Which level of explored terrain the map draws at a zoom, and where its chunks are (ADR 0034,
 * T99.6): zoomed out, a coarse level, so a view costs about the same whatever the zoom.
 */

/**
 * The map draws the coarsest level whose squares are at most this many screen pixels across (a
 * tuning number, like the zoom tiers of ADR 0008): its squares are then over half of it, so a
 * chunk of the level drawn is at least `CHUNK_SIZE × LEVEL_SQUARE_PX / 2` = 96 pixels across.
 */
export const LEVEL_SQUARE_PX = 6

/** The most chunks the map draws terrain from at once on a 1920 × 1080 screen, at any zoom. */
export const MAX_CHUNKS_ON_SCREEN = 300

/** The level of explored terrain the map draws at `scale` pixels a tile; 0 is full detail. */
export function levelForScale(scale: number): number {
  const level = Math.floor(Math.log2(LEVEL_SQUARE_PX / scale))
  return Math.max(0, Math.min(TERRAIN_LEVEL_MAX, level))
}

/** How many tiles a chunk of `level` spans a side (the last ones of the map fewer). */
export const levelSpan = (level: number) => CHUNK_SIZE * 2 ** level

/** The tiles a chunk of `level` covers on the map: its corner and size, without padding. */
export function levelChunkRect(
  size: number,
  level: number,
  index: number,
): { x: number; y: number; w: number; h: number } {
  const n = levelChunksAcross(chunksAcross(size), level)
  const span = levelSpan(level)
  const [x, y] = [(index % n) * span, Math.floor(index / n) * span]
  return { x, y, w: Math.min(span, size - x), h: Math.min(span, size - y) }
}

/**
 * The chunks of `level` on screen, as indices of that level. The map's sides join, and the last
 * chunk of a row stops at the map's side, so the chunks after it are the first of the row again:
 * padding past the side is never on screen.
 */
export function visibleLevelChunks(cam: Camera, view: Size, size: number, level: number): number[] {
  const n = levelChunksAcross(chunksAcross(size), level)
  const span = levelSpan(level)
  const { x0, y0, x1, y1 } = visibleTiles(cam, view)
  /** The chunk columns (or rows) the tiles from a to b fall in, each once. */
  const along = (a: number, b: number): number[] => {
    const out = new Set<number>()
    // Never more than the whole map, however far the view reaches.
    for (let t = a; t <= Math.min(b, a + size - 1);) {
      const at = wrap(t, size)
      const c = Math.floor(at / span)
      out.add(c)
      t += Math.min((c + 1) * span, size) - at
    }
    return [...out]
  }
  const rows = along(y0, y1)
  const cols = along(x0, x1)
  return rows.flatMap((cy) => cols.map((cx) => cy * n + cx))
}

/** Where a chunk of `level` shows on screen, at its copy nearest the view's centre: its corner and size. */
export function levelChunkToScreen(
  cam: Camera,
  view: Size,
  size: number,
  level: number,
  index: number,
): { x: number; y: number; width: number; height: number } {
  const r = levelChunkRect(size, level, index)
  const [mx, my] = tileToScreen(cam, view, size, r.x + r.w / 2, r.y + r.h / 2)
  const [width, height] = [r.w * cam.scale, r.h * cam.scale]
  return { x: mx - width / 2, y: my - height / 2, width, height }
}

/**
 * The loaded chunk of the finest level coarser than `level` that holds chunk `index` of `level`:
 * what shows while that chunk still loads, so zooming in or panning shows no hole where the
 * Player already has a picture. None if no coarser one is loaded.
 */
export function coarserCover(
  size: number,
  level: number,
  index: number,
  loaded: (index: number, level: number) => boolean,
): { level: number; index: number } | undefined {
  const across = chunksAcross(size)
  const n = levelChunksAcross(across, level)
  const [cx, cy] = [index % n, Math.floor(index / n)]
  for (let k = level + 1; k <= TERRAIN_LEVEL_MAX; k++) {
    const d = k - level
    const cover = (cy >> d) * levelChunksAcross(across, k) + (cx >> d)
    if (loaded(cover, k)) return { level: k, index: cover }
  }
  return undefined
}

/**
 * A coarse chunk's picture, one texel a square (ADR 0034: drawn flat, smoothed when scaled):
 * RGBA, `w` × `h` squares from its top left (the squares on the map), clear where the Player
 * explored none of a square.
 */
export function coarseTexels(tiles: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * CHUNK_SIZE + x]!
      const c = t === UNEXPLORED ? undefined : TERRAIN_COLORS[t]
      if (c === undefined) continue
      const i = (y * w + x) * 4
      out[i] = c >> 16
      out[i + 1] = (c >> 8) & 0xff
      out[i + 2] = c & 0xff
      out[i + 3] = 255
    }
  }
  return out
}

/** How many squares of `level` a chunk covering `tiles` tiles a side holds. */
export const squaresIn = (tiles: number, level: number) => Math.ceil(tiles / 2 ** level)
