// Feeding a horse (`CONTEXT.md`: Feeding a horse) on the client. Its rules with a Rust original are
// twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client asks
// them per frame or per row.

import { inContact, canWork } from '@csp/lang-wasm'
import { isDown } from '../world/world.js'
import { HORSE_FILL_PER_FOOD, MAX_HUNGER } from '@csp/balance'
import type { Resident } from '@csp/shared-types'
import { NO_CHILD_FEEDS, NO_FOOD_TO_FEED, HORSE_FULL } from '@csp/shared-types'

/**
 * Reviving and Feeding a horse (`CONTEXT.md`), shared by the server and the UI: who can Feed a
 * Down resident or a horse.
 */

/** What Feed needs to know of the resident who feeds. */
export type Feeder = Pick<Resident, 'bornAt' | 'x' | 'y' | 'carried'>

/**
 * What Feed needs to know of the horse fed: from the world, or as a Player sees it. A Player sees
 * the hunger of only their own and their allies' horses (`SeenHorse`).
 */
export interface FedHorse {
  x: number
  y: number
  hunger?: number
}

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
