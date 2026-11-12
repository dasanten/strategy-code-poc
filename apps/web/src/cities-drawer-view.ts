import type { Building, City } from '@csp/shared-types'
import { FAR_SCALE } from './map/camera.js'

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
