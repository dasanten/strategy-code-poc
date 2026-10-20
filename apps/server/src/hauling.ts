import {
  commands,
  commandsCarriage,
  CARRIAGE_CAPACITY,
  GOODS,
  GOOD_WEIGHT,
  carriageCanEnter,
  driveProblem,
  goodsAtSpot,
  haulStopSpot,
  terrainAt,
  unitsThatFit,
  unitsThatFitCarriage,
  type Carriage,
  type Good,
  type GoodsSpot,
  type HaulOrder,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import type { CarryAction } from './carrying.js'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/**
 * The input of a haul order: which resident drives which carriage from the tile they share to
 * the other stop (x, y), which goods go there and which come back (none if left out), and how
 * much Food stays on board for the horse.
 */
interface HaulRequest extends OrderRequest {
  kind: 'haul'
  residentId: string
  carriageId: string
  x: number
  y: number
  goods: Good[]
  returnGoods?: Good[]
  keepFood: number
}

/** The order's goods as plain data: known goods, each once, at least `min` of them. */
function readGoods(goods: unknown, min = 1): Good[] | undefined {
  if (!Array.isArray(goods) || goods.length < min) return undefined
  if (!goods.every((g) => (GOODS as readonly unknown[]).includes(g))) return undefined
  return new Set(goods).size === goods.length ? (goods as Good[]) : undefined
}

/**
 * The haul order (`CONTEXT.md`: Haul route): one of the Player's adult residents drives one of
 * the Player's carriages between the tile they share, where the goods are loaded, and another
 * tile, where they are unloaded and the return goods loaded, again and again until given another
 * order. Like driving, it only sets the order; later ticks request the steps (`Walking`) and the
 * takes and puts (`requestHauling`).
 */
export const haul: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<HaulRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    const carriage = world.carriages.find((k) => k.id === o.carriageId)
    if (!commandsCarriage(world, realm.id, carriage)) return 'not one of your carriages'
    if (!Number.isInteger(o.x) || !Number.isInteger(o.y)) return 'the other stop must be a tile'
    if (o.x === r.x && o.y === r.y) return 'the other stop must be another tile'
    if (terrain && !carriageCanEnter(terrainAt(terrain, o.x!, o.y!))) {
      return 'a carriage can’t go there'
    }
    const goods = readGoods(o.goods)
    if (!goods) return 'pick the goods to haul'
    const back = readGoods(o.returnGoods ?? [], 0)
    if (!back || back.some((g) => goods.includes(g))) {
      return 'pick the goods to haul back, none of them hauled there'
    }
    const food = o.keepFood
    if (!Number.isInteger(food) || food! < 0 || food! * GOOD_WEIGHT.food > CARRIAGE_CAPACITY) {
      return 'the Food kept for the horse must be whole units that fit on the carriage'
    }
    return driveProblem(world, r, carriage)
  },
  apply(world, _sender, order) {
    const { residentId, carriageId, x, y, goods, returnGoods, keepFood } = order as HaulRequest
    const r = world.residents.find((x) => x.id === residentId)
    const carriage = world.carriages.find((k) => k.id === carriageId)
    // Two drivers ordered onto one carriage in the same tick: the first one drives it.
    if (!r || !carriage || driveProblem(world, r, carriage)) return
    r.order = {
      kind: 'haul',
      carriageId,
      from: { x: r.x, y: r.y },
      to: { x, y },
      goods: [...goods],
      returnGoods: [...(returnGoods ?? [])],
      keepFood,
      stop: 'from',
      phase: 'loading',
      path: null,
      progress: 0,
      moving: null,
    }
  },
}

/** The input of a stop order: which resident. */
interface StopRequest extends OrderRequest {
  kind: 'stop'
  residentId: string
}

/**
 * The stop order: one of the Player's residents stops what they were ordered to do, such as a
 * haul route, and stands idle.
 */
export const stop: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<StopRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return undefined
  },
  apply(world, _sender, order) {
    const r = world.residents.find((x) => x.id === (order as StopRequest).residentId)
    if (r) r.order = null
  },
}

/** One take a hauler requests next at a stop: a good, how many, from where, and where it goes. */
interface Transfer {
  good: Good
  units: number
  from: GoodsSpot
  onto: 'carriage' | 'stop'
}

/** How much of a good the route leaves on board when unloading: the Food kept for the horse. */
const kept = (o: HaulOrder, good: Good) => (good === 'food' ? o.keepFood : 0)

/**
 * The next take at the hauler's stop, if there is one: unloading what goes to this stop (`goods`
 * at `to`, `returnGoods` at `from`); topping up the Food kept for the horse; loading what goes
 * on from here (`goods` at `from`, `returnGoods` at `to`). Each take is no more than the hauler
 * can carry and, onto the carriage, no more than fits on it.
 */
function nextTransfer(
  world: WorldState,
  r: Resident,
  o: HaulOrder,
  carriage: Carriage,
  spot: GoodsSpot,
): Transfer | undefined {
  const load = carriage.load
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  const there = goodsAtSpot(world, r.x, r.y, spot) ?? {}
  const hands = (g: Good) => unitsThatFit(r, g, world.tick)
  const loadable = (g: Good) => Math.min(there[g] ?? 0, hands(g), unitsThatFitCarriage(carriage, g))
  const [unloading, loading] = o.stop === 'to' ? [o.goods, o.returnGoods] : [o.returnGoods, o.goods]
  for (const good of unloading) {
    const units = Math.min((load[good] ?? 0) - kept(o, good), hands(good))
    if (units > 0) return { good, units, from: onCarriage, onto: 'stop' }
  }
  const food = Math.min(o.keepFood - (load.food ?? 0), loadable('food'))
  if (food > 0) return { good: 'food', units: food, from: spot, onto: 'carriage' }
  for (const good of loading) {
    const units = loadable(good)
    if (units > 0) return { good, units, from: spot, onto: 'carriage' }
  }
  return undefined
}

/**
 * Requests this tick's takes and puts for residents on haul routes who stand at a stop
 * (`CONTEXT.md`: Haul route), and starts them driving on when they are done there. Each tick a
 * hauler either puts down what they took the tick before (only that, not their own goods), or
 * takes the next goods to move. With nothing left to move they drive to the other stop; at
 * `from` only once something of the route's goods is on board, so they wait for goods there.
 * A hauler whose carriage is gone or not with them stops.
 */
export function requestHauling(world: WorldState): CarryAction[] {
  const actions: CarryAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'haul' || o.phase !== 'loading') continue
    const carriage = world.carriages.find((k) => k.id === o.carriageId)
    if (!carriage || carriage.x !== r.x || carriage.y !== r.y) {
      r.order = null
      continue
    }
    const spot = haulStopSpot(world, r.x, r.y)
    if (o.moving) {
      const { good, before, onto } = o.moving
      o.moving = null
      const held = (r.carried[good] ?? 0) - before
      const to: GoodsSpot =
        onto === 'carriage' ? { kind: 'carriage', carriageId: carriage.id } : spot
      if (held > 0) {
        actions.push({ kind: 'put', residentId: r.id, spot: to, goods: { [good]: held } })
        continue
      }
    }
    const next = nextTransfer(world, r, o, carriage, spot)
    if (next) {
      o.moving = { good: next.good, before: r.carried[next.good] ?? 0, onto: next.onto }
      const goods = { [next.good]: next.units }
      actions.push({ kind: 'take', residentId: r.id, spot: next.from, goods })
      continue
    }
    const loaded = o.goods.some((g) => (carriage.load[g] ?? 0) > kept(o, g))
    if (o.stop === 'from' && !loaded) continue
    o.stop = o.stop === 'from' ? 'to' : 'from'
    o.phase = 'driving'
    o.path = null
    o.progress = 0
  }
  return actions
}
