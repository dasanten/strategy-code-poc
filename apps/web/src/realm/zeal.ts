import { TICK_MS, TICKS_PER_GAME_HOUR, ZEAL_CAP_HOURS, ZEAL_FILL_TICKS } from '@csp/balance'
import type { Building, ResidentOrder } from '@csp/shared-types'
import { WORKPLACE_SKILL } from '../world/narrowed.js'

/** What the top bar's Zeal meter shows (`CONTEXT.md`: Zeal). */
export interface ZealShown {
  /** How full the pool is, 0 to 1. */
  share: number
  /** The meter's words: "Zeal 75%". */
  label: string
  /** Its tooltip: what Zeal is and about how long until full. */
  title: string
  /** Draining while the Player's crew is rallied. */
  draining?: true
}

/** About how long until a pool holding `zeal` game hours is full, in real time. */
export function untilFull(zeal: number): string {
  const ticks = ((ZEAL_CAP_HOURS - zeal) * ZEAL_FILL_TICKS) / ZEAL_CAP_HOURS
  const minutes = Math.ceil((ticks * TICK_MS) / 60_000)
  if (minutes <= 1) return 'within a minute'
  if (minutes < 60) return `in about ${minutes} min`
  const hours = Math.round((minutes / 60) * 2) / 2
  return `in about ${hours} h`
}

/** About how long a pool holding `zeal` game hours lasts while a crew is rallied, in real time. */
export function zealLasts(zeal: number): string {
  // It drains a game hour an hour and doesn't fill while the rally runs (Daniel, 2026-11-20).
  const perTick = 1 / TICKS_PER_GAME_HOUR
  const minutes = Math.ceil((Math.max(0, zeal) / perTick) * (TICK_MS / 60_000))
  if (minutes <= 1) return 'under a minute'
  return minutes < 60 ? `about ${minutes} min` : `about ${Math.round((minutes / 60) * 2) / 2} h`
}

/**
 * The meter for a pool holding `zeal` game hours of rallying (`CONTEXT.md`: Zeal); `draining`
 * while the Player's Leader rallies the crew, when it doesn't fill.
 */
export function zealShown(zeal: number, draining = false): ZealShown {
  const share = Math.min(1, Math.max(0, zeal / ZEAL_CAP_HOURS))
  const full = share >= 1
  const about = `Zeal fills in real time, online or not; a full pool rallies a crew for ${ZEAL_CAP_HOURS} game hours.`
  const percent = `Zeal ${Math.floor(share * 100)}%`
  if (draining)
    return {
      share,
      label: `${percent} ↓`,
      title: `Zeal: not filling while your Leader rallies the crew; lasts ${zealLasts(zeal)} while the crew works. ${about}`,
      draining: true,
    }
  return {
    share,
    label: percent,
    title: full ? `Zeal: full. ${about}` : `Zeal: full ${untilFull(zeal)}. ${about}`,
  }
}

/** Whether the Leader can rally the crew at `b`: a construction site, one being torn down, or a standing workplace. */
export function ralliesAt(
  b: Pick<Building, 'kind' | 'site' | 'teardown' | 'ruinedAt'> | undefined,
): boolean {
  if (!b) return false
  return (
    !!b.site || b.teardown !== undefined || (!!WORKPLACE_SKILL[b.kind] && b.ruinedAt === undefined)
  )
}

/** Why the Player's Leader standing at `building` can't rally the crew now, if they can't (ADR 0019). */
const NOT_AT_A_RALLY_PLACE = 'not at a workplace or construction site'
const NO_ZEAL_LEFT = 'no Zeal left'
const ALREADY_RALLYING = 'already rallying the crew here'

/** Why the Leader, standing at `building` with `order`, can't rally the crew now, if they can't. */
export function rallyProblem(
  building: Pick<Building, 'id' | 'kind' | 'site' | 'teardown' | 'ruinedAt'> | undefined,
  zeal: number,
  order: ResidentOrder | null | undefined,
): string | undefined {
  if (!building || !ralliesAt(building)) return NOT_AT_A_RALLY_PLACE
  if (order?.kind === 'rally' && order.buildingId === building.id) return ALREADY_RALLYING
  if (zeal <= 0) return NO_ZEAL_LEFT
  return undefined
}
