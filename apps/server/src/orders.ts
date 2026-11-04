import {
  isDown,
  type Account,
  type OrderRequest,
  type ServerMessage,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { build } from './building.js'
import { tearDown } from './teardown.js'
import { breed } from './breeding.js'
import { drop, pickUp } from './carrying.js'
import { fetch, store } from './storing.js'
import { drive, unhitch } from './driving.js'
import { haul, stop } from './hauling.js'
import { pair } from './pairing.js'
import { relocate } from './relocating.js'
import { walkTo } from './walking.js'
import { workAt } from './work.js'
import { teach } from './teaching.js'
import { train } from './training.js'
import { allianceOrders } from './alliances.js'
import { climb } from './climbing.js'
import { dismount, mount } from './riding.js'
import { GETS_OFF_FIRST, board, getOff, getsOffFirst } from './passengers.js'
import { attack } from './combat.js'
import { noteGiven, underAttack } from './defence.js'
import { armyOrders, leaveOnOwnOrders, memberOrders } from './armies.js'
import { setGate } from './gates.js'
import { roadLine, wallLine } from './road-line.js'
import { contractOrders, pay } from './contracts.js'
import { buyCity } from './buying.js'
import { persuasionOrders } from './persuasion.js'
import { buy, sell } from './trading.js'
import { handInOrder, transfer } from './transfers.js'
import { buyOff } from './directives.js'
import { payDebt } from './trade-org-debt.js'
import { handOver } from './leader.js'
import { rename, renameCity, renameHorse } from './renaming.js'
import { claimHorses } from './horse-grant.js'
import { queueOrders } from './queues.js'
import { feed } from './reviving.js'
import { waypointOrders } from './waypoints.js'

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

/**
 * The order kind called `name`, if there is one. Only the kinds' own entries count: a name such as
 * `"constructor"` or `"toString"` would otherwise find a function inherited from
 * `Object.prototype`, and a client can send any name.
 */
export function orderKindOf(
  kinds: Record<string, OrderKind>,
  name: unknown,
): OrderKind | undefined {
  return typeof name === 'string' && Object.hasOwn(kinds, name) ? kinds[name] : undefined
}

/**
 * The order kinds that exist. Those that act on a tile get a passenger off their carriage first
 * (`CONTEXT.md`: Passenger, `GETS_OFF_FIRST`).
 */
export const orderKinds: Record<string, OrderKind> = Object.fromEntries(
  Object.entries({
    walkTo,
    drive,
    unhitch,
    haul,
    stop,
    pickUp,
    drop,
    store,
    fetch,
    build,
    tearDown,
    workAt,
    teach,
    train,
    breed,
    pair,
    relocate,
    attack,
    climb,
    mount,
    dismount,
    board,
    getOff,
    setGate,
    roadLine,
    wallLine,
    pay,
    buyCity,
    buy,
    sell,
    handIn: handInOrder,
    transfer,
    buyOff,
    payDebt,
    handOver,
    rename,
    renameCity,
    renameHorse,
    claimHorses,
    feed,
    ...allianceOrders,
    ...armyOrders,
    ...contractOrders,
    ...persuasionOrders,
    ...queueOrders,
    ...waypointOrders,
  }).map(([name, kind]) => [name, GETS_OFF_FIRST.includes(name) ? getsOffFirst(kind) : kind]),
)

/**
 * Why an order can't be given: a resident it is for is Down (`CONTEXT.md`: Down) and takes no
 * orders. Undefined when none is.
 */
export function downProblem(world: WorldState, order: OrderRequest): string | undefined {
  const ids: unknown[] = [order.residentId]
  if (Array.isArray(order.residentIds)) ids.push(...(order.residentIds as unknown[]))
  const down = world.residents.find((r) => isDown(r) && ids.includes(r.id))
  return down && `${down.name} is Down and takes no orders`
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
    const kind = orderKindOf(this.kinds, req.kind)
    if (!kind) {
      return { type: 'rejected', requestId: id, reason: `unknown order: ${String(req.kind)}` }
    }
    const reason = downProblem(world, req) ?? kind.validate(world, sender, req, this.terrain)
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
      // Gone Down since the order came, they no longer take it.
      if (downProblem(world, order)) continue
      // Any other order for a resident or army ends the script it runs (`CONTEXT.md`: Running a
      // script). Pairing, the Leader handover, renaming and claiming the Horse offer change
      // nobody's order, so they leave scripts running too, as do picking a param value and a
      // defence script (`CONTEXT.md`: Script parameter, Defence script), and putting down, renaming
      // and removing waypoints (Waypoint).
      // Editing a queue keeps its current step going (`CONTEXT.md`: Queue).
      const keeps = [
        'runScript',
        'pair',
        'handOver',
        'rename',
        'renameCity',
        'renameHorse',
        'claimHorses',
        'setScriptParam',
        'setDefenceScript',
        'editQueue',
        ...Object.keys(waypointOrders),
      ]
      const r = world.residents.find((x) => x.id === order.residentId)
      // An order replacing what they do, given under attack, stands against further blows
      // (`CONTEXT.md`: A Player's order under attack). What a script or queue requests itself
      // doesn't come through here.
      const replaces = r && (order.kind === 'runScript' || !keeps.includes(order.kind))
      const given = replaces ? { attacked: underAttack(world, r), order: r.order } : undefined
      if (r && !keeps.includes(order.kind)) {
        delete r.script
        // How their last store or fetch ended is kept until their next order.
        delete r.orderEnded
      }
      // Any order that isn't a step of it ends the resident's queue, running a script too; a new
      // queue replaces it. It ends a defence script and what it interrupted too (`CONTEXT.md`:
      // Defence script).
      if (replaces) {
        delete r.queue
        if (r.interrupted) {
          delete r.interrupted
          delete r.script
        }
      }
      if (order.kind !== 'armyRunScript') {
        const a = world.armies.find((x) => x.id === order.armyId)
        if (a) delete a.script
      }
      const toArmy = Object.hasOwn(armyOrders, order.kind) || order.kind === 'armyRunScript'
      const before = toArmy ? undefined : memberOrders(world)
      // Accepted by `receive`, so the kind exists.
      orderKindOf(this.kinds, order.kind)!.apply(world, sender, order, this.terrain)
      if (before) leaveOnOwnOrders(world, before)
      if (r && given) noteGiven(world, r, given.attacked, given.order)
    }
  }

  get size(): number {
    return this.pending.length
  }

  /** How many orders a Player has waiting for the next tick. */
  pendingFor(userId: number): number {
    return this.pending.filter((p) => p.sender.userId === userId).length
  }
}
