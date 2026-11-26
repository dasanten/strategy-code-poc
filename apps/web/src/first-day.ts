// The first-day card on the client (`CONTEXT.md`: First day). Its rules with a Rust original are
// twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client asks
// them per frame or per row.

import type { FirstDay } from '@csp/shared-types'
import { FIRST_DAY_LINES } from '@csp/shared-types'

/**
 * The first-day card (`CONTEXT.md`: First day): a checklist a new realm's HUD shows, kept per
 * Player rather than per realm.
 */

/** Whether the card shows: until every line is ticked or the Player dismisses it, for good. */
export function firstDayShown(card: FirstDay): boolean {
  return !card.dismissed && FIRST_DAY_LINES.some((l) => !card.done.includes(l))
}
