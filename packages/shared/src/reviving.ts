import { canWork } from './balance.js'
import { inContact } from './combat.js'
import { isDown, type Resident } from './world.js'

/**
 * Reviving (`CONTEXT.md`: Reviving), shared by the server and the UI: who can Feed a Down
 * resident.
 */

/** What Feed needs to know of the resident who feeds. */
export type Feeder = Pick<Resident, 'bornAt' | 'x' | 'y' | 'carried'>

/** What Feed needs to know of the resident fed: from the world, or as a Player sees them. */
export interface FeedTarget {
  x: number
  y: number
  downUntil?: number
  down?: true
}

/** Why a child can't Feed anyone (`CONTEXT.md`: Reviving: any grown resident). */
export const NO_CHILD_FEEDS = 'children can’t feed others'

/** Why a resident without Food in their hands can't Feed anyone. */
export const NO_FOOD_TO_FEED = 'no Food in hand'

/**
 * Why `feeder` can't Feed `target` now, undefined when they can: a grown resident with Food in
 * their hands, on or next to the tile of a resident who is Down. `size` is the map's.
 */
export function feedProblem(
  feeder: Feeder,
  target: FeedTarget | undefined,
  tick: number,
  size: number,
): string | undefined {
  if (!target || !isDown(target)) return 'nobody Down there to feed'
  if (!canWork(feeder, tick)) return NO_CHILD_FEEDS
  if (!inContact(size, feeder, target)) return 'stand on or next to their tile to feed them'
  if ((feeder.carried.food ?? 0) < 1) return NO_FOOD_TO_FEED
  return undefined
}
