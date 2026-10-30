import {
  ADULT_AGE,
  CARRYING_TICKS,
  PAIRING_WAIT_TICKS,
  STABLE_BREED_TICKS,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  TICK_MS,
  teardownLeft,
  ticksForAge,
  workNeeded,
  workPace,
  workingOn,
  type Building,
  type Resident,
} from '@csp/shared'

/**
 * Estimates (`CONTEXT.md`: Doing, Estimates): how long something takes at its current pace, in
 * real time with game time in brackets, each rounded to one coarse unit, "about 2 h (5 game
 * days)". Meters, countdowns and arrivals all say it the same way.
 */

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** Real time for a number of ticks in one coarse unit: "40 s", "3 min", "2 h", "4 real days". */
export function roughRealTime(ticks: number): string {
  const s = (ticks * TICK_MS) / 1000
  if (s >= 2 * 86_400) return `${Math.round(s / 86_400)} real days`
  if (s >= 3600) return `${Math.round(s / 3600)} h`
  if (s >= 60) return `${Math.round(s / 60)} min`
  return `${Math.max(1, Math.round(s))} s`
}

/** Game time for a number of ticks in one coarse unit: "5 game days", "1 game hour". */
export function roughGameTime(ticks: number): string {
  if (ticks >= TICKS_PER_GAME_DAY) return plural(Math.round(ticks / TICKS_PER_GAME_DAY), 'game day')
  if (ticks >= TICKS_PER_GAME_HOUR)
    return plural(Math.round(ticks / TICKS_PER_GAME_HOUR), 'game hour')
  const minutes = Math.max(1, Math.round(ticks / (TICKS_PER_GAME_HOUR / 60)))
  return plural(minutes, 'game minute')
}

/** About how long `ticks` takes: "about 2 h (5 game days)". */
export const about = (ticks: number) =>
  `about ${roughRealTime(ticks)} (${roughGameTime(ticks)})`

/** How long is left: "about 2 h (5 game days) left". */
export const timeLeft = (ticks: number) => `${about(ticks)} left`

/** Ticks left of `work` at `pace` work a tick; undefined when nobody is at it (pace 0). */
export function ticksAtPace(work: number, pace: number): number | undefined {
  return pace > 0 ? Math.ceil(Math.max(0, work) / pace) : undefined
}

// ---------- Each rule's estimate, from its pace ----------

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
  `born in ${about(Math.max(0, since + CARRYING_TICKS - tick))}`

/** A pair paired since `since`: ticks until one partner can start carrying (`CONTEXT.md`: Pairing). */
export const pairingTicksLeft = (since: number, tick: number) =>
  Math.max(0, since + PAIRING_WAIT_TICKS - tick)

/** A child: "grown in about 3 h (30 game days)"; undefined once grown (`CONTEXT.md`: Child). */
export function grownIn(r: Pick<Resident, 'bornAt'>, tick: number): string | undefined {
  const left = r.bornAt + ticksForAge(ADULT_AGE) - tick
  return left > 0 ? `grown in ${about(left)}` : undefined
}
