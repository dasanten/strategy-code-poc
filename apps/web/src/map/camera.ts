import { CHUNK_SIZE, chunksAcross } from '@csp/shared'

/** Where the map view looks: the tile at the centre of the screen and the pixels per tile. */
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
/** Below this many pixels per tile, the map only draws terrain (no grid, nodes or units). */
export const FAR_SCALE = 3
/** From this many pixels per tile up, the tile grid is drawn. */
export const CLOSE_SCALE = 14

/** The furthest zoom: the whole disc fits on screen with a little room. */
export function minScale(diameter: number, view: Size): number {
  return Math.min(view.width, view.height) / (diameter * 1.1)
}

export function clampScale(scale: number, diameter: number, view: Size): number {
  return Math.min(MAX_SCALE, Math.max(minScale(diameter, view), scale))
}

/** The tile position (fractional) under a point on screen. */
export function screenToTile(cam: Camera, view: Size, sx: number, sy: number): [number, number] {
  return [cam.x + (sx - view.width / 2) / cam.scale, cam.y + (sy - view.height / 2) / cam.scale]
}

/** Where a tile position appears on screen. */
export function tileToScreen(cam: Camera, view: Size, tx: number, ty: number): [number, number] {
  return [(tx - cam.x) * cam.scale + view.width / 2, (ty - cam.y) * cam.scale + view.height / 2]
}

/** Zooms by `factor` keeping the tile under the screen point (sx, sy) where it is. */
export function zoomAt(
  cam: Camera,
  view: Size,
  diameter: number,
  factor: number,
  sx: number,
  sy: number,
): Camera {
  const scale = clampScale(cam.scale * factor, diameter, view)
  const [tx, ty] = screenToTile(cam, view, sx, sy)
  return keepOnMap(
    {
      x: tx - (sx - view.width / 2) / scale,
      y: ty - (sy - view.height / 2) / scale,
      scale,
    },
    diameter,
  )
}

/** Moves the view by a screen distance, as dragging the map does. */
export function panBy(cam: Camera, diameter: number, dx: number, dy: number): Camera {
  return keepOnMap({ ...cam, x: cam.x - dx / cam.scale, y: cam.y - dy / cam.scale }, diameter)
}

/** Keeps the centre of the view over the disc's square, so the map can't be lost off-screen. */
export function keepOnMap(cam: Camera, diameter: number): Camera {
  const clamp = (v: number) => Math.min(diameter, Math.max(0, v))
  return { ...cam, x: clamp(cam.x), y: clamp(cam.y) }
}

/** The tile rectangle on screen, whole tiles, clipped to the map's square. */
export function visibleTiles(cam: Camera, view: Size, diameter: number) {
  const [x0, y0] = screenToTile(cam, view, 0, 0)
  const [x1, y1] = screenToTile(cam, view, view.width, view.height)
  return {
    x0: Math.max(0, Math.floor(x0)),
    y0: Math.max(0, Math.floor(y0)),
    x1: Math.min(diameter - 1, Math.floor(x1)),
    y1: Math.min(diameter - 1, Math.floor(y1)),
  }
}

/** The chunks on screen, as chunk indices (`i = cy * n + cx`, see `chunksAcross`). */
export function visibleChunks(cam: Camera, view: Size, diameter: number): number[] {
  const n = chunksAcross(diameter)
  const { x0, y0, x1, y1 } = visibleTiles(cam, view, diameter)
  const out: number[] = []
  for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
      out.push(cy * n + cx)
    }
  }
  return out
}
