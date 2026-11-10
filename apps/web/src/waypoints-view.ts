import { WAYPOINTS_MAX } from '@csp/balance'
import type { Waypoint } from '@csp/shared-types'

/*
 * What the Waypoints drawer and the map's tile menu show (`CONTEXT.md`: Waypoint), as plain
 * functions of the Player's waypoints.
 */

/** The name a new waypoint's field starts with: "Waypoint n", the lowest n none of them has. */
export function suggestedWaypointName(held: readonly Pick<Waypoint, 'name'>[]): string {
  const taken = new Set(held.map((w) => w.name))
  for (let n = 1; ; n++) if (!taken.has(`Waypoint ${n}`)) return `Waypoint ${n}`
}

/** The drawer head's count: how many the Player holds of the most they may. */
export function waypointCount(held: readonly unknown[]): string {
  return `${held.length} of ${WAYPOINTS_MAX}`
}

/** Where a waypoint is, as a row in the drawer shows it. */
export const waypointPlace = (w: Pick<Waypoint, 'x' | 'y'>) => `tile ${w.x}, ${w.y}`

/**
 * Where the tile menu opens: at the point pressed, moved in so a menu `width` × `height` stays
 * inside a screen `view` across, with a margin.
 */
export function menuSpot(
  at: { x: number; y: number },
  menu: { width: number; height: number },
  view: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  const clamp = (v: number, size: number, room: number) =>
    Math.max(margin, Math.min(v, room - size - margin))
  return { left: clamp(at.x, menu.width, view.width), top: clamp(at.y, menu.height, view.height) }
}
