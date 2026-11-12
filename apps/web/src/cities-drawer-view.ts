import type { Building, City, RealmLabel, Resident } from '@csp/shared-types'
import { describeCity, describeOccupation, type OccupationView } from './city-view.js'
import type { GoodsItem } from './goods-grid.js'
import { KEY_GOODS, keyGoods } from './hud-view.js'
import { agoText } from './last-seen.js'
import { FAR_SCALE } from './map/camera.js'
import { cityRelationship, type Viewer } from './map/tokens.js'
import { housingRoom } from './shared/city.js'
import type { Relationship } from './theme.js'

/** The Cities drawer's lists, in this order (`CONTEXT.md`: Cities drawer). */
export const CITY_LISTS = [
  { id: 'own', title: 'Your cities' },
  { id: 'inSight', title: 'Others in sight' },
  { id: 'lastSeen', title: 'Last seen' },
] as const
export type CityListId = (typeof CITY_LISTS)[number]['id']

/**
 * A city's row in the Cities drawer: its name, and whose it is in that relation's colour; for the
 * Player's own cities residents against housing and the key goods in its storages, for one last
 * seen how long ago. An occupation stays on the row.
 */
export interface CityRow {
  id: string
  name: string
  whose: string
  rel: Relationship
  /** The Player's own cities: residents who live there against its housing. */
  housing?: { residents: number; room: number }
  /** The Player's own cities: the key goods in its storages, as the icon grid shows them. */
  goods?: GoodsItem[]
  /** A city last seen: how long ago, "3 days ago". */
  ago?: string
  occupation?: OccupationView
}

/** The relation colour a city's row takes (`relationshipClass`), as its map emblem does. */
function rowRelationship(city: Pick<City, 'realmId' | 'tradeOrg'>, viewer: Viewer): Relationship {
  const rel = cityRelationship(city, viewer)
  if (rel === 'own' || rel === 'alliance') return rel
  if (rel === 'npc') return 'npcCity'
  if (rel === 'trade') return 'tradeOrg'
  return 'otherRealm'
}

/** What the drawer knows: cities and buildings in sight and those last seen, residents in sight. */
export interface CitiesKnown {
  cities: readonly City[]
  buildings: readonly Building[]
  residents: readonly Pick<Resident, 'cityId'>[]
  lastSeen: {
    cities: readonly (City & { seenAt: number })[]
    buildings: readonly (Building & { seenAt: number })[]
  }
}

/**
 * The Cities drawer's lists (`CONTEXT.md`: Cities drawer): the Player's own cities in sight, the
 * others in sight and those last seen, each by name. A list with no cities is left out.
 */
export function cityLists(
  known: CitiesKnown,
  viewer: Viewer,
  realms: RealmLabel[],
  tick: number,
): { id: CityListId; title: string; rows: CityRow[] }[] {
  const realmId = viewer.realmId
  const row = (city: City): CityRow => ({
    id: city.id,
    name: city.name,
    whose: describeCity(city, { residents: [], buildings: [] }, realmId, realms).whose,
    rel: rowRelationship(city, viewer),
  })
  const goodsWorld = {
    buildings: known.buildings,
    lastSeen: known.lastSeen.buildings,
    cities: [...known.cities, ...known.lastSeen.cities],
  }
  const lists: Record<CityListId, CityRow[]> = { own: [], inSight: [], lastSeen: [] }
  for (const city of known.cities) {
    const occupation = describeOccupation(city, tick, realmId, realms)
    const base = { ...row(city), ...(occupation ? { occupation } : {}) }
    if (city.realmId !== realmId) {
      lists.inSight.push(base)
      continue
    }
    const totals = keyGoods(goodsWorld, realmId, city.id).totals
    lists.own.push({
      ...base,
      housing: {
        residents: known.residents.filter((r) => r.cityId === city.id).length,
        room: housingRoom(known, city),
      },
      goods: KEY_GOODS.map((good) => ({ good, amount: totals[good] })),
    })
  }
  for (const city of known.lastSeen.cities)
    lists.lastSeen.push({
      ...row(city),
      ago: agoText(tick - city.seenAt),
    })
  const byName = (a: CityRow, b: CityRow) => a.name.localeCompare(b.name)
  return CITY_LISTS.map((l) => ({ ...l, rows: lists[l.id].sort(byName) })).filter(
    (l) => l.rows.length > 0,
  )
}

/**
 * Where the map centres for a city opened in the Cities drawer (`CONTEXT.md`: Cities drawer): its
 * town hall, in sight or as last seen. Undefined while the Player knows no town hall for it.
 */
export function cityPlace(
  cityId: string,
  cities: readonly Pick<City, 'id' | 'townHallId'>[],
  buildings: readonly Pick<Building, 'id' | 'x' | 'y'>[],
): { x: number; y: number } | undefined {
  const city = cities.find((c) => c.id === cityId)
  const hall = city && buildings.find((b) => b.id === city.townHallId)
  return hall && { x: hall.x, y: hall.y }
}

/**
 * The closest zoom a city opened in the Cities drawer shows at: just inside the far tier, where a
 * city's area is outlined as picking it on the map does (ADR 0008). Further out stays as it is.
 */
export const CITY_SCALE = FAR_SCALE - 1

/** The zoom to show an opened city at, from the map's zoom now. */
export function cityScale(scale: number): number {
  return Math.min(scale, CITY_SCALE)
}
