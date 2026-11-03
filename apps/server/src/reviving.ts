import {
  MAP_SIZE,
  feedHorseProblem,
  feedProblem,
  unitsThatFit,
  type Horse,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { horseEats } from './horses.js'
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
 * The feed order (`CONTEXT.md`: Reviving, Feeding a horse): a grown resident of the Player's realm
 * with Food in their hands, on or next to the tile of a Down resident or of a horse that isn't
 * full, gives it up to `units` of that Food. The one fed may be anyone's, of any realm or none.
 */
export const feed: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<FeedRequest>
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    if (!Number.isInteger(o.units) || o.units! <= 0) return 'units must be a whole number above 0'
    const size = terrain?.size ?? MAP_SIZE
    const horse = world.horses.find((h) => h.id === o.targetId)
    if (horse) return feedHorseProblem(r, horse, world.tick, size)
    const target = world.residents.find((x) => x.id === o.targetId)
    return feedProblem(r, target, world.tick, size)
  },
  apply(world, _sender, order) {
    const { residentId, targetId, units } = order as FeedRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'feed', targetId, units }
  },
}

/**
 * Feeding (`CONTEXT.md`: Reviving, Feeding a horse): each resident with a feed order gives up to
 * its units of the Food in their hands. A Down resident eats a unit at once and wakes (`wake`), the
 * rest goes in their hands as far as it fits, and what doesn't fit stays with the feeder. A horse
 * has no hands, so it eats all it takes at once (`feedHorse`). A feed that no longer holds (they
 * moved apart, the Food is gone, someone else woke or filled them first) does nothing. Either way
 * the order is done. `size` is the map's.
 */
export function stepFeeding(world: WorldState, size = MAP_SIZE): void {
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'feed') continue
    r.order = null
    const horse = world.horses.find((h) => h.id === o.targetId)
    if (horse) {
      feedHorse(world, r, horse, o.units, size)
      continue
    }
    const target = world.residents.find((x) => x.id === o.targetId)
    if (!target || feedProblem(r, target, world.tick, size)) continue
    const food = Math.min(o.units, r.carried.food!)
    // The first unit is eaten at once; the rest has to fit in their hands.
    const given = Math.min(food, 1 + unitsThatFit(target, 'food', world.tick))
    takeFood(r, given)
    target.carried.food = (target.carried.food ?? 0) + given
    wake(world, target, r.name)
  }
}

/**
 * A horse eats from the feeder's hands until it is full (`horseFull`), up to `units`, whole units
 * only; the rest stays with the feeder (`CONTEXT.md`: Feeding a horse).
 */
function feedHorse(
  world: WorldState,
  r: Resident,
  horse: Horse,
  units: number,
  size: number,
): void {
  if (feedHorseProblem(r, horse, world.tick, size)) return
  takeFood(r, horseEats(horse, Math.min(units, Math.floor(r.carried.food!))))
}

function takeFood(from: Resident, units: number): void {
  const left = from.carried.food! - units
  if (left > 0) from.carried.food = left
  else delete from.carried.food
}
