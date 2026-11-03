import { EXPLORED_EDGE_RANGE, EXPLORE_SKIP_RANGE, wrap, wrapDistance } from '@csp/shared'

/** The compass directions `exploredEdge` looks toward, as a step on the map (y grows south). */
export const COMPASS: Readonly<Record<string, readonly [number, number]>> = {
  north: [0, -1],
  northeast: [Math.SQRT1_2, -Math.SQRT1_2],
  east: [1, 0],
  southeast: [Math.SQRT1_2, Math.SQRT1_2],
  south: [0, 1],
  southwest: [-Math.SQRT1_2, Math.SQRT1_2],
  west: [-1, 0],
  northwest: [-Math.SQRT1_2, -Math.SQRT1_2],
}

export interface EdgeSearch {
  size: number
  /** Whether the Player has explored a tile. */
  explored: (x: number, y: number) => boolean
  /** Whether the one looking can go onto an explored tile: on foot, or riding. */
  canEnter: (x: number, y: number) => boolean
  from: { x: number; y: number }
  /** A compass direction (`COMPASS`): only tiles that way, at most 45° off it. */
  toward?: string
  /** Tiles to leave out, with those within `EXPLORE_SKIP_RANGE` of them. */
  skip?: readonly { x: number; y: number }[]
}

/**
 * The nearest tile of the edge of a Player's explored terrain (`CONTEXT.md`: Explored terrain,
 * Explore): one they have explored and can go onto, beside one they haven't. Standing there,
 * they see into the unknown. Toward a direction, the tiles that way only, the straightest first
 * among those as near to a whole tile. Undefined with none within `EXPLORED_EDGE_RANGE`.
 */
export function exploredEdge(search: EdgeSearch): { x: number; y: number } | undefined {
  const { size, explored, canEnter, from, skip = [] } = search
  const dir = search.toward === undefined ? undefined : COMPASS[search.toward]
  const range = Math.min(EXPLORED_EDGE_RANGE, Math.floor((size - 1) / 2))
  const onEdge = (x: number, y: number) =>
    explored(x, y) &&
    canEnter(x, y) &&
    (!explored(x, wrap(y - 1, size)) ||
      !explored(wrap(x + 1, size), y) ||
      !explored(x, wrap(y + 1, size)) ||
      !explored(wrap(x - 1, size), y))
  const skipped = (x: number, y: number) =>
    skip.some((s) => wrapDistance(size, s, { x, y }) <= EXPLORE_SKIP_RANGE)
  let best: { x: number; y: number; near: number; off: number } | undefined
  // Ring by ring outward: a tile on ring r lies at least r away, so once r passes the best found
  // no nearer one is left.
  for (let r = 0; r <= range && !(best && r > best.near); r++) {
    for (let dy = -r; dy <= r; dy++) {
      const across = Math.abs(dy) === r ? 1 : 2 * r
      for (let dx = -r; dx <= r; dx += across) {
        const distance = Math.hypot(dx, dy)
        // How far off the direction, as 1 less the cosine: 0 straight that way.
        const off = dir && distance > 0 ? 1 - (dx * dir[0] + dy * dir[1]) / distance : 0
        if (off > 1 - Math.SQRT1_2 + 1e-9) continue
        const near = Math.round(distance)
        if (best && (near > best.near || (near === best.near && off >= best.off))) continue
        const x = wrap(from.x + dx, size)
        const y = wrap(from.y + dy, size)
        if (!onEdge(x, y) || skipped(x, y)) continue
        best = { x, y, near, off }
      }
    }
  }
  return best && { x: best.x, y: best.y }
}
