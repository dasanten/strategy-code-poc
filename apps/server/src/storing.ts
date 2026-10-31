import {
  GOODS,
  MAP_SIZE,
  OWN_FOOD,
  canHandle,
  covers,
  putAwayUnits,
  wrapDistance,
  type FetchOrder,
  type Good,
  type GoodsPlace,
  type GoodsWanted,
  type Building,
  type OrderRequest,
  type Resident,
  type Stock,
  type StoreOrder,
  type WorldState,
} from '@csp/shared'
import type { CarryAction } from './carrying.js'
import { buildingOrganization, carriageOrganization } from './crimes.js'
import { orderedResident } from './order-sender.js'
import type { OrderKind, OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'
import { worldIndex } from './world-index.js'

/** The buildings a store or fetch order goes to: a storage, or a stable's storage. */
const PLACE_KINDS = ['storage', 'stable']

/**
 * The input of a store or fetch order: which resident, which goods, and where to (`to`) or from
 * (`from`), by id: a storage, a stable or one of the sender's carriages. Without it, the nearest
 * fitting place.
 */
interface StoringRequest extends OrderRequest {
  residentId: string
  goods: unknown
  to?: unknown
  from?: unknown
  /** Store: the Food to keep on them and top up to, in units; `OWN_FOOD` when absent. */
  ownFood?: unknown
}

/**
 * The order's goods as plain data: a list of known goods (as many as there are of each), or
 * known goods with whole positive units or null. At least one.
 */
export function readWanted(goods: unknown): GoodsWanted | undefined {
  const known = (g: unknown) => (GOODS as readonly unknown[]).includes(g)
  const out: GoodsWanted = {}
  if (Array.isArray(goods)) {
    for (const g of goods) {
      if (!known(g)) return undefined
      out[g as Good] = null
    }
  } else if (typeof goods === 'object' && goods !== null) {
    for (const [g, units] of Object.entries(goods)) {
      if (!known(g)) return undefined
      if (units !== null && (!Number.isInteger(units) || (units as number) <= 0)) return undefined
      out[g as Good] = units as number | null
    }
  } else return undefined
  return Object.keys(out).length > 0 ? out : undefined
}

/** The Organization the sender orders for: their realm, or the NPC city running defaults. */
function sideOf(world: WorldState, sender: OrderSender): string | undefined {
  return sender.npcCityId ?? realmOf(world, sender.userId)?.id
}

/**
 * The place an id names: a finished storage or stable, anyone's, or a carriage of the sender's
 * own. An id may also come as anything with an `id`, such as a building a script holds.
 */
function namedPlace(world: WorldState, side: string | undefined, id: unknown) {
  const key = typeof id === 'object' && id !== null ? (id as { id?: unknown }).id : id
  if (typeof key !== 'string') return undefined
  const b = world.buildings.find((x) => x.id === key)
  if (b) {
    return PLACE_KINDS.includes(b.kind) && !b.site
      ? ({ kind: 'storage', storageId: b.id } as const)
      : undefined
  }
  const k = world.carriages.find((x) => x.id === key)
  return k && side !== undefined && carriageOrganization(k) === side
    ? ({ kind: 'carriage', carriageId: k.id } as const)
    : undefined
}

/** Where a place stands now; undefined once it is gone. */
export function placeTile(
  world: WorldState,
  place: GoodsPlace,
): { x: number; y: number } | undefined {
  if (place.kind === 'carriage') return worldIndex(world).carriageById(place.carriageId)
  return finishedStorage(world, place.storageId)
}

/** The goods at a place, wherever it stands. */
function placeStock(world: WorldState, place: GoodsPlace): Stock | undefined {
  if (place.kind === 'carriage') return worldIndex(world).carriageById(place.carriageId)?.load
  const b = finishedStorage(world, place.storageId)
  return b && (b.stock ?? {})
}

/** Whether the resident stands at the place: on a tile of the building, or the carriage's. */
function atPlace(world: WorldState, r: Resident, place: GoodsPlace): boolean {
  if (place.kind === 'carriage') {
    const k = worldIndex(world).carriageById(place.carriageId)
    return k?.x === r.x && k.y === r.y
  }
  const b = finishedStorage(world, place.storageId)
  return b !== undefined && covers(b, r.x, r.y)
}

/**
 * The units of each good a store order puts: those asked for, or all carried but own food
 * (`ownFood` units).
 */
function toStore(r: Resident, goods: GoodsWanted, ownFood = OWN_FOOD): Stock {
  const out: Stock = {}
  for (const [good, units] of Object.entries(goods) as [Good, number | null][]) {
    const carried = r.carried[good] ?? 0
    const n = units === null ? putAwayUnits(good, carried, ownFood) : Math.min(units, carried)
    if (n > 0) out[good] = n
  }
  return out
}

/** The nearest of `places` to the resident, the short way round the map. */
function nearest<T extends { x: number; y: number }>(r: Resident, places: T[], size: number) {
  let best: T | undefined
  let bestDistance = Infinity
  for (const p of places) {
    const d = wrapDistance(size, r, p)
    if (d < bestDistance) {
      best = p
      bestDistance = d
    }
  }
  return best
}

/**
 * Where a store order goes: `to`, or the nearest finished storage of the sender's realm (of
 * their city, for an NPC city's sender). A reason when there is none.
 */
function storePlace(
  world: WorldState,
  sender: OrderSender,
  r: Resident,
  to: unknown,
  size: number,
): GoodsPlace | string {
  const side = sideOf(world, sender)
  if (to !== undefined && to !== null) {
    return namedPlace(world, side, to) ?? 'to must be a storage, a stable or a carriage of yours'
  }
  const storages = world.buildings.filter(
    (b) => b.kind === 'storage' && !b.site && buildingOrganization(world, b) === side,
  )
  const b = nearest(r, storages, size)
  return b ? { kind: 'storage', storageId: b.id } : 'no storage'
}

/**
 * Where a fetch order goes: `from`, or the nearest finished storage or carriage of the sender's
 * holding any of the goods. A reason when there is none.
 */
function fetchPlace(
  world: WorldState,
  sender: OrderSender,
  r: Resident,
  from: unknown,
  goods: GoodsWanted,
  size: number,
): GoodsPlace | string {
  const side = sideOf(world, sender)
  if (from !== undefined && from !== null) {
    return (
      namedPlace(world, side, from) ?? 'from must be a storage, a stable or a carriage of yours'
    )
  }
  const holds = (stock: Stock | undefined) =>
    Object.keys(goods).some((g) => (stock?.[g as Good] ?? 0) > 0)
  const places = [
    ...world.buildings
      .filter(
        (b) =>
          b.kind === 'storage' &&
          !b.site &&
          buildingOrganization(world, b) === side &&
          holds(b.stock),
      )
      .map((b) => ({ x: b.x, y: b.y, place: { kind: 'storage', storageId: b.id } as const })),
    ...world.carriages
      .filter((k) => side !== undefined && carriageOrganization(k) === side && holds(k.load))
      .map((k) => ({ x: k.x, y: k.y, place: { kind: 'carriage', carriageId: k.id } as const })),
  ]
  return nearest(r, places, size)?.place ?? 'nothing of yours holds those goods'
}

/** Checks what store and fetch orders share; returns the resident and goods or a reason. */
function check(world: WorldState, sender: OrderSender, order: OrderRequest) {
  const o = order as Partial<StoringRequest>
  const r = orderedResident(world, sender, o.residentId)
  if (!r) return 'not one of your residents'
  const goods = readWanted(o.goods)
  if (!goods) return 'goods must be a list of goods, or whole units of known goods'
  if (!canHandle(r, world.tick, Object.keys(goods))) return 'children can’t store or fetch goods'
  return { r, goods, o }
}

/** A new order: walking, or straight to work when the resident already stands at the place. */
function start<O extends StoreOrder | FetchOrder>(
  world: WorldState,
  r: Resident,
  place: GoodsPlace,
  order: Omit<O, 'phase' | 'path' | 'progress'>,
  there: O['phase'],
): O {
  delete r.orderEnded
  const phase = atPlace(world, r, place) ? there : 'walking'
  return { ...order, phase, path: null, progress: 0 } as O
}

/** A store order's `ownFood`: absent, or units of zero or more; null when it is neither. */
function readOwnFood(ownFood: unknown): number | undefined | null {
  if (ownFood === undefined || ownFood === null) return undefined
  return typeof ownFood === 'number' && Number.isFinite(ownFood) && ownFood >= 0 ? ownFood : null
}

/**
 * The store order (`CONTEXT.md`: Store): one of the Player's residents walks to `to` (by default
 * the nearest storage of their realm), puts down the goods there and, at a storage with Food, tops
 * up their own food to `ownFood` units, `OWN_FOOD` unless asked (Getting food).
 */
export const store: OrderKind = {
  validate(world, sender, order, terrain) {
    const c = check(world, sender, order)
    if (typeof c === 'string') return c
    const ownFood = readOwnFood(c.o.ownFood)
    if (ownFood === null) return 'ownFood must be units of Food, zero or more'
    if (Object.keys(toStore(c.r, c.goods, ownFood)).length === 0) {
      return 'not carrying any of those goods'
    }
    const to = storePlace(world, sender, c.r, c.o.to, terrain?.size ?? MAP_SIZE)
    return typeof to === 'string' ? to : undefined
  },
  apply(world, sender, order, terrain) {
    const c = check(world, sender, order)
    if (typeof c === 'string') return
    const ownFood = readOwnFood(c.o.ownFood)
    if (ownFood === null) return
    const to = storePlace(world, sender, c.r, c.o.to, terrain?.size ?? MAP_SIZE)
    if (typeof to === 'string') return
    c.r.order = start<StoreOrder>(
      world,
      c.r,
      to,
      { kind: 'store', goods: c.goods, to, ...(ownFood === undefined ? {} : { ownFood }) },
      'putting',
    )
  },
}

/**
 * The fetch order (`CONTEXT.md`: Fetch): one of the Player's residents walks to `from` (by
 * default the nearest storage or carriage of their realm holding the goods) and takes the goods
 * there, as much as fits.
 */
export const fetch: OrderKind = {
  validate(world, sender, order, terrain) {
    const c = check(world, sender, order)
    if (typeof c === 'string') return c
    const from = fetchPlace(world, sender, c.r, c.o.from, c.goods, terrain?.size ?? MAP_SIZE)
    return typeof from === 'string' ? from : undefined
  },
  apply(world, sender, order, terrain) {
    const c = check(world, sender, order)
    if (typeof c === 'string') return
    const from = fetchPlace(world, sender, c.r, c.o.from, c.goods, terrain?.size ?? MAP_SIZE)
    if (typeof from === 'string') return
    c.r.order = start<FetchOrder>(
      world,
      c.r,
      from,
      { kind: 'fetch', goods: c.goods, from },
      'taking',
    )
  },
}

/** A store or fetch order's place. */
export function placeOf(o: StoreOrder | FetchOrder): GoodsPlace {
  return o.kind === 'store' ? o.to : o.from
}

/**
 * Ends the resident's order. A store or fetch order says how it ended (`OrderEnded`): `reason`
 * null when it was done, else why not.
 */
export function endOrder(world: WorldState, r: Resident, reason: string | null): void {
  const o = r.order
  if (o?.kind === 'store' || o?.kind === 'fetch') {
    r.orderEnded = { kind: o.kind, tick: world.tick, reason }
  }
  r.order = null
}

/**
 * Requests this tick's take and put actions from store and fetch orders at their place. An order
 * whose place is gone ends; one whose resident isn't at its place (a carriage moved on) walks
 * there again.
 */
export function requestStoring(world: WorldState): CarryAction[] {
  const actions: CarryAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'store' && o?.kind !== 'fetch') continue
    const place = placeOf(o)
    if (!placeTile(world, place)) {
      endOrder(world, r, place.kind === 'carriage' ? 'the carriage is gone' : 'the storage is gone')
      continue
    }
    if (o.phase === 'walking') continue
    if (!atPlace(world, r, place)) {
      o.phase = 'walking'
      o.path = null
      o.progress = 0
      continue
    }
    const action = (kind: CarryAction['kind'], goods: Stock) =>
      actions.push({ kind, residentId: r.id, spot: place, goods })
    if (o.kind === 'fetch') {
      // As many as there are: take clips them to what is there and fits.
      const goods: Stock = {}
      for (const [good, units] of Object.entries(o.goods) as [Good, number | null][]) {
        goods[good] = units ?? Number.MAX_SAFE_INTEGER
      }
      action('take', goods)
    } else if (o.phase === 'putting') action('put', toStore(r, o.goods, o.ownFood))
    else action('take', { food: Math.max(0, (o.ownFood ?? OWN_FOOD) - (r.carried.food ?? 0)) })
  }
  return actions
}

/**
 * After a store or fetch order's take or put (`resolveCarrying`): a store at a storage with Food
 * goes on to top up own food when it is short; otherwise the order is done.
 */
export function carriedForOrder(world: WorldState, r: Resident): void {
  const o = r.order
  if (o?.kind === 'store' && o.phase === 'putting') {
    const food = o.to.kind === 'storage' ? (placeStock(world, o.to)?.food ?? 0) : 0
    const isStorage = world.buildings.some(
      (b) => o.to.kind === 'storage' && b.id === o.to.storageId && b.kind === 'storage',
    )
    if (isStorage && food > 0 && (r.carried.food ?? 0) < (o.ownFood ?? OWN_FOOD)) {
      o.phase = 'refilling'
      return
    }
  }
  if (o?.kind === 'store' || o?.kind === 'fetch') endOrder(world, r, null)
}

/** The building `id`, if it is finished: a storage a store or fetch order may use. */
function finishedStorage(world: WorldState, id: string): Building | undefined {
  const b = worldIndex(world).buildingById(id)
  return b && !b.site ? b : undefined
}
