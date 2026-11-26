// City areas (T122.7, `CONTEXT.md`: City area), answered by `csp-sim`'s own rules in the module
// (`crates/csp-lang-wasm/src/area_rules.rs`). The client passes the buildings it knows, in sight
// or remembered, as one typed array a call; nothing crosses once per tile.

import { BUILDING_KINDS } from '@csp/balance'
import type { Building, BuildingKind } from '@csp/shared-types'
import * as wasm from '../generated/csp_lang_wasm.js'

/** What a building is to the area rules. */
export type AreaBuilding = Pick<Building, 'kind' | 'x' | 'y' | 'cityId' | 'site'>

/** What the module adds to a building's city number when it is a construction site. */
const SITE = 1000

const KIND_NUMBER = new Map<BuildingKind, number>(BUILDING_KINDS.map((k, i) => [k, i]))

/**
 * The buildings as the module reads them, four numbers each: `x`, `y`, the kind's number and the
 * city's, which `cityNumber` gives (-1 for none); only those whose city it numbers when `only`.
 */
function encode(
  buildings: readonly AreaBuilding[],
  cityNumber: (cityId: string | null) => number,
  only: boolean,
): Int32Array {
  const out: number[] = []
  for (const b of buildings) {
    const city = cityNumber(b.cityId)
    if (only && city < 0) continue
    out.push(b.x, b.y, KIND_NUMBER.get(b.kind)!, city + (b.site ? SITE : 0))
  }
  return Int32Array.from(out)
}

/** One city's buildings, that city numbered 0. */
const ofCity = (buildings: readonly AreaBuilding[], cityId: string) =>
  encode(buildings, (c) => (c === cityId ? 0 : -1), true)

/** Every tile in a city's area as `x, y` pairs in one array, each once (`cityAreaTiles`). */
export function cityAreaTileArray(
  buildings: readonly AreaBuilding[],
  cityId: string,
  size: number,
): Int32Array {
  return wasm.cityAreaTiles(ofCity(buildings, cityId), 0, size)
}

/** Every tile in a city's area, as `[x, y]`, each once (`cityAreaTiles`). */
export function cityAreaTileList(
  buildings: readonly AreaBuilding[],
  cityId: string,
  size: number,
): [number, number][] {
  const flat = cityAreaTileArray(buildings, cityId, size)
  const out: [number, number][] = []
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!])
  return out
}

/**
 * For each of `tiles`, whether it lies in a city's area or within `reach` tiles of it
 * (`inCityArea`, `nearCityArea`), asked in one call.
 */
export function nearCityAreaAll(
  buildings: readonly AreaBuilding[],
  cityId: string,
  tiles: readonly (readonly [number, number])[],
  reach: number,
  size: number,
): boolean[] {
  const flat = Int32Array.from(tiles.flatMap(([x, y]) => [x, y]))
  return [...wasm.nearCityArea(ofCity(buildings, cityId), 0, flat, reach, size)].map((n) => n === 1)
}

/** The ids of the cities whose area a tile lies in (`cityIdsAt`), in the order of their first building. */
export function cityIdsAtTile(
  buildings: readonly AreaBuilding[],
  x: number,
  y: number,
  size: number,
): string[] {
  const ids: string[] = []
  const number = new Map<string, number>()
  const cityNumber = (c: string | null) => {
    if (c === null) return -1
    let n = number.get(c)
    if (n === undefined) {
      n = ids.length
      number.set(c, n)
      ids.push(c)
    }
    return n
  }
  const found = wasm.cityIdsAt(encode(buildings, cityNumber, false), x, y, size)
  return [...found].map((n) => ids[n]!)
}

/**
 * Which city each finished city building belongs to (`cityMembership`, `CONTEXT.md`: City
 * building), building id to city id; a building missing from it belongs to none. Cities grow in a
 * chain from their town halls; the whole map's buildings go across in one call.
 */
export function cityMembershipOf(
  buildings: readonly (AreaBuilding & Pick<Building, 'id'>)[],
  cities: readonly { id: string; townHallId: string }[],
  size: number,
): Map<string, string> {
  const place = new Map(buildings.map((b, i) => [b.id, i]))
  const flat = encode(buildings, () => -1, false)
  const halls = Int32Array.from(cities.map((c) => place.get(c.townHallId) ?? -1))
  const found = wasm.cityMembership(flat, cities.map((c) => c.id).join('\n'), halls, size)
  const out = new Map<string, string>()
  found.forEach((c, i) => {
    if (c >= 0) out.set(buildings[i]!.id, cities[c]!.id)
  })
  return out
}

/** For each of `tiles`, whether it lies in the area of any city (`citiesAt` not empty), asked in one call. */
export function inAnyCityArea(
  buildings: readonly AreaBuilding[],
  tiles: readonly (readonly [number, number])[],
  size: number,
): boolean[] {
  const numbers = new Map<string, number>()
  const cityNumber = (c: string | null) => {
    if (c === null) return -1
    if (!numbers.has(c)) numbers.set(c, numbers.size)
    return numbers.get(c)!
  }
  const flat = Int32Array.from(tiles.flatMap(([x, y]) => [x, y]))
  return [...wasm.inAnyCityArea(encode(buildings, cityNumber, false), flat, size)].map(
    (n) => n === 1,
  )
}
