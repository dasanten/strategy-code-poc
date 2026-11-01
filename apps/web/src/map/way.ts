import { drivenCarriageId, type SeenResident } from '@csp/shared'
import { tileToScreen, type Camera, type Size } from './camera.js'

/** A resident's way ahead: where it ends and the tiles along it (none once in contact). */
export interface Way {
  target: { x: number; y: number }
  path: readonly (readonly [number, number])[] | null
}

/**
 * Where a picked resident is going along a path, and the way there (`CONTEXT.md`: Way on the
 * map): walking, driving, hauling, storing, fetching, walking to a road or wall line's next tile,
 * or going after someone.
 */
export function wayAhead(r: Pick<SeenResident, 'order'>): Way | undefined {
  const o = r.order
  if (o?.kind === 'walkTo' || o?.kind === 'drive') return o
  if (o?.kind === 'haul' && o.phase === 'driving')
    return { target: o.stop === 'from' ? o.from : o.to, path: o.path }
  const next = (o?.kind === 'roadLine' || o?.kind === 'wallLine') && o.phase === 'walking'
  if (next && o.tiles[0]) return { target: { x: o.tiles[0][0], y: o.tiles[0][1] }, path: o.path }
  // Storing or fetching: the way ends on the tile of the storage or carriage it was found to;
  // going after a resident, where they were when it was found. None while it is being found, nor
  // once there (putting, taking) or in contact.
  const walking = (o?.kind === 'store' || o?.kind === 'fetch') && o.phase === 'walking'
  const along = walking || o?.kind === 'attack' ? o.path : null
  const last = along?.at(-1)
  return last && { target: { x: last[0], y: last[1] }, path: along }
}

/**
 * The way ahead of a resident on the map: a passenger's is the carriage's they are aboard, the
 * way its driver among `residents` drives it (`CONTEXT.md`: Passenger); anyone else's their own.
 */
export function selectedWay(
  r: Pick<SeenResident, 'order' | 'aboard'>,
  residents: readonly Pick<SeenResident, 'order'>[],
): Way | undefined {
  if (r.aboard === undefined) return wayAhead(r)
  const driver = residents.find((d) => drivenCarriageId(d) === r.aboard)
  return driver && wayAhead(driver)
}

/** Screen pixels round the view in which the way's line and target dot still show. */
const MARGIN = 8

/**
 * Whether any of a way shows on screen, wherever the resident is: its screen bounding box (the
 * resident's tile, the tiles along it and the target, each where it is drawn) meets the view.
 */
export function wayInView(
  cam: Camera,
  view: Size,
  size: number,
  from: { x: number; y: number },
  way: Way,
): boolean {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  const add = (tx: number, ty: number) => {
    const [sx, sy] = tileToScreen(cam, view, size, tx + 0.5, ty + 0.5)
    ;[x0, y0, x1, y1] = [Math.min(x0, sx), Math.min(y0, sy), Math.max(x1, sx), Math.max(y1, sy)]
  }
  add(way.target.x, way.target.y)
  if (way.path) {
    add(from.x, from.y)
    for (const [x, y] of way.path) add(x, y)
  }
  return x1 >= -MARGIN && y1 >= -MARGIN && x0 <= view.width + MARGIN && y0 <= view.height + MARGIN
}
