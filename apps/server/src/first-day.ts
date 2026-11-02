import { eq } from 'drizzle-orm'
import {
  isFirstDayLine,
  tickFirstDay,
  type FirstDay,
  type FirstDayLine,
  type OrderRequest,
} from '@csp/shared'
import { schema, type Db } from './db/index.js'

/**
 * The first-day card (`CONTEXT.md`: First day), kept per Player on their account row, not in
 * the world, so it outlasts a Leader's death.
 */

/** A Player's first-day card as kept. */
export function readFirstDay(db: Db, userId: number): FirstDay {
  const row = db
    .select({ done: schema.users.firstDayDone, dismissed: schema.users.firstDayDismissed })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get()
  if (!row) return { done: [], dismissed: true }
  return { done: row.done.split(',').filter(isFirstDayLine), dismissed: row.dismissed }
}

/**
 * Ticks `line` on the Player's card. Answers the card when that changed it, undefined when the
 * line was ticked already.
 */
export function markFirstDay(db: Db, userId: number, line: FirstDayLine): FirstDay | undefined {
  const card = readFirstDay(db, userId)
  const ticked = tickFirstDay(card, line)
  if (ticked === card) return undefined
  db.update(schema.users)
    .set({ firstDayDone: ticked.done.join(',') })
    .where(eq(schema.users.id, userId))
    .run()
  return ticked
}

/** The Player dismissed the card: it never shows again. */
export function dismissFirstDay(db: Db, userId: number): FirstDay {
  db.update(schema.users).set({ firstDayDismissed: true }).where(eq(schema.users.id, userId)).run()
  return readFirstDay(db, userId)
}

/**
 * The line an order the server accepted ticks: claiming the Horse offer, or giving any order to
 * a resident.
 */
export function firstDayLineOf(order: OrderRequest): FirstDayLine | undefined {
  if (order.kind === 'claimHorses') return 'claimHorses'
  return typeof order.residentId === 'string' ? 'giveOrder' : undefined
}
