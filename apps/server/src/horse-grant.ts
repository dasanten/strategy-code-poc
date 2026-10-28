import {
  FOOTPRINT,
  HORSE_GRANT_FOOD,
  HORSE_GRANT_HORSES,
  middleOf,
  wrap,
  wrapDistance,
  type Placed,
  type RealmEventWhat,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { newHorse } from './horses.js'
import { Ground } from './placing.js'
import { mulberry32 } from './residents.js'
import { newId, residentTiles } from './starting-city.js'
import { isWalkable } from './world.js'

/** How far out from the storage or the Leader the grant looks for free tiles, in rings. */
const GRANT_REACH = 6

type Granted = Omit<Extract<RealmEventWhat, { kind: 'horsesGranted' }>, 'kind'>

/**
 * The one-time Horse grant (`CONTEXT.md`: Horse grant), run by a world migration: every Player
 * realm with a living Leader and no horse at all (stabled, hitched or ridden) gets
 * `HORSE_GRANT_HORSES` new horses, drawn as in a starting city. They go in the realm's finished
 * stable nearest the Leader's city; with no stable, on free tiles next to the storage of the
 * Leader's city (or the realm's oldest city; with no city, next to the Leader), each with
 * `HORSE_GRANT_FOOD` on the ground by it. The realm log says where. NPC cities and the Trade
 * Organization are no Player realms and get none.
 */
export function grantHorses(world: WorldState, terrain: TerrainMap): void {
  const size = terrain.size
  for (const realm of world.realms) {
    const leader = world.residents.find((r) => r.id === realm.leaderId)
    if (!leader || world.horses.some((h) => h.realmId === realm.id)) continue
    // `world.cities` keeps the order cities were founded or taken in: the first is the oldest.
    const cities = world.cities.filter((c) => c.realmId === realm.id)
    const city = cities.find((c) => c.id === leader.cityId) ?? cities[0]
    const hall = city && world.buildings.find((b) => b.id === city.townHallId)
    const from = hall ? middleOf(hall, size) : leader
    const ids = new Set(cities.map((c) => c.id))
    const away = (b: Placed) => wrapDistance(size, from, middleOf(b, size))
    const stable = world.buildings
      .filter((b) => b.kind === 'stable' && !b.site && b.cityId !== null && ids.has(b.cityId))
      .sort((a, b) => away(a) - away(b))[0]

    const rand = mulberry32(world.seed * 7919 + realm.userId + 2)
    const add = (x: number, y: number) => {
      const id = newId(world, 'horse')
      world.horses.push(
        newHorse(rand, { id, realmId: realm.id, cityId: null, x, y, tick: world.tick }),
      )
      return id
    }
    let granted: Granted
    if (stable) {
      const horseIds = Array.from({ length: HORSE_GRANT_HORSES }, () => add(stable.x, stable.y))
      const name = world.cities.find((c) => c.id === stable.cityId)!.name
      granted = { horseIds, where: 'stable', city: name, x: stable.x, y: stable.y }
    } else {
      const storage =
        city && world.buildings.find((b) => b.kind === 'storage' && !b.site && b.cityId === city.id)
      const tiles = freeTilesAround(world, terrain, storage ?? { x: leader.x, y: leader.y })
      if (tiles.length === 0) continue
      const horseIds = tiles.map(([x, y]) => {
        world.piles.push({ id: newId(world, 'pile'), x, y, goods: { food: HORSE_GRANT_FOOD } })
        return add(x, y)
      })
      const [x, y] = tiles[0]!
      granted = storage
        ? { horseIds, where: 'storage', city: city!.name, x, y }
        : { horseIds, where: 'leader', x, y }
    }
    recordEvent(world, realm.id, { kind: 'horsesGranted', ...granted })
  }
}

/**
 * Up to `HORSE_GRANT_HORSES` walkable tiles around a building's footprint or a tile, nearest ring
 * first, that no building covers (roads aside), with no node and nothing standing or lying on
 * them.
 */
function freeTilesAround(
  world: WorldState,
  terrain: TerrainMap,
  at: Placed | { x: number; y: number },
): [number, number][] {
  const ground = new Ground(world, terrain, residentTiles(world))
  const side = 'kind' in at ? FOOTPRINT[at.kind] : 1
  const out: [number, number][] = []
  for (let ring = 1; ring <= GRANT_REACH; ring++) {
    for (let dy = -ring; dy < side + ring; dy++) {
      for (let dx = -ring; dx < side + ring; dx++) {
        const edge =
          dx === -ring || dy === -ring || dx === side + ring - 1 || dy === side + ring - 1
        if (!edge) continue
        const x = wrap(at.x + dx, terrain.size)
        const y = wrap(at.y + dy, terrain.size)
        if (!isWalkable(terrain, x, y) || !ground.free(x, y) || ground.nodeAt(x, y)) continue
        out.push([x, y])
        if (out.length === HORSE_GRANT_HORSES) return out
      }
    }
  }
  return out
}
