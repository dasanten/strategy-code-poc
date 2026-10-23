import {
  SIGHT_RANGE,
  cityPrice,
  commanderOf,
  forSale,
  npcCityPrices,
  npcCityRefuses,
  npcHirePrice,
  sellsTo,
  spareResidents,
  sharingSight,
  wrapDistance,
  carriageCommanderOf,
  cityOrganization,
  loadLevel,
  tradeCoinWarehouse,
  warehousePrices,
  type Army,
  type Building,
  type Carriage,
  type Placed,
  type Caravan,
  type Resident,
  type SeenBuilding,
  type SeenCarriage,
  type SeenEntity,
  type Shown,
  type TerrainMap,
  type WorldState,
  FOOTPRINT,
  footprintTiles,
} from '@csp/shared'
import type { ExploredTerrain } from './explored.js'
import type { InvariantViolation } from './invariants.js'

/** A spot something can be seen from or at. */
interface Spot {
  x: number
  y: number
}

/** Whether any of the observers is within sight range of the spot (plus `reach`). */
function seen(size: number, observers: Spot[], at: Spot, reach = 0): boolean {
  return observers.some((o) => wrapDistance(size, o, at) <= SIGHT_RANGE + reach)
}

/** Whether any tile of a building's footprint is in sight of the observers (`CONTEXT.md`: Sight). */
function buildingSeen(size: number, observers: Spot[], b: Placed): boolean {
  const side = FOOTPRINT[b.kind]
  if (side === 1) return seen(size, observers, b)
  if (!seen(size, observers, b, side * Math.SQRT2)) return false
  return footprintTiles(b, size).some(([x, y]) => seen(size, observers, { x, y }))
}

/** Whether any of the army's members is in sight (`CONTEXT.md`: Sight). */
function armySeen(
  world: WorldState,
  army: Pick<Army, 'memberIds'>,
  inSight: (at: Spot) => boolean,
): boolean {
  return world.residents.some((r) => army.memberIds.includes(r.id) && inSight(r))
}

/**
 * The residents a realm's Player sees through: their own and their alliance's, an NPC city
 * member's included, those rented out too, and mercenaries they hired (`CONTEXT.md`: Mercenary
 * contract).
 */
function observersOf(world: WorldState, realmId: string): Spot[] {
  const members = new Set(sharingSight(world, realmId))
  return world.residents.filter((r) => {
    const by = commanderOf(world, r)
    const org = r.owner ?? r.cityId
    return (org !== null && members.has(org)) || (by !== null && members.has(by))
  })
}

/**
 * Whether a realm's Player, or an NPC city, sees a spot (`CONTEXT.md`: Sight): within sight
 * range of any of their residents or their alliance's, as `entitiesInSight` counts it.
 */
export function sightOf(world: WorldState, size: number, side: string): (at: Spot) => boolean {
  const observers = observersOf(world, side)
  return (at) => seen(size, observers, at)
}

/**
 * What a side knows of what it sees (`CONTEXT.md`: Seeing inside a storage, Seeing how someone
 * fares): how its own Organization's and its allies' residents and horses fare and what their
 * storages and carriages hold, and what is inside where one of the residents it sees through
 * stands.
 */
interface Insight {
  /** Whether a thing of this realm, or else of this city, is its own or its allies'. */
  ours(realmId: string | null, cityId: string | null): boolean
  /** Whether it sees what a storage, warehouse or stable holds. */
  insideBuilding(b: Building): boolean
  /** Whether it sees what a city's storages hold together (an NPC city's stock in its prices). */
  insideCity(cityId: string): boolean
  /** Whether it sees a carriage's load. */
  insideCarriage(k: Carriage): boolean
  /** Whether it sees how a resident fares. */
  fares(r: Resident): boolean
}

function insightOf(world: WorldState, size: number, side: string, observers: Spot[]): Insight {
  const cities = new Map(world.cities.map((c) => [c.id, c]))
  const orgs = new Set(sharingSight(world, side))
  // A Trade Org city sees for its Organization, as all of the Trade Org's cities are one.
  const sideCity = cities.get(side)
  if (sideCity) orgs.add(cityOrganization(sideCity))
  const ours = (realmId: string | null, cityId: string | null) => {
    if (realmId !== null) return orgs.has(realmId)
    const city = cityId === null ? undefined : cities.get(cityId)
    return city !== undefined && (orgs.has(city.id) || orgs.has(cityOrganization(city)))
  }
  const standing = new Set(observers.map((o) => `${o.x},${o.y}`))
  const at = (b: Building) => footprintTiles(b, size).some(([x, y]) => standing.has(`${x},${y}`))
  // Trading at a warehouse of the HQ draws on its coin warehouse, so a resident at one sees
  // those coins too (`tradeCoinWarehouse`).
  let coinsSeen: Set<string> | undefined
  const coinWarehouseSeen = (b: Building) =>
    (coinsSeen ??= new Set(
      world.buildings
        .filter((w) => w.kind === 'warehouse' && at(w))
        .flatMap((w) => tradeCoinWarehouse(world, w)?.id ?? []),
    )).has(b.id)
  const insideBuilding = (b: Building) => ours(null, b.cityId) || at(b) || coinWarehouseSeen(b)
  return {
    ours,
    insideBuilding,
    insideCity: (cityId) =>
      ours(null, cityId) ||
      world.buildings.some((b) => b.cityId === cityId && b.kind === 'storage' && at(b)),
    insideCarriage: (k) => {
      const by = carriageCommanderOf(world, k)
      return (
        ours(k.realmId, k.cityId) || (by !== null && orgs.has(by)) || standing.has(`${k.x},${k.y}`)
      )
    },
    fares: (r) => {
      const by = commanderOf(world, r)
      return ours(r.owner, r.cityId) || (by !== null && orgs.has(by))
    },
  }
}

/** Price lines as the side sees them: without what is held unless it sees inside. */
function shownLines<P extends { stock: number }>(lines: P[], inside: boolean): Shown<P>[] {
  if (inside) return lines
  return lines.map((line) => {
    const shown: Shown<P> = { ...line }
    delete shown.stock
    return shown
  })
}

/**
 * A building as the side sees it: its stock only when it sees inside, and a Trade Org
 * warehouse's prices either way (`CONTEXT.md`: Seeing inside a storage, Warehouse prices).
 */
function seenBuilding(world: WorldState, insight: Insight, b: Building): SeenBuilding {
  const inside = insight.insideBuilding(b)
  const shown: SeenBuilding = { ...b }
  if (!inside) delete shown.stock
  if (b.kind === 'warehouse') {
    const prices = warehousePrices(world, b)
    if (prices.length > 0) shown.prices = shownLines(prices, inside)
  }
  return shown
}

/** A carriage as the side sees it: how heavily it is loaded, its load only when it sees inside. */
function seenCarriage(insight: Insight, k: Carriage): SeenCarriage {
  const level = loadLevel(k.load)
  if (insight.insideCarriage(k)) return { ...k, loadLevel: level }
  const { id, realmId, cityId, x, y, horseId } = k
  return { id, realmId, cityId, x, y, horseId, loadLevel: level }
}

/**
 * What a realm's Player sees (`CONTEXT.md`: Sight): everything within sight range of any of
 * their residents or their alliance's, their own things included. A city counts as seen when
 * any of it is. What is inside, and how residents and horses fare, only as `CONTEXT.md` says
 * (Seeing inside a storage, Seeing how someone fares).
 */
export function entitiesInSight(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string | undefined,
): SeenEntity[] {
  if (realmId === undefined) return []
  const observers = observersOf(world, realmId)
  if (observers.length === 0) return []
  const size = terrain.size
  const insight = insightOf(world, size, realmId, observers)
  const out: SeenEntity[] = []
  for (const r of world.residents) {
    if (!seen(size, observers, r)) continue
    // Which script a resident runs is seen; its memory stays on the server.
    const { script, ...rest } = r
    const shown: SeenEntity = {
      is: 'resident',
      ...rest,
      ...(script ? { script: { scriptId: script.scriptId } } : {}),
    }
    if (!insight.fares(r)) {
      delete shown.hunger
      delete shown.health
    }
    out.push(shown)
  }
  const seenCities = new Set<string>()
  const seenStorages = new Set<string>()
  for (const b of world.buildings) {
    if (!buildingSeen(size, observers, b)) continue
    out.push({ is: 'building', ...seenBuilding(world, insight, b) })
    if (b.cityId !== null) seenCities.add(b.cityId)
    if (b.cityId !== null && b.kind === 'storage' && !b.site) seenStorages.add(b.cityId)
  }
  // An NPC city names the Player its price (`CONTEXT.md`: Buying a city), from all of it, or says
  // it won't sell to them or refuses them at all (`CONTEXT.md`: NPC city reaction). One that doesn't
  // refuse them names what it would lend and its asking price, and, with a storage of it in sight,
  // its prices (`CONTEXT.md`: Hiring from / Trading with an NPC city).
  for (const c of world.cities) {
    if (!seenCities.has(c.id)) continue
    const sale = !forSale(c)
      ? {}
      : sellsTo(world, c, realmId)
        ? { price: cityPrice(world, c, realmId) }
        : { wontSell: true as const }
    const refuses = npcCityRefuses(world, c, realmId) ? { refuses: true as const } : {}
    const deal =
      !forSale(c) || refuses.refuses
        ? {}
        : {
            hire: {
              spare: spareResidents(world, c).length,
              pricePerResidentWeek: npcHirePrice(world, c, realmId),
            },
            ...(seenStorages.has(c.id)
              ? { trade: shownLines(npcCityPrices(world, c, realmId), insight.insideCity(c.id)) }
              : {}),
          }
    out.push({ is: 'city', ...c, ...sale, ...refuses, ...deal })
  }
  for (const h of world.horses) {
    if (!seen(size, observers, h)) continue
    const shown: SeenEntity = { is: 'horse', ...h }
    if (!insight.ours(h.realmId, h.cityId)) {
      delete shown.hunger
      delete shown.health
    }
    out.push(shown)
  }
  for (const k of world.carriages) {
    if (seen(size, observers, k)) out.push({ is: 'carriage', ...seenCarriage(insight, k) })
  }
  for (const p of world.piles) if (seen(size, observers, p)) out.push({ is: 'pile', ...p })
  // An army is seen through its members; the Player gets only their own.
  for (const a of world.armies) {
    if (a.realmId === realmId && armySeen(world, a, (at) => seen(size, observers, at))) {
      // As for residents: which script it runs is seen, its memory isn't.
      const { script, ...rest } = a
      out.push({
        is: 'army',
        ...rest,
        ...(script ? { script: { scriptId: script.scriptId } } : {}),
      })
    }
  }
  // A caravan is seen through its carriage and its crew (`CONTEXT.md`: Caravan).
  for (const c of world.caravans) {
    if (caravanSeen(world, c, (at) => seen(size, observers, at))) {
      const { id, postId, carriageId, driverId, escortIds, heading } = c
      out.push({ is: 'caravan', id, postId, carriageId, driverId, escortIds, heading })
    }
  }
  return out
}

/** Whether a caravan's carriage or any of its crew is in sight. */
function caravanSeen(
  world: WorldState,
  caravan: Pick<Caravan, 'carriageId' | 'driverId' | 'escortIds'>,
  inSight: (at: Spot) => boolean,
): boolean {
  const crew = [caravan.driverId, ...caravan.escortIds]
  return (
    world.carriages.some((k) => k.id === caravan.carriageId && inSight(k)) ||
    world.residents.some((r) => crew.includes(r.id) && inSight(r))
  )
}

/**
 * Invariant (ADR 0004): nothing is sent to a Player outside their own or their alliance's sight.
 * Checks the entities about to go out to a realm's Player against the world as it is, each on
 * its own: a city is in sight when any of its buildings is, a building when any tile of its
 * footprint is.
 */
export function sentOutOfSight(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string,
  sent: SeenEntity[],
): InvariantViolation[] {
  const observers = observersOf(world, realmId)
  const inSight = (at: Spot) => seen(terrain.size, observers, at)
  const out = sent.filter((e) =>
    e.is === 'city'
      ? !world.buildings.some((b) => b.cityId === e.id && buildingSeen(terrain.size, observers, b))
      : e.is === 'army'
        ? !armySeen(world, e, inSight)
        : e.is === 'caravan'
          ? !caravanSeen(world, e, inSight)
          : e.is === 'building'
            ? !buildingSeen(terrain.size, observers, e)
            : !inSight(e),
  )
  return out.map((e) => ({
    invariant: 'sent-only-in-sight',
    message: `${e.is} ${e.id} was sent to realm ${realmId}, outside its sight`,
    entityIds: [e.id, realmId],
  }))
}

/**
 * Invariant (ADR 0004): nothing a Player may not see inside goes out to them (`CONTEXT.md`: Seeing
 * inside a storage, Seeing how someone fares): no other Organization's stock, prices with what is
 * held or carriage load without a resident there, no stranger's hunger or health. Checks the
 * entities about to go out against the world as it is.
 */
export function sentInsideUnseen(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string,
  sent: SeenEntity[],
): InvariantViolation[] {
  const insight = insightOf(world, terrain.size, realmId, observersOf(world, realmId))
  const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)
  const hasStock = (lines: { stock?: number }[] | undefined) =>
    lines?.some((l) => l.stock !== undefined) ?? false
  const out = sent.filter((e) => {
    switch (e.is) {
      case 'building': {
        const b = byId(world.buildings, e.id)
        return (e.stock !== undefined || hasStock(e.prices)) && !(b && insight.insideBuilding(b))
      }
      case 'carriage': {
        const k = byId(world.carriages, e.id)
        return e.load !== undefined && !(k && insight.insideCarriage(k))
      }
      case 'city':
        return hasStock(e.trade) && !insight.insideCity(e.id)
      case 'resident': {
        const r = byId(world.residents, e.id)
        return (e.hunger !== undefined || e.health !== undefined) && !(r && insight.fares(r))
      }
      case 'horse': {
        const h = byId(world.horses, e.id)
        const told = e.hunger !== undefined || e.health !== undefined
        return told && !(h && insight.ours(h.realmId, h.cityId))
      }
      default:
        return false
    }
  })
  return out.map((e) => ({
    invariant: 'sent-only-what-is-seen-inside',
    message: `what is inside ${e.is} ${e.id}, or how it fares, was sent to realm ${realmId}`,
    entityIds: [e.id, realmId],
  }))
}

/**
 * Grows each Player's explored terrain from what they see: their residents and their alliance's.
 * Only residents that came to a new tile since the last call look around again, for a Player
 * that shares their sight, so a quiet tick costs next to nothing; a Player who joins an alliance
 * explores around its residents on the next call. The positions it remembers are scratch memory:
 * after a restart everyone looks around once.
 */
export class SightTracker {
  /** Per Player and resident (`userId:residentId`), the tile they last looked around from. */
  private lastSeenFrom = new Map<string, string>()

  /** Explores around residents that moved; returns, per Player, the chunks that grew. */
  update(world: WorldState, explored: ExploredTerrain): Map<number, Set<number>> {
    const userOf = new Map(world.realms.map((r) => [r.id, r.userId]))
    // Per realm, and per NPC city in an alliance, the Players who see through its residents.
    const viewersOf = new Map<string, number[]>()
    const members = [
      ...world.realms.map((r) => r.id),
      ...world.alliances.flatMap((a) => a.members.map((m) => m.realmId)),
    ]
    for (const id of new Set(members)) {
      viewersOf.set(
        id,
        sharingSight(world, id).flatMap((x) => userOf.get(x) ?? []),
      )
    }
    const grown = new Map<number, Set<number>>()
    const looking = new Set<string>()
    for (const r of world.residents) {
      const by = commanderOf(world, r)
      const org = r.owner ?? r.cityId
      const viewers = [org, by === r.owner ? null : by].flatMap((id) =>
        id === null ? [] : (viewersOf.get(id) ?? []),
      )
      const here = `${r.x},${r.y}`
      for (const userId of new Set(viewers)) {
        const key = `${userId}:${r.id}`
        looking.add(key)
        if (this.lastSeenFrom.get(key) === here) continue
        this.lastSeenFrom.set(key, here)
        const chunks = explored.explore(userId, r.x, r.y, SIGHT_RANGE)
        if (chunks.size === 0) continue
        const mine = grown.get(userId) ?? new Set<number>()
        for (const c of chunks) mine.add(c)
        grown.set(userId, mine)
      }
    }
    for (const key of this.lastSeenFrom.keys()) if (!looking.has(key)) this.lastSeenFrom.delete(key)
    return grown
  }
}
