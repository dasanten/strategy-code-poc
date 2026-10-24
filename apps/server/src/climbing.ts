import {
  CLIMB_TICKS,
  climbLanding,
  commands,
  foreignWall,
  MAP_SIZE,
  wrapDelta,
  type OrderRequest,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/** An action a resident with a climb order requests: climb a tick further up the wall. */
export interface ClimbAction {
  residentId: string
}

/** The input of a climb order: which resident, and which wall or gate next to them. */
interface ClimbRequest extends OrderRequest {
  kind: 'climb'
  residentId: string
  wallId: string
}

/**
 * Whether two tiles are side by side, the short way round a map of `size` tiles. Only straight:
 * climbing over a wall from a corner would squeeze between two corners (`CONTEXT.md`: Step), and
 * the climber comes down straight across (`climbLanding`).
 */
function besides(size: number, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(wrapDelta(a.x, b.x, size)) + Math.abs(wrapDelta(a.y, b.y, size)) === 1
}

/**
 * The climb order (`CONTEXT.md`: Walls in combat, climbed): one of the Player's residents climbs
 * over a wall or gate of another realm's city, or of none, from the tile next to it they stand
 * on. The climbing happens in later ticks.
 */
export const climb: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<ClimbRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    const wall = foreignWall(world, realm.id, o.wallId)
    if (typeof wall === 'string') return wall
    if (!besides(terrain?.size ?? MAP_SIZE, r, wall)) return 'stand next to the wall to climb it'
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, wallId } = order as ClimbRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'climb', wallId, at: { x: r.x, y: r.y }, progress: 0 }
  },
}

/** Requests this tick's climbing. */
export function requestClimbing(world: WorldState): ClimbAction[] {
  return world.residents.filter((r) => r.order?.kind === 'climb').map((r) => ({ residentId: r.id }))
}

/**
 * Resolves climbing (ADR 0002), one action after another. A climber who has left their tile, or
 * whose wall is gone, stops. Each tick takes them `1 / CLIMB_TICKS` of the way; once over, they
 * come down where `climbLanding` says and the order is done. While climbing they can't defend
 * themselves (`resolveStrikes`).
 */
export function resolveClimbing(
  world: WorldState,
  actions: ClimbAction[],
  terrain: TerrainMap,
): void {
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    const o = r?.order
    if (!r || o?.kind !== 'climb') continue
    const wall = world.buildings.find((b) => b.id === o.wallId)
    const finished = wall && (wall.kind === 'wall' || wall.kind === 'gate') && !wall.site
    if (!finished || r.x !== o.at.x || r.y !== o.at.y || !besides(terrain.size, r, wall)) {
      r.order = null
      continue
    }
    o.progress = Math.min(1, o.progress + 1 / CLIMB_TICKS)
    if (o.progress < 1 - 1e-9) continue
    const to = climbLanding(world, terrain, r, wall)
    r.x = to.x
    r.y = to.y
    r.order = null
  }
}
