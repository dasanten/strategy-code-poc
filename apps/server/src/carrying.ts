import {
  GOODS,
  MAP_SIZE,
  canHandle,
  commanderOf,
  downOn,
  freeStock,
  goodsAtSpot,
  materialsNeeded,
  outpostStorageGuarded,
  pileAt,
  siteAt,
  storageAt,
  unitsThatFit,
  unitsThatFitCarriage,
  type Good,
  type GoodsSpot,
  type OrderRequest,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { finishSite } from './building.js'
import { updateCityMembership } from './cities.js'
import { robCaravan } from './caravans.js'
import {
  buildingOrganization,
  carriageOrganization,
  commitCrime,
  organizationOf,
} from './crimes.js'
import { collectsFrom } from './deliveries.js'
import { collectsTransferFrom } from './transfers.js'
import { orderedResident } from './order-sender.js'
import { carriedForOrder } from './storing.js'
import type { OrderKind, OrderSender } from './orders.js'
import { dropGoods } from './survival.js'

/**
 * An action a resident requests: take goods from a spot on their tile, or put carried goods
 * there. The world checks and resolves it at the end of the tick.
 */
export interface CarryAction {
  kind: 'take' | 'put'
  residentId: string
  spot: GoodsSpot
  goods: Stock
}

/** The input of a pick-up or drop order: which resident, the spot on their tile, which goods. */
interface CarryRequest extends OrderRequest {
  residentId: string
  spot: GoodsSpot
  goods: Stock
}

/** The order's goods as plain data: known goods, whole positive units, at least one. */
function readGoods(goods: unknown): Stock | undefined {
  if (typeof goods !== 'object' || goods === null) return undefined
  const out: Stock = {}
  for (const [good, units] of Object.entries(goods)) {
    if (!(GOODS as readonly string[]).includes(good)) return undefined
    if (!Number.isInteger(units) || (units as number) <= 0) return undefined
    out[good as Good] = units as number
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function readSpot(spot: unknown): GoodsSpot | undefined {
  const s = spot as Partial<{
    kind: string
    storageId: unknown
    siteId: unknown
    carriageId: unknown
    residentId: unknown
  }> | null
  if (s?.kind === 'ground') return { kind: 'ground' }
  if (s?.kind === 'resident' && typeof s.residentId === 'string') {
    return { kind: 'resident', residentId: s.residentId }
  }
  if (s?.kind === 'carriage' && typeof s.carriageId === 'string') {
    return { kind: 'carriage', carriageId: s.carriageId }
  }
  if (s?.kind === 'storage' && typeof s.storageId === 'string') {
    return { kind: 'storage', storageId: s.storageId }
  }
  if (s?.kind === 'site' && typeof s.siteId === 'string') return { kind: 'site', siteId: s.siteId }
  return undefined
}

/** Checks what pick-up and drop orders share; returns the resident or a reason to reject. */
function check(world: WorldState, sender: OrderSender, order: OrderRequest) {
  const o = order as Partial<CarryRequest>
  const r = orderedResident(world, sender, o.residentId)
  if (!r) return 'not one of your residents'
  const spot = readSpot(o.spot)
  if (!spot)
    return 'the spot must be the ground, a storage, a construction site, a carriage or a Down resident'
  const goods = readGoods(o.goods)
  if (!goods) return 'goods must be whole units of known goods'
  if (!canHandle(r, world.tick, Object.keys(goods)))
    return 'children can’t pick up or put down goods'
  if (spot.kind === 'storage' && storageAt(world, r.x, r.y)?.id !== spot.storageId) {
    return 'the resident is not at that storage'
  }
  if (spot.kind === 'site' && !siteAt(world, r.x, r.y, spot.siteId)) {
    return 'the resident is not at that construction site'
  }
  if (spot.kind === 'carriage' && !goodsAtSpot(world, r.x, r.y, spot)) {
    return 'that carriage is not on the resident’s tile'
  }
  if (spot.kind === 'resident' && !downOn(world, r.x, r.y, spot.residentId)) {
    return 'nobody of that id lies Down on the resident’s tile'
  }
  return { r, spot, goods }
}

const has = (stock: Stock | undefined, goods: Stock) =>
  Object.keys(goods).some((g) => (stock?.[g as Good] ?? 0) > 0)

/**
 * The pick-up order (`CONTEXT.md`: Core rule): one of the Player's residents takes goods from the
 * pile, a storage, a construction site or a carriage on their tile, or from what a Down resident
 * lying there carries (`CONTEXT.md`: Down). Nothing is protected yet, so anyone's goods can be
 * taken.
 */
export const pickUp: OrderKind = {
  validate(world, sender, order) {
    const c = check(world, sender, order)
    if (typeof c === 'string') return c
    const here = goodsAtSpot(world, c.r.x, c.r.y, c.spot)
    if (!has(here, c.goods)) return 'none of those goods here'
    const free = takeableFrom(world, c.r, c.spot, here!, false)
    return has(free, c.goods) ? undefined : 'those goods are set aside for an offer'
  },
  apply(world, _sender, order) {
    const { residentId, spot, goods } = order as CarryRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'pickUp', from: readSpot(spot)!, goods: readGoods(goods)! }
  },
}

/**
 * The drop order: one of the Player's residents puts down carried goods on their tile. Delivered
 * to a construction site, only what it still needs goes in; the rest stays carried.
 */
export const drop: OrderKind = {
  validate(world, sender, order) {
    const c = check(world, sender, order)
    if (typeof c === 'string') return c
    if (!has(c.r.carried, c.goods)) return 'not carrying any of those goods'
    // Food goes into a Down resident's hands by feeding them (`CONTEXT.md`: Reviving).
    if (c.spot.kind === 'resident') return 'goods can’t be put down on a resident'
    if (
      c.spot.kind === 'site' &&
      !has(materialsNeeded(siteAt(world, c.r.x, c.r.y, c.spot.siteId)!), c.goods)
    ) {
      return 'the construction site needs none of those goods'
    }
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, spot, goods } = order as CarryRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = { kind: 'drop', to: readSpot(spot)!, goods: readGoods(goods)! }
  },
}

/** Requests this tick's take and put actions from residents' pick-up and drop orders. */
export function requestCarrying(world: WorldState): CarryAction[] {
  const actions: CarryAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind === 'pickUp')
      actions.push({ kind: 'take', residentId: r.id, spot: o.from, goods: o.goods })
    else if (o?.kind === 'drop')
      actions.push({ kind: 'put', residentId: r.id, spot: o.to, goods: o.goods })
  }
  return actions
}

/** Moves units of one good between two stocks, dropping a good that reaches 0. */
function move(from: Stock, to: Stock, good: Good, units: number): void {
  if (units <= 0) return
  const left = (from[good] ?? 0) - units
  if (left > 0) from[good] = left
  else delete from[good]
  to[good] = (to[good] ?? 0) + units
}

/**
 * Resolves take and put actions (ADR 0002), one after another, so two residents never take the
 * same goods. A take gets what is still at the spot on the resident's own tile, whole units that
 * fit their carry capacity; a put puts down what they still carry. A spot that is gone means
 * nothing happens. Either way the order is done; a store or fetch order goes on or ends
 * (`carriedForOrder`). Taking from another Organization's storage, carriage or Down resident is
 * theft (`CONTEXT.md`: Crime, Down), on a map of `size` tiles, and taking from a caravan's
 * carriage robs it (`robCaravan`). Nobody but its realm takes from a guarded outpost storage.
 */
export function resolveCarrying(world: WorldState, actions: CarryAction[], size = MAP_SIZE): void {
  const robbed = new Set<string>()
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    if (!r) continue
    if (a.kind === 'take') take(world, r, a, size, robbed)
    else put(world, r, a, size)
    if (r.order?.kind === 'pickUp' || r.order?.kind === 'drop') r.order = null
    else carriedForOrder(world, r)
  }
}

function take(
  world: WorldState,
  r: Resident,
  a: CarryAction,
  size: number,
  robbed: Set<string>,
): void {
  const source =
    a.spot.kind === 'ground' ? pileAt(world, r.x, r.y)?.goods : spotStock(world, r, a.spot)
  if (!source || guardedFrom(world, r, a.spot, size)) return
  // A caravan collecting a pick-up takes what was sold to it (`CONTEXT.md`: Delivery), one
  // collecting a transfer what it was given to carry (`CONTEXT.md`: Transfer).
  const sold =
    a.spot.kind === 'storage' &&
    (collectsFrom(world, r, a.spot.storageId) || collectsTransferFrom(world, r, a.spot.storageId))
  const free = takeableFrom(world, r, a.spot, source, sold)
  const taken: Stock = {}
  for (const [good, wanted] of Object.entries(a.goods) as [Good, number][]) {
    const units = Math.min(wanted, free[good] ?? 0, unitsThatFit(r, good, world.tick))
    move(source, r.carried, good, units)
    if (units > 0) taken[good] = units
  }
  world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
  const victimOrg = spotOrganization(world, a.spot)
  if (victimOrg !== null && !sold && Object.keys(taken).length > 0) {
    const victim =
      a.spot.kind === 'resident' ? downOn(world, r.x, r.y, a.spot.residentId) : undefined
    commitCrime(world, size, 'theft', r, { victimOrg, goods: taken, ...(victim && { victim }) })
  }
  if (a.spot.kind === 'carriage' && Object.keys(taken).length > 0) {
    robCaravan(world, r, a.spot.carriageId, robbed)
  }
}

/**
 * What `r` can take of the goods `source` at a spot (`CONTEXT.md`: Offer): the storage's own side,
 * and a caravan collecting there (`sold`), leave what is set aside for offers alone. A thief takes
 * it like any other goods, cutting the offer down.
 */
function takeableFrom(
  world: WorldState,
  r: Resident,
  spot: GoodsSpot,
  source: Stock,
  sold: boolean,
): Stock {
  if (spot.kind !== 'storage') return source
  const org = spotOrganization(world, spot)
  const theirs = org !== null && (organizationOf(r) === org || commanderOf(world, r) === org)
  return theirs || sold ? freeStock(world, { id: spot.storageId, stock: source }) : source
}

/**
 * Whether a spot is an outpost storage guarded against `r` (`CONTEXT.md`: Outpost storage): it is
 * guarded and `r` is not of its realm.
 */
function guardedFrom(world: WorldState, r: Resident, spot: GoodsSpot, size: number): boolean {
  if (spot.kind !== 'storage') return false
  const b = world.buildings.find((x) => x.id === spot.storageId)
  return !!b && r.owner !== b.realmId && outpostStorageGuarded(world, b, size)
}

/**
 * Whose goods a spot holds: a storage's city's Organization, a carriage's, or a Down resident's.
 * Piles on the ground and construction sites belong to nobody.
 */
function spotOrganization(world: WorldState, spot: GoodsSpot): string | null {
  if (spot.kind === 'resident') {
    const d = world.residents.find((x) => x.id === spot.residentId)
    return d ? organizationOf(d) : null
  }
  if (spot.kind === 'storage') {
    const b = world.buildings.find((x) => x.id === spot.storageId)
    return b ? buildingOrganization(world, b) : null
  }
  if (spot.kind === 'carriage') {
    const k = carriageOf(world, spot)
    return k ? carriageOrganization(k) : null
  }
  return null
}

/**
 * Puts down goods. The last materials delivered to a site that has all its work finish it
 * (`finishSite`).
 */
function put(world: WorldState, r: Resident, a: CarryAction, size: number): void {
  // On the ground the goods go in the tile's pile; a storage or site that is gone takes nothing,
  // nor does a Down resident: Food goes into their hands by feeding (`CONTEXT.md`: Reviving).
  if (a.spot.kind === 'resident') return
  const target = a.spot.kind === 'ground' ? {} : spotStock(world, r, a.spot)
  if (!target) return
  // A construction site takes only the materials it still needs, a carriage what fits on it.
  const room =
    a.spot.kind === 'site' ? materialsNeeded(siteAt(world, r.x, r.y, a.spot.siteId)!) : undefined
  const carriage = a.spot.kind === 'carriage' ? carriageOf(world, a.spot) : undefined
  for (const [good, wanted] of Object.entries(a.goods) as [Good, number][]) {
    const fits = carriage ? unitsThatFitCarriage(world, carriage, good) : Infinity
    const units = Math.min(wanted, r.carried[good] ?? 0, room ? (room[good] ?? 0) : fits)
    move(r.carried, target, good, units)
  }
  if (a.spot.kind === 'ground') dropGoods(world, r.x, r.y, target)
  const site = a.spot.kind === 'site' && siteAt(world, r.x, r.y, a.spot.siteId)
  if (site && finishSite(world, site, r)) updateCityMembership(world, size)
}

function carriageOf(world: WorldState, spot: { carriageId: string }) {
  return world.carriages.find((k) => k.id === spot.carriageId)
}

/**
 * The goods of the named storage or construction site, the load of the named carriage, or what
 * the named Down resident carries, if it stands or they lie on the resident's tile.
 */
function spotStock(world: WorldState, r: Resident, spot: GoodsSpot): Stock | undefined {
  if (spot.kind === 'carriage' || spot.kind === 'resident')
    return goodsAtSpot(world, r.x, r.y, spot)
  if (spot.kind === 'site') {
    return siteAt(world, r.x, r.y, spot.siteId)?.site!.delivered
  }
  const storage = storageAt(world, r.x, r.y)
  if (spot.kind !== 'storage' || storage?.id !== spot.storageId) return undefined
  return (storage.stock ??= {})
}
