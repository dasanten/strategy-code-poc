import { freeHousing } from './city.js'
import { CARRYING_A_CHILD, type Building, type City, type Resident } from './world.js'

/**
 * World queries about relocating (`CONTEXT.md`: Relocate, Homeless; ADR 0002: the game API orders
 * and scripts share). They take as much of the world as they need, so the client asks them of
 * what the Player sees, and the server of the world.
 */

/** What the relocating queries look at: residents with their orders, cities and buildings. */
export interface RelocateWorld {
  buildings: readonly Building[]
  residents: readonly Pick<Resident, 'id' | 'cityId' | 'order'>[]
  cities: readonly Pick<City, 'id' | 'name' | 'realmId'>[]
}

/** The residents relocating to a city (`CONTEXT.md`: Relocate): on their way, not moved in yet. */
export function relocatingTo<R extends Pick<Resident, 'cityId' | 'order'>>(
  world: { residents: readonly R[] },
  city: Pick<City, 'id'>,
): R[] {
  return world.residents.filter(
    (r) => r.order?.kind === 'relocate' && r.order.cityId === city.id && r.cityId !== city.id,
  )
}

/**
 * A city's free housing for residents told to relocate there (`CONTEXT.md`: Relocate): its free
 * housing less the residents already relocating there, but for those in `ordered`, who are being
 * told again. Can be below 0.
 */
export function relocateRoom(
  world: RelocateWorld,
  city: Pick<City, 'id'>,
  ordered: ReadonlySet<string> = new Set(),
): number {
  const coming = relocatingTo(world, city).filter((r) => !ordered.has(r.id)).length
  return freeHousing(world, city) - coming
}

/**
 * Why the realm `realmId` can't tell `residents` to relocate to the city `cityId` now
 * (`CONTEXT.md`: Relocate), or undefined when it can: the city is another of the realm's, each of
 * them is a resident of the realm who lives elsewhere and isn't carrying a child, and the city has
 * free housing for all of them, counting the residents already relocating there.
 */
export function relocateProblem(
  world: RelocateWorld,
  realmId: string,
  residents: readonly Pick<Resident, 'id' | 'name' | 'owner' | 'cityId' | 'carrying'>[],
  cityId: unknown,
): string | undefined {
  const city = world.cities.find((c) => c.id === cityId)
  if (!city || city.realmId !== realmId) return 'not a city of your realm'
  for (const r of residents) {
    if (r.owner !== realmId) return 'not one of your residents'
    if (r.cityId === city.id) return `${r.name} already lives in ${city.name}`
    if (r.carrying) return `${r.name} is ${CARRYING_A_CHILD}`
  }
  const room = relocateRoom(world, city, new Set(residents.map((r) => r.id)))
  if (room >= residents.length) return undefined
  if (room <= 0) return 'no free housing'
  return `free housing for ${room} only`
}
