import type { WorldState } from '@csp/shared'

/**
 * Offering horses again (`CONTEXT.md`: Horse offer): the one Player who claimed, or with no
 * `userId` every Player who did, may claim once more. A Player who hasn't claimed still has just
 * the one claim. Answers how many offers were re-opened.
 *
 * Apart from `horse-grant.ts` because the HTTP app calls it: entering the order kinds' import
 * cycle through `horse-grant.ts` stops the server at startup.
 */
export function reopenHorseOffers(world: WorldState, userId?: number): number {
  const before = world.horseOffersClaimed.length
  world.horseOffersClaimed =
    userId === undefined ? [] : world.horseOffersClaimed.filter((id) => id !== userId)
  return before - world.horseOffersClaimed.length
}
