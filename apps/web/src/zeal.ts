import { TICK_MS, ZEAL_CAP_HOURS, ZEAL_FILL_TICKS } from '@csp/balance'

/** What the top bar's Zeal meter shows (`CONTEXT.md`: Zeal). */
export interface ZealShown {
  /** How full the pool is, 0 to 1. */
  share: number
  /** The meter's words: "Zeal 75%". */
  label: string
  /** Its tooltip: what Zeal is and about how long until full. */
  title: string
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

/** The meter for a pool holding `zeal` game hours of rallying (`CONTEXT.md`: Zeal). */
export function zealShown(zeal: number): ZealShown {
  const share = Math.min(1, Math.max(0, zeal / ZEAL_CAP_HOURS))
  const full = share >= 1
  const about = `Zeal fills in real time, online or not; a full pool rallies a crew for ${ZEAL_CAP_HOURS} game hours.`
  return {
    share,
    label: `Zeal ${Math.floor(share * 100)}%`,
    title: full ? `Zeal: full. ${about}` : `Zeal: full ${untilFull(zeal)}. ${about}`,
  }
}
