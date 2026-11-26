// Game time as the phone's top bar shows it.

import { gameTime } from '@csp/lang-wasm'

/** Game time as a phone's top bar shows it, with no room for the long form: "Y1 · D3 · 14:20". */
export function formatGameTimeShort(tick: number): string {
  const { year, day, hour, minute } = gameTime(tick)
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return `Y${year} · D${day} · ${hh}:${mm}`
}
