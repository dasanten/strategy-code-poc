// Ported from packages/shared/src/waypoints.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { nameProblem } from './names.js'
import { WAYPOINTS_MAX, WAYPOINT_NAME_MAX_LENGTH } from '@csp/balance'
import type { Waypoint } from '@csp/shared-types'

/*
 * Waypoints (`CONTEXT.md`: Waypoint): named markers a Player puts on tiles, seen only by them and
 * kept with the Player, not their realm. These checks are shared, so the UI can say why before
 * it sends an order and the server says the same when it turns one down.
 */

/** Why a Player holding `held` can't add a waypoint named `name` on tile (x, y) of a map `size` across. */
export function addWaypointProblem(
  held: readonly Waypoint[],
  x: unknown,
  y: unknown,
  name: unknown,
  size: number,
): string | undefined {
  if (held.length >= WAYPOINTS_MAX) return `you hold ${WAYPOINTS_MAX} waypoints already, the most`
  if (!onMap(x, size) || !onMap(y, size)) return 'not a tile on the map'
  const bad = nameProblem(name, WAYPOINT_NAME_MAX_LENGTH)
  return bad && `Name: ${bad}`
}

/** Why a Player holding `held` can't rename the waypoint `id` to `name`. */
export function renameWaypointProblem(
  held: readonly Waypoint[],
  id: unknown,
  name: unknown,
): string | undefined {
  if (!held.some((w) => w.id === id)) return 'not one of your waypoints'
  const bad = nameProblem(name, WAYPOINT_NAME_MAX_LENGTH)
  return bad && `Name: ${bad}`
}

/** Why a Player holding `held` can't remove the waypoint `id`. */
export function removeWaypointProblem(held: readonly Waypoint[], id: unknown): string | undefined {
  return held.some((w) => w.id === id) ? undefined : 'not one of your waypoints'
}

const onMap = (v: unknown, size: number) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < size
