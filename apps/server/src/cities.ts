import {
  cityMembership,
  isCityBuilding,
  type Building,
  type City,
  type WorldState,
} from '@csp/shared'
import { hash } from './residents.js'

/** City names. Only flavour, like resident names. */
export const CITY_NAMES = [
  'Ashford',
  'Brackenholt',
  'Coldwater',
  'Dunmere',
  'Eastwick',
  'Fallowby',
  'Greyhaven',
  'Hartwell',
  'Ironside',
  'Juniper',
  'Kettleby',
  'Larkspur',
  'Millbrook',
  'Northam',
  'Oakhurst',
  'Pinecrest',
  'Quarrytown',
  'Redbank',
  'Stonebridge',
  'Thornbury',
]

/**
 * Brings every building's city up to date with where the buildings stand (`cityMembership`):
 * each finished city building belongs to the city whose chain it is part of, or to none. A farm
 * or stable keeps the city it was laid out for while that city exists. A storage a city takes in
 * is that city's; one cut off from its city stays its realm's, as an outpost storage
 * (`CONTEXT.md`: Outpost storage). Called whenever buildings or cities change. `size` is the map's.
 */
export function updateCityMembership(world: WorldState, size: number): void {
  const members = cityMembership(world, size)
  const cities = new Map(world.cities.map((c) => [c.id, c]))
  for (const b of world.buildings) {
    if (isCityBuilding(b)) {
      const cityId = members.get(b.id) ?? null
      if (b.kind === 'storage') {
        const lastRealm = b.cityId === null ? undefined : cities.get(b.cityId)?.realmId
        if (cityId !== null) delete b.realmId
        else if (lastRealm) b.realmId = lastRealm
      }
      b.cityId = cityId
    } else if (b.cityId !== null && !cities.has(b.cityId)) b.cityId = null
  }
}

/**
 * Founds a city around a town hall just finished (`CONTEXT.md`: Town hall), belonging to the
 * realm whose resident finished it. Its name is drawn from its id, so a world always names it the
 * same way.
 */
export function foundCity(world: WorldState, hall: Building, realmId: string | null): City {
  const id = `city${world.nextId++}`
  const city: City = {
    id,
    name: CITY_NAMES[hash(`${world.seed}:${id}`) % CITY_NAMES.length]!,
    realmId,
    townHallId: hall.id,
  }
  world.cities.push(city)
  hall.cityId = id
  return city
}

/**
 * Dissolves a city whose town hall is gone (`CONTEXT.md`: Town hall): its buildings and residents
 * stay where they are (its storages as outpost storages of its realm), and its residents are
 * homeless; horses and carriages of an NPC city belong to nobody. Pairs among them end, since a
 * pair needs a city to live in.
 */
export function dissolveCity(world: WorldState, city: City): void {
  world.cities = world.cities.filter((c) => c !== city)
  for (const b of world.buildings) {
    if (b.cityId === city.id && b.kind === 'storage' && !b.site && city.realmId !== null)
      b.realmId = city.realmId
  }
  for (const r of world.residents) {
    if (r.cityId !== city.id) continue
    r.cityId = null
    delete r.pair
  }
  for (const k of [...world.horses, ...world.carriages]) {
    if (k.cityId === city.id) k.cityId = null
  }
}
