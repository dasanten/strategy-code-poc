import {
  WAYPOINTS_MAX,
  WAYPOINT_NAME_MAX_LENGTH,
  addWaypointProblem,
  nameProblem,
  removeWaypointProblem,
  renameWaypointProblem,
  type OrderRequest,
  type Waypoint,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { newId } from './starting-city.js'

/*
 * Waypoints (`CONTEXT.md`: Waypoint) are the Player's own marks on the map: putting one down,
 * renaming or removing it is plain data, free, at once and from anywhere, which a script could
 * request as well (ADR 0002). They are kept by account id (`WorldState.waypoints`), not by realm,
 * so a Leader death leaves them where they are.
 */

/** The waypoints the Player with account `userId` holds, oldest first. */
export function waypointsOf(world: WorldState, userId: number): readonly Waypoint[] {
  return world.waypoints[userId] ?? []
}

/** The input of an add order: a waypoint named `name` on tile (x, y). */
interface AddWaypointRequest extends OrderRequest {
  kind: 'addWaypoint'
  x: number
  y: number
  name: string
}

/** The input of a rename order: the waypoint `waypointId` gets `name`. */
interface RenameWaypointRequest extends OrderRequest {
  kind: 'renameWaypoint'
  waypointId: string
  name: string
}

/** The input of a remove order: the waypoint `waypointId` goes. */
interface RemoveWaypointRequest extends OrderRequest {
  kind: 'removeWaypoint'
  waypointId: string
}

/**
 * The add order: the Player gets a new waypoint with the name trimmed, after those they hold.
 * Turned down past `WAYPOINTS_MAX`, also when orders waiting for the same tick filled the cap.
 */
export const addWaypoint: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<AddWaypointRequest>
    if (!terrain) return 'no map to put a waypoint on'
    return addWaypointProblem(waypointsOf(world, sender.userId), o.x, o.y, o.name, terrain.size)
  },
  apply(world, sender, order, terrain) {
    if (!terrain || addWaypoint.validate(world, sender, order, terrain)) return
    const { x, y, name } = order as AddWaypointRequest
    const held = (world.waypoints[sender.userId] ??= [])
    held.push({ id: newId(world, 'wp'), name: name.trim(), x, y })
  },
}

/** The rename order: one of the Player's waypoints takes the new name, trimmed. */
export const renameWaypoint: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<RenameWaypointRequest>
    return renameWaypointProblem(waypointsOf(world, sender.userId), o.waypointId, o.name)
  },
  apply(world, sender, order) {
    if (renameWaypoint.validate(world, sender, order)) return
    const { waypointId, name } = order as RenameWaypointRequest
    world.waypoints[sender.userId]!.find((w) => w.id === waypointId)!.name = name.trim()
  },
}

/** The remove order: one of the Player's waypoints goes; a Player left with none has no entry. */
export const removeWaypoint: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<RemoveWaypointRequest>
    return removeWaypointProblem(waypointsOf(world, sender.userId), o.waypointId)
  },
  apply(world, sender, order) {
    if (removeWaypoint.validate(world, sender, order)) return
    const { waypointId } = order as RemoveWaypointRequest
    const left = world.waypoints[sender.userId]!.filter((w) => w.id !== waypointId)
    if (left.length > 0) world.waypoints[sender.userId] = left
    else delete world.waypoints[sender.userId]
  },
}

export const waypointOrders = { addWaypoint, renameWaypoint, removeWaypoint }

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Waypoint): each Player holds at most `WAYPOINTS_MAX`
 * waypoints, each on a tile of the map with a trimmed name of at most `WAYPOINT_NAME_MAX_LENGTH`,
 * and no two waypoints share an id.
 */
export const waypointsSound: Invariant = {
  name: 'waypoints-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const ids = new Set<string>()
    for (const [userId, held] of Object.entries(world.waypoints)) {
      if (held.length > WAYPOINTS_MAX) {
        out.push({
          invariant: this.name,
          message: `Player ${userId} holds ${held.length} waypoints, more than ${WAYPOINTS_MAX}`,
          entityIds: [],
        })
      }
      for (const w of held) {
        const problem =
          (ids.has(w.id) ? 'shares its id with another waypoint' : undefined) ??
          (!onMap(w.x, terrain.size) || !onMap(w.y, terrain.size) ? 'is off the map' : undefined) ??
          nameProblem(w.name, WAYPOINT_NAME_MAX_LENGTH) ??
          (w.name !== w.name.trim() ? 'name not trimmed' : undefined)
        if (problem) {
          out.push({
            invariant: this.name,
            message: `Player ${userId}'s waypoint ${w.id}: ${problem}`,
            entityIds: [w.id],
          })
        }
        ids.add(w.id)
      }
    }
    return out
  },
}

const onMap = (v: number, size: number) => Number.isInteger(v) && v >= 0 && v < size
