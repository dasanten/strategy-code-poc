import type { Graphics } from 'pixi.js'

/** The dark edge of a wall tile (`CONTEXT.md`: Wall / Gate). */
export const WALL_EDGE_COLOR = 0x0e1419

/** One wall or gate tile to draw: its top left corner on screen, and which sides touch another wall. */
export interface WallTile {
  sx: number
  sy: number
  /** Joined to a wall tile on that side, so no edge is drawn there and the two meet without a seam. */
  left: boolean
  right: boolean
  up: boolean
  down: boolean
}

/** How thick a wall tile's dark edge is at a zoom, in screen pixels. */
export const wallEdgeWidth = (tile: number) => Math.max(1.5, tile * 0.12)

/** A rectangle as [x, y, width, height]. */
export type Rect = readonly [number, number, number, number]

/** The dark edge strips of a wall tile: one along each side that touches no other wall. */
export function wallEdgeRects(t: WallTile, tile: number): Rect[] {
  const e = Math.min(wallEdgeWidth(tile), tile / 2)
  const rects: Rect[] = []
  if (!t.up) rects.push([t.sx, t.sy, tile, e])
  if (!t.down) rects.push([t.sx, t.sy + tile - e, tile, e])
  if (!t.left) rects.push([t.sx, t.sy + e, e, tile - 2 * e])
  if (!t.right) rects.push([t.sx + tile - e, t.sy + e, e, tile - 2 * e])
  return rects
}

/**
 * The one place a wall or gate tile is drawn (`CONTEXT.md`: Wall / Gate): the whole tile in
 * `color`, a darker edge on every side not joined to another wall tile. It is a placeholder for a
 * sprite; the map, the ghosts of planned walls and the pick preview all draw through it. A
 * diagonal pair touch at a corner and read as closed, as the tiles fill their squares.
 */
export function drawWallTiles(
  g: Graphics,
  tiles: readonly WallTile[],
  tile: number,
  color: number,
  alpha: number,
  edgeAlpha = alpha * 0.85,
) {
  if (tiles.length === 0) return
  for (const t of tiles) g.rect(t.sx, t.sy, tile, tile)
  g.fill({ color, alpha })
  const edges = tiles.flatMap((t) => wallEdgeRects(t, tile))
  if (edges.length === 0) return
  for (const [x, y, w, h] of edges) g.rect(x, y, w, h)
  g.fill({ color: WALL_EDGE_COLOR, alpha: edgeAlpha })
}

/** Which sides of the wall tile at (x, y) touch another, given the walls' membership test. */
export function wallSides(
  x: number,
  y: number,
  isWall: (x: number, y: number) => boolean,
): Pick<WallTile, 'left' | 'right' | 'up' | 'down'> {
  return {
    left: isWall(x - 1, y),
    right: isWall(x + 1, y),
    up: isWall(x, y - 1),
    down: isWall(x, y + 1),
  }
}

/** The stone of a stone wall or gate tile (`CONTEXT.md`: Wood or stone), a placeholder look. */
export const STONE_WALL_COLOR = 0xc9c4ba

/**
 * Marks stone wall or gate tiles apart from wooden ones (`CONTEXT.md`: Wood or stone): a block of
 * grey stone inside the owner's colour, split by a mortar line. A placeholder until the texture.
 */
export function drawStoneMarks(
  g: Graphics,
  tiles: readonly WallTile[],
  tile: number,
  alpha: number,
) {
  if (tiles.length === 0) return
  const inset = Math.max(1, tile * 0.22)
  const side = tile - 2 * inset
  if (side <= 0) return
  for (const t of tiles) g.rect(t.sx + inset, t.sy + inset, side, side)
  g.fill({ color: STONE_WALL_COLOR, alpha })
  const mortar = Math.max(1, tile * 0.05)
  for (const t of tiles) g.rect(t.sx + inset, t.sy + tile / 2 - mortar / 2, side, mortar)
  g.fill({ color: WALL_EDGE_COLOR, alpha: alpha * 0.6 })
}
