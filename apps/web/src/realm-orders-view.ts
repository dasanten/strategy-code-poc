import { GOODS } from './world.js'
import { covers } from './footprint.js'
import { relocateRoom } from './relocate.js'
import type {
  Building,
  Carriage,
  Good,
  SeenVessel,
  StartParamValues,
  Stock,
  Waypoint,
} from '@csp/shared-types'
import { BUILDING_NAMES } from './map/palette.js'
import type { Place } from './group-orders.js'
import type { RelocateChoice, RelocateSeen } from './relocate-view.js'
import type { WhoAt } from './who-list-view.js'

/**
 * The realm orders about places and goods (`CONTEXT.md`: Realm order): what the realm bar's
 * Walk to, Explore, Run script and Relocate and a tile's or storage's card need to reach the
 * who-list. Only the UI (ADR 0041).
 */

/** A place to store at or fetch from, where it is and what it holds. */
export interface StorePlace extends Place {
  x: number
  y: number
  holds: Stock
}

/** What finding a place to store at or fetch from looks at. */
export interface StoreSeen {
  buildings: readonly Pick<Building, 'id' | 'kind' | 'x' | 'y' | 'site' | 'stock'>[]
  vessels: readonly Pick<SeenVessel, 'id' | 'kind' | 'realmId' | 'x' | 'y' | 'load'>[]
  carriages: readonly (Pick<Carriage, 'id' | 'realmId' | 'x' | 'y'> & { load?: Stock })[]
}

/**
 * The place on a tile to store at or fetch from (`CONTEXT.md`: Storage): a finished storage,
 * stable or haven, else one of the realm's boats (loaded from beside it, `CONTEXT.md`: Beside a
 * vessel), else one of its carriages; with what it holds, as far as the Player sees it.
 */
export function storePlaceAt(
  seen: StoreSeen,
  realmId: string,
  x: number,
  y: number,
): StorePlace | undefined {
  const b = seen.buildings.find(
    (s) => ['storage', 'stable', 'haven'].includes(s.kind) && !s.site && covers(s, x, y),
  )
  if (b) return { id: b.id, name: BUILDING_NAMES[b.kind].toLowerCase(), x, y, holds: b.stock ?? {} }
  const v = seen.vessels.find(
    (s) => s.kind === 'boat' && s.realmId === realmId && s.x === x && s.y === y,
  )
  if (v) return { id: v.id, name: 'boat', x, y, holds: v.load ?? {} }
  const k = seen.carriages.find((c) => c.realmId === realmId && c.x === x && c.y === y)
  return k && { id: k.id, name: 'carriage', x, y, holds: k.load ?? {} }
}

/** The goods a place holds, at least one unit of each, to pick one to fetch. */
export function heldGoods(holds: Stock): Good[] {
  return GOODS.filter((g) => (holds[g] ?? 0) > 0)
}

/** A realm order a tile's card starts in realm control mode. */
export interface RealmTileOrder {
  id: 'walkHere' | 'buildHere' | 'storeHere' | 'fetchFrom'
  label: string
  /** Why it can't be given, greyed out; the row keeps its slot (ADR 0019). */
  reason?: string
}

/**
 * The realm orders a tile's card starts (`CONTEXT.md`: Realm order): Walk here on any tile,
 * Build here on one with no building, Store here and Fetch from here at a place to store at
 * (`storePlaceAt`), Fetch greyed while it holds nothing.
 */
export function realmTileOrders(tile: {
  building: boolean
  place: StorePlace | undefined
}): RealmTileOrder[] {
  const orders: RealmTileOrder[] = [{ id: 'walkHere', label: 'Walk here…' }]
  if (!tile.building) orders.push({ id: 'buildHere', label: 'Build here…' })
  if (tile.place) {
    orders.push({ id: 'storeHere', label: 'Store here…' })
    orders.push({
      id: 'fetchFrom',
      label: 'Fetch from here…',
      ...(heldGoods(tile.place.holds).length === 0 ? { reason: 'it holds nothing' } : {}),
    })
  }
  return orders
}

/** What finding the realm's town hall looks at. */
export interface HallSeen {
  cities: readonly { id: string; name: string; townHallId?: string | null }[]
  buildings: readonly Pick<Building, 'id' | 'x' | 'y'>[]
}

/**
 * Where the who-list measures from for an order with no target tile (Explore, Run script
 * without a place): the town hall of the realm's home city, which it says it sorts by
 * (`CONTEXT.md`: Who-list). Undefined while its town hall isn't known.
 */
export function townHallAt(seen: HallSeen, cityId: string): WhoAt | undefined {
  const city = seen.cities.find((c) => c.id === cityId)
  const hall = city?.townHallId && seen.buildings.find((b) => b.id === city.townHallId)
  return hall ? { x: hall.x, y: hall.y, near: 'the town hall' } : undefined
}

/**
 * Where the who-list measures from for Relocate: the town hall of the city they move to, which
 * they walk into (`CONTEXT.md`: Relocate). Undefined while it isn't known.
 */
export function relocateAt(seen: HallSeen, cityId: string): WhoAt | undefined {
  const city = seen.cities.find((c) => c.id === cityId)
  const at = townHallAt(seen, cityId)
  return city && at ? { x: at.x, y: at.y, near: `the town hall of ${city.name}` } : undefined
}

/** What naming a picked param's place looks at. */
export interface ParamPlaceSeen {
  buildings: readonly Pick<Building, 'id' | 'kind' | 'x' | 'y'>[]
  carriages: readonly Pick<Carriage, 'id' | 'x' | 'y'>[]
  waypoints: readonly Waypoint[]
}

/**
 * Where a script started with these values acts, for Run script's who-list: the first building,
 * carriage or waypoint picked for one of its params (`CONTEXT.md`: Script parameter), named as
 * the list sorts by it; undefined when none was picked, and then it sorts by the town hall.
 */
export function paramsPlace(
  values: StartParamValues | undefined,
  seen: ParamPlaceSeen,
): WhoAt | undefined {
  for (const value of Object.values(values ?? {})) {
    if (typeof value !== 'string') continue
    const b = seen.buildings.find((x) => x.id === value)
    if (b) return { x: b.x, y: b.y, near: `the ${BUILDING_NAMES[b.kind].toLowerCase()}` }
    const k = seen.carriages.find((x) => x.id === value)
    if (k) return { x: k.x, y: k.y, near: 'the carriage' }
    const w = seen.waypoints.find((x) => x.id === value)
    if (w) return { x: w.x, y: w.y, near: w.name }
  }
  return undefined
}

/**
 * The realm's cities to relocate to from the realm bar (`CONTEXT.md`: Relocate), by name, each
 * with its free housing; who moves is picked after, so none is refused yet. With only one city
 * there is nowhere to move to.
 */
export function realmRelocateChoices(seen: RelocateSeen, realmId: string): RelocateChoice[] {
  const cities = seen.cities.filter((c) => c.realmId === realmId)
  if (cities.length < 2) return []
  return [...cities]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, room: Math.max(0, relocateRoom(seen, c, new Set())) }))
}
