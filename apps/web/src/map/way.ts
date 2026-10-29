import { drivenCarriageId, type SeenResident } from '@csp/shared'
import { tileToScreen, type Camera, type Size } from './camera.js'

/** A resident's way ahead: where it ends and the tiles along it (none once in contact). */
export interface Way {
  target: { x: number; y: number }
  path: readonly (readonly [number, number])[] | null
}

/** Where the selected resident is walking, driving or going after someone, and the way there. */
export function wayAhead(r: Pick<SeenResident, 'order'>): Way | undefined {
  const o = r.order
  if (o?.kind === 'walkTo' || o?.kind === 'drive') return o
  if (o?.kind === 'haul' && o.phase === 'driving')
    return { target: o.stop === 'from' ? o.from : o.to, path: o.path }
  // Going after a resident: the way ends where they were when it was found; none once in contact.
  const last = o?.kind === 'attack' ? o.path?.at(-1) : undefined
  if (o?.kind === 'attack' && last) return { target: { x: last[0], y: last[1] }, path: o.path }
  return undefined
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
