import type { Graphics } from 'pixi.js'
import { FOOTPRINT } from '../shared/footprint.js'
import type { PickPreview } from '../pick-preview.js'
import { tileToScreen, type Camera, type Size } from './camera.js'
import { LEADER_COLOR, ROAD_COLOR, WALL_COLOR } from './palette.js'
import { GLYPH_COLOR } from './tokens.js'

/** What doesn't fit, in a pick's preview: a footprint where it can't go, a line too long. */
const REFUSED_COLOR = 0xe5484d

/**
 * Draws the preview of a pick under the pointer (`CONTEXT.md`: Picking a target): each way as a
 * line to a dot, a line's tiles in the road's or wall's colour, a footprint's tiles
 * (red where it can't go), a frame round the building or carriage the pick would use, and a
 * frame round the tile under the pointer.
 */
export function drawPickPreview(
  g: Graphics,
  cam: Camera,
  view: Size,
  size: number,
  p: PickPreview,
) {
  const tile = cam.scale
  const at = (x: number, y: number) => tileToScreen(cam, view, size, x, y)
  for (const way of p.ways) {
    let [px, py] = at(way.from.x + 0.5, way.from.y + 0.5)
    g.moveTo(px, py)
    for (const [x, y] of way.path) {
      const [nx, ny] = at(x + 0.5, y + 0.5)
      // A step across a join shows up far away on screen; don't draw a line across the map.
      if (Math.hypot(nx - px, ny - py) < tile * 1.5) g.lineTo(nx, ny)
      else g.moveTo(nx, ny)
      ;[px, py] = [nx, ny]
    }
    if (way.path.length > 0)
      g.stroke({ width: 2.5, color: LEADER_COLOR, alpha: 0.75, cap: 'round', join: 'round' })
  }
  if (p.ways.length > 0) {
    const [tx, ty] = at(p.at.x + 0.5, p.at.y + 0.5)
    g.circle(tx, ty, 5).fill({ color: LEADER_COLOR, alpha: 0.75 })
  }
  if (p.line) {
    const color = p.line.tooLong
      ? REFUSED_COLOR
      : p.line.building === 'road'
        ? ROAD_COLOR
        : WALL_COLOR
    for (const [x, y] of p.line.tiles) {
      const [sx, sy] = at(x, y)
      g.rect(sx + tile * 0.15, sy + tile * 0.15, tile * 0.7, tile * 0.7)
    }
    g.fill({ color, alpha: 0.55 }).stroke({ width: 1.5, color })
  }
  if (p.footprint) {
    const f = p.footprint
    const [sx, sy] = at(f.x, f.y)
    const w = FOOTPRINT[f.kind] * tile
    const color = f.problem ? REFUSED_COLOR : LEADER_COLOR
    g.rect(sx, sy, w, w).fill({ color, alpha: 0.25 }).stroke({ width: 2, color })
  }
  const frame = (x: number, y: number, side: number, color: number, width: number) => {
    const [sx, sy] = at(x, y)
    const out = Math.max(2, tile * 0.08)
    const w = side * tile
    g.roundRect(sx - out, sy - out, w + 2 * out, w + 2 * out, out).stroke({ width, color })
  }
  if (p.place) frame(p.place.x, p.place.y, p.place.side, LEADER_COLOR, 2.5)
  frame(p.at.x, p.at.y, 1, GLYPH_COLOR, 1.5)
}

/** A spot marked on the map at every zoom (`MapView`'s `marks`): a tile and the mark's colour. */
export interface MapMark {
  x: number
  y: number
  color: number
}

/** Draws each mark as a diamond of a steady size on screen over the middle of its tile. */
export function drawMarks(
  g: Graphics,
  cam: Camera,
  view: Size,
  size: number,
  marks: readonly MapMark[],
) {
  const r = 6
  for (const m of marks) {
    const [sx, sy] = tileToScreen(cam, view, size, m.x + 0.5, m.y + 0.5)
    if (sx < -r || sy < -r || sx > view.width + r || sy > view.height + r) continue
    g.poly([sx, sy - r, sx + r, sy, sx, sy + r, sx - r, sy])
      .fill({ color: m.color })
      .stroke({ width: 1.5, color: GLYPH_COLOR })
  }
}
