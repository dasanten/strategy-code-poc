// The Creative bar's words (`CONTEXT.md`: Creative mode, ADR 0043): time controls for an admin
// on a server started with `CREATIVE=1`.
import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR, TICKS_PER_GAME_YEAR } from '@csp/balance'
import type { Account, CreativeSpeed, SkipProgress, SkipUnit } from '@csp/shared-types'

/** The speeds in the order the bar shows them, with their labels and what they do. */
export const CREATIVE_SPEEDS: readonly { speed: CreativeSpeed; label: string; title: string }[] = [
  { speed: 'normal', label: '×1', title: 'Normal speed: one game minute a second' },
  { speed: 'x10', label: '×10', title: 'Ten game minutes a second' },
  { speed: 'x60', label: '×60', title: 'One game hour a second' },
  { speed: 'max', label: 'Max', title: 'As fast as the machine allows' },
]

/** Whether the game view shows the Creative bar: only to admins on a creative server. */
export function showsCreativeBar(account: Account): boolean {
  return account.isAdmin && account.creative === true
}

/** The bar's line on how the world runs: paused, or at what speed. */
export function creativeRunning(paused: boolean, speed: CreativeSpeed): string {
  if (paused) return 'Paused'
  const shown = CREATIVE_SPEEDS.find((s) => s.speed === speed)
  return speed === 'normal' ? 'Running' : `Running ${shown?.label ?? speed}`
}

/** The units a skip ahead counts in, as the bar offers them. */
export const SKIP_UNITS: readonly { unit: SkipUnit; label: string }[] = [
  { unit: 'hours', label: 'hours' },
  { unit: 'days', label: 'days' },
]

/** The longest skip ahead the server takes: one game year. */
export const MAX_SKIP_TICKS = TICKS_PER_GAME_YEAR

/** The ticks a skip of `amount` game hours or days runs, or `undefined` if the server refuses it. */
export function skipTicks(amount: number, unit: SkipUnit): number | undefined {
  if (!Number.isInteger(amount) || amount < 1) return undefined
  const ticks = amount * (unit === 'hours' ? TICKS_PER_GAME_HOUR : TICKS_PER_GAME_DAY)
  return ticks <= MAX_SKIP_TICKS ? ticks : undefined
}

/** How far a skip ahead has come, 0 to 1. */
export function skipShare(skip: SkipProgress): number {
  return skip.total > 0 ? Math.min(1, skip.done / skip.total) : 1
}

/** The bar's line on a skip ahead: "Skipping ahead: 6 h 20 min of 1 day (26%)". */
export function skipLine(skip: SkipProgress): string {
  const percent = Math.floor(skipShare(skip) * 100)
  return `Skipping ahead: ${gameSpan(skip.done)} of ${gameSpan(skip.total)} (${percent}%)`
}

/** A span of game time in days, hours and minutes: "1 day 2 h", "45 min", "0 min". */
export function gameSpan(ticks: number): string {
  const days = Math.floor(ticks / TICKS_PER_GAME_DAY)
  const hours = Math.floor((ticks - days * TICKS_PER_GAME_DAY) / TICKS_PER_GAME_HOUR)
  const minutes = Math.floor(ticks - days * TICKS_PER_GAME_DAY - hours * TICKS_PER_GAME_HOUR)
  const parts = [
    days > 0 && `${days} ${days === 1 ? 'day' : 'days'}`,
    hours > 0 && `${hours} h`,
    minutes > 0 && `${minutes} min`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : '0 min'
}

/** The longest checkpoint name the server takes, in characters. */
export const CHECKPOINT_NAME_MAX = 60

/** A checkpoint's name as the server stores it (trimmed), or `undefined` if it refuses it. */
export function checkpointName(name: string): string | undefined {
  const trimmed = name.trim()
  return trimmed.length > 0 && [...trimmed].length <= CHECKPOINT_NAME_MAX ? trimmed : undefined
}
