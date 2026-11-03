import { HORSE_FILL_PER_FOOD, MAX_HUNGER, canWork } from './balance.js'
import { inContact } from './combat.js'
import { isDown, type Resident } from './world.js'

/**
 * Reviving and Feeding a horse (`CONTEXT.md`), shared by the server and the UI: who can Feed a
 * Down resident or a horse.
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

/**
 * What Feed needs to know of the horse fed: from the world, or as a Player sees it. A Player sees
 * the hunger of only their own and their allies' horses (`SeenHorse`).
 */
export interface FedHorse {
  x: number
  y: number
  hunger?: number
}

/** Why a child can't Feed anyone (`CONTEXT.md`: Reviving: any grown resident). */
export const NO_CHILD_FEEDS = 'children can’t feed others'

/** Why a resident without Food in their hands can't Feed anyone. */
export const NO_FOOD_TO_FEED = 'no Food in hand'

/** Why a horse can't be Fed (`CONTEXT.md`: Feeding a horse: any horse that isn't full). */
export const HORSE_FULL = 'that horse is full'

/** What is wrong with the feeder, undefined when they can Feed someone within their reach. */
function feederProblem(
  feeder: Feeder,
  target: { x: number; y: number },
  tick: number,
  size: number,
  tooFar: string,
): string | undefined {
  if (!canWork(feeder, tick)) return NO_CHILD_FEEDS
  if (!inContact(size, feeder, target)) return tooFar
  if ((feeder.carried.food ?? 0) < 1) return NO_FOOD_TO_FEED
  return undefined
}

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
  return feederProblem(feeder, target, tick, size, 'stand on or next to their tile to feed them')
}

/**
 * Whether a horse is known to be full, so it can't be Fed: its hunger meter has no room for a whole
 * unit of Food, as when it eats on its own (`CONTEXT.md`: Feeding a horse).
 */
export function horseFull(horse: Pick<FedHorse, 'hunger'>): boolean {
  return horse.hunger !== undefined && horse.hunger > MAX_HUNGER - HORSE_FILL_PER_FOOD
}

/**
 * The horses that can be Fed as far as is known, most in need first: those Down, then those known
 * to be hungry, then strangers' of unknown hunger, who may turn out full. So a pick that doesn't
 * ask goes to the one that needs it (`CONTEXT.md`: Feeding a horse).
 */
export function horsesInNeed<H extends Pick<FedHorse, 'hunger'> & Parameters<typeof isDown>[0]>(
  horses: readonly H[],
): H[] {
  const need = (h: H) => (isDown(h) ? 0 : h.hunger !== undefined ? 1 : 2)
  return horses.filter((h) => !horseFull(h)).sort((a, b) => need(a) - need(b))
}

/**
 * Why `feeder` can't Feed `horse` now, undefined when they can (`CONTEXT.md`: Feeding a horse): a
 * grown resident with Food in their hands, on or next to the tile of a horse that isn't full, Down
 * or not, of any realm. `size` is the map's.
 */
export function feedHorseProblem(
  feeder: Feeder,
  horse: FedHorse,
  tick: number,
  size: number,
): string | undefined {
  if (horseFull(horse)) return HORSE_FULL
  return feederProblem(feeder, horse, tick, size, 'stand on or next to its tile to feed it')
}
