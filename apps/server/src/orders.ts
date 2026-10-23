import type { Account, OrderRequest, ServerMessage, TerrainMap, WorldState } from '@csp/shared'
import { build } from './building.js'
import { tearDown } from './teardown.js'
import { drop, pickUp } from './carrying.js'
import { drive } from './driving.js'
import { haul, stop } from './hauling.js'
import { pair } from './pairing.js'
import { walkTo } from './walking.js'
import { workAt } from './work.js'
import { allianceOrders } from './alliances.js'
import { climb } from './climbing.js'
import { attack } from './combat.js'
import { armyOrders, leaveOnOwnOrders, memberOrders } from './armies.js'
import { setGate } from './gates.js'
import { roadLine } from './road-line.js'
import { contractOrders, pay } from './contracts.js'
import { buyCity } from './buying.js'
import { persuasionOrders } from './persuasion.js'
import { buy, sell } from './trading.js'
import { handInOrder, transfer } from './transfers.js'
import { buyOff } from './directives.js'

/** Who sent an order: the Player's account and id. */
export interface OrderSender {
  userId: number
  account: Account
  /**
   * Set when an NPC city's game default sends it for one of the residents the city runs
   * (`CONTEXT.md`: NPC city, Default script); `userId` is then 0, nobody's.
   */
  npcCityId?: string
}

/**
 * One kind of UI order (ADR 0002). `validate` runs when the order arrives and returns a reason
 * to reject it; `apply` runs at the start of the next tick and may only set the order state
 * that later ticks turn into actions, never change the world directly.
 */
export interface OrderKind {
  validate(
    world: WorldState,
    sender: OrderSender,
    order: OrderRequest,
    terrain?: TerrainMap,
  ): string | undefined
  apply(world: WorldState, sender: OrderSender, order: OrderRequest, terrain?: TerrainMap): void
}

/** The order kinds that exist. */
export const orderKinds: Record<string, OrderKind> = {
  walkTo,
  drive,
  haul,
  stop,
  pickUp,
  drop,
  build,
  tearDown,
  workAt,
  pair,
  attack,
  climb,
  setGate,
  roadLine,
  pay,
  buyCity,
  buy,
  sell,
  handIn: handInOrder,
  transfer,
  buyOff,
  ...allianceOrders,
  ...armyOrders,
  ...contractOrders,
  ...persuasionOrders,
}

interface Pending {
  sender: OrderSender
  order: OrderRequest
}

/** Orders accepted during a tick, applied together at the start of the next one. */
export class OrderQueue {
  private pending: Pending[] = []

  /** `terrain`, when given, lets orders check the land, such as a stable going on Plains. */
  constructor(
    private kinds: Record<string, OrderKind> = orderKinds,
    private terrain?: TerrainMap,
  ) {}

  /** Checks an incoming order and answers it; a valid one waits for the next tick. */
  receive(
    world: WorldState,
    sender: OrderSender,
    requestId: unknown,
    order: unknown,
  ): ServerMessage {
    const id = typeof requestId === 'string' ? requestId : ''
    if (!id || typeof order !== 'object' || order === null) {
      return { type: 'rejected', requestId: id, reason: 'malformed order' }
    }
    const req = order as OrderRequest
    const kind = typeof req.kind === 'string' ? this.kinds[req.kind] : undefined
    if (!kind) return { type: 'rejected', requestId: id, reason: `unknown order: ${req.kind}` }
    const reason = kind.validate(world, sender, req, this.terrain)
    if (reason) return { type: 'rejected', requestId: id, reason }
    this.pending.push({ sender, order: req })
    return { type: 'ack', requestId: id }
  }

  /**
   * Applies the waiting orders in the order they came. A resident in an army who gets an order of
   * their own leaves it (`CONTEXT.md`: Army); orders to armies don't count.
   */
  applyAll(world: WorldState): void {
    const batch = this.pending
    this.pending = []
    for (const { sender, order } of batch) {
      // Any other order for a resident or army ends the script it runs (`CONTEXT.md`: Running a
      // script). Pairing changes nobody's order, so it leaves scripts running too.
      if (order.kind !== 'runScript' && order.kind !== 'pair') {
        const r = world.residents.find((x) => x.id === order.residentId)
        if (r) delete r.script
      }
      if (order.kind !== 'armyRunScript') {
        const a = world.armies.find((x) => x.id === order.armyId)
        if (a) delete a.script
      }
      const toArmy = order.kind in armyOrders || order.kind === 'armyRunScript'
      const before = toArmy ? undefined : memberOrders(world)
      this.kinds[order.kind]!.apply(world, sender, order, this.terrain)
      if (before) leaveOnOwnOrders(world, before)
    }
  }

  get size(): number {
    return this.pending.length
  }
}
