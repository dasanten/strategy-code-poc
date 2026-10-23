import {
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  gameTime,
  type Remembered,
  type SeenBuilding,
  type SeenCity,
} from '@csp/shared'

/** A building or site as the Player last saw it, out of their sight now (`CONTEXT.md`: Last seen). */
export type LastSeenBuilding = SeenBuilding & { seenAt: number }

/** A city as the Player last saw it, out of their sight now (`CONTEXT.md`: Last seen). */
export type LastSeenCity = SeenCity & { seenAt: number }

/** What the Player remembers out of their sight, by kind. */
export interface LastSeen {
  buildings: LastSeenBuilding[]
  cities: LastSeenCity[]
}

/** Sorts the Player's Last seen by kind, dropping the tag. */
export function lastSeenByKind(entries: Iterable<Remembered>): LastSeen {
  const out: LastSeen = { buildings: [], cities: [] }
  for (const { is, ...e } of entries) {
    if (is === 'building') out.buildings.push(e as LastSeenBuilding)
    else out.cities.push(e as LastSeenCity)
  }
  return out
}

/** "3 days", "1 hour", "5 minutes" of game time. */
function span(ticks: number): string {
  const [n, unit] =
    ticks >= TICKS_PER_GAME_DAY
      ? [Math.floor(ticks / TICKS_PER_GAME_DAY), 'day']
      : ticks >= TICKS_PER_GAME_HOUR
        ? [Math.floor(ticks / TICKS_PER_GAME_HOUR), 'hour']
        : [Math.floor((ticks / TICKS_PER_GAME_HOUR) * 60), 'minute']
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/**
 * When the Player last saw something, in game time: "Last seen: day 12, 14:30 (3 days ago)", with
 * the year when it was another year's.
 */
export function lastSeenText(seenAt: number, tick: number): string {
  const then = gameTime(seenAt)
  const year = then.year === gameTime(tick).year ? '' : `year ${then.year}, `
  const hh = String(then.hour).padStart(2, '0')
  const mm = String(then.minute).padStart(2, '0')
  const ago = tick - seenAt
  const when = ago < TICKS_PER_GAME_HOUR / 60 ? 'just now' : `${span(ago)} ago`
  return `Last seen: ${year}day ${then.day}, ${hh}:${mm} (${when})`
}
