// Ported from packages/shared/src/time.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR } from '@csp/balance'
import { gameTime } from '@csp/lang-wasm'

export { type GameTime, gameTime, formatGameTime } from '@csp/lang-wasm'

/** Game days in a game year (`CONTEXT.md`: Game time). */
export const GAME_DAYS_PER_YEAR = TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY

/** Ticks in one game hour: a game day has 24 hours like a real one. */
export const TICKS_PER_GAME_HOUR = TICKS_PER_GAME_DAY / 24

/** Game time as a phone's top bar shows it, with no room for the long form: "Y1 · D3 · 14:20". */
export function formatGameTimeShort(tick: number): string {
  const { year, day, hour, minute } = gameTime(tick)
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return `Y${year} · D${day} · ${hh}:${mm}`
}
