import { buildingRealm } from './shared/city.js'
import type { Building, City, Good } from '@csp/shared-types'
import { agoText } from './last-seen.js'

/** The groups of the tool rail, in rail order (`CONTEXT.md`: Tool rail). */
export const RAIL_GROUPS = [
  { id: 'people', label: 'People' },
  { id: 'diplomacy', label: 'Diplomacy' },
  { id: 'realm', label: 'Realm' },
] as const

export type RailGroupId = (typeof RAIL_GROUPS)[number]['id']

/**
 * The drawers the tool rail opens over the map (ADR 0008), in rail order, each in its group
 * (`CONTEXT.md`: Tool rail). Cities holds the city inspector until selecting a city shows it on the
 * selection card.
 */
export const DRAWERS = [
  { id: 'residents', label: 'Residents', group: 'people' },
  { id: 'horses', label: 'Horses', group: 'people' },
  { id: 'armies', label: 'Armies', group: 'people' },
  { id: 'diplomacy', label: 'Diplomacy', group: 'diplomacy' },
  { id: 'cities', label: 'Cities', group: 'realm' },
  { id: 'waypoints', label: 'Waypoints', group: 'realm' },
  { id: 'scripts', label: 'Scripts', group: 'realm', wide: true },
  { id: 'realmLog', label: 'Realm log', group: 'realm' },
] as const satisfies readonly { id: string; label: string; group: RailGroupId; wide?: boolean }[]

export type Drawer = (typeof DRAWERS)[number]

/** The rail's groups with their drawers, both in rail order; the rail draws a divider between them. */
export function railGroups(): { id: RailGroupId; label: string; drawers: Drawer[] }[] {
  return RAIL_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    drawers: DRAWERS.filter((d) => d.group === g.id),
  }))
}

export type DrawerId = (typeof DRAWERS)[number]['id']

/** At most one drawer is open; none shows the whole map. */
export type OpenDrawer = DrawerId | undefined

/** A rail button: opens its drawer in place of the open one, or closes it when it is open. */
export function toggleDrawer(open: OpenDrawer, clicked: DrawerId): OpenDrawer {
  return open === clicked ? undefined : clicked
}

/** The tabs of the Diplomacy drawer, in order (`CONTEXT.md`: Tool rail). */
export const DIPLOMACY_TABS = [
  { id: 'contracts', label: 'Contracts' },
  { id: 'demands', label: 'Demands' },
  { id: 'directOffers', label: 'Direct offers' },
  { id: 'alliance', label: 'Alliance' },
  { id: 'standing', label: 'Standing' },
] as const

export type DiplomacyTab = (typeof DIPLOMACY_TABS)[number]['id']

/**
 * The drawer open over the map, and the Diplomacy drawer's tab. The tab stays what it was while
 * the drawer is closed or another one is open, so the Diplomacy button reopens it there.
 */
export interface Drawers {
  open: OpenDrawer
  tab: DiplomacyTab
}

/** No drawer open, the Diplomacy drawer on its first tab. */
export const NO_DRAWER: Drawers = { open: undefined, tab: DIPLOMACY_TABS[0].id }

/** Opens the drawer, or closes them all with undefined; the Diplomacy tab stays. */
export function withOpen(drawers: Drawers, open: OpenDrawer): Drawers {
  return { ...drawers, open }
}

/** Opens the Diplomacy drawer on the tab, as a notice's Open does, or picks the tab in it. */
export function openDiplomacy(tab: DiplomacyTab): Drawers {
  return { open: 'diplomacy', tab }
}

/** Whether the Player has this Diplomacy tab in front of them: its drawer open and on it. */
export function showsTab(drawers: Drawers, tab: DiplomacyTab): boolean {
  return drawers.open === 'diplomacy' && drawers.tab === tab
}

/** Whether the drawer is a wide one (the script editor needs the room). */
export function isWide(id: DrawerId): boolean {
  return DRAWERS.some((d) => d.id === id && 'wide' in d && d.wide)
}

/** The least map, in pixels, the open drawer and card must leave between them to show a place. */
export const MIN_OPEN_MAP = 160

/**
 * Where to show a place on the map while an open drawer covers `left` pixels of it and the
 * selection card `right`: in the map left between them; with the drawer closed when they leave
 * too little; on the whole screen when even the card alone does.
 */
export function showBeside(
  mapWidth: number,
  left: number,
  right: number,
): { left: number; right: number; closeDrawer: boolean } {
  if (mapWidth - left - right >= MIN_OPEN_MAP) return { left, right, closeDrawer: false }
  const closeDrawer = left > 0
  if (mapWidth - right >= MIN_OPEN_MAP) return { left: 0, right, closeDrawer }
  return { left: 0, right: 0, closeDrawer }
}

/** The goods the top bar shows, in this order (`CONTEXT.md`: Goods in the top bar). */
export const KEY_GOODS = ['food', 'wood', 'stone', 'coins'] as const satisfies readonly Good[]
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
  const totals = { food: 0, wood: 0, stone: 0, coins: 0 }
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

/** How wide, in pixels, the Player can drag a drawer (the wide script drawer keeps its own). */
export const DRAWER_WIDTH = { min: 280, max: 640, initial: 380 } as const

/** A drawer width the Player dragged to or the browser remembered, kept within the limits. */
export function drawerWidth(wanted: number): number {
  if (!Number.isFinite(wanted)) return DRAWER_WIDTH.initial
  return Math.round(Math.min(DRAWER_WIDTH.max, Math.max(DRAWER_WIDTH.min, wanted)))
}

/** The width the browser remembered, or the initial one when it has none (or nonsense). */
export function rememberedDrawerWidth(stored: string | null): number {
  return stored === null ? DRAWER_WIDTH.initial : drawerWidth(Number.parseFloat(stored))
}
