import type { SeenResident } from '@csp/shared'
import type { Spot } from './unit-tokens.js'

/**
 * One of the Player's residents where it shows on screen, and how far from it a click reaches: 0
 * for one a click never picks, only a box.
 */
export interface Pickable {
  id: string
  x: number
  y: number
  reach: number
}

/** A point on screen, in pixels. */
export interface Point {
  x: number
  y: number
}

/**
 * The residents of the Player's realm that can be clicked or boxed on the map: at the figure or
 * token they were drawn as last frame (`spots`), so the reach grows with it, or else at their
 * tile's centre (`place`). Up close only those drawn as a figure (or behind a "+N" badge) count.
 * A passenger, inside their carriage, is only boxed: a click there opens the carriage's card,
 * which lists them (`CONTEXT.md`: Passenger).
 */
export function pickables(
  residents: readonly Pick<SeenResident, 'id' | 'owner' | 'x' | 'y' | 'aboard'>[],
  realmId: string,
  spots: ReadonlyMap<string, Spot>,
  place: (x: number, y: number) => readonly [number, number],
  scale: number,
  close: boolean,
): Pickable[] {
  const list: Pickable[] = []
  for (const r of residents) {
    if (r.owner !== realmId) continue
    const spot = spots.get(r.id)
    if (close && !spot) continue
    const [x, y] = spot ? [spot.x, spot.y] : place(r.x + 0.5, r.y + 0.5)
    const reach = spot ? Math.max(8, spot.r * 1.4) : Math.max(10, scale * 0.6)
    list.push({ id: r.id, x, y, reach: r.aboard === undefined ? reach : 0 })
  }
  return list
}

/** The nearest pickable whose reach covers a point on screen, if any. */
export function pickableAt(list: readonly Pickable[], sx: number, sy: number): string | undefined {
  let best: { id: string; d: number } | undefined
  for (const p of list) {
    const d = Math.hypot(p.x - sx, p.y - sy)
    if (p.reach > 0 && d <= p.reach && (!best || d < best.d)) best = { id: p.id, d }
  }
  return best?.id
}

/** The pickables inside a box dragged between two corners, in either order. */
export function inBox(list: readonly Pickable[], a: Point, b: Point): string[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
  return list.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id)
}

/** A Shift-click on a resident: adds them to the selection, or takes them out if already in it. */
export function toggled(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
}
