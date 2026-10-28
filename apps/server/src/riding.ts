import {
  carriagePulledBy,
  horseOfResident,
  horseRidden,
  mountProblem,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { orderedResident } from './order-sender.js'

/** The input of a mount order: which resident mounts which horse. */
interface MountRequest extends OrderRequest {
  kind: 'mount'
  residentId: string
  horseId: string
}

/** The input of a dismount order: which resident gets off their horse. */
interface DismountRequest extends OrderRequest {
  kind: 'dismount'
  residentId: string
}

/**
 * A path found before mounting or dismounting kept to the ground and walls of the other way of
 * going (`CONTEXT.md`: Riding), so the walk finds a new one.
 */
function freshPath(r: Resident): void {
  const o = r.order as { path?: unknown; progress?: number } | null
  if (!o || !('path' in o) || o.path === undefined) return
  o.path = null
  o.progress = 0
}

/**
 * The mount order (`CONTEXT.md`: Riding): one of the Player's residents gets on a horse of their
 * realm on their tile that pulls no carriage. Riding is no order: they go on with what they do,
 * from the next tick at the horse's pace (`Walking`).
 */
export const mount: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<MountRequest>
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    return mountProblem(
      world,
      r,
      world.horses.find((h) => h.id === o.horseId),
    )
  },
  apply(world, _sender, order) {
    const { residentId, horseId } = order as MountRequest
    const r = world.residents.find((x) => x.id === residentId)
    const horse = world.horses.find((h) => h.id === horseId)
    // Two riders ordered onto one horse in the same tick: the first one rides it.
    if (!r || mountProblem(world, r, horse)) return
    r.riding = horseId
    freshPath(r)
  },
}

/** The dismount order (`CONTEXT.md`: Riding): a resident gets off their horse, which stays on the tile. */
export const dismount: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<DismountRequest>
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    if (r.riding === undefined) return 'not riding'
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId } = order as DismountRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (!r || r.riding === undefined) return
    delete r.riding
    freshPath(r)
  },
}

/**
 * Ends riding that can't go on (`CONTEXT.md`: Riding), at the end of each tick: the horse died, is
 * no longer the rider's realm's, was hitched, or has another rider, or the rider left it behind,
 * as by climbing over a wall. The horse stays where it is.
 */
export function stepRiders(world: WorldState): void {
  const ridden = new Set<string>()
  for (const r of world.residents) {
    if (r.riding === undefined) continue
    const horse = horseRidden(world, r)
    const together = horse?.x === r.x && horse.y === r.y
    if (
      !horse ||
      !together ||
      !horseOfResident(horse, r) ||
      carriagePulledBy(world, horse) ||
      ridden.has(horse.id)
    ) {
      delete r.riding
      continue
    }
    ridden.add(horse.id)
  }
}
