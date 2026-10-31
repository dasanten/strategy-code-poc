import {
  boardProblem,
  buildingAt,
  carriageOfResident,
  drivenCarriageId,
  inContact,
  isPassableTerrain,
  isWallOrGate,
  terrainAt,
  type OrderRequest,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { OrderKind } from './orders.js'
import { orderedResident } from './order-sender.js'
import { walkTo } from './walking.js'

/** The input of a board order: which resident boards which carriage. */
interface BoardRequest extends OrderRequest {
  kind: 'board'
  residentId: string
  carriageId: string
}

/**
 * The input of a get-off order: which resident gets off their carriage, and with `x` and `y` the
 * tile right next to it they step onto; without, they stay on its tile.
 */
interface GetOffRequest extends OrderRequest {
  kind: 'getOff'
  residentId: string
  x?: number
  y?: number
}

/**
 * The board order (`CONTEXT.md`: Passenger): one of the Player's residents gets on a carriage of
 * their realm on their tile that has room for them. Aboard they don't walk on their own, so what
 * they were doing stops; being aboard is no order, and they move with the carriage.
 */
export const board: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<BoardRequest>
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    return boardProblem(
      world,
      r,
      world.carriages.find((k) => k.id === o.carriageId),
    )
  },
  apply(world, _sender, order) {
    const { residentId, carriageId } = order as BoardRequest
    const r = world.residents.find((x) => x.id === residentId)
    const carriage = world.carriages.find((k) => k.id === carriageId)
    // Two residents ordered onto the last room in the same tick: the first one boards.
    if (!r || boardProblem(world, r, carriage)) return
    r.aboard = carriageId
    r.order = null
  },
}

/**
 * Why a passenger can't get off onto (x, y), or undefined when they can (`CONTEXT.md`: Passenger):
 * a tile right next to their carriage that is walkable and has no wall or gate on it.
 */
function getOffTileProblem(
  world: WorldState,
  r: Resident,
  x: unknown,
  y: unknown,
  terrain: TerrainMap | undefined,
): string | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'the target must be a tile'
  const at = { x: x as number, y: y as number }
  const size = terrain?.size
  if (size === undefined) return undefined
  if (!inContact(size, r, at)) return 'that tile is not next to the carriage'
  if (!isPassableTerrain(terrainAt(terrain!, at.x, at.y))) return 'nobody can stand there'
  const b = buildingAt(world, at.x, at.y, size)
  if (b && isWallOrGate(b)) return 'a wall or gate stands there'
  return undefined
}

/**
 * The get-off order (`CONTEXT.md`: Passenger): a passenger gets off onto their carriage's tile,
 * or with a tile right next to it, steps over onto that one (a walk).
 */
export const getOff: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<GetOffRequest>
    const r = orderedResident(world, sender, o.residentId)
    if (!r) return 'not one of your residents'
    if (r.aboard === undefined) return 'not aboard a carriage'
    if (o.x === undefined && o.y === undefined) return undefined
    return getOffTileProblem(world, r, o.x, o.y, terrain)
  },
  apply(world, sender, order, terrain) {
    const { residentId, x, y } = order as GetOffRequest
    const r = world.residents.find((p) => p.id === residentId)
    if (!r || r.aboard === undefined) return
    delete r.aboard
    if (x === undefined || y === undefined) return
    walkTo.apply(world, sender, { kind: 'walkTo', residentId, x, y }, terrain)
  },
}

/**
 * The orders that act on a tile, and so get a passenger off their carriage first (`CONTEXT.md`:
 * Passenger): walking anywhere, driving, unhitching, goods, building, work, fighting, climbing, mounting,
 * trading. They get off onto the carriage's tile, where they stand, and the order goes on.
 */
export const GETS_OFF_FIRST: readonly string[] = [
  'walkTo',
  'drive',
  'unhitch',
  'haul',
  'pickUp',
  'drop',
  'store',
  'fetch',
  'build',
  'tearDown',
  'workAt',
  'teach',
  'train',
  'breed',
  'attack',
  'climb',
  'mount',
  'roadLine',
  'wallLine',
  'buyCity',
  'buy',
  'sell',
  'handIn',
  'transfer',
  'buyOff',
]

/** An order kind that first gets the ordered resident off their carriage (`GETS_OFF_FIRST`). */
export function getsOffFirst(kind: OrderKind): OrderKind {
  return {
    validate: kind.validate,
    apply(world, sender, order, terrain) {
      const r = world.residents.find((x) => x.id === order.residentId)
      if (r) delete r.aboard
      kind.apply(world, sender, order, terrain)
    },
  }
}

/**
 * Ends being aboard that can't go on (`CONTEXT.md`: Passenger), at the end of each tick: the
 * carriage is gone or no longer the passenger's realm's, the passenger drives or rides now, or
 * left its tile, as by an order that moved them without getting them off. They stand where they
 * are.
 */
export function stepPassengers(world: WorldState): void {
  for (const r of world.residents) {
    if (r.aboard === undefined) continue
    const carriage = world.carriages.find((k) => k.id === r.aboard)
    if (
      !carriage ||
      carriage.x !== r.x ||
      carriage.y !== r.y ||
      !carriageOfResident(carriage, r) ||
      drivenCarriageId(r) !== undefined ||
      r.riding !== undefined
    ) {
      delete r.aboard
    }
  }
}
