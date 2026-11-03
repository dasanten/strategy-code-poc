import {
  MAP_SIZE,
  feedProblem,
  unitsThatFit,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { orderedResident } from './order-sender.js'
import type { OrderKind } from './orders.js'
import { wake } from './survival.js'

/** The input of a feed order: which resident Feeds whom, and how many units of Food at most. */
interface FeedRequest extends OrderRequest {
  kind: 'feed'
  residentId: string
  targetId: string
  units: number
}

/**
 * The feed order (`CONTEXT.md`: Reviving): a grown resident of the Player's realm with Food in
 * their hands, on or next to a Down resident's tile, puts up to `units` of it into the Down
 * resident's hands. The Down resident may be anyone's, of any realm or none.
 */
export const feed: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<FeedRequest>
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    if (!Number.isInteger(o.units) || o.units! <= 0) return 'units must be a whole number above 0'
    const target = world.residents.find((x) => x.id === o.targetId)
    return feedProblem(r, target, world.tick, terrain?.size ?? MAP_SIZE)
  },
  apply(world, _sender, order) {
    const { residentId, targetId, units } = order as FeedRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'feed', targetId, units }
  },
}

/**
 * Feeding (`CONTEXT.md`: Reviving): each resident with a feed order puts up to its units of the
 * Food in their hands into the Down resident's, who eats a unit at once and wakes (`wake`); the
 * rest goes in their hands as far as it fits, and what doesn't fit stays with the feeder. A feed
 * that no longer holds (they moved apart, the Food is gone, someone else woke them first) does
 * nothing. Either way the order is done. `size` is the map's.
 */
export function stepFeeding(world: WorldState, size = MAP_SIZE): void {
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'feed') continue
    r.order = null
    const target = world.residents.find((x) => x.id === o.targetId)
    if (!target || feedProblem(r, target, world.tick, size)) continue
    const food = Math.min(o.units, r.carried.food!)
    // The first unit is eaten at once; the rest has to fit in their hands.
    const given = Math.min(food, 1 + unitsThatFit(target, 'food', world.tick))
    move(r, target, given)
    wake(world, target, r.name)
  }
}

function move(from: Resident, to: Resident, units: number): void {
  const left = from.carried.food! - units
  if (left > 0) from.carried.food = left
  else delete from.carried.food
  to.carried.food = (to.carried.food ?? 0) + units
}
