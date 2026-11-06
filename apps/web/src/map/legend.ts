import { TICKS_PER_GAME_DAY, type RealmEvent } from '@csp/shared'
import type { ZoomTier } from './camera.js'

/*
 * The map's legend and readout (ADR 0008): the legend folds to a button, remembered per browser,
 * and opens by itself only on a new realm; the readout says what the pointer is over.
 */

/** How long after its starting city was founded a realm counts as new, in ticks. */
export const NEW_REALM_TICKS = TICKS_PER_GAME_DAY

/** Whether the Player's realm is new: its starting city was founded within `NEW_REALM_TICKS`. */
export function isNewRealm(events: readonly RealmEvent[], tick: number): boolean {
  const founded = events.findLast((e) => e.kind === 'founded')
  return founded !== undefined && tick - founded.tick < NEW_REALM_TICKS
}

/** Where the browser remembers the legend: the realm it was left for, and whether open. */
const LEGEND_KEY = 'csp.legendOpen'

/**
 * Whether the legend starts open: as the Player left it in this browser for this realm, else
 * only when the realm is new.
 */
export function legendOpenAtStart(
  realmId: string,
  newRealm: boolean,
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): boolean {
  try {
    const [realm, open] = (storage().getItem(LEGEND_KEY) ?? '').split(' ')
    if (realm === realmId && (open === '1' || open === '0')) return open === '1'
  } catch {
    // Storage can be off (a private window); then it starts as in a fresh browser.
  }
  return newRealm
}

export function rememberLegendOpen(
  realmId: string,
  open: boolean,
  storage: () => Pick<Storage, 'setItem'> = () => localStorage,
): void {
  try {
    storage().setItem(LEGEND_KEY, `${realmId} ${open ? '1' : '0'}`)
  } catch {
    // Not remembered, which only costs a click next time.
  }
}

/** What the pointer is over, for the readout. */
export interface Hover {
  x: number
  y: number
  terrain: string
  node?: string
  /** Who holds the tile on the Region map, when it is explored. */
  holder?: string
  /** A Trade Org caravan stands there (`CONTEXT.md`: Caravan). */
  caravan?: boolean
  /** A wandering trader stands there (`CONTEXT.md`: Wandering trader). */
  trader?: boolean
}

/**
 * The readout: the terrain and coordinates under the pointer, what else is there, and the zoom
 * tier's name. Who holds the tile only while territory shows.
 */
export function readoutText(hover: Hover | null, tier: ZoomTier, territory: boolean): string {
  if (!hover) return `${tier} zoom`
  return [
    hover.terrain,
    `${hover.x}, ${hover.y}`,
    hover.node,
    hover.caravan ? 'Trade Org caravan' : undefined,
    hover.trader ? 'Wandering trader' : undefined,
    territory ? hover.holder : undefined,
    `${tier} zoom`,
  ]
    .filter((p) => p !== undefined)
    .join(' · ')
}
