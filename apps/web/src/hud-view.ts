import { buildingRealm } from './shared/city.js'
import type { Building, City, Good } from '@csp/shared-types'
import { agoText } from './last-seen.js'

/**
 * The groups of the sidebar's strip, in strip order (`CONTEXT.md`: Screen): the groups the tool
 * rail had.
 */
export const SIDEBAR_GROUPS = [
  { id: 'people', label: 'People' },
  { id: 'diplomacy', label: 'Diplomacy' },
  { id: 'realm', label: 'Realm' },
] as const

export type SidebarGroupId = (typeof SIDEBAR_GROUPS)[number]['id']

/**
 * The sidebar's tabs (ADR 0044), in strip order, each in its group (`CONTEXT.md`: Screen): one for
 * each drawer the tool rail had, in the same order. Scripts is a `screen`: it opens the script
 * workshop over the map instead of a panel.
 */
export const SIDE_TABS = [
  { id: 'residents', label: 'Residents', group: 'people' },
  { id: 'horses', label: 'Horses', group: 'people' },
  { id: 'armies', label: 'Armies', group: 'people' },
  { id: 'diplomacy', label: 'Diplomacy', group: 'diplomacy' },
  { id: 'cities', label: 'Cities', group: 'realm' },
  { id: 'waypoints', label: 'Waypoints', group: 'realm' },
  { id: 'scripts', label: 'Scripts', group: 'realm', screen: true },
  { id: 'realmLog', label: 'Realm log', group: 'realm' },
] as const satisfies readonly {
  id: string
  label: string
  group: SidebarGroupId
  screen?: boolean
}[]

export type SideTabEntry = (typeof SIDE_TABS)[number]

/** The strip's groups with their tabs, in strip order; the strip draws a divider between them. */
export function sidebarGroups(): { id: SidebarGroupId; label: string; tabs: SideTabEntry[] }[] {
  return SIDEBAR_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    tabs: SIDE_TABS.filter((t) => t.group === g.id),
  }))
}

export type SideTabId = (typeof SIDE_TABS)[number]['id']

/** The sidebar's open tab; undefined while it is folded to its strip. */
export type OpenTab = SideTabId | undefined

/** A tab on the strip: opens it in place of the open one, or folds the sidebar when it is open. */
export function toggleTab(open: OpenTab, clicked: SideTabId): OpenTab {
  return open === clicked ? undefined : clicked
}

/** The Diplomacy tab's own tabs, in order (`CONTEXT.md`: Tool rail). */
export const DIPLOMACY_TABS = [
  { id: 'contracts', label: 'Contracts' },
  { id: 'demands', label: 'Demands' },
  { id: 'directOffers', label: 'Direct offers' },
  { id: 'alliance', label: 'Alliance' },
  { id: 'standing', label: 'Standing' },
] as const

export type DiplomacyTab = (typeof DIPLOMACY_TABS)[number]['id']

/**
 * The sidebar: the tab open in it (none while folded), the one its fold button unfolds to, and the
 * Diplomacy tab's own tab. `last` and the Diplomacy tab stay what they were while it is folded or
 * another tab is open, so unfolding, or the Diplomacy button, comes back to them.
 */
export interface Sidebar {
  open: OpenTab
  /** The tab the fold button unfolds to: the one open last. */
  last: SideTabId
  tab: DiplomacyTab
}

/** Folded, unfolding to Residents, the Diplomacy tab on its first tab. */
export const FOLDED: Sidebar = {
  open: undefined,
  last: SIDE_TABS[0].id,
  tab: DIPLOMACY_TABS[0].id,
}

/**
 * Opens the tab, or folds the sidebar with undefined; the Diplomacy tab stays. A screen (the
 * script workshop) is never the tab the fold button unfolds to: leaving it goes back to the map.
 */
export function withOpen(sidebar: Sidebar, open: OpenTab): Sidebar {
  return { ...sidebar, open, last: open && !isScreen(open) ? open : sidebar.last }
}

/** The strip's fold button: folds the open sidebar, or unfolds it to the tab open last. */
export function foldOrUnfold(sidebar: Sidebar): Sidebar {
  return withOpen(sidebar, sidebar.open ? undefined : sidebar.last)
}

/** Opens the Diplomacy tab on its tab, as a notice's Open does, or picks the tab in it. */
export function openDiplomacy(sidebar: Sidebar, tab: DiplomacyTab): Sidebar {
  return { ...withOpen(sidebar, 'diplomacy'), tab }
}

/** Whether the Player has this Diplomacy tab in front of them: the sidebar open on it. */
export function showsTab(sidebar: Sidebar, tab: DiplomacyTab): boolean {
  return sidebar.open === 'diplomacy' && sidebar.tab === tab
}

function isTabId(id: unknown): id is SideTabId {
  return SIDE_TABS.some((t) => t.id === id)
}

/**
 * What the browser keeps of the sidebar across a reload: the tab open, null while folded, and the
 * one it unfolds to.
 */
export function sidebarToKeep(sidebar: Sidebar): string {
  return JSON.stringify({ open: sidebar.open ?? null, last: sidebar.last })
}

/**
 * The sidebar as the browser kept it (`sidebarToKeep`), folded when it kept nothing or nonsense.
 * On a phone it starts folded all the same: there a tab covers the whole map.
 */
export function rememberedSidebar(kept: string | null, phone = false): Sidebar {
  let parsed: unknown = null
  try {
    if (kept !== null) parsed = JSON.parse(kept)
  } catch {
    // Nonsense kept: folded, as with nothing.
  }
  if (typeof parsed !== 'object' || parsed === null) return FOLDED
  const { open, last } = parsed as { open?: unknown; last?: unknown }
  const unfoldsTo = isTabId(last) && !isScreen(last) ? last : FOLDED.last
  return withOpen({ ...FOLDED, last: unfoldsTo }, isTabId(open) && !phone ? open : undefined)
}

/**
 * Whether the tab is a screen of its own over the map (`CONTEXT.md`: Screen) rather than a panel
 * in the sidebar: Scripts, the script workshop. The map and the command bar are hidden behind it.
 */
export function isScreen(id: SideTabId): boolean {
  return SIDE_TABS.some((t) => t.id === id && 'screen' in t && t.screen)
}

/** The least map, in pixels, the open sidebar and the card must leave between them for a place. */
export const MIN_OPEN_MAP = 160

/**
 * Where to show a place on the map while the sidebar covers `left` pixels of it and the card
 * `right`: in the map left between them; with the sidebar folded to its strip (`strip` pixels)
 * when they leave too little; on the whole screen when even the card alone does.
 */
export function showBeside(
  mapWidth: number,
  left: number,
  right: number,
  strip = 0,
): { left: number; right: number; closeDrawer: boolean } {
  if (mapWidth - left - right >= MIN_OPEN_MAP) return { left, right, closeDrawer: false }
  const closeDrawer = left > strip
  if (mapWidth - strip - right >= MIN_OPEN_MAP) return { left: strip, right, closeDrawer }
  return { left: 0, right: 0, closeDrawer }
}

/** The goods the top bar shows, in this order (`CONTEXT.md`: Goods in the top bar). */
export const KEY_GOODS = [
  'food',
  'wood',
  'stone',
  'coal',
  'steel',
  'coins',
] as const satisfies readonly Good[]
export type KeyGood = (typeof KEY_GOODS)[number]

/** What the top bar's goods are for: one city of the realm by id, or null for the entire realm. */
export type GoodsPick = string | null

/** What the picker beside the goods offers: the realm's cities the Player knows, by name. */
export function goodsPickCities<C extends Pick<City, 'id' | 'name' | 'realmId'>>(
  known: readonly C[],
  realmId: string,
): C[] {
  return known.filter((c) => c.realmId === realmId).sort((a, b) => a.name.localeCompare(b.name))
}

/** What to show for a picked city: a city no longer the realm's goes back to the entire realm. */
export function goodsPickOf(picked: GoodsPick, cities: readonly Pick<City, 'id'>[]): GoodsPick {
  return cities.some((c) => c.id === picked) ? picked : null
}

/**
 * What the goods shown are, for those who can't see the picker (the aria-label), and how old they
 * are when any of them is (`goodsOldText`).
 */
export function goodsLabel(
  pick: GoodsPick,
  cities: readonly Pick<City, 'id' | 'name'>[],
  oldText: string | null = null,
): string {
  const city = cities.find((c) => c.id === pick)
  const shown = city ? `Goods in ${city.name}` : 'Goods in the entire realm'
  return oldText ? `${shown}. ${oldText}` : shown
}

/** What the top bar's goods add up to (`CONTEXT.md`: Goods in the top bar). */
export interface GoodsHeld {
  totals: Record<KeyGood, number>
  /** The storages counted as last seen: when the oldest was seen, and whether they are all of them. */
  old: { oldestSeenAt: number; all: boolean } | null
}

/**
 * How much of each key good the finished storages and warehouses hold together: those of the picked
 * city, or with no pick every one of the realm, outpost storages included. One in sight counts as it
 * is now, one out of sight with what the Player last saw in it. A stable's storage is left out: its
 * Food is for its horses. `cities` are those the Player knows, in sight or last seen, so a city seen
 * to be someone else's takes its remembered storages with it.
 */
export function keyGoods(
  world: {
    buildings: readonly Building[]
    lastSeen: readonly (Building & { seenAt: number })[]
    cities: readonly Pick<City, 'id' | 'realmId'>[]
  },
  realmId: string,
  pick: GoodsPick,
): GoodsHeld {
  const totals = { food: 0, wood: 0, stone: 0, coal: 0, steel: 0, coins: 0 }
  const counts = (b: Building) =>
    !b.site &&
    (b.kind === 'storage' || b.kind === 'warehouse') &&
    (pick === null ? buildingRealm(world, b) === realmId : b.cityId === pick)
  const add = (b: Building) => {
    for (const good of KEY_GOODS) totals[good] += b.stock?.[good] ?? 0
  }
  const inSight = new Set<string>()
  let anyInSight = false
  for (const b of world.buildings) {
    inSight.add(b.id)
    if (!counts(b)) continue
    anyInSight = true
    add(b)
  }
  let oldestSeenAt: number | null = null
  for (const b of world.lastSeen) {
    if (inSight.has(b.id) || !counts(b)) continue
    add(b)
    oldestSeenAt = oldestSeenAt === null ? b.seenAt : Math.min(oldestSeenAt, b.seenAt)
  }
  return { totals, old: oldestSeenAt === null ? null : { oldestSeenAt, all: !anyInSight } }
}

/** The goods' age in words, for the marker's tooltip and the aria-label; null when all is in sight. */
export function goodsOldText(old: GoodsHeld['old'], tick: number): string | null {
  if (!old) return null
  const part = old.all ? 'All' : 'Part'
  return `${part} of this is as last seen, the oldest ${agoText(tick - old.oldestSeenAt)}`
}

const GOODS_PICK_KEY = 'csp.goodsPick'

/** The pick this browser remembers; the entire realm when it has none. */
export function rememberedGoodsPick(
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): GoodsPick {
  try {
    return storage().getItem(GOODS_PICK_KEY)
  } catch {
    // Storage can be off (a private window); the top bar then just shows the entire realm.
    return null
  }
}

/** Remembers the pick in this browser, if it lets us. */
export function rememberGoodsPick(
  pick: GoodsPick,
  storage: () => Pick<Storage, 'setItem' | 'removeItem'> = () => localStorage,
): void {
  try {
    if (pick === null) storage().removeItem(GOODS_PICK_KEY)
    else storage().setItem(GOODS_PICK_KEY, pick)
  } catch {
    // Not remembered, which only costs a click next time.
  }
}

/** How wide (px) the Player can drag the sidebar's panel. */
export const SIDE_WIDTH = { min: 280, max: 640, initial: 380 } as const

/** A panel width the Player dragged to or the browser remembered, kept within the limits. */
export function sideWidth(wanted: number): number {
  if (!Number.isFinite(wanted)) return SIDE_WIDTH.initial
  return Math.round(Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, wanted)))
}

/** The width the browser remembered, or the initial one when it has none (or nonsense). */
export function rememberedSideWidth(stored: string | null): number {
  return stored === null ? SIDE_WIDTH.initial : sideWidth(Number.parseFloat(stored))
}
