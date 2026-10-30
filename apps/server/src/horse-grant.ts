import {
  FOOTPRINT,
  HORSE_GRANT_FOOD,
  HORSE_GRANT_HORSES,
  middleOf,
  wrap,
  wrapDistance,
  type Placed,
  type Realm,
  type RealmEventWhat,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { newHorse } from './horses.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { Ground } from './placing.js'
import { mulberry32 } from './residents.js'
import { newId, realmOf, residentTiles } from './starting-city.js'
import { isWalkable } from './world.js'

/** How far out from the storage or the Leader the grant looks for free tiles, in rings. */
const GRANT_REACH = 6

type Granted = Omit<Extract<RealmEventWhat, { kind: 'horsesGranted' }>, 'kind'>

/**
 * The one-time Horse grant (`CONTEXT.md`: Horse grant), run by a world migration: every Player
 * realm with a living Leader and no horse at all (stabled, hitched or ridden) gets
 * `HORSE_GRANT_HORSES` new horses, placed by `placeNewHorses`. The realm log says where. NPC
 * cities and the Trade Organization are no Player realms and get none.
 */
export function grantHorses(world: WorldState, terrain: TerrainMap): void {
  for (const realm of world.realms) {
    if (world.horses.some((h) => h.realmId === realm.id)) continue
    const granted = placeNewHorses(world, terrain, realm, world.seed * 7919 + realm.userId + 2)
    if (granted) recordEvent(world, realm.id, { kind: 'horsesGranted', ...granted })
  }
}

/**
 * Gives a realm with a living Leader `HORSE_GRANT_HORSES` new horses, drawn as in a starting
 * city from `seed`, and says where they went; nothing when its Leader is dead or there is no room.
 * They go in
 * the realm's finished stable nearest the Leader's city; with no stable, on free tiles next to
 * the storage of the Leader's city (or the realm's oldest city; with no city, next to the
 * Leader), each with `HORSE_GRANT_FOOD` on the ground by it. Used by the Horse grant and the Horse
 * offer (`CONTEXT.md`).
 */
function placeNewHorses(
  world: WorldState,
  terrain: TerrainMap,
  realm: Realm,
  seed: number,
): Granted | undefined {
  const size = terrain.size
  const leader = world.residents.find((r) => r.id === realm.leaderId)
  if (!leader) return undefined
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

  const rand = mulberry32(seed)
  const add = (x: number, y: number) => {
    const id = newId(world, 'horse')
    world.horses.push(
      newHorse(rand, { id, realmId: realm.id, cityId: null, x, y, tick: world.tick }),
    )
    return id
  }
  if (stable) {
    const horseIds = Array.from({ length: HORSE_GRANT_HORSES }, () => add(stable.x, stable.y))
    const name = world.cities.find((c) => c.id === stable.cityId)!.name
    return { horseIds, where: 'stable', city: name, x: stable.x, y: stable.y }
  }
  const storage =
    city && world.buildings.find((b) => b.kind === 'storage' && !b.site && b.cityId === city.id)
  const tiles = freeTilesAround(world, terrain, storage ?? { x: leader.x, y: leader.y })
  if (tiles.length === 0) return undefined
  const horseIds = tiles.map(([x, y]) => {
    world.piles.push({ id: newId(world, 'pile'), x, y, goods: { food: HORSE_GRANT_FOOD } })
    return add(x, y)
  })
  const [x, y] = tiles[0]!
  return storage
    ? { horseIds, where: 'storage', city: city!.name, x, y }
    : { horseIds, where: 'leader', x, y }
}

/*
 * The Horse offer (`CONTEXT.md`: Horse offer) is the Player's choice of when to take two new
 * horses, once ever. Claiming is an order request with nothing in it but its kind, which a script
 * could send as well (ADR 0002); whether the Player has claimed is plain data kept by account id
 * (`WorldState.horseOffersClaimed`), so it outlives their realm.
 */

/** Why a Player can't claim their Horse offer now, if they can't. */
export function horseOfferProblem(world: WorldState, userId: number): string | undefined {
  if (world.horseOffersClaimed.includes(userId)) return 'you have claimed your horses already'
  const realm = realmOf(world, userId)
  if (!realm || !world.residents.some((r) => r.id === realm.leaderId)) {
    return 'you have no living Leader'
  }
  return undefined
}

/**
 * The claim order: the Player's realm gets two new horses placed as the Horse grant places them,
 * the realm log says where, and the offer is claimed for good. With no room for them the offer
 * stays open.
 */
export const claimHorses: OrderKind = {
  validate(world, sender, _order, terrain) {
    if (!terrain) return 'no map to place horses on'
    return horseOfferProblem(world, sender.userId)
  },
  apply(world, sender, _order, terrain) {
    if (!terrain || horseOfferProblem(world, sender.userId)) return
    const realm = realmOf(world, sender.userId)!
    // Seeded by the tick too, so the claimed horses are drawn apart from any granted ones.
    const seed = world.seed * 7919 + realm.userId * 31 + world.tick + 3
    const placed = placeNewHorses(world, terrain, realm, seed)
    if (!placed) return
    world.horseOffersClaimed.push(sender.userId)
    recordEvent(world, realm.id, { kind: 'horsesClaimed', ...placed })
  },
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Horse offer): each Player claims their Horse offer at most
 * once, so no account id is in `horseOffersClaimed` twice.
 */
export const horseOffersOnce: Invariant = {
  name: 'horse-offers-once',
  check(world) {
    const seen = new Set<number>()
    const out: InvariantViolation[] = []
    for (const userId of world.horseOffersClaimed) {
      if (seen.has(userId)) {
        out.push({
          invariant: this.name,
          message: `Player ${userId} claimed their Horse offer more than once`,
          entityIds: [],
        })
      }
      seen.add(userId)
    }
    return out
  },
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
