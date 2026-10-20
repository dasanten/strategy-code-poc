import {
  GOODS,
  MAP_SIZE,
  canWork,
  goodsAtSpot,
  materialsNeeded,
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
import { buildingOrganization, carriageOrganization, commitCrime } from './crimes.js'
import type { OrderKind, OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'
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
  }> | null
  if (s?.kind === 'ground') return { kind: 'ground' }
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
  const realm = realmOf(world, sender.userId)
  const r = world.residents.find((x) => x.id === o.residentId)
  if (!r || !realm || r.owner !== realm.id) return 'not one of your residents'
  if (!canWork(r, world.tick)) return 'children can’t pick up or put down goods'
  const spot = readSpot(o.spot)
  if (!spot) return 'the spot must be the ground, a storage, a construction site or a carriage'
  const goods = readGoods(o.goods)
  if (!goods) return 'goods must be whole units of known goods'
  if (spot.kind === 'storage' && storageAt(world, r.x, r.y)?.id !== spot.storageId) {
    return 'that storage is not on the resident’s tile'
  }
  if (spot.kind === 'site' && !siteAt(world, r.x, r.y, spot.siteId)) {
    return 'that construction site is not on the resident’s tile'
  }
  if (spot.kind === 'carriage' && !goodsAtSpot(world, r.x, r.y, spot)) {
    return 'that carriage is not on the resident’s tile'
  }
  return { r, spot, goods }
}

const has = (stock: Stock | undefined, goods: Stock) =>
  Object.keys(goods).some((g) => (stock?.[g as Good] ?? 0) > 0)

/**
 * The pick-up order (`CONTEXT.md`: Core rule): one of the Player's residents takes goods from the
 * pile, a storage, a construction site or a carriage on their tile. Nothing is protected yet, so anyone's
 * goods can be taken.
 */
export const pickUp: OrderKind = {
  validate(world, sender, order) {
    const c = check(world, sender, order)
    if (typeof c === 'string') return c
    if (!has(goodsAtSpot(world, c.r.x, c.r.y, c.spot), c.goods)) return 'none of those goods here'
    return undefined
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
 * nothing happens. Either way the order is done. Taking from another Organization's storage or
 * carriage is theft (`CONTEXT.md`: Crime), on a map of `size` tiles.
 */
export function resolveCarrying(world: WorldState, actions: CarryAction[], size = MAP_SIZE): void {
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    if (!r) continue
    if (a.kind === 'take') take(world, r, a, size)
    else put(world, r, a)
    if (r.order?.kind === 'pickUp' || r.order?.kind === 'drop') r.order = null
  }
}

function take(world: WorldState, r: Resident, a: CarryAction, size: number): void {
  const source =
    a.spot.kind === 'ground' ? pileAt(world, r.x, r.y)?.goods : spotStock(world, r, a.spot)
  if (!source) return
  const taken: Stock = {}
  for (const [good, wanted] of Object.entries(a.goods) as [Good, number][]) {
    const units = Math.min(wanted, source[good] ?? 0, unitsThatFit(r, good, world.tick))
    move(source, r.carried, good, units)
    if (units > 0) taken[good] = units
  }
  world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
  const victimOrg = spotOrganization(world, a.spot)
  if (victimOrg !== null && Object.keys(taken).length > 0) {
    commitCrime(world, size, 'theft', r, { victimOrg, goods: taken })
  }
}

/**
 * Whose goods a spot holds: a storage's city's Organization, or a carriage's. Piles on the ground
 * and construction sites belong to nobody.
 */
function spotOrganization(world: WorldState, spot: GoodsSpot): string | null {
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

function put(world: WorldState, r: Resident, a: CarryAction): void {
  // On the ground the goods go in the tile's pile; a storage or site that is gone takes nothing.
  const target = a.spot.kind === 'ground' ? {} : spotStock(world, r, a.spot)
  if (!target) return
  // A construction site takes only the materials it still needs, a carriage what fits on it.
  const room =
    a.spot.kind === 'site' ? materialsNeeded(siteAt(world, r.x, r.y, a.spot.siteId)!) : undefined
  const carriage = a.spot.kind === 'carriage' ? carriageOf(world, a.spot) : undefined
  for (const [good, wanted] of Object.entries(a.goods) as [Good, number][]) {
    const fits = carriage ? unitsThatFitCarriage(carriage, good) : Infinity
    const units = Math.min(wanted, r.carried[good] ?? 0, room ? (room[good] ?? 0) : fits)
    move(r.carried, target, good, units)
  }
  if (a.spot.kind === 'ground') dropGoods(world, r.x, r.y, target)
}

function carriageOf(world: WorldState, spot: { carriageId: string }) {
  return world.carriages.find((k) => k.id === spot.carriageId)
}

/**
 * The goods of the named storage or construction site, or the load of the named carriage, if it
 * stands on the resident's tile.
 */
function spotStock(world: WorldState, r: Resident, spot: GoodsSpot): Stock | undefined {
  if (spot.kind === 'carriage') return goodsAtSpot(world, r.x, r.y, spot)
  if (spot.kind === 'site') {
    return siteAt(world, r.x, r.y, spot.siteId)?.site!.delivered
  }
  const storage = storageAt(world, r.x, r.y)
  if (spot.kind !== 'storage' || storage?.id !== spot.storageId) return undefined
  return (storage.stock ??= {})
}
