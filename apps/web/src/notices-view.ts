import { FIRST_DAY_LINES, type FirstDay, type FirstDayLine } from '@csp/shared'
import { isWide, type OpenDrawer } from './hud-view.js'

/**
 * The notices that share the lane under the top bar (`CONTEXT.md`: Notices), besides the pick
 * banner, in the order they stack. Lasting ones come first and passing ones after, so a notice
 * that comes and goes never moves a button the Player is aiming at.
 */
export const NOTICE_ORDER = ['horseOffer', 'firstDay', 'groupReport'] as const

/** A notice in the lane: the pick banner or one of `NOTICE_ORDER`. */
export type NoticeKind = 'pick' | (typeof NOTICE_ORDER)[number]

/**
 * What the lane shows, top to bottom, of the notices that want to show: the pick banner alone
 * while it shows (the others come back after), otherwise the rest in `NOTICE_ORDER`.
 */
export function laneNotices(wanted: Partial<Record<NoticeKind, boolean>>): NoticeKind[] {
  if (wanted.pick) return ['pick']
  return NOTICE_ORDER.filter((kind) => wanted[kind])
}

/**
 * Whether the selection card is hidden: the wide Scripts drawer leaves no room for it. It stays
 * as it was, and closing the drawer brings it back.
 */
export function cardHidden(open: OpenDrawer): boolean {
  return open !== undefined && isWide(open)
}

/** The least width, in pixels, the lane needs over the map between the drawer and the card. */
export const MIN_LANE_WIDTH = 320

/** The gap, in pixels, between the lane and the drawer, the card or the screen's edge. */
export const LANE_GAP = 12

/**
 * Where the lane goes, in pixels from the screen's left and right edges, while the tool rail
 * takes `rail` pixels on the left, the open drawer covers the map up to `covered.left` and the
 * card from `covered.right`: centred over the map between them. When that leaves less than
 * `MIN_LANE_WIDTH`, and always on a phone (where drawers take the whole screen), the lane is a
 * band across the screen under the top bar instead, and the drawer and card move down below it.
 */
export function laneSpot(
  screenWidth: number,
  rail: number,
  covered: { left: number; right: number },
  phone: boolean,
): { left: number; right: number; band: boolean } {
  const left = Math.max(rail, covered.left) + LANE_GAP
  const right = covered.right + LANE_GAP
  if (!phone && screenWidth - left - right >= MIN_LANE_WIDTH) return { left, right, band: false }
  return { left: rail + LANE_GAP, right: LANE_GAP, band: true }
}

/**
 * Who a group order's report says was skipped, one entry per reason in the order they first come
 * up, so eight residents not riding read as one line rather than eight.
 */
export function skippedByWhy(skipped: readonly { name: string; why: string }[]): {
  names: string[]
  why: string
}[] {
  const byWhy = new Map<string, string[]>()
  for (const s of skipped) byWhy.set(s.why, [...(byWhy.get(s.why) ?? []), s.name])
  return [...byWhy].map(([why, names]) => ({ names, why }))
}

/** What each line of the first-day card says (`CONTEXT.md`: First day). */
export const FIRST_DAY_LABELS: Record<FirstDayLine, string> = {
  claimHorses: 'Claim the Horse offer',
  pickResident: 'Pick a resident',
  giveOrder: 'Give them an order',
  openWiki: 'Open the Wiki',
}

/**
 * The first-day card's lines in its order, each ticked or not, and the first one not ticked yet,
 * which a phone shows alone.
 */
export function firstDayView(card: FirstDay): {
  lines: { line: FirstDayLine; label: string; done: boolean }[]
  next: FirstDayLine | undefined
  ticked: number
} {
  const lines = FIRST_DAY_LINES.map((line) => ({
    line,
    label: FIRST_DAY_LABELS[line],
    done: card.done.includes(line),
  }))
  return {
    lines,
    next: lines.find((l) => !l.done)?.line,
    ticked: lines.filter((l) => l.done).length,
  }
}
