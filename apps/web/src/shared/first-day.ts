// Ported from packages/shared/src/first-day.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { ClientFirstDayLine, FirstDay, FirstDayLine } from '@csp/shared-types'

/**
 * The first-day card (`CONTEXT.md`: First day): a checklist a new realm's HUD shows, kept per
 * Player rather than per realm.
 */

/** The card's lines, in its order. */
export const FIRST_DAY_LINES = ['claimHorses', 'pickResident', 'giveOrder', 'openWiki'] as const

/**
 * The lines the client reports (`FIRST_DAY_PATH`); the server sees the others itself, as the
 * orders come in, and ignores a report of them.
 */
export const CLIENT_FIRST_DAY_LINES = [
  'pickResident',
  'openWiki',
] as const satisfies readonly FirstDayLine[]

/** Where the client reports a line done (POST `{ line }`) and dismisses the card (POST). */
export const FIRST_DAY_PATH = '/api/first-day'

export const FIRST_DAY_DISMISS_PATH = '/api/first-day/dismiss'

/** Whether `line` names one of the card's lines; a client can send anything. */
export function isFirstDayLine(line: unknown): line is FirstDayLine {
  return typeof line === 'string' && (FIRST_DAY_LINES as readonly string[]).includes(line)
}

/** Whether the client may report `line`; it can send anything. */
export function isClientFirstDayLine(line: unknown): line is ClientFirstDayLine {
  return typeof line === 'string' && (CLIENT_FIRST_DAY_LINES as readonly string[]).includes(line)
}

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
