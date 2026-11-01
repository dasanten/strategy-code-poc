import {
  MAP_SIZE,
  cityAreaTiles,
  freeHousing,
  inCityArea,
  isPassableTerrain,
  relocateProblem,
  terrainAt,
  townHallOf,
  wrapDistance,
  type City,
  type OrderRequest,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { orderedResident } from './order-sender.js'
import type { OrderKind, OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'

/**
 * The input of a relocate order: which resident, and the realm's city they move to. Given to a
 * group, each of them gets one naming the whole `group` (`CONTEXT.md`: Group, Relocate).
 */
interface RelocateRequest extends OrderRequest {
  kind: 'relocate'
  residentId: string
  cityId: string
  /** The ids of the group they relocate with, their own among them. */
  group?: string[]
}

/**
 * The relocate order (`CONTEXT.md`: Relocate): a resident of the Player's realm walks to another
 * of its cities and moves in on stepping into its area (`stepRelocating`). It can be given only as
 * `relocateProblem` allows, free housing counting the residents already on their way there; an
 * NPC city relocates nobody. Given to a group, each one's order is checked for all of them, so the
 * city needs room for the whole group and none goes when one of them can't. It only sets the
 * resident's order, heading for the nearest tile of the city's area.
 */
export const relocate: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<RelocateRequest>
    const realm = sender.npcCityId === undefined ? realmOf(world, sender.userId) : undefined
    const r = orderedResident(world, sender, o.residentId)
    const group = r && groupOf(world, sender, r, o.group)
    if (!realm || !group) return 'not one of your residents'
    return relocateProblem(world, realm.id, group, o.cityId)
  },
  apply(world, _sender, order, terrain) {
    const { residentId, cityId } = order as RelocateRequest
    const r = world.residents.find((x) => x.id === residentId)
    const city = world.cities.find((c) => c.id === cityId)
    // Housing taken since is checked on arrival, where the realm log can say so.
    if (!r || !city || r.carrying) return
    const target = nearestAreaTile(world, city, r, terrain) ?? { x: r.x, y: r.y }
    // How their last store, fetch or relocate ended goes with a new one, as a script's too.
    delete r.orderEnded
    r.order = { kind: 'relocate', cityId: city.id, target, path: null, progress: 0 }
  },
}

/**
 * The residents a relocate order is checked for: `r` alone, or the group named, which must hold
 * `r` and only residents the sender may order, each once. Undefined when it doesn't.
 */
function groupOf(
  world: WorldState,
  sender: OrderSender,
  r: Resident,
  ids: unknown,
): Resident[] | undefined {
  if (ids === undefined) return [r]
  if (!Array.isArray(ids) || !ids.includes(r.id) || new Set(ids).size !== ids.length) return
  const group = ids.map((id) => orderedResident(world, sender, id))
  return group.every((x) => x !== undefined) ? group : undefined
}

/**
 * The tile of a city's area nearest to `from` that a resident can stand on: passable land
 * (as far as `terrain` tells), with no wall or gate on it. Undefined when its area has none.
 */
export function nearestAreaTile(
  world: WorldState,
  city: City,
  from: { x: number; y: number },
  terrain?: TerrainMap,
): { x: number; y: number } | undefined {
  const size = terrain?.size ?? MAP_SIZE
  const walled = new Set(
    world.buildings
      .filter((b) => b.kind === 'wall' || b.kind === 'gate')
      .map((b) => `${b.x},${b.y}`),
  )
  let best: { x: number; y: number } | undefined
  let bestDistance = Infinity
  for (const key of cityAreaTiles(world, city, size)) {
    if (walled.has(key)) continue
    const [x, y] = key.split(',').map(Number) as [number, number]
    if (terrain && !isPassableTerrain(terrainAt(terrain, x, y))) continue
    const d = wrapDistance(size, from, { x, y })
    if (d < bestDistance) {
      best = { x, y }
      bestDistance = d
    }
  }
  return best
}

/**
 * Moves relocating residents in (`CONTEXT.md`: Relocate), after the tick's steps: one standing in
 * the area of the city they relocate to becomes its resident if it is still their realm's and has
 * free housing; if not, their order ends, they keep their old city and the realm log says why.
 * One whose city is gone stops too. One heading for a tile its city's area no longer holds heads
 * for the nearest one it does.
 */
export function stepRelocating(world: WorldState, terrain: TerrainMap): void {
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'relocate') continue
    const city = world.cities.find((c) => c.id === o.cityId)
    if (!city) {
      failRelocating(world, r, o.cityId, undefined, 'the city is gone')
      continue
    }
    if (inCityArea(world, city, r.x, r.y, terrain.size)) {
      moveIn(world, r, city)
      continue
    }
    if (inCityArea(world, city, o.target.x, o.target.y, terrain.size)) continue
    const target = nearestAreaTile(world, city, r, terrain) ?? townHallOf(world, city)
    if (!target) {
      failRelocating(world, r, city.id, city.name, 'the city is gone')
      continue
    }
    o.target = { x: target.x, y: target.y }
    o.path = null
    o.progress = 0
  }
}

/**
 * A relocating resident steps into the city's area: they move in while it is still their realm's
 * and has free housing, ending any pair (Pairing needs one city), and their order is done.
 */
function moveIn(world: WorldState, r: Resident, city: City): void {
  if (city.realmId !== r.owner) {
    failRelocating(world, r, city.id, city.name, 'it is no longer your realm’s')
    return
  }
  if (freeHousing(world, city) <= 0) {
    failRelocating(world, r, city.id, city.name, 'no free housing')
    return
  }
  const partner = r.pair && world.residents.find((x) => x.id === r.pair!.partnerId)
  if (partner?.pair?.partnerId === r.id) delete partner.pair
  delete r.pair
  r.cityId = city.id
  endRelocating(world, r, null)
}

/**
 * Ends a relocate order, saying how it ended (`OrderEnded`) for a script to read once it waited
 * on it: `reason` null when they moved in, else why not.
 */
function endRelocating(world: WorldState, r: Resident, reason: string | null): void {
  r.order = null
  r.orderEnded = { kind: 'relocate', tick: world.tick, reason }
}

/** A relocate order ends without moving in; the resident keeps their city, and the log says why. */
function failRelocating(
  world: WorldState,
  r: Resident,
  cityId: string,
  city: string | undefined,
  reason: string,
): void {
  endRelocating(world, r, reason)
  recordEvent(world, r.owner, {
    kind: 'relocateFailed',
    residentId: r.id,
    name: r.name,
    cityId,
    ...(city === undefined ? {} : { city }),
    reason,
  })
}
