import type { Waypoint } from '@csp/shared-types'
import { tileToScreen, type Camera, type Size } from './camera.js'

/*
 * Waypoint pins (`CONTEXT.md`: Waypoint): each of the Player's waypoints is drawn as a pin whose
 * point is on its tile's centre, the same size at every zoom tier. Its head stands above the
 * tile, so far out it covers other tiles: a click on it while picking a place picks the
 * waypoint's tile, a place like a tile.
 */

/** A pin's head radius and how far above its point the head's centre is, in pixels. */
export const PIN_RADIUS = 7
export const PIN_HEIGHT = 16

/** Pixels around a pin a click still counts as on it. */
const PIN_SLOP = 3

/**
 * The waypoint whose pin a screen point falls on, if any: on its head or along its stem down to
 * its point, the nearest head on ties.
 */
export function pinAt(
  waypoints: readonly Waypoint[],
  cam: Camera,
  view: Size,
  mapSize: number,
  sx: number,
  sy: number,
): Waypoint | undefined {
  let best: { w: Waypoint; d: number } | undefined
  for (const w of waypoints) {
    const [px, py] = tileToScreen(cam, view, mapSize, w.x + 0.5, w.y + 0.5)
    const head = py - PIN_HEIGHT
    const d = Math.hypot(px - sx, head - sy)
    const onHead = d <= PIN_RADIUS + PIN_SLOP
    const onStem = Math.abs(px - sx) <= PIN_RADIUS * 0.5 + PIN_SLOP && sy >= head && sy <= py
    if ((onHead || onStem) && (!best || d < best.d)) best = { w, d }
  }
  return best?.w
}
