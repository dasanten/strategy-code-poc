import { cityMembership, type Building, type Carriage, type City, type Resident } from '@csp/shared'
import { tileToScreen, type Camera, type Size } from './camera.js'
import { cityRelationship, type Relationship, type Viewer } from './tokens.js'

/**
 * What the far zoom tier shows (ADR 0008): one emblem per city, sized by the city's size, and
 * armies and caravans as small markers. Single buildings and residents are not drawn there.
 */

/** A city's size, from village to large town (`CONTEXT.md`: City). */
export type CitySize = 'village' | 'town' | 'largeTown'

/**
 * Houses in sight from which a city shows as a town, and as a large town. A starting city or an
 * NPC village has 2–3 houses, an NPC town 5, the Trade Org HQ 9.
 */
export const TOWN_HOUSES = 4
export const LARGE_TOWN_HOUSES = 8

/** An emblem's radius on screen, in pixels, by city size; it keeps its size at every far zoom. */
export const EMBLEM_RADIUS: Record<CitySize, number> = { village: 9, town: 12, largeTown: 15 }

/** An army's or caravan's marker radius on screen, in pixels. */
export const MARKER_RADIUS = 4

export function citySize(houses: number): CitySize {
  return houses >= LARGE_TOWN_HOUSES ? 'largeTown' : houses >= TOWN_HOUSES ? 'town' : 'village'
}

/** A city as the far tier draws it: on its town hall's tile. */
export interface CityEmblem {
  id: string
  name: string
  x: number
  y: number
  size: CitySize
  rel: Relationship
}

/** One emblem per city whose town hall is in sight, sized by its houses in sight. */
export function cityEmblems(
  world: { cities: readonly City[]; buildings: readonly Building[] },
  viewer: Viewer,
  mapSize: number,
): CityEmblem[] {
  const members = cityMembership(
    { cities: [...world.cities], buildings: [...world.buildings] },
    mapSize,
  )
  const houses = new Map<string, number>()
  for (const b of world.buildings) {
    const cityId = members.get(b.id)
    if (b.kind === 'house' && cityId) houses.set(cityId, (houses.get(cityId) ?? 0) + 1)
  }
  const byId = new Map(world.buildings.map((b) => [b.id, b]))
  return world.cities.flatMap((c) => {
    const hall = byId.get(c.townHallId)
    if (!hall) return []
    return [
      {
        id: c.id,
        name: c.name,
        x: hall.x,
        y: hall.y,
        size: citySize(houses.get(c.id) ?? 0),
        rel: cityRelationship(c, viewer)!,
      },
    ]
  })
}

/** A small marker for an army or a caravan. */
export interface FarMarker {
  kind: 'army' | 'caravan'
  x: number
  y: number
  rel: Relationship
}

/**
 * The Player's armies, each where its first member in sight stands, and the Trade Org's caravans,
 * where their carriages are.
 */
export function farMarkers(world: {
  armies: readonly { memberIds: readonly string[] }[]
  caravans: readonly { carriageId: string }[]
  residents: readonly Resident[]
  carriages: readonly Carriage[]
}): FarMarker[] {
  const residents = new Map(world.residents.map((r) => [r.id, r]))
  const carriages = new Map(world.carriages.map((k) => [k.id, k]))
  const out: FarMarker[] = []
  for (const a of world.armies) {
    const m = a.memberIds.map((id) => residents.get(id)).find((r) => r !== undefined)
    if (m) out.push({ kind: 'army', x: m.x, y: m.y, rel: 'own' })
  }
  for (const c of world.caravans) {
    const k = carriages.get(c.carriageId)
    if (k) out.push({ kind: 'caravan', x: k.x, y: k.y, rel: 'trade' })
  }
  return out
}

/** The emblem under a screen point, if any: the nearest one the point falls on. */
export function emblemAt(
  emblems: readonly CityEmblem[],
  cam: Camera,
  view: Size,
  mapSize: number,
  sx: number,
  sy: number,
): CityEmblem | undefined {
  let best: { e: CityEmblem; d: number } | undefined
  for (const e of emblems) {
    const [ex, ey] = tileToScreen(cam, view, mapSize, e.x + 0.5, e.y + 0.5)
    const d = Math.hypot(ex - sx, ey - sy)
    if (d <= EMBLEM_RADIUS[e.size] + 4 && (!best || d < best.d)) best = { e, d }
  }
  return best?.e
}
