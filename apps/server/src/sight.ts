import {
  SIGHT_RANGE,
  cityPrice,
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
  carriageCapacity,
  passengersOf,
  tradeCoinWarehouse,
  warehousePrices,
  type Army,
  type Building,
  type BuildingKind,
  type RunningScript,
  type SeenScript,
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
import { worldIndex } from './world-index.js'

/** A spot something can be seen from or at. */
interface Spot {
  x: number
  y: number
}

/** Whether any of a side's observers is within sight range of a spot, plus `reach` (`eyesOf`). */
interface Eyes {
  size: number
  sees(at: Spot, reach?: number): boolean
  /** The squares (`squaresOf`) anything in sight can stand in. */
  watched: ReadonlySet<number>
}

/**
 * The map cut into squares at least twice the sight range across, so what is in sight of someone
 * stands in their square or one next to it: `square` gives the column or row of a coordinate.
 */
function squaresOf(size: number) {
  const across = Math.max(1, Math.floor(size / (2 * SIGHT_RANGE)))
  const side = size / across
  const square = (v: number) =>
    Math.min(across - 1, Math.floor((((v % size) + size) % size) / side))
  return { across, square, key: (at: Spot) => square(at.y) * across + square(at.x) }
}

/**
 * Where each building stands, by square (`squaresOf`): its place in `world.buildings`. Made
 * once for a tick, it lets every realm look only at the buildings near its observers (`places`).
 * A building's footprint is far smaller than a square, so its corner's square will do.
 */
export function buildingsBySquare(world: WorldState, size: number): Map<number, number[]> {
  const { key } = squaresOf(size)
  const out = new Map<number, number[]>()
  world.buildings.forEach((b, i) => {
    const k = key(b)
    const list = out.get(k)
    if (list) list.push(i)
    else out.set(k, [i])
  })
  return out
}

/**
 * The observers' eyes: whether any of them is within sight range of a spot, plus `reach` (at
 * most `SIGHT_RANGE`). The observers are sorted into squares (`squaresOf`), so a spot is
 * checked only against those in its square and the ones next to it.
 */
function eyesOf(size: number, observers: Spot[]): Eyes {
  const { across, square } = squaresOf(size)
  // The squares next to one, across the joins; on a map only a few squares across, every one.
  const steps = across < 3 ? [...Array(across).keys()] : [-1, 0, 1]
  const around = (s: number, d: number) => (across < 3 ? d : (s + d + across) % across)
  const grid = new Map<number, Spot[]>()
  // The squares with an observer in or next to them: anywhere else nothing is seen.
  const watched = new Set<number>()
  for (const o of observers) {
    const [sx, sy] = [square(o.x), square(o.y)]
    const key = sy * across + sx
    const list = grid.get(key)
    if (list) list.push(o)
    else grid.set(key, [o])
    for (const dy of steps) {
      for (const dx of steps) watched.add(around(sy, dy) * across + around(sx, dx))
    }
  }
  return {
    size,
    watched,
    sees: (at, reach = 0) => {
      const [sx, sy] = [square(at.x), square(at.y)]
      if (!watched.has(sy * across + sx)) return false
      for (const dy of steps) {
        for (const dx of steps) {
          const near = grid.get(around(sy, dy) * across + around(sx, dx))
          if (!near) continue
          for (const o of near) if (wrapDistance(size, o, at) <= SIGHT_RANGE + reach) return true
        }
      }
      return false
    },
  }
}

/** Whether any tile of a building's footprint is in sight of the observers (`CONTEXT.md`: Sight). */
function buildingSeen(eyes: Eyes, b: Placed): boolean {
  const side = FOOTPRINT[b.kind]
  if (side === 1) return eyes.sees(b)
  // Every tile of it is within this of its corner, so close enough to that, all of it is seen.
  const across = side * Math.SQRT2
  if (!eyes.sees(b, across)) return false
  if (eyes.sees(b, -across)) return true
  return footprintTiles(b, eyes.size).some(([x, y]) => eyes.sees({ x, y }))
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
  const index = worldIndex(world)
  return world.residents.filter((r) => {
    const by = index.commanderOf(r)
    const org = r.owner ?? r.cityId
    return (org !== null && members.has(org)) || (by !== null && members.has(by))
  })
}

/**
 * Whether a realm's Player, or an NPC city, sees a spot (`CONTEXT.md`: Sight): within sight
 * range of any of their residents or their alliance's, as `entitiesInSight` counts it.
 */
export function sightOf(world: WorldState, size: number, side: string): (at: Spot) => boolean {
  return sideSight(world, size, side).sees
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
  const index = worldIndex(world)
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
  const insideBuilding = (b: Building) =>
    ours(b.realmId ?? null, b.cityId) || at(b) || coinWarehouseSeen(b)
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
      const by = index.commanderOf(r)
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
 * A building as the side sees it: its stock and the breeding progress a stable keeps only when it
 * sees inside, and a Trade Org warehouse's prices either way (`CONTEXT.md`: Seeing inside a storage, Warehouse prices).
 */
function seenBuilding(world: WorldState, insight: Insight, b: Building): SeenBuilding {
  const inside = insight.insideBuilding(b)
  const shown: SeenBuilding = { ...b }
  if (!inside) {
    delete shown.stock
    delete shown.breedings
  }
  if (b.kind === 'warehouse') {
    const prices = warehousePrices(world, b)
    if (prices.length > 0) shown.prices = shownLines(prices, inside)
  }
  return shown
}

/**
 * A carriage as the side sees it: how heavily it is loaded, its load only when it sees inside,
 * and who is aboard it.
 */
function seenCarriage(world: WorldState, insight: Insight, k: Carriage): SeenCarriage {
  const level = loadLevel(k.load, carriageCapacity(world, k))
  const passengerIds = passengersOf(world, k).map((r) => r.id)
  if (insight.insideCarriage(k)) return { ...k, loadLevel: level, passengerIds }
  const { id, realmId, cityId, x, y, horseId } = k
  return { id, realmId, cityId, x, y, horseId, loadLevel: level, passengerIds }
}

/**
 * What a Player sees of the script a resident runs (`SeenScript`): which one, and for the owning
 * Player (`own`) what goes into the resident's Doing line (`CONTEXT.md`: Doing): the task, the
 * kind of building the task is about, as its memory names it (`TaskMemory`), the text the
 * script gave `doing()`, and whether it waits (`CONTEXT.md`: Running a script, Waiting).
 */
export function seenScript(world: WorldState, script: RunningScript, own: boolean): SeenScript {
  if (!own) return { scriptId: script.scriptId }
  const { memory } = script
  const id = memory.workplaceId ?? memory.buildingId
  const building =
    typeof memory.building === 'string' && Object.hasOwn(FOOTPRINT, memory.building)
      ? (memory.building as BuildingKind)
      : world.buildings.find((b) => typeof id === 'string' && b.id === id)?.kind
  return {
    scriptId: script.scriptId,
    ...(script.task ? { task: script.task } : {}),
    ...(building ? { building } : {}),
    ...(typeof memory.doing === 'string' && memory.doing ? { doing: memory.doing } : {}),
    ...(script.waitingSince !== undefined ? { waiting: true as const } : {}),
  }
}

/**
 * A resident without their script log, which only the owning Player gets, on the Script tab
 * (`CONTEXT.md`: Script log); it never goes with the resident.
 */
export const withoutScriptLog = ({ scriptLog: _, ...rest }: Resident) => rest

/**
 * What a realm's Player sees (`CONTEXT.md`: Sight): everything within sight range of any of
 * their residents or their alliance's, their own things included. A city counts as seen when
 * any of it is. What is inside, and how residents and horses fare, only as `CONTEXT.md` says
 * (Seeing inside a storage, Seeing how someone fares). While a `SightCache` is open the list is
 * shared by everyone who asks, so nobody changes it or what is in it (both are frozen).
 */
export function entitiesInSight(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string | undefined,
): readonly SeenEntity[] {
  if (realmId === undefined) return []
  return sideSight(world, terrain.size, realmId).entities()
}

/** Everything in a side's sight, as `entitiesInSight` gives it. */
function everythingSeen(
  world: WorldState,
  realmId: string,
  eyes: Eyes,
  insight: Insight,
  seenPlaces: readonly SeenPlace[],
): SeenEntity[] {
  const inSight = (at: Spot) => eyes.sees(at)
  const index = worldIndex(world)
  const out: SeenEntity[] = []
  for (const r of world.residents) {
    if (!inSight(r)) continue
    // Which script a resident runs is seen; its memory stays on the server, and the values of
    // its params are shown only to the realm commanding them, all they keep (to fill in before a
    // script starts), as is the queue to the realm that gave it.
    // What a defence script interrupted goes on the owning Player's Doing line only, its memory
    // never; the defence script picked is the owning Player's to see too.
    const { script, scriptParams, queue, interrupted, defenceScriptId, ...rest } =
      withoutScriptLog(r)
    const kept = index.commanderOf(r) === realmId ? scriptParams : undefined
    const params = script ? kept?.[script.scriptId] : undefined
    const own = r.owner === realmId
    const shown: SeenEntity = {
      is: 'resident',
      ...rest,
      ...(kept ? { scriptParams: kept } : {}),
      ...(defenceScriptId !== undefined && own ? { defenceScriptId } : {}),
      ...(queue && queue.realmId === realmId ? { queue } : {}),
      ...(interrupted && own
        ? {
            interrupted: {
              order: interrupted.order,
              ...(interrupted.script
                ? { script: seenScript(world, interrupted.script, true) }
                : {}),
            },
          }
        : {}),
      ...(script
        ? {
            script: {
              ...seenScript(world, script, r.owner === realmId),
              ...(params ? { params } : {}),
            },
          }
        : {}),
    }
    if (!insight.fares(r)) {
      delete shown.hunger
      delete shown.health
      delete shown.struck
    }
    out.push(shown)
  }
  out.push(...seenPlaces)
  for (const h of world.horses) {
    if (!inSight(h)) continue
    const shown: SeenEntity = { is: 'horse', ...h }
    if (!insight.ours(h.realmId, h.cityId)) {
      delete shown.hunger
      delete shown.health
    }
    out.push(shown)
  }
  for (const k of world.carriages) {
    if (inSight(k)) out.push({ is: 'carriage', ...seenCarriage(world, insight, k) })
  }
  for (const p of world.piles) if (inSight(p)) out.push({ is: 'pile', ...p })
  // An army is seen through its members; the Player gets only their own.
  for (const a of world.armies) {
    if (a.realmId === realmId && armySeen(world, a, inSight)) {
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
    if (caravanSeen(world, c, inSight)) {
      const { id, postId, carriageId, driverId, escortIds, heading } = c
      out.push({ is: 'caravan', id, postId, carriageId, driverId, escortIds, heading })
    }
  }
  return out
}

/** A building or city as a Player sees it. */
export type SeenPlace = Extract<SeenEntity, { is: 'building' | 'city' }>

/** The buildings and cities in a realm's sight, as `entitiesInSight` shows them. */
function places(
  world: WorldState,
  realmId: string,
  eyes: Eyes,
  insight: Insight,
  bySquare?: Map<number, number[]>,
): SeenPlace[] {
  const out: SeenPlace[] = []
  const seenCities = new Set<string>()
  const seenStorages = new Set<string>()
  // Only the buildings near the observers, in the world's order, when they are sorted by square.
  const near = bySquare
    ? [...eyes.watched]
        .flatMap((k) => bySquare.get(k) ?? [])
        .sort((a, b) => a - b)
        .map((i) => world.buildings[i]!)
    : world.buildings
  for (const b of near) {
    if (!buildingSeen(eyes, b)) continue
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
  return out
}

/**
 * The buildings and cities a realm's Player sees, as `entitiesInSight` shows them, and whether
 * any tile of a footprint is in their sight (`CONTEXT.md`: Last seen). `bySquare`, from
 * `buildingsBySquare` this tick, saves looking at every building. `afresh` works it out apart
 * from any open `SightCache`, as an invariant should.
 */
export function placesInSight(
  world: WorldState,
  size: number,
  realmId: string,
  { bySquare, afresh = false }: { bySquare?: Map<number, number[]>; afresh?: boolean } = {},
): { seen: readonly SeenPlace[]; sees: (b: Placed) => boolean } {
  const sight = afresh ? new SideSight(world, size, realmId) : sideSight(world, size, realmId)
  return { seen: sight.places(bySquare), sees: sight.buildingSeen }
}

/**
 * What one side, a realm or an NPC city, sees (`CONTEXT.md`: Sight): who it sees through and
 * their eyes, worked out when it is made; its insight, the buildings and cities in its sight and
 * everything in its sight, each the first time it is asked for. What it hands out is frozen.
 */
class SideSight {
  private readonly observers: Spot[]
  private readonly eyes: Eyes
  private insight?: Insight
  private seenPlaces?: readonly SeenPlace[]
  private everything?: readonly SeenEntity[]

  constructor(
    private readonly world: WorldState,
    private readonly size: number,
    private readonly side: string,
  ) {
    this.observers = observersOf(world, side)
    this.eyes = eyesOf(size, this.observers)
  }

  readonly sees = (at: Spot): boolean => this.eyes.sees(at)

  readonly buildingSeen = (b: Placed): boolean => buildingSeen(this.eyes, b)

  private insightOf(): Insight {
    return (this.insight ??= insightOf(this.world, this.size, this.side, this.observers))
  }

  places(bySquare?: Map<number, number[]>): readonly SeenPlace[] {
    if (this.observers.length === 0) return []
    return (this.seenPlaces ??= frozen(
      places(this.world, this.side, this.eyes, this.insightOf(), bySquare),
    ))
  }

  entities(): readonly SeenEntity[] {
    if (this.observers.length === 0) return []
    return (this.everything ??= frozen(
      everythingSeen(this.world, this.side, this.eyes, this.insightOf(), this.places()),
    ))
  }
}

/** A list and what is in it, frozen, since everyone who asks this phase shares them. */
function frozen<T extends object>(list: T[]): readonly T[] {
  for (const e of list) Object.freeze(e)
  return Object.freeze(list)
}

/**
 * What each side sees, worked out once per phase of a tick and shared by everyone who asks: the
 * scripts, the NPC scripts, Last seen and sync (Epic 49). A tick has three phases: the scripts
 * run before the world steps, the NPC scripts inside it, Last seen and sync once it has stepped;
 * `newSightPhase` starts the next. Scratch memory like the pathfinder's: never saved, never world
 * state (ADR 0006). The sight invariants work theirs out on their own.
 */
export class SightCache {
  /** How many times a side's sight was worked out since the cache opened (tick health). */
  builds = 0
  private readonly sides = new Map<string, SideSight>()

  constructor(readonly size: number) {}

  side(world: WorldState, side: string): SideSight {
    let sight = this.sides.get(side)
    if (!sight) {
      sight = new SideSight(world, this.size, side)
      this.sides.set(side, sight)
      this.builds++
    }
    return sight
  }

  /** Forgets every side's sight: the world has moved on since. */
  newPhase(): void {
    this.sides.clear()
  }
}

const openCaches = new WeakMap<WorldState, SightCache>()

/** Opens a sight cache for the world, in place of any open one, until `closeSight`. */
export function openSight(world: WorldState, size: number): SightCache {
  const cache = new SightCache(size)
  openCaches.set(world, cache)
  return cache
}

/** Closes the world's sight cache: from then on each caller works sight out for itself. */
export function closeSight(world: WorldState): void {
  openCaches.delete(world)
}

/** Starts the next phase of the world's open sight cache, if one is open (`SightCache`). */
export function newSightPhase(world: WorldState): void {
  openCaches.get(world)?.newPhase()
}

/** Runs `fn` with a sight cache open: the open one, or one opened for it and closed after. */
export function withSight<T>(world: WorldState, size: number, fn: () => T): T {
  if (openCaches.has(world)) return fn()
  openSight(world, size)
  try {
    return fn()
  } finally {
    closeSight(world)
  }
}

/** A side's sight: from the open cache, or worked out for this caller alone without one. */
function sideSight(world: WorldState, size: number, side: string): SideSight {
  const cache = openCaches.get(world)
  return cache?.size === size ? cache.side(world, side) : new SideSight(world, size, side)
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
  const eyes = eyesOf(terrain.size, observersOf(world, realmId))
  const inSight = (at: Spot) => eyes.sees(at)
  const out = sent.filter((e) =>
    e.is === 'city'
      ? !world.buildings.some((b) => b.cityId === e.id && buildingSeen(eyes, b))
      : e.is === 'army'
        ? !armySeen(world, e, inSight)
        : e.is === 'caravan'
          ? !caravanSeen(world, e, inSight)
          : e.is === 'building'
            ? !buildingSeen(eyes, e)
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
        const told = e.hunger !== undefined || e.health !== undefined || e.struck !== undefined
        return told && !(r && insight.fares(r))
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
    const index = worldIndex(world)
    for (const r of world.residents) {
      const by = index.commanderOf(r)
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
