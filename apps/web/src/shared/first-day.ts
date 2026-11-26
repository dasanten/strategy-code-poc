// Ported from packages/shared/src/first-day.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { FirstDay, FirstDayLine } from '@csp/shared-types'
import { FIRST_DAY_LINES } from '@csp/shared-types'

export { isFirstDayLine, isClientFirstDayLine } from '@csp/lang-wasm'

export {
  FIRST_DAY_LINES,
  CLIENT_FIRST_DAY_LINES,
  FIRST_DAY_PATH,
  FIRST_DAY_DISMISS_PATH,
} from '@csp/shared-types'

/**
 * The first-day card (`CONTEXT.md`: First day): a checklist a new realm's HUD shows, kept per
 * Player rather than per realm.
 */

/** The card with `line` ticked too, its lines kept in the card's order. */
export function tickFirstDay(card: FirstDay, line: FirstDayLine): FirstDay {
  if (card.done.includes(line)) return card
  const done = FIRST_DAY_LINES.filter((l) => l === line || card.done.includes(l))
  return { ...card, done }
}

/** Whether the card shows: until every line is ticked or the Player dismisses it, for good. */
export function firstDayShown(card: FirstDay): boolean {
  return !card.dismissed && FIRST_DAY_LINES.some((l) => !card.done.includes(l))
}
