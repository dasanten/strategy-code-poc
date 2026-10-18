import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR } from './world.js'

/** Game days in a game year (`CONTEXT.md`: Game time). */
export const GAME_DAYS_PER_YEAR = TICKS_PER_GAME_YEAR / TICKS_PER_GAME_DAY

/** Ticks in one game hour: a game day has 24 hours like a real one. */
export const TICKS_PER_GAME_HOUR = TICKS_PER_GAME_DAY / 24

/** A moment of game time. Year and day count from 1, like a calendar; hour and minute from 0. */
export interface GameTime {
  year: number
  /** Day within the year, 1 to `GAME_DAYS_PER_YEAR`. */
  day: number
  hour: number
  minute: number
}

/** The game time at a tick: one tick is one real second (`CONTEXT.md`: Game time, Tick). */
export function gameTime(tick: number): GameTime {
  const t = Math.max(0, Math.floor(tick))
  const days = Math.floor(t / TICKS_PER_GAME_DAY)
  const inDay = t - days * TICKS_PER_GAME_DAY
  const minutes = Math.floor((inDay / TICKS_PER_GAME_HOUR) * 60)
  return {
    year: Math.floor(days / GAME_DAYS_PER_YEAR) + 1,
    day: (days % GAME_DAYS_PER_YEAR) + 1,
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  }
}

/** Game time as the top bar shows it: "Year 1 · Day 3 · 14:20". */
export function formatGameTime(tick: number): string {
  const { year, day, hour, minute } = gameTime(tick)
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return `Year ${year} · Day ${day} · ${hh}:${mm}`
}
