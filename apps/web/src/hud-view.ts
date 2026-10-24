import type { Building, Good } from '@csp/shared'

/**
 * The drawers the tool rail opens over the map (ADR 0008), in rail order. Cities holds the city
 * inspector until selecting a city shows it on the selection card.
 */
export const DRAWERS = [
  { id: 'residents', label: 'Residents' },
  { id: 'armies', label: 'Armies' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'alliance', label: 'Alliance' },
  { id: 'standing', label: 'Standing' },
  { id: 'cities', label: 'Cities' },
  { id: 'scripts', label: 'Scripts', wide: true },
  { id: 'realmLog', label: 'Realm log' },
] as const satisfies readonly { id: string; label: string; wide?: boolean }[]

export type DrawerId = (typeof DRAWERS)[number]['id']

/** At most one drawer is open; none shows the whole map. */
export type OpenDrawer = DrawerId | undefined

/** A rail button: opens its drawer in place of the open one, or closes it when it is open. */
export function toggleDrawer(open: OpenDrawer, clicked: DrawerId): OpenDrawer {
  return open === clicked ? undefined : clicked
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

/** The goods the top bar shows for the home city, in this order. */
export const KEY_GOODS = ['food', 'wood', 'stone', 'coins'] as const satisfies readonly Good[]
export type KeyGood = (typeof KEY_GOODS)[number]

/**
 * How much of each key good the city's finished storages and warehouses in sight hold together.
 * A stable's storage is left out: its Food is for its horses.
 */
export function keyGoods(
  buildings: readonly Building[],
  cityId: string | null | undefined,
): Record<KeyGood, number> {
  const totals = { food: 0, wood: 0, stone: 0, coins: 0 }
  if (!cityId) return totals
  for (const b of buildings) {
    if (b.cityId !== cityId || b.site || (b.kind !== 'storage' && b.kind !== 'warehouse')) continue
    for (const good of KEY_GOODS) totals[good] += b.stock?.[good] ?? 0
  }
  return totals
}
