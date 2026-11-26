// Ported from packages/shared/src/estimates.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance. A way's arrival
// estimate (`arrivalTicks`) is asked of the rules module: `arrivalOf` in `doing-view.ts`.

import { teardownLeft, workNeeded, workPace, workingOn } from './building.js'
import { STABLE_BREED_TICKS } from './horses.js'
import { TICKS_PER_GAME_HOUR } from './time.js'
import {
  ADULT_AGE,
  CARRYING_TICKS,
  PAIRING_WAIT_TICKS,
  TICKS_PER_GAME_DAY,
  TICK_MS,
  ticksForAge,
} from '@csp/balance'
import type { Building, Resident } from '@csp/shared-types'

export { foodPerTick } from '@csp/lang-wasm'

/**
 * About how long `ticks` last, to plan around (`CONTEXT.md`: Doing, Estimates): real time first,
 * game time in brackets, each rounded to one coarse unit: "about 3 min (3 game hours)", "about
 * 20 min (a game day)". Under a real minute is just "under a minute".
 */
export function aboutTime(ticks: number): string {
  const seconds = (ticks * TICK_MS) / 1000
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  const real = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
  return `about ${real} (${gameTimeAbout(ticks)})`
}

/** The most game hours `aboutTime` counts in hours; longer is half a game day, then days. */
const HOURS_UP_TO = 8

/** Game time in one coarse unit: "a game hour", "half a game day", "3 game days". */
function gameTimeAbout(ticks: number): string {
  const hours = Math.max(1, Math.round(ticks / TICKS_PER_GAME_HOUR))
  if (hours <= HOURS_UP_TO) return hours === 1 ? 'a game hour' : `${hours} game hours`
  if (hours < 18) return 'half a game day'
  const days = Math.max(1, Math.round(ticks / TICKS_PER_GAME_DAY))
  return days === 1 ? 'a game day' : `${days} game days`
}

/** How long is left, as `aboutTime` says it: "about 2 h (5 game days) left". */
export const timeLeft = (ticks: number) => `${aboutTime(ticks)} left`

/** Ticks left of `work` at `pace` work a tick; undefined when nobody is at it (pace 0). */
export function ticksAtPace(work: number, pace: number): number | undefined {
  return pace > 0 ? Math.ceil(Math.max(0, work) / pace) : undefined
}

// ---------- Meters and countdowns, each from its rule's pace ----------

/** A foal at breeding `progress`: the stable brings it on one tick a tick while tended. */
export const foalLeft = (progress: number) => timeLeft(STABLE_BREED_TICKS - progress)

/**
 * A construction site or tear-down, from the work left and the residents on it now (`workingOn`,
 * `workPace`); with nobody at it, who would be missing.
 */
export function workLeft(
  b: Building,
  residents: readonly Resident[],
  tick: number,
  { tearingDown = false, under, size }: { tearingDown?: boolean; under?: number; size?: number },
): string {
  const work = tearingDown ? teardownLeft(b) : workNeeded(b)
  const pace = workPace(b, workingOn(b, residents, tearingDown, size), tick, under)
  const ticks = ticksAtPace(work, pace)
  if (ticks === undefined) return tearingDown ? 'nobody is tearing it down' : 'nobody is building'
  return timeLeft(ticks)
}

/** A child carried since `since`: "born in about 4 h (10 game days)". */
export const bornIn = (since: number, tick: number) =>
  `born in ${aboutTime(Math.max(0, since + CARRYING_TICKS - tick))}`

/** A pair paired since `since`: ticks until one partner can start carrying (`CONTEXT.md`: Pairing). */
export const pairingTicksLeft = (since: number, tick: number) =>
  Math.max(0, since + PAIRING_WAIT_TICKS - tick)

/** A child: "grown in about 22 h (56 game days)"; undefined once grown (`CONTEXT.md`: Child). */
export function grownIn(r: Pick<Resident, 'bornAt'>, tick: number): string | undefined {
  const left = r.bornAt + ticksForAge(ADULT_AGE) - tick
  return left > 0 ? `grown in ${aboutTime(left)}` : undefined
}
